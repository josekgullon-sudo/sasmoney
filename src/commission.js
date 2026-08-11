'use strict';

/**
 * Motor de cálculo de comisiones.
 *
 * Cada trabajador tiene una regla:
 *
 *  - 'percent'  → un porcentaje único sobre todo lo facturado.
 *  - 'tiers'    → varios porcentajes por tramos de facturación. Dos modos:
 *                 'total'       → se aplica a TODO el importe el % del tramo alcanzado.
 *                 'progressive' → cada tramo cobra su % sólo sobre la parte que le toca.
 *  - 'fixed'    → una cantidad fija por servicio realizado.
 *
 * Todos los importes viajan en céntimos (enteros) para no arrastrar errores de coma flotante.
 */

const COMMISSION_TYPES = ['percent', 'tiers', 'fixed'];

/** Normaliza y ordena los tramos guardados en la ficha del trabajador. */
function parseTiers(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw || '[]');
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];

  return list
    .map((t) => ({
      min_cents: Math.max(0, Math.round(Number(t.min_cents) || 0)),
      percent: Math.max(0, Number(t.percent) || 0),
    }))
    .sort((a, b) => a.min_cents - b.min_cents);
}

/** Asegura que siempre exista un tramo que arranque en 0, para que ningún importe quede sin regla. */
function withBaseTier(tiers) {
  if (tiers.length === 0) return [];
  if (tiers[0].min_cents === 0) return tiers;
  return [{ min_cents: 0, percent: tiers[0].percent }, ...tiers];
}

/**
 * Calcula lo que hay que pagarle a un trabajador.
 *
 * @param {object} rule    Ficha del trabajador (commission_type, commission_percent, tiers_json, tier_mode, fixed_cents).
 * @param {object} totals  { totalCents, serviceCount } y, si la hay, la retención:
 *                         { percent, desde, baseAfectada, baseTotal }.
 * @returns {{commissionCents:number, grossCommissionCents:number, retentionCents:number,
 *            companyCents:number, label:string, breakdown:Array}}
 */
function calcCommission(rule, totals) {
  const totalCents = Math.max(0, Math.round(Number(totals.totalCents) || 0));
  const serviceCount = Math.max(0, Math.round(Number(totals.serviceCount) || 0));
  const type = COMMISSION_TYPES.includes(rule.commission_type) ? rule.commission_type : 'percent';

  let commissionCents = 0;
  let label = '';
  const breakdown = [];

  if (type === 'fixed') {
    const fixed = Math.max(0, Math.round(Number(rule.fixed_cents) || 0));
    commissionCents = fixed * serviceCount;
    label = `${formatEuro(fixed)} por servicio`;
    breakdown.push({
      concept: `${serviceCount} servicio(s) × ${formatEuro(fixed)}`,
      amountCents: commissionCents,
    });
  } else if (type === 'tiers') {
    const tiers = withBaseTier(parseTiers(rule.tiers_json));

    if (tiers.length === 0) {
      label = 'Sin tramos configurados';
    } else if (rule.tier_mode === 'progressive') {
      label = 'Tramos (progresivo)';
      for (let i = 0; i < tiers.length; i++) {
        const from = tiers[i].min_cents;
        const to = i + 1 < tiers.length ? tiers[i + 1].min_cents : Infinity;
        if (totalCents <= from) break;
        const portion = Math.min(totalCents, to) - from;
        const part = Math.round((portion * tiers[i].percent) / 100);
        commissionCents += part;
        breakdown.push({
          concept: `${formatEuro(from)} – ${to === Infinity ? '∞' : formatEuro(to)} · ${fmtPercent(tiers[i].percent)}`,
          amountCents: part,
        });
      }
    } else {
      // Modo 'total': se busca el tramo más alto alcanzado y su % se aplica a todo.
      let applied = tiers[0];
      for (const tier of tiers) {
        if (totalCents >= tier.min_cents) applied = tier;
      }
      commissionCents = Math.round((totalCents * applied.percent) / 100);
      label = `Tramos · alcanzado ${fmtPercent(applied.percent)} (desde ${formatEuro(applied.min_cents)})`;
      breakdown.push({
        concept: `${formatEuro(totalCents)} × ${fmtPercent(applied.percent)}`,
        amountCents: commissionCents,
      });
    }
  } else {
    const percent = Math.max(0, Number(rule.commission_percent) || 0);
    commissionCents = Math.round((totalCents * percent) / 100);
    label = `${fmtPercent(percent)} de lo facturado`;
    breakdown.push({
      concept: `${formatEuro(totalCents)} × ${fmtPercent(percent)}`,
      amountCents: commissionCents,
    });
  }

  // Nunca se paga más de lo facturado: evita que un fijo por servicio se coma la caja sin avisar.
  const capped = Math.min(commissionCents, totalCents);
  const cappedFlag = capped !== commissionCents;

  const retentionCents = calcRetention(totals.retencion, capped);
  if (retentionCents > 0) {
    breakdown.push({
      concept: retentionLabel(totals.retencion),
      amountCents: -retentionCents,
    });
  }

  return {
    // Lo que le tocaría por su regla, antes de retener nada.
    grossCommissionCents: capped,
    retentionCents,
    // Lo que se le paga de verdad: es esto lo que usa toda la aplicación.
    commissionCents: capped - retentionCents,
    companyCents: totalCents - capped + retentionCents,
    label,
    breakdown,
    capped: cappedFlag,
  };
}

/**
 * Retención sobre lo que cobra el trabajador.
 *
 * Se aplica sólo a los servicios a partir de una fecha, así que hace falta saber
 * qué parte de la base va con retención y cuál no: `baseAfectada` sobre
 * `baseTotal`. La base son los euros facturados, salvo con la regla de cantidad
 * fija por servicio, donde lo que cuenta es el número de servicios.
 */
function calcRetention(retencion, commissionCents) {
  if (!retencion) return 0;
  const percent = Math.min(100, Math.max(0, Number(retencion.percent) || 0));
  const baseTotal = Math.max(0, Number(retencion.baseTotal) || 0);
  const baseAfectada = Math.min(baseTotal, Math.max(0, Number(retencion.baseAfectada) || 0));
  if (percent === 0 || baseTotal === 0 || baseAfectada === 0) return 0;

  const parteConRetencion = (commissionCents * baseAfectada) / baseTotal;
  return Math.round((parteConRetencion * percent) / 100);
}

function retentionLabel(retencion) {
  const pct = fmtPercent(Math.min(100, Math.max(0, Number(retencion.percent) || 0)));
  if (!retencion.desde) return `− Retención ${pct}`;
  const [y, m, d] = String(retencion.desde).split('-');
  return `− Retención ${pct} (servicios desde el ${d}/${m}/${y})`;
}

/** Descripción corta de la regla, para listados y fichas. */
function ruleLabel(rule) {
  const type = rule.commission_type;
  if (type === 'fixed') return `${formatEuro(rule.fixed_cents)} por servicio`;
  if (type === 'tiers') {
    const tiers = parseTiers(rule.tiers_json);
    if (tiers.length === 0) return 'Tramos (sin configurar)';
    const modo = rule.tier_mode === 'progressive' ? 'progresivo' : 'sobre el total';
    return `${tiers.map((t) => fmtPercent(t.percent)).join(' / ')} por tramos (${modo})`;
  }
  return `${fmtPercent(rule.commission_percent)} de lo facturado`;
}

function fmtPercent(value) {
  const n = Number(value) || 0;
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}

/** Convierte céntimos a texto en euros con formato español (1.234,50 €). */
function formatEuro(cents) {
  const n = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  const [int, dec] = n.split('.');
  const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots},${dec} €`;
}

/**
 * Lee un importe escrito por una persona ("40", "40,50", "40.50", "1.234,50", "40 €")
 * y lo devuelve en céntimos. Devuelve null si no es un número válido.
 */
function parseAmountToCents(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/[€\s]/g, '');
  if (!s) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // El último separador que aparece es el decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot) {
    // "1.234" son mil doscientos treinta y cuatro; "12.50" son doce con cincuenta.
    const decimals = s.length - s.lastIndexOf('.') - 1;
    if (decimals === 3) s = s.replace(/\./g, '');
  }

  if (!/^-?\d*(\.\d+)?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

module.exports = {
  COMMISSION_TYPES,
  calcCommission,
  ruleLabel,
  parseTiers,
  formatEuro,
  fmtPercent,
  parseAmountToCents,
};
