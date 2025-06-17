// database.js
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let dbInstance = null;

async function connect() {
    if (dbInstance) return dbInstance;

    await client.connect();
    dbInstance = client.db('discord-bot-ib');
    return dbInstance;
}

async function createSubject(name) {
    const db = await connect();
    const subjects = db.collection('subjects');
    const existing = await subjects.findOne({ name });
    if (!existing) {
        await subjects.insertOne({ name });
    }
}

async function createUser(userId, username) {
    const db = await connect();
    const users = db.collection('users');
    await users.updateOne(
        { _id: userId },
        { $set: { username, subjects: [] } },
        { upsert: true }
    );
}

async function addSubjectToUser(userId, subjectId) {
    const db = await connect();
    const users = db.collection('users');
    await users.updateOne(
        { _id: userId },
        { $addToSet: { subjects: new ObjectId(subjectId) } }
    );
}

async function createTest(subjectId, date, portion) {
    const db = await connect();
    const tests = db.collection('tests');
    await tests.insertOne({
        subject_id: new ObjectId(subjectId),
        date: new Date(date),
        portion
    });
}

async function createDeadline(subjectId, work, date) {
    const db = await connect();
    const deadlines = db.collection('deadlines');
    await deadlines.insertOne({
        subject_id: new ObjectId(subjectId),
        work: work,
        date: new Date(date)
    });
}

module.exports = {
    connect,
    createSubject,
    createUser,
    addSubjectToUser,
    createTest,
    createDeadline
};