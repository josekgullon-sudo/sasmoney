'use strict';

const { db } = require('./db');

/**
 * Reparto de la inversión (publicidad y demás) entre los trabajadores.
 *
 * Cada trabajador tiene un porcentaje fijo que decide el jefe: "tú el 60 %, tú
 * el 30 %". Ese porcentaje se aplica tal cual, mes tras mes, hasta que lo
 * cambie. No se calcula solo a partir de lo que factura nadie.
 *
 * Si los porcentajes no llegan a 100, lo que falta queda **sin asignar**: es
 * gasto de la empresa que no carga sobre ninguna persona. Y si se pasan de 100
 * se avisa, pero se respeta lo escrito: manda lo que ha puesto el jefe.
 */

/** Guarda el porcentaje que carga cada trabajador. */
function setShares(pares) {
  const stmt = db.prepare("UPDATE users SET investment_share = ? WHERE id = ? AND role = 'worker'");
  for (const { id, share } of pares) {
    stmt.run(Math.max(0, Math.min(100, Number(share) || 0)), id);
  }
}

/**
 * Reparte la inversión según el porcentaje de cada uno.
 *
 * @param {number} inversionCents  Total del mes a repartir.
 * @param {Array}  rows            [{ user, totalCents, calc, ... }]
 * @returns {{rows: Array, asignadoCents: number, sinAsignarCents: number, sumaPercent: number}}
 */
function split(inversionCents, rows) {
  const conParte = rows.map((r) => {
    const share = Math.max(0, Number(r.user.investment_share) || 0);
    const suya = Math.round((inversionCents * share) / 100);
    return {
      ...r,
      sharePercent: share,
      inversionCents: suya,
      beneficioCents: r.totalCents - r.calc.commissionCents - suya,
    };
  });

  const asignadoCents = conParte.reduce((a, r) => a + r.inversionCents, 0);

  return {
    rows: conParte,
    asignadoCents,
    // Lo que no carga sobre nadie se queda como gasto general de la empresa.
    sinAsignarCents: Math.max(0, inversionCents - asignadoCents),
    sumaPercent: rows.reduce((a, r) => a + (Number(r.user.investment_share) || 0), 0),
  };
}

/**
 * Porcentajes que saldrían si se repartiera según lo que ha facturado cada uno.
 * Sirve como punto de partida para rellenar el formulario, no como regla fija.
 */
function sharesFromBilling(rows) {
  const total = rows.reduce((a, r) => a + Math.max(0, r.totalCents), 0);
  if (total <= 0) return rows.map((r) => ({ id: r.user.id, share: 0 }));

  // Se redondea a un decimal y el último se lleva lo que falte para llegar a 100.
  let acumulado = 0;
  return rows.map((r, i) => {
    const esUltimo = i === rows.length - 1;
    const share = esUltimo
      ? Math.round((100 - acumulado) * 10) / 10
      : Math.round((Math.max(0, r.totalCents) / total) * 1000) / 10;
    acumulado += share;
    return { id: r.user.id, share: Math.max(0, share) };
  });
}

/**
 * Reparte a partes iguales entre los trabajadores que cuenten.
 *
 * Es lo que se hace con los gastos que no son publicidad (alquiler, gestoría...):
 * no dependen de quién trabaje, así que cada uno carga la misma parte. Si entra
 * alguien nuevo, el reparto se ajusta solo: con dos son la mitad cada uno, con
 * tres un tercio. Al último le toca lo que sobra del redondeo, para que la suma
 * cuadre al céntimo.
 *
 * @param {number} cents        Total a repartir.
 * @param {Array}  rows         Filas de trabajadores.
 * @param {Function} cuenta     Cuáles entran en el reparto (por defecto, los activos).
 * @returns {Map} id de trabajador -> céntimos que le tocan.
 */
function splitEqually(cents, rows, cuenta = (r) => Boolean(r.user.active)) {
  const reparto = new Map(rows.map((r) => [r.user.id, 0]));
  const participan = rows.filter(cuenta);
  if (participan.length === 0 || cents <= 0) return reparto;

  const cada = Math.round(cents / participan.length);
  let repartido = 0;

  participan.forEach((r, i) => {
    const suya = i === participan.length - 1 ? cents - repartido : cada;
    repartido += suya;
    reparto.set(r.user.id, suya);
  });

  return reparto;
}

module.exports = { setShares, split, sharesFromBilling, splitEqually };
