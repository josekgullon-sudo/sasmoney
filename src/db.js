'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'sasmoney.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  username         TEXT    NOT NULL UNIQUE,
  name             TEXT    NOT NULL,
  password_hash    TEXT    NOT NULL,
  role             TEXT    NOT NULL CHECK (role IN ('admin','worker')),
  active           INTEGER NOT NULL DEFAULT 1,

  -- Regla de comisión: 'percent' | 'tiers' | 'fixed'
  commission_type  TEXT    NOT NULL DEFAULT 'percent',
  commission_percent REAL  NOT NULL DEFAULT 0,       -- para 'percent'
  fixed_cents      INTEGER NOT NULL DEFAULT 0,       -- para 'fixed' (por servicio)
  tiers_json       TEXT    NOT NULL DEFAULT '[]',    -- para 'tiers'
  tier_mode        TEXT    NOT NULL DEFAULT 'total' CHECK (tier_mode IN ('total','progressive')),

  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS towns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settlements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  period_from      TEXT    NOT NULL,
  period_to        TEXT    NOT NULL,
  entry_count      INTEGER NOT NULL,
  total_cents      INTEGER NOT NULL,
  commission_cents INTEGER NOT NULL,
  rule_snapshot    TEXT    NOT NULL,
  note             TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_settlements_user ON settlements(user_id, period_from);

CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  service_date  TEXT    NOT NULL,                    -- YYYY-MM-DD
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  client_label  TEXT    NOT NULL DEFAULT '',         -- opcional: nombre o apodo del cliente
  town_id       INTEGER REFERENCES towns(id),
  payment_method TEXT   NOT NULL DEFAULT 'efectivo',
  notes         TEXT    NOT NULL DEFAULT '',
  settlement_id INTEGER REFERENCES settlements(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, service_date);
CREATE INDEX IF NOT EXISTS idx_entries_settlement ON entries(settlement_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/** Crea el usuario administrador la primera vez que arranca la aplicación. */
function ensureAdmin() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get();
  if (existing.n > 0) return null;

  const username = (process.env.ADMIN_USER || 'admin').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'cambiar123';
  db.prepare(
    `INSERT INTO users (username, name, password_hash, role, commission_type)
     VALUES (?, ?, ?, 'admin', 'percent')`
  ).run(username, process.env.ADMIN_NAME || 'Jefe', bcrypt.hashSync(password, 10));

  return { username, password, generated: !process.env.ADMIN_PASSWORD };
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

module.exports = { db, ensureAdmin, getSetting, setSetting, DB_FILE };
