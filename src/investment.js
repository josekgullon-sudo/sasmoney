'use strict';

const { db, getSetting, setSetting } = require('./db');

/**
 * Reparto de la inversión (publicidad y demás) entre los trabajadores.
 *
 * Dos maneras:
 *   'facturacion' — a cada uno le toca la misma proporción que ha facturado.
 *   'manual'      — el jefe decide el porcentaje de cada uno.
 *
 * En los dos casos el último reparto se ajusta con lo que quede, para que la
 * suma cuadre al céntimo con la inversión del mes y no se pierda ni se invente
 * dinero por los redondeos.
 */

const MODES = ['facturacion', 'manual'];

function getMode() {
  const v = getSetting('reparto_inversion', 'facturacion');
  return MODES.includes(v) ? v : 'facturacion';
}

function setMode(mode) {
  setSetting('reparto_inversion', MODES.includes(mode) ? mode : 'facturacion');
}

/** Guarda el porcentaje que carga cada trabajador. */
function setShares(pares) {
  const stmt = db.prepare('UPDATE users SET investment_share = ? WHERE id = ? AND role = \'worker\'');
  for (const { id, share } of pares) {
    stmt.run(Math.max(0, Math.min(100, Number(share) || 0)), id);
  }
}

/**
 * Reparte la inversión entre las filas dadas.
 *
 * @param {number} inversionCents  Total a repartir.
 * @param {Array}  rows            [{ user, totalCents, ... }]
 * @param {string} mode            'facturacion' | 'manual'
 * @returns {Array} las mismas filas con inversionCents y sharePercent añadidos.
 */
function split(inversionCents, rows, mode = getMode()) {
  if (rows.length === 0) return [];

  const pesos = rows.map((r) =>
    mode === 'manual' ? Math.max(0, Number(r.user.investment_share) || 0) : Math.max(0, r.totalCents)
  );
  const sumaPesos = pesos.reduce((a, p) => a + p, 0);

  let repartido = 0;
  return rows.map((r, i) => {
    const esUltimo = i === rows.length - 1;
    // Al último le toca lo que sobra: así la suma cuadra exacta.
    const suya = esUltimo
      ? Math.max(0, inversionCents - repartido)
      : sumaPesos > 0
        ? Math.round((inversionCents * pesos[i]) / sumaPesos)
        : 0;
    repartido += suya;

    return {
      ...r,
      inversionCents: suya,
      sharePercent: sumaPesos > 0 ? (pesos[i] / sumaPesos) * 100 : 0,
      beneficioCents: r.totalCents - r.calc.commissionCents - suya,
    };
  });
}

/** Suma de los porcentajes puestos a mano; sirve para avisar si no dan 100. */
function manualTotal(workers) {
  return workers.reduce((a, w) => a + (Number(w.investment_share) || 0), 0);
}

module.exports = { MODES, getMode, setMode, setShares, split, manualTotal };
