-- Kicks on Deck — first-party capture schema (Cloudflare D1 / SQLite)
-- Run once in the D1 console (dashboard) or: wrangler d1 execute kod_data --file=schema.sql

CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  interest TEXT,
  size TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_email ON signups(email);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  choice TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_votes_choice ON votes(choice);

CREATE TABLE IF NOT EXISTS quiz (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  answers TEXT,
  coll TEXT,
  reflective INTEGER DEFAULT 0,
  recommended TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
