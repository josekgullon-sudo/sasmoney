'use strict';

const { db } = require('./db');
const { todayISO, monthRange } = require('./util');

/**
 * Movimientos de caja de la empresa: gastos ('out') y otros ingresos ('in').
 *
 * Los dos funcionan igual —pueden ser sueltos o repetirse solos—, así que
 * comparten tabla y cálculo de fechas; sólo cambia el signo con el que entran
 * en el resumen del mes.
 *
 * Hay dos clases:
 *   - 'once'      un pago suelto, en una fecha concreta.
 *   - recurrentes 'monthly', 'quarterly' y 'yearly', que se repiten solos a
 *                 partir de su primera fecha.
 *
 * De un gasto recurrente no se guarda cada repetición: se guarda la primera
 * fecha y las siguientes se calculan. Así no hay que crear filas por adelantado
 * ni preocuparse de que se acaben.
 */

const KINDS = ['once', 'monthly', 'quarterly', 'yearly'];

const KIND_LABELS = {
  once: 'Una sola vez',
  monthly: 'Todos los meses',
  quarterly: 'Cada tres meses',
  yearly: 'Una vez al año',
};

const KIND_STEP = { monthly: 1, quarterly: 3, yearly: 12 };

/** Suma meses a una fecha, ajustando el día si el mes destino es más corto. */
function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, ultimoDia);
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/**
 * Próxima fecha en la que toca pagar un gasto, contando desde `desde`.
 * Devuelve null si es un pago suelto que ya pasó.
 */
function nextDate(expense, desde = todayISO()) {
  const anchor = expense.anchor_date;
  if (expense.kind === 'once') return anchor >= desde ? anchor : null;

  const step = KIND_STEP[expense.kind];
  if (!step) return null;
  if (anchor >= desde) return anchor;

  // Se salta directamente a la vuelta que toca en lugar de ir de una en una.
  const [ay, am] = anchor.split('-').map(Number);
  const [dy, dm] = desde.split('-').map(Number);
  const mesesTranscurridos = (dy * 12 + (dm - 1)) - (ay * 12 + (am - 1));
  let vueltas = Math.max(0, Math.floor(mesesTranscurridos / step));

  let fecha = addMonths(anchor, vueltas * step);
  while (fecha < desde) {
    vueltas += 1;
    fecha = addMonths(anchor, vueltas * step);
  }
  return fecha;
}

/** Fecha en la que ese gasto cae dentro del mes indicado ('YYYY-MM'), o null. */
function dateInMonth(expense, month) {
  const { from, to } = monthRange(month);
  if (expense.kind === 'once') {
    return expense.anchor_date >= from && expense.anchor_date <= to ? expense.anchor_date : null;
  }
  if (expense.anchor_date > to) return null;
  const fecha = nextDate(expense, from);
  return fecha && fecha <= to ? fecha : null;
}

const DIRECTIONS = ['out', 'in'];

function listExpenses({ direction = 'out' } = {}) {
  return db
    .prepare('SELECT * FROM expenses WHERE direction = ? ORDER BY anchor_date DESC, id DESC')
    .all(direction);
}

function getExpense(id) {
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
}

function createExpense(data) {
  const info = db
    .prepare(
      `INSERT INTO expenses (name, amount_cents, kind, anchor_date, notes, direction)
       VALUES (@name, @amount_cents, @kind, @anchor_date, @notes, @direction)`
    )
    .run({ direction: 'out', ...data });
  return Number(info.lastInsertRowid);
}

function updateExpense(id, data) {
  db.prepare(
    `UPDATE expenses SET name = @name, amount_cents = @amount_cents, kind = @kind,
            anchor_date = @anchor_date, notes = @notes, active = @active
      WHERE id = @id`
  ).run({ ...data, id });
}

function deleteExpense(id) {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
}

/**
 * Gastos que caen en un mes, con la fecha concreta de cada uno.
 * Los inactivos quedan fuera: son los que has puesto en pausa.
 */
function monthExpenses(month, direction = 'out') {
  const rows = [];
  for (const e of listExpenses({ direction })) {
    if (!e.active) continue;
    const fecha = dateInMonth(e, month);
    if (fecha) rows.push({ ...e, fecha });
  }
  rows.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return rows;
}

function monthExpensesTotal(month, direction = 'out') {
  return monthExpenses(month, direction).reduce((a, e) => a + e.amount_cents, 0);
}

/** Los siguientes gastos que van a llegar, ordenados por fecha. */
function upcoming({ dias = 90, limit = 20, direction = 'out' } = {}) {
  const hoy = todayISO();
  const limite = addDays(hoy, dias);
  const rows = [];
  for (const e of listExpenses({ direction })) {
    if (!e.active) continue;
    const fecha = nextDate(e, hoy);
    if (fecha && fecha <= limite) rows.push({ ...e, fecha });
  }
  rows.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return rows.slice(0, limit);
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

module.exports = {
  KINDS,
  DIRECTIONS,
  KIND_LABELS,
  addMonths,
  addDays,
  nextDate,
  dateInMonth,
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  monthExpenses,
  monthExpensesTotal,
  upcoming,
};
