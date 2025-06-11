// database.js
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();



// Initialize DB in ./data/bot.db
const dbPath = path.join(__dirname, 'data', 'bot.db');
const db = new Database(dbPath);

// USERS table
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT
);`).run();

// SUBJECTS table
db.prepare(`
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
);`).run();

// USER_SUBJECTS table (many-to-many)
db.prepare(`
CREATE TABLE IF NOT EXISTS user_subjects (
    user_id TEXT,
    subject_id INTEGER,
    PRIMARY KEY (user_id, subject_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (subject_id) REFERENCES subjects(id)
);`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER,
    date TEXT,
    portion TEXT,
    FOREIGN KEY (subject_id) REFERENCES subjects(id)
);`).run();

module.exports = db;