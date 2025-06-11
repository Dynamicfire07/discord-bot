import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const commands = [
  {
    name: 'profile',
    description: 'Create your profile with subjects',
    // subject select handled dynamically in interaction
  },
  {
    name: 'viewprofile',
    description: 'View another user’s subject profile.',
    options: [{ name: 'user', type: 6, description: 'User to view', required: true }]
  },
  {
    name: 'test-add',
    description: 'Add a test reminder for a subject',
    options: [
      { name: 'subject', type: 3, description: 'Subject', required: true },
      { name: 'date', type: 3, description: 'dd/mm/yyyy', required: true },
      { name: 'portion', type: 3, description: 'Portion', required: true }
    ]
  },
  {
    name: 'test-list',
    description: 'List all upcoming tests'
  },
  {
    name: 'pomdorro',
    description: 'Start Pomodoro',
    options: [
      { name: 'studytime', type: 4, description: 'Study time (min)', required: true },
      { name: 'breaktime', type: 4, description: 'Break time (min)', required: true },
      { name: 'sessioncount', type: 4, description: 'Number of sessions', required: true }
    ]
  },
  {
    name: 'summarize',
    description: 'Upload a PDF and summarize',
    options: [{ name: 'file', description: 'PDF file', type: 11, required: true }]
  },
  {
    name: 'explain',
    description: 'Explain any question',
    options: [{ name: 'question', type: 3, description: 'Your question', required: true }]
  },
  {
    name: 'exam-plan',
    description: 'Generate AI-powered exam plan'
  }
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log('Deploying slash commands...');
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('Slash commands deployed!');
} catch (err) {
  console.error(err);
}