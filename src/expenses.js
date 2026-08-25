'use strict';

const { db, transaction } = require('./db');
const { todayISO, monthRange, addDays, daysBetween } = require('./util');

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

/**
 * El importe con su IVA.
 *
 * La publicidad se apunta sin IVA, que es como la enseñan las plataformas, pero
 * lo que sale de la cuenta lo lleva. Se guarda el importe tal y como se escribe
 * y el IVA se suma al contar: así el jefe sigue apuntando la cifra que ve en su
 * panel de anuncios y las cuentas salen con lo que de verdad se paga.
 *
 * Con vat_percent a 0 no toca nada: el importe ya lo lleva dentro.
 */
function conIva(cents, vatPercent) {
  const iva = Math.max(0, Number(vatPercent) || 0);
  return iva === 0 ? cents : Math.round((cents * (100 + iva)) / 100);
}

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
  const conImporte = (fecha) => {
    // `amount_cents` es lo que escribió el jefe (el calendario lo enseña tal
    // cual); `con_iva_cents` es lo que cuesta de verdad y es lo que se suma.
    const neto = ajustes.has(fecha) ? ajustes.get(fecha) : expense.amount_cents;
    return {
      fecha,
      amount_cents: neto,
      con_iva_cents: conIva(neto, expense.vat_percent),
      ajustado: ajustes.has(fecha),
    };
  };

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

/** Meses enteros que hay de un mes a otro ('2026-01-01' → '2026-08-01' = 7). */
function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return by * 12 + (bm - 1) - (ay * 12 + (am - 1));
}

/** El día 1 del mes de una fecha. */
function monthStart(iso) {
  return `${iso.slice(0, 7)}-01`;
}

/**
 * El tramo de tiempo que cubre cada cobro de un gasto que se repite, en **meses
 * naturales**: uno para los mensuales, tres para los trimestrales, doce para los
 * anuales, contados siempre desde el día 1.
 *
 * Que cuenten meses naturales y no "del día 20 al 19" es lo que hace que
 * "200 € al mes" sean 200 € en agosto, aunque lo dieras de alta el día 20. Si
 * el tramo empezara el día del alta, agosto se quedaría con doce treintaiunavos
 * y el resto se iría a septiembre, que no es lo que nadie entiende por
 * "doscientos euros al mes".
 */
function coverageOf(expense, ocurrencia) {
  const step = KIND_STEP[expense.kind];
  if (!step) return null;
  const inicio = monthStart(ocurrencia);
  return { inicio, fin: addDays(addMonths(inicio, step), -1) };
}

/** El tramo que cubre una fecha, o el primero si la fecha es anterior al alta. */
function coveringDate(expense, fecha) {
  const step = KIND_STEP[expense.kind];
  if (!step) return null;

  const primero = monthStart(expense.anchor_date);
  if (primero >= fecha) return primero;

  let vueltas = Math.max(0, Math.floor(monthsBetween(primero, fecha) / step));
  // El salto por meses puede pasarse o quedarse corto; se ajusta.
  while (vueltas > 0 && addMonths(primero, vueltas * step) > fecha) vueltas -= 1;
  while (addMonths(primero, (vueltas + 1) * step) <= fecha) vueltas += 1;
  return addMonths(primero, vueltas * step);
}

/**
 * Lo que le toca a un periodo de un gasto, repartido por días.
 *
 * Un alquiler de 500 € al mes no se gasta "de golpe el día que se paga": cubre
 * todo el mes. Si miras un solo día, lo justo es que te toquen 500/31 = 16,13 €,
 * no 500 € ni 0 €. Por eso los gastos que se repiten se reparten entre los días
 * del tramo que cubren, y se suma el trozo que cae dentro de lo que estás mirando.
 *
 * Los diarios ya van por días y los pagos sueltos son de un día concreto: esos
 * no se reparten, se cuentan tal cual.
 *
 * Cada tramo se redondea una sola vez sobre su total, así que un mes entero suma
 * exactamente el importe del recibo, sin céntimos perdidos por el camino.
 *
 * Devuelve también `dias` (los que caen dentro) y `span` (los que tiene el tramo)
 * cuando hay un solo tramo, para poder decir "2 de 31 días" en lugar de dejarlo
 * en un misterioso "parte proporcional".
 */
function rangeAccrual(expense, from, to) {
  const vacio = { cents: 0, prorrateado: false, dias: 0, span: null };
  if (!from || !to || to < from) return vacio;

  if (expense.kind === 'daily' || expense.kind === 'once') {
    const dias = rangeOccurrences(expense, from, to);
    return {
      cents: dias.reduce((a, d) => a + d.con_iva_cents, 0),
      prorrateado: false,
      dias: dias.length,
      span: null,
    };
  }

  const step = KIND_STEP[expense.kind];
  if (!step) return vacio;

  const importe = conIva(expense.amount_cents, expense.vat_percent);
  let cents = 0;
  let dias = 0;
  let tramos = 0;
  let span = null;

  let inicio = coveringDate(expense, from);
  while (inicio && inicio <= to) {
    const { fin } = coverageOf(expense, inicio);
    const largo = daysBetween(inicio, fin);

    const desde = inicio > from ? inicio : from;
    const hasta = fin < to ? fin : to;
    const dentro = daysBetween(desde, hasta);

    if (dentro > 0) {
      cents += dentro >= largo ? importe : Math.round((importe * dentro) / largo);
      dias += dentro;
      tramos += 1;
      span = largo;
    }
    inicio = addMonths(inicio, step);
  }

  return { cents, prorrateado: true, dias, span: tramos === 1 ? span : null };
}

/** Importes ajustados a mano de un gasto entre dos fechas. */
function dayOverrides(expenseId, from, to) {
  if (!expenseId) return new Map();
  const filas = db
    .prepare('SELECT day, amount_cents FROM expense_days WHERE expense_id = ? AND day >= ? AND day <= ?')
    .all(expenseId, from, to);
  return new Map(filas.map((f) => [f.day, f.amount_cents]));
}

/**
 * Pone (o quita, con null) el importe de un día concreto.
 * Devuelve true si de verdad ha cambiado algo, para poder contar cuántos días
 * se han tocado al guardar un mes entero.
 */
function setDayAmount(expenseId, day, amountCents) {
  if (amountCents === null) {
    const info = db
      .prepare('DELETE FROM expense_days WHERE expense_id = ? AND day = ?')
      .run(expenseId, day);
    return info.changes > 0;
  }
  db.prepare(
    `INSERT INTO expense_days (expense_id, day, amount_cents) VALUES (?, ?, ?)
     ON CONFLICT(expense_id, day) DO UPDATE SET amount_cents = excluded.amount_cents`
  ).run(expenseId, day, amountCents);
  return true;
}

/** Quita todos los importes escritos a mano de un gasto entre dos fechas. */
function clearDayAmounts(expenseId, from, to) {
  const info = db
    .prepare('DELETE FROM expense_days WHERE expense_id = ? AND day >= ? AND day <= ?')
    .run(expenseId, from, to);
  return info.changes;
}

/** Guarda un mes entero de golpe: o entran todos los días o no entra ninguno. */
const saveDayAmounts = transaction((fn) => fn());

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
      `INSERT INTO expenses (name, amount_cents, vat_percent, kind, anchor_date, notes, direction, is_investment)
       VALUES (@name, @amount_cents, @vat_percent, @kind, @anchor_date, @notes, @direction, @is_investment)`
    )
    .run({ direction: 'out', is_investment: 0, vat_percent: 0, ...data });
  return Number(info.lastInsertRowid);
}

function updateExpense(id, data) {
  db.prepare(
    `UPDATE expenses SET name = @name, amount_cents = @amount_cents, vat_percent = @vat_percent,
            kind = @kind, anchor_date = @anchor_date, notes = @notes, active = @active,
            is_investment = @is_investment
      WHERE id = @id`
  ).run({ is_investment: 0, vat_percent: 0, ...data, id });
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
 * Gastos que le tocan a un periodo, ya con la cuenta hecha.
 *
 * `total_cents` es la parte que le corresponde al periodo, prorrateada (ver
 * rangeAccrual): por eso un alquiler mensual aparece también si miras un solo
 * día, con su parte, en lugar de desaparecer porque ese día no tocaba pagar.
 * `dias` y `veces` siguen siendo los pagos de verdad que caen dentro, que es lo
 * que hace falta para saber cuándo sale el dinero de la cuenta.
 *
 * Los inactivos quedan fuera: son los que has puesto en pausa.
 */
function rangeExpenses({ from, to, direction = 'out' }) {
  const hoy = todayISO();
  const rows = [];

  for (const e of listExpenses({ direction })) {
    if (!e.active) continue;

    const pagos = rangeOccurrences(e, from, to);
    const periodo = rangeAccrual(e, from, to);
    if (periodo.cents === 0 && pagos.length === 0) continue;

    // Lo que ya ha corrido de ese periodo: desde su principio hasta hoy.
    const corte = hoy < to ? hoy : to;
    const corrido = hoy < from ? { cents: 0 } : rangeAccrual(e, from, corte);

    rows.push({
      ...e,
      fecha: pagos.length ? pagos[0].fecha : nextDate(e, from) || from,
      veces: pagos.length,
      dias: pagos,
      ajustados: pagos.filter((d) => d.ajustado).length,
      prorrateado: periodo.prorrateado,
      // Para poder decir "2 de 31 días" en vez de un "parte proporcional" a secas.
      dias_dentro: periodo.dias,
      dias_tramo: periodo.span,
      total_cents: periodo.cents,
      hasta_hoy_cents: corrido.cents,
      pendiente_cents: periodo.cents - corrido.cents,
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
    if (fecha && fecha <= limite) {
      rows.push({ ...e, fecha, con_iva_cents: conIva(e.amount_cents, e.vat_percent) });
    }
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
  conIva,
  nextDate,
  dateInMonth,
  monthOccurrences,
  rangeOccurrences,
  rangeAccrual,
  coveringDate,
  setDayAmount,
  clearDayAmounts,
  saveDayAmounts,
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
