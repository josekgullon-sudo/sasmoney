'use strict';

const { getSetting, setSetting } = require('./db');
const { calcRetention, retentionLabel, formatEuro, fmtPercent } = require('./commission');

/**
 * Comisionar sólo por encima de los gastos del día.
 *
 * La idea: hasta que entre todos no se cubre lo que cuesta el día, nadie
 * comisiona. A partir de ahí se comisiona sobre el exceso, y cuanto más se
 * genera, mejor porcentaje.
 *
 * Cómo sale la cuenta, día a día:
 *
 *   1. Lo que ha facturado el equipo ese día menos lo que costó el día:
 *      eso es el **exceso**. Si sale negativo, ese día no se comisiona.
 *   2. El exceso se reparte entre los trabajadores según lo que haya facturado
 *      cada uno ese día. El umbral es de todos, así que el exceso también.
 *   3. A la parte de cada uno se le aplica su porcentaje de siempre **más** los
 *      puntos del tramo que alcance con esa parte.
 *
 * La escalera de tramos es una sola para todos y va en puntos, no en
 * porcentajes cerrados: así cada trabajador conserva su base (una al 40 %, otra
 * al 35 %) y el tramo sube a los dos por igual. El tramo alcanzado se aplica a
 * todo el exceso de ese día, no sólo a la parte que asoma por encima.
 */

const POR_DEFECTO = {
  activo: true,
  // Sin tramos configurados: se comisiona por encima de gastos al % de siempre,
  // que es justo "el primer tramo es lo que están comisionando ahora".
  tramos: [{ min_cents: 0, puntos: 0 }],
};

function getThreshold() {
  const activo = getSetting('umbral_activo', POR_DEFECTO.activo ? '1' : '0') === '1';
  return { activo, tramos: normalizaTramos(leeTramos()) };
}

function leeTramos() {
  try {
    const raw = getSetting('umbral_tramos', '');
    return raw ? JSON.parse(raw) : POR_DEFECTO.tramos;
  } catch {
    return POR_DEFECTO.tramos;
  }
}

/**
 * Deja los tramos en orden y sin sorpresas, y se asegura de que siempre haya uno
 * que arranque en 0: sin él, el primer euro por encima de gastos se quedaría sin
 * regla.
 */
function normalizaTramos(lista) {
  const tramos = (Array.isArray(lista) ? lista : [])
    .map((t) => ({
      min_cents: Math.max(0, Math.round(Number(t.min_cents) || 0)),
      puntos: Math.max(0, Number(t.puntos) || 0),
    }))
    .sort((a, b) => a.min_cents - b.min_cents);

  if (tramos.length === 0) return [{ min_cents: 0, puntos: 0 }];
  if (tramos[0].min_cents !== 0) tramos.unshift({ min_cents: 0, puntos: 0 });
  return tramos;
}

function setThreshold({ activo, tramos }) {
  setSetting('umbral_activo', activo ? '1' : '0');
  setSetting('umbral_tramos', JSON.stringify(normalizaTramos(tramos)));
}

/** Los puntos que se suman con un exceso dado. */
function puntosDe(tramos, excesoCents) {
  let puntos = 0;
  for (const t of tramos) {
    if (excesoCents >= t.min_cents) puntos = t.puntos;
  }
  return puntos;
}

/**
 * Lo que le queda a un trabajador cada día después de su parte de los gastos.
 *
 * Los gastos del día son de todos, así que se reparten según lo que facturó
 * cada uno ese día: quien más trajo, más gastos cubre y más le sobra. Lo que
 * sobra es el exceso sobre gastos, que es lo mismo que decir su ganancia.
 *
 * @param {Array} entries      Servicios del trabajador que se están mirando.
 * @param {Map}   equipoPorDia Lo que facturó **todo el equipo** cada día.
 * @param {Map}   costePorDia  Lo que costó cada día.
 */
function repartoPorDia(entries, equipoPorDia, costePorDia) {
  const mioPorDia = new Map();
  for (const e of entries) {
    mioPorDia.set(e.service_date, (mioPorDia.get(e.service_date) || 0) + e.amount_cents);
  }

  return [...mioPorDia.keys()].sort().map((fecha) => {
    const mio = mioPorDia.get(fecha);
    // Sin dato del equipo se asume que ese día facturó él solo: es lo prudente,
    // porque así carga con todo el gasto en vez de con una parte inventada.
    const equipo = equipoPorDia.get(fecha) || mio;
    const coste = costePorDia.get(fecha) || 0;
    const excesoEquipo = Math.max(0, equipo - coste);
    const miExceso = equipo > 0 ? Math.round((excesoEquipo * mio) / equipo) : 0;
    return { fecha, mio, equipo, coste, miExceso, miCoste: mio - miExceso };
  });
}

/**
 * Lo que se le paga a un trabajador cuando sólo se comisiona por encima de los
 * gastos del día.
 *
 * @param {object} worker    Ficha del trabajador.
 * @param {Array}  entries   Sus servicios (los que se estén liquidando).
 * @param {object} contexto  { tramos, equipoPorDia, costePorDia, retencion }
 *        `equipoPorDia` es lo que facturó **todo el equipo** cada día, no sólo
 *        este trabajador: el umbral se cubre entre todos.
 */
function calcConUmbral(worker, entries, { tramos, equipoPorDia, costePorDia, retencion = null }) {
  const base = Math.max(0, Number(worker.commission_percent) || 0);

  const dias = [];
  let facturadoCents = 0;
  let gastosCents = 0;
  let excesoCents = 0;
  let comisionCents = 0;
  const porTramo = new Map();

  for (const dia of repartoPorDia(entries, equipoPorDia, costePorDia)) {
    const { fecha, mio, equipo, coste, miExceso, miCoste } = dia;
    const puntos = puntosDe(tramos, miExceso);
    const percent = base + puntos;
    const comision = Math.round((miExceso * percent) / 100);

    facturadoCents += mio;
    gastosCents += miCoste;
    excesoCents += miExceso;
    comisionCents += comision;

    if (comision > 0) {
      const clave = percent;
      const acumulado = porTramo.get(clave) || { excesoCents: 0, comisionCents: 0, puntos };
      acumulado.excesoCents += miExceso;
      acumulado.comisionCents += comision;
      porTramo.set(clave, acumulado);
    }

    dias.push({ fecha, equipoCents: equipo, costeCents: coste, mioCents: mio, miExcesoCents: miExceso, percent, comisionCents: comision });
  }

  const breakdown = [...porTramo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([percent, t]) => ({
      concept: `${formatEuro(t.excesoCents)} por encima de gastos × ${fmtPercent(percent)}${
        t.puntos > 0 ? ` (${fmtPercent(base)} + ${t.puntos})` : ''
      }`,
      amountCents: t.comisionCents,
    }));

  if (breakdown.length === 0) {
    breakdown.push({ concept: 'Todavía no se han cubierto los gastos de esos días', amountCents: 0 });
  }

  const retentionCents = calcRetention(retencion, comisionCents);
  if (retentionCents > 0) {
    breakdown.push({ concept: retentionLabel(retencion), amountCents: -retentionCents });
  }

  return {
    grossCommissionCents: comisionCents,
    retentionCents,
    commissionCents: comisionCents - retentionCents,
    companyCents: facturadoCents - comisionCents + retentionCents,
    label: `${fmtPercent(base)} por encima de los gastos del día`,
    breakdown,
    capped: false,
    umbral: {
      activo: true,
      modo: 'umbral',
      concepto: 'Comisiona sobre',
      facturadoCents,
      gastosCents,
      excesoCents,
      dias,
      diasSinCubrir: dias.filter((d) => d.miExcesoCents === 0).length,
    },
  };
}

module.exports = {
  POR_DEFECTO,
  getThreshold,
  setThreshold,
  normalizaTramos,
  puntosDe,
  repartoPorDia,
  calcConUmbral,
};
