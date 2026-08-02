'use strict';

const { db } = require('./db');
const { todayISO, monthRange, addDays } = require('./util');

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

const KINDS = ['daily', 'once', 'monthly', 'quarterly', 'yearly'];

const KIND_LABELS = {
  daily: 'Todos los días',
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
  // Un gasto diario toca hoy mismo, salvo que aún no haya empezado.
  if (expense.kind === 'daily') return anchor >= desde ? anchor : desde;

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
  const fechas = monthOccurrences(expense, month);
  return fechas.length ? fechas[0].fecha : null;
}

/**
 * Los días de ese mes en los que toca pagar ese gasto, cada uno con su importe.
 * Es el caso más habitual del cálculo por fechas de abajo.
 */
function monthOccurrences(expense, month) {
  const { from, to } = monthRange(month);
  return rangeOccurrences(expense, from, to);
}

/**
 * Los días de un periodo cualquiera en los que toca pagar ese gasto, con su importe.
 *
 * Un pago suelto cae como mucho una vez; los diarios caen todos los días desde
 * su fecha de inicio; y los que se repiten (mensual, trimestral, anual) caen
 * tantas veces como vueltas quepan entre las dos fechas. Si algún día tiene un
 * importe ajustado a mano, se usa ese en lugar del habitual.
 */
function rangeOccurrences(expense, from, to) {
  if (to < from) return [];
  const anchor = expense.anchor_date;
  if (anchor > to) return [];

  const ajustes = dayOverrides(expense.id, from, to);
  const conImporte = (fecha) => ({
    fecha,
    amount_cents: ajustes.has(fecha) ? ajustes.get(fecha) : expense.amount_cents,
    ajustado: ajustes.has(fecha),
  });

  if (expense.kind === 'once') {
    return anchor >= from && anchor <= to ? [conImporte(anchor)] : [];
  }

  const desde = anchor > from ? anchor : from;

  if (expense.kind === 'daily') {
    const fechas = [];
    for (let dia = desde; dia <= to; dia = addDays(dia, 1)) fechas.push(conImporte(dia));
    return fechas;
  }

  const fechas = [];
  let fecha = nextDate(expense, desde);
  while (fecha && fecha <= to) {
    fechas.push(conImporte(fecha));
    fecha = nextDate(expense, addDays(fecha, 1));
  }
  return fechas;
}

/** Importes ajustados a mano de un gasto entre dos fechas. */
function dayOverrides(expenseId, from, to) {
  if (!expenseId) return new Map();
  const filas = db
    .prepare('SELECT day, amount_cents FROM expense_days WHERE expense_id = ? AND day >= ? AND day <= ?')
    .all(expenseId, from, to);
  return new Map(filas.map((f) => [f.day, f.amount_cents]));
}

/** Pone (o quita, con null) el importe de un día concreto. */
function setDayAmount(expenseId, day, amountCents) {
  if (amountCents === null) {
    db.prepare('DELETE FROM expense_days WHERE expense_id = ? AND day = ?').run(expenseId, day);
    return;
  }
  db.prepare(
    `INSERT INTO expense_days (expense_id, day, amount_cents) VALUES (?, ?, ?)
     ON CONFLICT(expense_id, day) DO UPDATE SET amount_cents = excluded.amount_cents`
  ).run(expenseId, day, amountCents);
}

/** Días ajustados de un gasto entre dos fechas, ordenados por fecha. */
function listDayAmounts(expenseId, from, to) {
  return [...dayOverrides(expenseId, from, to).entries()]
    .map(([day, amount_cents]) => ({ day, amount_cents }))
    .sort((a, b) => a.day.localeCompare(b.day));
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
      `INSERT INTO expenses (name, amount_cents, kind, anchor_date, notes, direction, is_investment)
       VALUES (@name, @amount_cents, @kind, @anchor_date, @notes, @direction, @is_investment)`
    )
    .run({ direction: 'out', is_investment: 0, ...data });
  return Number(info.lastInsertRowid);
}

function updateExpense(id, data) {
  db.prepare(
    `UPDATE expenses SET name = @name, amount_cents = @amount_cents, kind = @kind,
            anchor_date = @anchor_date, notes = @notes, active = @active,
            is_investment = @is_investment
      WHERE id = @id`
  ).run({ is_investment: 0, ...data, id });
}

function deleteExpense(id) {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
}

/** Gastos que caen en un mes. Atajo del cálculo por fechas de abajo. */
function monthExpenses(month, direction = 'out') {
  const { from, to } = monthRange(month);
  return rangeExpenses({ from, to, direction });
}

/**
 * Gastos que caen en un periodo, ya con la cuenta hecha.
 * Cada fila trae cuántas veces cae ('veces'), el total del periodo, cuánto va
 * gastado hasta hoy y cuánto está aún por llegar. Los inactivos quedan fuera:
 * son los que has puesto en pausa.
 */
function rangeExpenses({ from, to, direction = 'out' }) {
  const hoy = todayISO();
  const rows = [];

  for (const e of listExpenses({ direction })) {
    if (!e.active) continue;
    const dias = rangeOccurrences(e, from, to);
    if (dias.length === 0) continue;

    rows.push({
      ...e,
      fecha: dias[0].fecha,
      veces: dias.length,
      dias,
      ajustados: dias.filter((d) => d.ajustado).length,
      total_cents: dias.reduce((a, d) => a + d.amount_cents, 0),
      // Lo que ya ha caído del 1 hasta hoy, y lo que queda por caer este mes.
      hasta_hoy_cents: dias.filter((d) => d.fecha <= hoy).reduce((a, d) => a + d.amount_cents, 0),
      pendiente_cents: dias.filter((d) => d.fecha > hoy).reduce((a, d) => a + d.amount_cents, 0),
    });
  }

  rows.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return rows;
}

/** El mes resumido. Atajo del resumen por fechas de abajo. */
function monthSummary(month, direction = 'out') {
  const { from, to } = monthRange(month);
  return rangeSummary({ from, to, direction });
}

/**
 * El periodo resumido, con dos cifras para cada cosa:
 *
 *   - `hastaHoyCents`: lo que se lleva gastado (o ingresado) hasta hoy.
 *   - `totalCents`:    lo que va a sumar el periodo entero cuando termine.
 *
 * Los dos números importan y no son el mismo: un gasto diario de 20 € son 620 €
 * a fin de mes, pero el día 2 sólo se han gastado 40 €. Enseñar el mes completo
 * el día 2 hace pensar que la empresa va en números rojos cuando no es así.
 */
function rangeSummary({ from, to, direction = 'out' }) {
  const rows = rangeExpenses({ from, to, direction });
  const suma = (filtro, campo) => rows.filter(filtro).reduce((a, r) => a + r[campo], 0);
  const todos = () => true;
  const esInversion = (r) => Boolean(r.is_investment);
  const noEsInversion = (r) => !r.is_investment;

  return {
    rows,
    totalCents: suma(todos, 'total_cents'),
    hastaHoyCents: suma(todos, 'hasta_hoy_cents'),
    pendienteCents: suma(todos, 'pendiente_cents'),
    inversion: {
      totalCents: suma(esInversion, 'total_cents'),
      hastaHoyCents: suma(esInversion, 'hasta_hoy_cents'),
    },
    otros: {
      totalCents: suma(noEsInversion, 'total_cents'),
      hastaHoyCents: suma(noEsInversion, 'hasta_hoy_cents'),
    },
  };
}

function monthExpensesTotal(month, direction = 'out') {
  return monthExpenses(month, direction).reduce((a, e) => a + e.total_cents, 0);
}

/** Lo que cuesta al mes la publicidad y demás inversiones marcadas como tal. */
function monthInvestmentTotal(month) {
  return monthExpenses(month, 'out')
    .filter((e) => e.is_investment)
    .reduce((a, e) => a + e.total_cents, 0);
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

module.exports = {
  KINDS,
  DIRECTIONS,
  KIND_LABELS,
  addMonths,
  addDays,
  nextDate,
  dateInMonth,
  monthOccurrences,
  rangeOccurrences,
  setDayAmount,
  listDayAmounts,
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  monthExpenses,
  monthSummary,
  rangeExpenses,
  rangeSummary,
  monthExpensesTotal,
  monthInvestmentTotal,
  upcoming,
};
