// my-discord-bot/index.js
require('dotenv').config(); // Load environment variables from .env file
const fs = require('fs');
const path = require('path');
const db = require('./database');
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
            const getSubjects = db.prepare(`
                SELECT s.name FROM subjects s
                JOIN user_subjects us ON s.id = us.subject_id
                WHERE us.user_id = ?
            `);
            const subjects = getSubjects.all(user.id).map(row => row.name);

            if (!subjects || subjects.length === 0) {
                return interaction.reply({
                    content: `${user} hasn't created a profile.`,
                    ephemeral: false
                });
            }

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(`${user.username}'s Subject Profile`)
                .setDescription(subjects.map((s, i) => `**${i + 1}.** ${s}`).join('\n'))
                .setColor(0x1abc9c);

            return interaction.reply({ embeds: [embed] });
        } else if (commandName === 'test-add') {
            const subject = interaction.options.getString('subject');
            const dateStr = interaction.options.getString('date'); // Expected format: dd/mm/yyyy
            const portion = interaction.options.getString('portion');

            const [day, month, year] = dateStr.split('/').map(Number);
            const testDate = new Date(year, month - 1, day, 9); // Default to 9AM

            if (isNaN(testDate)) {
                return interaction.reply({ content: 'Invalid date format. Use dd/mm/yyyy.', ephemeral: true });
            }

            // Ensure subject exists
            const getSubject = db.prepare('SELECT id FROM subjects WHERE name = ?');
            const insertSubject = db.prepare('INSERT INTO subjects (name) VALUES (?)');
            let subjectRow = getSubject.get(subject);
            if (!subjectRow) {
                const allSubjects = db.prepare('SELECT name FROM subjects').all().map(row => row.name);
                if (!allSubjects.includes(subject)) {
                    return interaction.reply({
                        content: `Subject **${subject}** not found.\nAvailable subjects:\n- ${allSubjects.join('\n- ')}`,
                        ephemeral: true
                    });
                }
                insertSubject.run(subject);
                subjectRow = getSubject.get(subject);
            }

            // Insert test
            db.prepare('INSERT INTO tests (subject_id, date, portion) VALUES (?, ?, ?)').run(subjectRow.id, testDate.toISOString(), portion);
            await interaction.reply({ content: `Test for **${subject}** added on **${dateStr}**.\nPortion: ${portion}`, ephemeral: false });

            const getUsersForSubject = db.prepare(`
                SELECT u.id FROM users u
                JOIN user_subjects us ON u.id = us.user_id
                WHERE us.subject_id = ?
            `);
            const userRows = getUsersForSubject.all(subjectRow.id);
            const userMentions = userRows.map(u => `<@${u.id}>`).join(', ');

            const reminders = [-7, -3, -2, -1, 0]; // days before
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
            // Fetch all upcoming tests with subject info
            const tests = db.prepare(`
                SELECT t.id, t.date, t.portion, s.id AS subject_id, s.name AS subject
                FROM tests t
                JOIN subjects s ON t.subject_id = s.id
                ORDER BY t.date ASC
            `).all();

            if (tests.length === 0) {
                return interaction.reply({ content: 'No upcoming tests found.', ephemeral: true });
            }

            // Get all user-subject links at once for efficient mapping
            const userSubjectLinks = db.prepare(`
                SELECT us.subject_id, u.id as user_id
                FROM user_subjects us
                JOIN users u ON u.id = us.user_id
            `).all();
            // Build a mapping from subject_id to array of user_ids
            const subjectToUsers = {};
            for (const row of userSubjectLinks) {
                if (!subjectToUsers[row.subject_id]) subjectToUsers[row.subject_id] = [];
                subjectToUsers[row.subject_id].push(row.user_id);
            }

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(`📅 Upcoming Tests`)
                .setColor(0x7289da);

            tests.forEach((test, i) => {
                const userIds = subjectToUsers[test.subject_id] || [];
                const mentions = userIds.length > 0 ? userIds.map(uid => `<@${uid}>`).join(', ') : 'No one assigned';

                const testDate = new Date(test.date);
                const formattedDate = testDate.toLocaleDateString('en-GB', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                });

                embed.addFields({
                    name: `${i + 1}. ${test.subject} — ${formattedDate}`,
                    value: `**Portion**: ${test.portion}\n**Students**: ${mentions}`,
                });
            });

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
                    await interaction.editReply('📝 **Summary is too long. Splitting into parts:**');
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
                    await interaction.editReply('📚 **Explanation is too long. Splitting into parts:**');
                    const parts = answer.match(/[\s\S]{1,1900}/g);
                    for (const part of parts) {
                        await interaction.followUp(part);
                    }
                }
            } catch (err) {
                console.error(err);
                await interaction.editReply('❌ Failed to generate explanation.');
            }
        } else if (commandName === 'exam-plan') {
            const userId = interaction.user.id;
            const username = interaction.user.username;

            const tests = db.prepare(`
                SELECT t.date, t.portion, s.name AS subject
                FROM tests t
                JOIN subjects s ON t.subject_id = s.id
                JOIN user_subjects us ON s.id = us.subject_id
                WHERE us.user_id = ?
                ORDER BY t.date ASC
            `).all(userId);

            if (tests.length === 0) {
                return interaction.reply({ content: 'You have no upcoming exams scheduled.', ephemeral: true });
            }

            const today = new Date();
            const examInfo = tests.map(test => {
                const examDate = new Date(test.date);
                const examDateStr = examDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
                return `${test.subject} on ${examDateStr} for ${test.portion}`;
            }).join(', ');

            const prompt = `${interaction.user.username} has upcoming exams: ${examInfo}. Today is ${today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. You are a smart assistant who will help him make a timetable to efficiently approach the exams to make sure he gets a good grade and what he should study. You should provide a list of what he should study on each day till the final day. The day before the exam should only focus on that subject. Your response should be straight to the point with no extra fluff.`;

            await interaction.reply('🗓️ Generating your study plan...');

            try {
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "You are an efficient AI study planner." },
                        { role: "user", content: prompt }
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                const plan = completion.choices[0]?.message?.content || "Unable to generate a study plan.";

                if (plan.length <= 2000) {
                    await interaction.editReply(`🗓️ **Study Plan:**\n${plan}`);
                } else {
                    await interaction.editReply('🗓️ **Study Plan is too long. Splitting into parts:**');
                    const parts = plan.match(/[\s\S]{1,1900}/g);
                    for (const part of parts) {
                        await interaction.followUp(part);
                    }
                }
            } catch (err) {
                console.error(err);
                await interaction.editReply('❌ Failed to generate study plan.');
            }
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'subject-select') {
            const userId = interaction.user.id;
            const username = interaction.user.tag;
            const selectedSubjects = interaction.values;

            // Insert or update user
            db.prepare('INSERT OR REPLACE INTO users (id, username) VALUES (?, ?)').run(userId, username);

            // Clear previous subjects
            db.prepare('DELETE FROM user_subjects WHERE user_id = ?').run(userId);

            const getSubjectId = db.prepare('SELECT id FROM subjects WHERE name = ?');
            const insertSubject = db.prepare('INSERT INTO subjects (name) VALUES (?)');
            const linkUserSubject = db.prepare('INSERT OR IGNORE INTO user_subjects (user_id, subject_id) VALUES (?, ?)');

            for (const subject of selectedSubjects) {
                let row = getSubjectId.get(subject);
                if (!row) {
                    insertSubject.run(subject);
                    row = getSubjectId.get(subject);
                }
                linkUserSubject.run(userId, row.id);
            }

            await interaction.update({ content: 'Profile saved!', components: [] });
        }
    }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
