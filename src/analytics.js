'use strict';

const { db } = require('./db');
const { addDays, daysBetween } = require('./util');

/**
 * Los números de la pantalla de Analíticas.
 *
 * Todo lo de aquí son consultas de sólo lectura sobre los servicios apuntados:
 * ninguna toca dinero de nadie, así que se pueden mirar sin miedo. Las cuentas
 * que sí deciden pagos (comisiones, beneficio) siguen viviendo en repo.js y se
 * piden allí; aquí no se recalculan por otro camino, que es como aparecen dos
 * cifras distintas de lo mismo.
 *
 * Todas las funciones reciben el mismo `{ from, to }` para que el periodo y el
 * de comparación se saquen con la misma llamada.
 */

const RANGO = 'service_date >= @from AND service_date <= @to';

/** La hora de un servicio como número (los que no la tengan, a las 0). */
const HORA = "CAST(SUBSTR(COALESCE(NULLIF(service_time, ''), '00:00'), 1, 2) AS INTEGER)";

function resumen({ from, to }) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS servicios,
              COALESCE(SUM(amount_cents), 0) AS facturado,
              COUNT(DISTINCT service_date) AS diasConAlgo,
              COALESCE(MAX(amount_cents), 0) AS mayor
         FROM entries WHERE ${RANGO}`
    )
    .get({ from, to });

  const dias = Math.max(1, daysBetween(from, to));
  return {
    servicios: row.servicios,
    facturadoCents: row.facturado,
    diasConAlgo: row.diasConAlgo,
    mayorCents: row.mayor,
    ticketCents: row.servicios > 0 ? Math.round(row.facturado / row.servicios) : 0,
    porDiaCents: Math.round(row.facturado / dias),
    serviciosPorDia: row.servicios / dias,
    dias,
  };
}

/** Lo facturado cada día del periodo, con los días vacíos incluidos. */
function porDia({ from, to }) {
  const filas = db
    .prepare(
      `SELECT service_date AS fecha, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS count
         FROM entries WHERE ${RANGO} GROUP BY service_date`
    )
    .all({ from, to });

  const mapa = new Map(filas.map((f) => [f.fecha, f]));
  const dias = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const f = mapa.get(d);
    dias.push({ fecha: d, cents: f ? f.cents : 0, count: f ? f.count : 0 });
  }
  return dias;
}

/** Las 24 horas, siempre todas, para poder comparar dos periodos hora a hora. */
function porHora({ from, to }) {
  const filas = db
    .prepare(
      `SELECT ${HORA} AS hora, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS count
         FROM entries WHERE ${RANGO} GROUP BY hora`
    )
    .all({ from, to });

  const mapa = new Map(filas.map((f) => [f.hora, f]));
  return Array.from({ length: 24 }, (_, hora) => ({
    hora,
    cents: mapa.has(hora) ? mapa.get(hora).cents : 0,
    count: mapa.has(hora) ? mapa.get(hora).count : 0,
  }));
}

/**
 * Los siete días de la semana, con la **media** de cada uno.
 *
 * La media y no la suma: en un periodo de 30 días hay cinco lunes y cuatro
 * domingos, así que sumar diría que los lunes son mejores sólo por ser más.
 * El divisor son los días de calendario, no los días con servicios: un domingo
 * cerrado también cuenta como domingo flojo.
 */
function porDiaSemana({ from, to }) {
  const filas = db
    .prepare(
      `SELECT CAST(STRFTIME('%w', service_date) AS INTEGER) AS dow,
              COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS count
         FROM entries WHERE ${RANGO} GROUP BY dow`
    )
    .all({ from, to });

  const mapa = new Map(filas.map((f) => [f.dow, f]));
  const veces = new Array(7).fill(0);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    veces[new Date(`${d}T12:00:00Z`).getUTCDay()] += 1;
  }

  // De lunes a domingo, que es como se lee una semana.
  return [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const f = mapa.get(dow);
    const cents = f ? f.cents : 0;
    return {
      dow,
      cents,
      count: f ? f.count : 0,
      veces: veces[dow],
      mediaCents: veces[dow] > 0 ? Math.round(cents / veces[dow]) : 0,
    };
  });
}

function porTrabajador({ from, to }) {
  return db
    .prepare(
      `SELECT u.id, u.name,
              COUNT(e.id) AS count,
              COALESCE(SUM(e.amount_cents), 0) AS cents
         FROM entries e JOIN users u ON u.id = e.user_id
        WHERE ${RANGO.replace(/service_date/g, 'e.service_date')}
        GROUP BY u.id ORDER BY cents DESC`
    )
    .all({ from, to })
    .map((r) => ({ ...r, ticketCents: r.count > 0 ? Math.round(r.cents / r.count) : 0 }));
}

function porPueblo({ from, to }) {
  return db
    .prepare(
      `SELECT COALESCE(t.name, 'Sin pueblo') AS name,
              COUNT(e.id) AS count,
              COALESCE(SUM(e.amount_cents), 0) AS cents
         FROM entries e LEFT JOIN towns t ON t.id = e.town_id
        WHERE ${RANGO.replace(/service_date/g, 'e.service_date')}
        GROUP BY t.id ORDER BY cents DESC`
    )
    .all({ from, to })
    .map((r) => ({ ...r, ticketCents: r.count > 0 ? Math.round(r.cents / r.count) : 0 }));
}

function porMetodo({ from, to }) {
  return db
    .prepare(
      `SELECT payment_method AS metodo, COUNT(*) AS count,
              COALESCE(SUM(amount_cents), 0) AS cents
         FROM entries WHERE ${RANGO}
        GROUP BY payment_method ORDER BY cents DESC`
    )
    .all({ from, to });
}

/**
 * Los importes agrupados en tramos: para ver de qué se vive, si de muchos
 * servicios pequeños o de pocos grandes.
 */
const TRAMOS = [
  { hasta: 5000, label: 'Menos de 50 €' },
  { hasta: 10000, label: 'De 50 a 99 €' },
  { hasta: 15000, label: 'De 100 a 149 €' },
  { hasta: 20000, label: 'De 150 a 199 €' },
  { hasta: Infinity, label: '200 € o más' },
];

function porImporte({ from, to }) {
  const filas = db
    .prepare(`SELECT amount_cents AS cents FROM entries WHERE ${RANGO}`)
    .all({ from, to });

  const tramos = TRAMOS.map((t) => ({ ...t, count: 0, cents: 0 }));
  for (const f of filas) {
    const tramo = tramos.find((t) => f.cents < t.hasta) || tramos[tramos.length - 1];
    tramo.count += 1;
    tramo.cents += f.cents;
  }
  return tramos;
}

/** Los clientes con nombre que más veces han vuelto. */
function clientesQueRepiten({ from, to, limit = 8 }) {
  return db
    .prepare(
      `SELECT TRIM(client_label) AS cliente, COUNT(*) AS count,
              COALESCE(SUM(amount_cents), 0) AS cents, MAX(service_date) AS ultima
         FROM entries
        WHERE ${RANGO} AND TRIM(client_label) <> ''
        GROUP BY LOWER(TRIM(client_label))
       HAVING COUNT(*) > 1
        ORDER BY count DESC, cents DESC LIMIT @limit`
    )
    .all({ from, to, limit });
}

/**
 * Los últimos meses, para ver la tendencia larga. No depende del periodo
 * elegido: es la foto de siempre, que es justo lo que se quiere para saber si
 * el negocio sube o baja.
 */
function ultimosMeses(hasta, cuantos = 12) {
  const desde = `${sumaMeses(hasta.slice(0, 7), -(cuantos - 1))}-01`;
  const filas = db
    .prepare(
      `SELECT SUBSTR(service_date, 1, 7) AS mes,
              COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS count
         FROM entries WHERE service_date >= @desde AND service_date <= @hasta
        GROUP BY mes`
    )
    .all({ desde, hasta });

  const mapa = new Map(filas.map((f) => [f.mes, f]));
  const meses = [];
  for (let i = cuantos - 1; i >= 0; i--) {
    const mes = sumaMeses(hasta.slice(0, 7), -i);
    const f = mapa.get(mes);
    meses.push({ mes, cents: f ? f.cents : 0, count: f ? f.count : 0 });
  }
  return meses;
}

/** '2026-09' + (-3) → '2026-06'. */
function sumaMeses(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

module.exports = {
  resumen,
  porDia,
  porHora,
  porDiaSemana,
  porTrabajador,
  porPueblo,
  porMetodo,
  porImporte,
  clientesQueRepiten,
  ultimosMeses,
  sumaMeses,
};
