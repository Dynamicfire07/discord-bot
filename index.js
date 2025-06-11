// index.js - Fully Production AI Discord Bot (MySQL Powered)

import dotenv from 'dotenv';
dotenv.config();

import { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, Events } from 'discord.js';
import Groq from 'groq-sdk';
import pdfParse from 'pdf-parse';
import fetch from 'node-fetch';
import mysql from 'mysql2/promise';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const db = await mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const SUBJECTS = [
  'IB Math AA','IB Math AI','IB Spanish AB','IB English LAL','IB Economics','IB Business Management','IB Hindi B','IB Physics','IB Chemistry','IB ESS'
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`Ready! Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const commandName = interaction.commandName;

    if (commandName === 'profile') {
      const menu = new StringSelectMenuBuilder()
        .setCustomId('subject-select')
        .setPlaceholder('Select your subjects')
        .setMinValues(1)
        .setMaxValues(SUBJECTS.length)
        .addOptions(SUBJECTS.map(s => ({ label: s, value: s })));

      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.reply({ content: 'Choose your subjects:', components: [row], ephemeral: true });

    } else if (commandName === 'viewprofile') {
      const user = interaction.options.getUser('user');
      const [subjects] = await db.execute(
        `SELECT s.name FROM subjects s JOIN user_subjects us ON s.id = us.subject_id WHERE us.user_id = ?`,
        [user.id]
      );
      if (subjects.length === 0) {
        return interaction.reply(`${user} hasn't created a profile.`);
      }
      const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s Subject Profile`)
        .setDescription(subjects.map((s, i) => `**${i + 1}.** ${s.name}`).join('\n'))
        .setColor(0x1abc9c);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === 'test-add') {
      const subject = interaction.options.getString('subject');
      const dateStr = interaction.options.getString('date');
      const portion = interaction.options.getString('portion');
      const [day, month, year] = dateStr.split('/').map(Number);
      const testDate = new Date(year, month - 1, day);

      let [subjectRows] = await db.execute('SELECT id FROM subjects WHERE name = ?', [subject]);
      let subjectId;
      if (subjectRows.length === 0) {
        const [result] = await db.execute('INSERT INTO subjects (name) VALUES (?)', [subject]);
        subjectId = result.insertId;
      } else {
        subjectId = subjectRows[0].id;
      }

      await db.execute('INSERT INTO tests (subject_id, date, portion) VALUES (?, ?, ?)', [subjectId, testDate.toISOString(), portion]);
      await interaction.reply(`Test for **${subject}** added on **${dateStr}**. Portion: ${portion}`);

    } else if (commandName === 'test-list') {
      const [tests] = await db.execute(
        `SELECT t.date, t.portion, s.name FROM tests t JOIN subjects s ON t.subject_id = s.id ORDER BY t.date ASC`
      );
      if (tests.length === 0) {
        return interaction.reply('No upcoming tests found.');
      }
      const embed = new EmbedBuilder().setTitle('📅 Upcoming Tests').setColor(0x7289da);
      tests.forEach((test, i) => {
        const formatted = new Date(test.date).toLocaleDateString('en-GB');
        embed.addFields({ name: `${i + 1}. ${test.name} — ${formatted}`, value: `**Portion**: ${test.portion}` });
      });
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === 'summarize') {
      const attachment = interaction.options.getAttachment('file');
      if (!attachment.name.endsWith('.pdf')) return interaction.reply('Only PDF files supported.');
      await interaction.reply('📄 Processing PDF...');
      try {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const data = await pdfParse(buffer);
        const textContent = data.text.slice(0, 15000);
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'system', content: 'You summarize PDFs.' }, { role: 'user', content: textContent }],
          model: 'llama-3.3-70b-versatile',
        });
        const summary = completion.choices[0]?.message?.content || 'Unable to summarize.';
        if (summary.length <= 2000) {
          await interaction.editReply(`📝 **Summary:**\n${summary}`);
        } else {
          await interaction.editReply('📝 **Summary too long. Splitting:**');
          const parts = summary.match(/.{1,1900}/gs);
          for (const part of parts) await interaction.followUp(part);
        }
      } catch (err) {
        console.error(err);
        await interaction.editReply('❌ Failed to process file.');
      }

    } else if (commandName === 'explain') {
      const question = interaction.options.getString('question');
      await interaction.reply('🧠 Thinking...');
      try {
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'system', content: 'You explain concepts simply.' }, { role: 'user', content: `Explain: ${question}` }],
          model: 'llama-3.3-70b-versatile',
        });
        const answer = completion.choices[0]?.message?.content || 'Unable to explain.';
        if (answer.length <= 2000) {
          await interaction.editReply(`📚 **Explanation:**\n${answer}`);
        } else {
          await interaction.editReply('📚 **Explanation too long. Splitting:**');
          const parts = answer.match(/.{1,1900}/gs);
          for (const part of parts) await interaction.followUp(part);
        }
      } catch (err) {
        console.error(err);
        await interaction.editReply('❌ Failed to generate explanation.');
      }

    } else if (commandName === 'exam-plan') {
      const userId = interaction.user.id;
      const today = new Date();
      const [tests] = await db.execute(`
        SELECT t.date, t.portion, s.name FROM tests t 
        JOIN subjects s ON t.subject_id = s.id 
        JOIN user_subjects us ON s.id = us.subject_id WHERE us.user_id = ? ORDER BY t.date ASC`, [userId]);

      if (tests.length === 0) return interaction.reply('No exams scheduled.');

      const examInfo = tests.map(t => `${t.name} on ${new Date(t.date).toLocaleDateString('en-GB')} for ${t.portion}`).join(', ');
      const prompt = `${interaction.user.username} has exams: ${examInfo}. Today is ${today.toLocaleDateString('en-GB')}. You are a smart assistant who will create a daily timetable.`;

      await interaction.reply('🗓️ Generating study plan...');
      try {
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'system', content: 'You generate exam revision plans.' }, { role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
        });
        const plan = completion.choices[0]?.message?.content || 'Unable to generate plan.';
        if (plan.length <= 2000) {
          await interaction.editReply(`🗓️ **Plan:**\n${plan}`);
        } else {
          await interaction.editReply('🗓️ **Plan too long. Splitting:**');
          const parts = plan.match(/.{1,1900}/gs);
          for (const part of parts) await interaction.followUp(part);
        }
      } catch (err) {
        console.error(err);
        await interaction.editReply('❌ Failed to generate plan.');
      }
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'subject-select') {
    const userId = interaction.user.id;
    const selectedSubjects = interaction.values;

    await db.execute('INSERT INTO users (id) VALUES (?) ON DUPLICATE KEY UPDATE id=id', [userId]);
    await db.execute('DELETE FROM user_subjects WHERE user_id = ?', [userId]);

    for (const subject of selectedSubjects) {
      const [rows] = await db.execute('SELECT id FROM subjects WHERE name = ?', [subject]);
      const subjectId = rows.length ? rows[0].id : (await db.execute('INSERT INTO subjects (name) VALUES (?)', [subject]))[0].insertId;
      await db.execute('INSERT INTO user_subjects (user_id, subject_id) VALUES (?, ?)', [userId, subjectId]);
    }

    await interaction.update({ content: '✅ Profile saved!', components: [] });
  }
});

client.login(process.env.DISCORD_TOKEN);