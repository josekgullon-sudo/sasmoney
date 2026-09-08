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
 *      puntos de cada tramo, y cada tramo cuenta sólo sobre su trozo.
 *
 * La escalera va en puntos, no en porcentajes cerrados: así cada trabajador
 * conserva su base (una al 40 %, otra al 35 %) y el tramo sube a los dos por
 * igual. Hay una escalera general y cada trabajador puede tener la suya.
 *
 * Y la subida es **escalonada**: cada tramo cobra su porcentaje sólo sobre la
 * parte que le toca, no sobre todo el exceso. Con 0 € → +0 y 200 € → +5, y un
 * exceso de 300 €, los primeros 200 € van a su porcentaje de siempre y sólo los
 * 100 € que pasan de ahí cobran los cinco puntos de más. Es como funciona un
 * sueldo por tramos de toda la vida, y evita el escalón absurdo de que ganar un
 * euro más suba la comisión de todo lo anterior.
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

/**
 * La escalera que le toca a un trabajador: la suya si la tiene puesta, y si no
 * la general.
 *
 * Cada trabajador puede tener la suya porque no todos rinden igual ni cobran
 * igual: a una le puedes premiar antes que a otra. Quien no tenga nada propio
 * sigue la general, que es lo normal y lo que evita tener que repetir la misma
 * escalera en cada ficha.
 */
function tramosDe(worker, general) {
  const propios = leePropios(worker);
  return propios ? normalizaTramos(propios) : general;
}

/** ¿Tiene escalera propia? Devuelve la lista, o null si sigue la general. */
function leePropios(worker) {
  try {
    const raw = String((worker && worker.umbral_tramos_json) || '').trim();
    if (!raw) return null;
    const lista = JSON.parse(raw);
    return Array.isArray(lista) && lista.length > 0 ? lista : null;
  } catch {
    return null;
  }
}

/** Si tiene escalera propia (para pintarlo distinto en las pantallas). */
function tieneTramosPropios(worker) {
  return leePropios(worker) !== null;
}

function setThreshold({ activo, tramos }) {
  setSetting('umbral_activo', activo ? '1' : '0');
  setSetting('umbral_tramos', JSON.stringify(normalizaTramos(tramos)));
}

/** Los puntos que se suman en el tramo donde cae un exceso dado. */
function puntosDe(tramos, excesoCents) {
  let puntos = 0;
  for (const t of tramos) {
    if (excesoCents >= t.min_cents) puntos = t.puntos;
  }
  return puntos;
}

/**
 * La comisión de un exceso, tramo a tramo.
 *
 * Cada tramo cobra su porcentaje **sólo sobre su parte**. Con la escalera
 * 0 € → +0 y 200 € → +5, un trabajador al 40 % y 300 € de exceso:
 *
 *   los primeros 200 €  × 40 %  =  80,00 €
 *   los otros 100 €     × 45 %  =  45,00 €
 *                                 ─────────
 *                                 125,00 €
 *
 * y no 300 € × 45 %, que serían 135 € y haría que ganar un euro de más subiera
 * el porcentaje de todo lo anterior.
 *
 * @returns {{cents:number, partes:Array}} lo que se lleva y el detalle por tramo.
 */
function comisionEscalonada(tramos, base, excesoCents) {
  let cents = 0;
  const partes = [];

  for (let i = 0; i < tramos.length; i++) {
    const desde = tramos[i].min_cents;
    if (excesoCents <= desde) break;

    const hasta = i + 1 < tramos.length ? tramos[i + 1].min_cents : Infinity;
    const porcionCents = Math.min(excesoCents, hasta) - desde;
    const percent = base + tramos[i].puntos;
    const parteCents = Math.round((porcionCents * percent) / 100);

    cents += parteCents;
    partes.push({ desde, hasta, porcionCents, percent, puntos: tramos[i].puntos, cents: parteCents });
  }

  return { cents, partes };
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
    const { cents: comision, partes } = comisionEscalonada(tramos, base, miExceso);

    facturadoCents += mio;
    gastosCents += miCoste;
    excesoCents += miExceso;
    comisionCents += comision;

    // El desglose junta los mismos tramos de todos los días: al liquidar un mes
    // interesa "tanto al 40 % y tanto al 45 %", no treinta líneas iguales.
    for (const parte of partes) {
      const acumulado = porTramo.get(parte.desde) || {
        desde: parte.desde,
        percent: parte.percent,
        puntos: parte.puntos,
        excesoCents: 0,
        comisionCents: 0,
      };
      acumulado.excesoCents += parte.porcionCents;
      acumulado.comisionCents += parte.cents;
      porTramo.set(parte.desde, acumulado);
    }

    dias.push({
      fecha,
      equipoCents: equipo,
      costeCents: coste,
      mioCents: mio,
      miExcesoCents: miExceso,
      // Con varios tramos en un mismo día no hay "un" porcentaje: se enseña el
      // que sale de verdad, que es lo que se puede comprobar con una regla de tres.
      percent: miExceso > 0 ? Math.round((comision / miExceso) * 1000) / 10 : 0,
      partes,
      comisionCents: comision,
    });
  }

  const breakdown = [...porTramo.values()]
    .sort((a, b) => a.desde - b.desde)
    .map((t) => ({
      concept:
        t.desde === 0
          ? `${formatEuro(t.excesoCents)} por encima de gastos × ${fmtPercent(t.percent)}`
          : `${formatEuro(t.excesoCents)} a partir de ${formatEuro(t.desde)} × ${fmtPercent(
              t.percent
            )} (${fmtPercent(base)} + ${t.puntos})`,
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
  comisionEscalonada,
  tramosDe,
  tieneTramosPropios,
  puntosDe,
  repartoPorDia,
  calcConUmbral,
};
