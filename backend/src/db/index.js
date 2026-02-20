const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function makeDB(name) {
    return new Datastore({
        filename: path.join(DB_DIR, `${name}.db`),
        autoload: true
    });
}

const db = {
    teams: makeDB('teams'),
    questions: makeDB('questions'),
    submissions: makeDB('submissions'),
    settings: makeDB('settings')
};

// Promise wrappers
function findOne(col, query) {
    return new Promise((res, rej) => db[col].findOne(query, (e, d) => e ? rej(e) : res(d)));
}
function find(col, query, sort) {
    return new Promise((res, rej) => {
        let cursor = db[col].find(query);
        if (sort) cursor = cursor.sort(sort);
        cursor.exec((e, d) => e ? rej(e) : res(d));
    });
}
function insert(col, doc) {
    return new Promise((res, rej) => db[col].insert(doc, (e, d) => e ? rej(e) : res(d)));
}
function update(col, query, upd, opts = {}) {
    return new Promise((res, rej) => db[col].update(query, upd, opts, (e, n, d) => e ? rej(e) : res(d)));
}
function remove(col, query, opts = {}) {
    return new Promise((res, rej) => db[col].remove(query, opts, (e, n) => e ? rej(e) : res(n)));
}
function count(col, query) {
    return new Promise((res, rej) => db[col].count(query, (e, n) => e ? rej(e) : res(n)));
}

// Ensure default settings exist
db.settings.findOne({ singleton: 'main' }, (e, doc) => {
    if (!doc) {
        db.settings.insert({
            singleton: 'main', isActive: false, scheduledStart: null,
            contestDuration: 60, announcements: [], startedAt: null, stoppedAt: null
        });
    }
});

console.log('NeDB database initialized at:', DB_DIR);

module.exports = { db, findOne, find, insert, update, remove, count };
