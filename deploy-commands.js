// my-discord-bot/deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
    {
        name: 'test',
        description: 'Responds with "test complete".',
    },
    {
        name: 'test-list',
        description: 'List all upcoming tests with student mentions'
    },
    {
        name: 'profile',
        description: 'Create or update your profile with subjects. (Can only be used once)',
    },
    {
        name: 'viewprofile',
        description: 'View another user’s subject profile.',
        options: [
            {
                name: 'user',
                type: 6, // USER type
                description: 'The user whose profile you want to view',
                required: true,
            },
        ],
    },
    {
        name: 'test-add',
        description: 'Add a test reminder for a subject',
        options: [
            {
                name: 'subject',
                type: 3, // STRING
                description: 'Subject of the test',
                required: true,
            },
            {
                name: 'date',
                type: 3, // STRING
                description: 'Date of the test in dd/mm/yyyy format',
                required: true,
            },
            {
                name: 'portion',
                type: 3, // STRING
                description: 'Portion of the test',
                required: true,
            },
        ],
    },
    {
        name: 'pomdorro',
        description: 'Start a Pomodoro timer with custom study and break intervals.',
        options: [
            {
                name: 'studytime',
                type: 4, // INTEGER
                description: 'Study time in minutes',
                required: true,
            },
            {
                name: 'breaktime',
                type: 4, // INTEGER
                description: 'Break time in minutes',
                required: true,
            },
            {
                name: 'sessioncount',
                type: 4, // INTEGER
                description: 'Number of Pomodoro sessions',
                required: true,
            },
        ],
    },
    {
        name: 'summarize',
        description: 'Upload a PDF file and get its AI summary.',
        options: [
            {
                name: 'file',
                description: 'PDF file to summarize',
                type: 11, // ATTACHMENT type
                required: true
            }
        ]
    },
    {
        name: 'explain',
        description: 'Ask any question and get a simple AI-powered explanation.',
        options: [
            {
                name: 'question',
                type: 3, // STRING
                description: 'Your question to explain',
                required: true
            }
        ]
    },
    {
        name: 'exam-plan',
        description: 'Generate an AI-powered study plan based on your upcoming exams.'
    },
    {
        name: 'deadline',
        description: 'Add a deadline for a subject.',
        options: [
            {
                name: 'subject',
                type: 3, // STRING
                description: 'Subject name',
                required: true
            },
            {
                name: 'work',
                type: 3, // STRING
                description: 'Work or assignment description',
                required: true
            },
            {
                name: 'date',
                type: 3, // STRING
                description: 'Deadline date (dd/mm/yyyy)',
                required: true
            }
        ]
    }
];
// Grab the Bot Token, Client ID, and Guild ID from the .env file
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
console.log('Token:', token); // Should print 'Token: <starts with M...>'

// Construct and prepare an instance of the REST module
const rest = new REST({ version: '10' }).setToken(token);

// Deploy your commands!
(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // The put method is used to fully refresh all commands in the guild with the current set
        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        // And of course, make sure you catch and log any errors!
        console.error(error);
    }
})();
