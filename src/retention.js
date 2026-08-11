'use strict';

const { getSetting, setSetting } = require('./db');
const { isValidDate } = require('./util');

/**
 * Retención sobre lo que cobran los trabajadores.
 *
 * De cada transacción a partir de una fecha se le descuenta un porcentaje a lo
 * que le tocaría cobrar: si le tocaban 100 €, cobra 85 €. Lo retenido se queda
 * en la empresa.
 *
 * Va por **fecha del servicio**, no por cuándo se liquide: los servicios
 * anteriores a esa fecha se pagan enteros aunque se liquiden hoy. Así una
 * liquidación que cruce la fecha sale bien sin tener que partirla a mano.
 *
 * El porcentaje y la fecha se cambian desde la pantalla de Trabajadores; poner
 * el porcentaje a 0 la desactiva.
 */

const POR_DEFECTO = { percent: 15, desde: '2026-08-10' };

function getRetention() {
  const percent = Number(String(getSetting('retencion_percent', POR_DEFECTO.percent)).replace(',', '.'));
  const desde = getSetting('retencion_desde', POR_DEFECTO.desde);
  return {
    percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : POR_DEFECTO.percent,
    desde: isValidDate(desde) ? desde : POR_DEFECTO.desde,
  };
}

function setRetention({ percent, desde }) {
  const p = Number(String(percent).replace(',', '.'));
  setSetting('retencion_percent', Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0);
  if (isValidDate(desde)) setSetting('retencion_desde', desde);
}

/**
 * La base sobre la que se reparte la comisión entre los servicios.
 *
 * Con un porcentaje o con tramos, lo que pesa es el importe facturado; con una
 * cantidad fija por servicio, lo que pesa es cada servicio, valga lo que valga.
 */
function pesoDe(rule, entry) {
  return rule.commission_type === 'fixed' ? 1 : Math.max(0, entry.amount_cents || 0);
}

/** La retención lista para pasársela a calcCommission, a partir de los servicios. */
function forEntries(rule, entries) {
  const retencion = getRetention();
  if (retencion.percent <= 0) return null;

  let baseTotal = 0;
  let baseAfectada = 0;
  for (const e of entries) {
    const peso = pesoDe(rule, e);
    baseTotal += peso;
    if (e.service_date >= retencion.desde) baseAfectada += peso;
  }
  return { ...retencion, baseTotal, baseAfectada };
}

/**
 * Lo mismo, pero cuando sólo se tienen los totales (sin la lista de servicios).
 * `totals` es lo que devuelve repo.totalsFor.
 */
function forTotals(rule, totals) {
  const retencion = getRetention();
  if (retencion.percent <= 0) return null;

  const porServicio = rule.commission_type === 'fixed';
  return {
    ...retencion,
    baseTotal: porServicio ? totals.count : totals.totalCents,
    baseAfectada: porServicio ? totals.afectadoCount : totals.afectadoCents,
  };
}

module.exports = { POR_DEFECTO, getRetention, setRetention, forEntries, forTotals };
