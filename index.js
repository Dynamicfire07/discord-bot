// my-discord-bot/index.js
require('dotenv').config(); // Load environment variables from .env file
const fs = require('fs');
const path = require('path');
const database = require('./database');
const { ObjectId } = require('mongodb');
const {
    Client,
    Events,
    GatewayIntentBits,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require('discord.js');
const Groq = require('groq-sdk');
const pdfParse = require('pdf-parse');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const fetch = require('node-fetch');

// Available subjects a user can choose from
const SUBJECTS = [
    'IB Math AA',
    'IB Math AI',
    'IB Spanish AB',
    'IB English LAL',
    'IB Economics',
    'IB Business Management',
    'IB Hindi B',
    'IB Physics',
    'IB Chemistry',
    'IB ESS'
];

// Simple JSON based storage for user profiles
const profilesPath = path.join(__dirname, 'data', 'profiles.json');

function loadProfiles() {
    try {
        return JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    } catch (err) {
        return {};
    }
}

function saveProfiles(profiles) {
    fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
}

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// When the client is ready, run this once
client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

// Listen for interactions (like slash commands)
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'test') {
            await interaction.reply('test complete');
        } else if (commandName === 'profile') {
            const menu = new StringSelectMenuBuilder()
                .setCustomId('subject-select')
                .setPlaceholder('Select your subjects')
                .setMinValues(1)
                .setMaxValues(SUBJECTS.length)
                .addOptions(SUBJECTS.map(s => ({ label: s, value: s })));

            const row = new ActionRowBuilder().addComponents(menu);

            await interaction.reply({
                content: 'Choose your subjects:',
                components: [row],
                ephemeral: true
            });
        } else if (commandName === 'viewprofile') {
            const user = interaction.options.getUser('user');
            const db = await database.connect();
            const usersCollection = db.collection('users');
            const subjectsCollection = db.collection('subjects');
            
            const userData = await usersCollection.findOne({ _id: user.id });
            if (!userData || !userData.subjects || userData.subjects.length === 0) {
                return interaction.reply({
                    content: `${user} hasn't created a profile.`,
                    ephemeral: false
                });
            }
            
            const subjectIds = userData.subjects.map(id => new ObjectId(id));
            const subjects = await subjectsCollection.find({ _id: { $in: subjectIds } }).toArray();
            const subjectNames = subjects.map(s => s.name);
        
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(`${user.username}'s Subject Profile`)
                .setDescription(subjectNames.map((s, i) => `**${i + 1}.** ${s}`).join('\n'))
                .setColor(0x1abc9c);
        
            return interaction.reply({ embeds: [embed] });
        } else if (commandName === 'test-add') {
            const subject = interaction.options.getString('subject');
            const dateStr = interaction.options.getString('date');
            const portion = interaction.options.getString('portion');

            const [day, month, year] = dateStr.split('/').map(Number);
            const testDate = new Date(year, month - 1, day, 9);

            if (isNaN(testDate)) {
                return interaction.reply({ content: 'Invalid date format. Use dd/mm/yyyy.', ephemeral: true });
            }

            const db = await database.connect();
            const subjectsCollection = db.collection('subjects');
            let subjectDoc = await subjectsCollection.findOne({ name: subject });

            if (!subjectDoc) {
                const allSubjects = await subjectsCollection.find().toArray();
                const subjectNames = allSubjects.map(s => s.name);
                if (!subjectNames.includes(subject)) {
                    return interaction.reply({
                        content: `Subject **${subject}** not found.\nAvailable subjects:\n- ${subjectNames.join('\n- ')}`,
                        ephemeral: true
                    });
                }
                await subjectsCollection.insertOne({ name: subject });
                subjectDoc = await subjectsCollection.findOne({ name: subject });
            }

            await database.createTest(subjectDoc._id, testDate, portion);
            await interaction.reply({ content: `Test for **${subject}** added on **${dateStr}**.\nPortion: ${portion}`, ephemeral: false });

            const usersCollection = db.collection('users');
            const usersForSubject = await usersCollection.find({ subjects: subjectDoc._id }).toArray();
            const userMentions = usersForSubject.map(u => `<@${u._id}>`).join(', ');

            const reminders = [-7, -3, -2, -1, 0];
            reminders.forEach(daysBefore => {
                const reminderDate = new Date(testDate);
                reminderDate.setDate(reminderDate.getDate() + daysBefore);
                if (daysBefore === 0) reminderDate.setHours(testDate.getHours() - 1);

                const msUntilReminder = reminderDate.getTime() - Date.now();
                if (msUntilReminder > 0) {
                    setTimeout(() => {
                        interaction.channel.send({
                            content: `${userMentions}\nYou have an upcoming test on **${dateStr}** for **${subject}**.\n📚 Portion: ${portion}`
                        });
                    }, msUntilReminder);
                }
            });
        } else if (commandName === 'test-list') {
            const db = await database.connect();
            const testsCollection = db.collection('tests');
            const subjectsCollection = db.collection('subjects');
            const usersCollection = db.collection('users');

            const tests = await testsCollection.find().sort({ date: 1 }).toArray();

            if (tests.length === 0) {
                return interaction.reply({ content: 'No upcoming tests found.', ephemeral: true });
            }

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(`📅 Upcoming Tests`)
                .setColor(0x7289da);

            for (let i = 0; i < tests.length; i++) {
                const test = tests[i];
                const subject = await subjectsCollection.findOne({ _id: new ObjectId(test.subject_id) });

                const usersForSubject = await usersCollection.find({ subjects: subject._id }).toArray();
                const mentions = usersForSubject.length > 0 
                    ? usersForSubject.map(u => `<@${u._id}>`).join(', ')
                    : 'No one assigned';

                const testDate = new Date(test.date);
                const formattedDate = testDate.toLocaleDateString('en-GB', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                });

                embed.addFields({
                    name: `${i + 1}. ${subject.name} — ${formattedDate}`,
                    value: `**Portion**: ${test.portion}\n**Students**: ${mentions}`,
                });
            }

            await interaction.reply({ embeds: [embed] });
        } else if (commandName === 'pomdorro') {
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
            const studyTime = interaction.options.getInteger('studytime');
            const breakTime = interaction.options.getInteger('breaktime');
            const sessionCount = interaction.options.getInteger('sessioncount');
            const userId = interaction.user.id;
            const userMention = `<@${userId}>`;
            const channel = interaction.channel;

            let currentSession = 1;
            let phase = 'study';
            let remainingTime = studyTime * 60;
            let isPaused = false;
            let interval = null;

            const embed = new EmbedBuilder()
                .setTitle('🍅 Pomodoro Timer')
                .setDescription(`${userMention}, Session ${currentSession}/${sessionCount} — **Study**\nTime Remaining: ${formatTime(remainingTime)}`)
                .setColor(0xff5733);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pause').setLabel('Pause').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('resume').setLabel('Resume').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
            );

            const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

            function formatTime(seconds) {
                const m = String(Math.floor(seconds / 60)).padStart(2, '0');
                const s = String(seconds % 60).padStart(2, '0');
                return `${m}:${s}`;
            }

            function updateEmbed() {
                embed.setDescription(`${userMention}, Session ${currentSession}/${sessionCount} — **${phase === 'study' ? 'Study' : 'Break'}**\nTime Remaining: ${formatTime(remainingTime)}`);
                msg.edit({ embeds: [embed] });
            }

            function switchPhase() {
                if (phase === 'study') {
                    phase = 'break';
                    remainingTime = breakTime * 60;
                    channel.send(`${userMention} ☕ It's break time!`);
                } else {
                    currentSession++;
                    if (currentSession > sessionCount) {
                        msg.edit({
                            embeds: [embed.setDescription(`${userMention}, 🎉 All ${sessionCount} Pomodoro sessions complete!`)],
                            components: []
                        });
                        const totalMinutes = studyTime * sessionCount;
                        const hrs = Math.floor(totalMinutes / 60);
                        const mins = totalMinutes % 60;
                        const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                        channel.send(`${userMention} 🎉 GOOD JOB studying for ${timeStr}!`);
                        clearInterval(interval);
                        return;
                    }
                    phase = 'study';
                    remainingTime = studyTime * 60;
                    channel.send(`${userMention} 📚 It's time to study!`);
                }
                updateEmbed();
            }

            function startTimer() {
                interval = setInterval(() => {
                    if (!isPaused) {
                        remainingTime--;
                        updateEmbed();
                        if (remainingTime <= 0) {
                            switchPhase();
                        }
                    }
                }, 1000);
            }

            startTimer();

            const collector = msg.createMessageComponentCollector({
                time: (studyTime + breakTime) * sessionCount * 60 * 1000
            });

            collector.on('collect', async i => {
                if (i.user.id !== userId) {
                    return i.reply({ content: 'You cannot control this timer.', ephemeral: true });
                }

                if (i.customId === 'pause') {
                    isPaused = true;
                    row.components[0].setDisabled(true);
                    row.components[1].setDisabled(false);
                    await i.update({ components: [row] });
                } else if (i.customId === 'resume') {
                    isPaused = false;
                    row.components[0].setDisabled(false);
                    row.components[1].setDisabled(true);
                    await i.update({ components: [row] });
                } else if (i.customId === 'cancel') {
                    clearInterval(interval);
                    collector.stop();
                    await i.update({
                        embeds: [embed.setDescription(`${userMention}, ❌ Pomodoro timer cancelled.`)],
                        components: []
                    });
                }
            });
        } else if (commandName === 'summarize') {
            if (!interaction.options.getAttachment('file')) {
                return interaction.reply({ content: 'Please upload a PDF file.', ephemeral: true });
            }

            const attachment = interaction.options.getAttachment('file');
            if (!attachment.name.endsWith('.pdf')) {
                return interaction.reply({ content: 'Only PDF files are supported.', ephemeral: true });
            }

            await interaction.reply('📄 Processing your PDF file. Please wait...');

            try {
                const response = await fetch(attachment.url);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const data = await pdfParse(buffer);
                const textContent = data.text.slice(0, 15000);

                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "You are a helpful AI assistant that summarizes PDF content for students." },
                        { role: "user", content: `Summarize this PDF:\n\n${textContent}` }
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                const summary = completion.choices[0]?.message?.content || "Unable to summarize.";

                if (summary.length <= 2000) {
                    await interaction.editReply(`📝 **Summary:**\n${summary}`);
                } else {
                    await interaction.editReply('📝 **Summary too long. Splitting into parts:**');
                    const parts = summary.match(/[\s\S]{1,1900}/g);
                    for (const part of parts) {
                        await interaction.followUp(part);
                    }
                }
            } catch (err) {
                console.error(err);
                await interaction.editReply('❌ Failed to process the file.');
            }
        } else if (commandName === 'explain') {
            const question = interaction.options.getString('question');
            await interaction.reply('🧠 Thinking...');
            try {
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "You are a helpful tutor that explains concepts in simple, clear language for students." },
                        { role: "user", content: `Explain: ${question}` }
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                const answer = completion.choices[0]?.message?.content || "I'm unable to explain that right now.";

                if (answer.length <= 2000) {
                    await interaction.editReply(`📚 **Explanation:**\n${answer}`);
                } else {
                    await interaction.editReply('📚 **Explanation too long. Splitting into parts:**');
                    const parts = answer.match(/[\s\S]{1,1900}/g);
                    for (const part of parts) {
                        await interaction.followUp(part);
                    }
                }
            } catch (err) {
                console.error(err);
                await interaction.editReply('❌ Failed to generate explanation.');
            }
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'subject-select') {
            const userId = interaction.user.id;
            const username = interaction.user.tag;
            const selectedSubjects = interaction.values;

            await database.createUser(userId, username);
            const db = await database.connect();
            const subjectsCollection = db.collection('subjects');
            const usersCollection = db.collection('users');

            for (const subject of selectedSubjects) {
                let subjectDoc = await subjectsCollection.findOne({ name: subject });
                if (!subjectDoc) {
                    await subjectsCollection.insertOne({ name: subject });
                    subjectDoc = await subjectsCollection.findOne({ name: subject });
                }
                await usersCollection.updateOne(
                    { _id: userId },
                    { $addToSet: { subjects: subjectDoc._id } }
                );
            }

            await interaction.update({ content: 'Profile saved!', components: [] });
        }
    }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
