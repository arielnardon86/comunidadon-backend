const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./reservations.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the reservations database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tableId INTEGER NOT NULL,
    turno TEXT NOT NULL,
    date TEXT NOT NULL,
    username TEXT NOT NULL
  )`);
});

module.exports = db;