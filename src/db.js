'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

// Node avisa de que su SQLite es experimental; ese aviso no aporta nada aquí,
// pero cualquier otro se sigue mostrando.
const otherWarningListeners = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /sqlite/i.test(w.message)) return;
  for (const listener of otherWarningListeners) listener(w);
});

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(
    `\nTu versión de Node.js (${process.version}) no trae SQLite incorporado.\n` +
      'Descarga Node.js 24 en https://nodejs.org y vuelve a ejecutar "npm start".\n'
  );
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'sasmoney.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/**
 * Ejecuta varias escrituras como una sola operación: o entran todas o no entra
 * ninguna. Sustituye al ayudante que traía better-sqlite3.
 */
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  username         TEXT    NOT NULL UNIQUE,
  name             TEXT    NOT NULL,
  password_hash    TEXT    NOT NULL,
  role             TEXT    NOT NULL CHECK (role IN ('admin','worker')),
  active           INTEGER NOT NULL DEFAULT 1,

  -- Regla de comisión: 'percent' | 'tiers' | 'fixed' | 'profit'
  commission_type  TEXT    NOT NULL DEFAULT 'percent',
  commission_percent REAL  NOT NULL DEFAULT 0,       -- para 'percent'
  investment_share REAL   NOT NULL DEFAULT 0,       -- % de la inversión que carga
  fixed_cents      INTEGER NOT NULL DEFAULT 0,       -- para 'fixed' (por servicio)
  tiers_json       TEXT    NOT NULL DEFAULT '[]',    -- para 'tiers'
  tier_mode        TEXT    NOT NULL DEFAULT 'total' CHECK (tier_mode IN ('total','progressive')),
  -- para 'profit': lo que se lleva LA EMPRESA de las ganancias; el resto es suyo.
  profit_company_percent REAL NOT NULL DEFAULT 60,

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
  service_time  TEXT    NOT NULL DEFAULT '',         -- HH:MM, se pone sola al apuntar
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

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  -- El importe se guarda tal y como lo escribe el jefe. Si lo escribe sin IVA,
  -- vat_percent dice cuánto hay que sumarle al contarlo; 0 = ya lo lleva dentro.
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  vat_percent  REAL    NOT NULL DEFAULT 0,
  -- 'once' = un pago suelto; el resto se repiten solos.
  kind         TEXT    NOT NULL CHECK (kind IN ('daily','once','monthly','quarterly','yearly')),
  -- Fecha del pago suelto, o fecha del primero si se repite.
  anchor_date  TEXT    NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_active ON expenses(active, anchor_date);

-- Importe distinto para un día concreto de un gasto diario: unos días se
-- invierte más y otros menos, sin tener que crear un gasto nuevo.
CREATE TABLE IF NOT EXISTS expense_days (
  expense_id   INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  day          TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (expense_id, day)
);

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

/**
 * Cambios de esquema sobre bases de datos que ya existían.
 * Se aplican solos al arrancar y no molestan si ya estaban puestos.
 */
function migrate() {
  const cols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name);
  if (!cols.includes('direction')) {
    // 'out' = gasto, 'in' = dinero que entra por otro lado. Lo que ya había son gastos.
    db.exec("ALTER TABLE expenses ADD COLUMN direction TEXT NOT NULL DEFAULT 'out'");
  }
  if (!cols.includes('is_investment')) {
    // Marca los gastos que son inversión (publicidad y similares) para poder
    // repartirlos entre las trabajadoras y medir la rentabilidad.
    db.exec('ALTER TABLE expenses ADD COLUMN is_investment INTEGER NOT NULL DEFAULT 0');
  }

  if (!cols.includes('vat_percent')) {
    db.exec('ALTER TABLE expenses ADD COLUMN vat_percent REAL NOT NULL DEFAULT 0');
    // Los gastos de marketing se apuntan sin IVA: es lo que enseñan las
    // plataformas de publicidad. Arrancan con el 21 % puesto; el resto se
    // quedan a 0 y se marcan uno a uno si hace falta.
    db.exec('UPDATE expenses SET vat_percent = 21 WHERE is_investment = 1');
  }

  const entryCols = db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  if (!entryCols.includes('service_time')) {
    db.exec("ALTER TABLE entries ADD COLUMN service_time TEXT NOT NULL DEFAULT ''");
  }

  // A los servicios que se quedaron sin hora se les pone la del momento en que
  // se apuntaron, que es la que guarda created_at (en UTC, hay que pasarla).
  // Se revisa en cada arranque, no sólo al crear la columna: así una fila que se
  // quedara vacía por lo que sea acaba teniendo su hora.
  const sinHora = db
    .prepare("SELECT id, created_at FROM entries WHERE service_time IS NULL OR TRIM(service_time) = ''")
    .all();
  if (sinHora.length > 0) {
    const { hmFromStamp } = require('./util');
    const poner = db.prepare('UPDATE entries SET service_time = ? WHERE id = ?');
    for (const e of sinHora) {
      const hora = hmFromStamp(e.created_at);
      if (hora) poner.run(hora, e.id);
    }
  }

  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('investment_share')) {
    // Qué porcentaje de la inversión carga cada trabajador cuando el reparto
    // se hace a mano en lugar de por facturación.
    db.exec('ALTER TABLE users ADD COLUMN investment_share REAL NOT NULL DEFAULT 0');
  }

  if (!userCols.includes('profit_company_percent')) {
    // Para el trato de repartir ganancias: lo que se lleva la empresa. A quien
    // ya estaba dado de alta no le cambia nada, porque su regla es otra.
    db.exec('ALTER TABLE users ADD COLUMN profit_company_percent REAL NOT NULL DEFAULT 60');
  }

  // El CHECK de 'kind' no admitía los gastos diarios y SQLite no deja cambiar un
  // CHECK: hay que rehacer la tabla copiando lo que hubiera dentro.
  const esquema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='expenses'").get();
  if (esquema && !esquema.sql.includes("'daily'")) {
    db.exec(`
      BEGIN;
      CREATE TABLE expenses_nueva (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        kind         TEXT    NOT NULL CHECK (kind IN ('daily','once','monthly','quarterly','yearly')),
        anchor_date  TEXT    NOT NULL,
        active       INTEGER NOT NULL DEFAULT 1,
        notes        TEXT    NOT NULL DEFAULT '',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        direction    TEXT    NOT NULL DEFAULT 'out',
        is_investment INTEGER NOT NULL DEFAULT 0,
        vat_percent  REAL    NOT NULL DEFAULT 0
      );
      INSERT INTO expenses_nueva
        (id, name, amount_cents, kind, anchor_date, active, notes, created_at, direction, is_investment, vat_percent)
        SELECT id, name, amount_cents, kind, anchor_date, active, notes, created_at, direction, is_investment, vat_percent
          FROM expenses;
      DROP TABLE expenses;
      ALTER TABLE expenses_nueva RENAME TO expenses;
      CREATE INDEX IF NOT EXISTS idx_expenses_active ON expenses(active, anchor_date);
      COMMIT;
    `);
  }
}

migrate();

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

module.exports = { db, transaction, ensureAdmin, getSetting, setSetting, DB_FILE };
