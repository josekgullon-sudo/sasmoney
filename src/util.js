'use strict';

const TZ = process.env.TZ_APP || 'Europe/Madrid';

// Nombre que se ve en la aplicación. Se cambia aquí o con la variable BRAND.
const BRAND = process.env.BRAND || 'SaaS TotalFlix';

/** Fecha de hoy en la zona horaria del negocio, en formato YYYY-MM-DD. */
function todayISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Hora actual del negocio, en formato HH:MM. */
function nowHM(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Hora del negocio a partir de una marca de tiempo guardada en UTC. */
function hmFromStamp(utcString) {
  const s = String(utcString || '').trim();
  if (!s) return '';
  const date = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? '' : nowHM(date);
}

/** Comprueba que una hora tenga la pinta de HH:MM. */
function isValidTime(hm) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(hm || ''));
}

/** Mes actual en formato YYYY-MM. */
function currentMonth() {
  return todayISO().slice(0, 7);
}

/** Devuelve el primer y último día de un mes 'YYYY-MM'. */
function monthRange(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthRange(currentMonth());
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${pad(y, 4)}-${pad(m, 2)}-01`, to: `${pad(y, 4)}-${pad(m, 2)}-${pad(last, 2)}` };
}

/**
 * Hasta qué día de ese mes hay que contar: hoy si el mes está en curso, el
 * último día si ya pasó, y '' si aún no ha empezado (todavía no ha pasado nada).
 */
function monthCutoff(month, hoy = todayISO()) {
  const { from, to } = monthRange(month);
  if (hoy < from) return '';
  return hoy < to ? hoy : to;
}

/** ¿Ese mes sigue corriendo? (quedan días por delante) */
function monthInProgress(month, hoy = todayISO()) {
  const { to } = monthRange(month);
  return hoy < to;
}

/** Suma (o resta, con negativos) días a una fecha ISO. */
function addDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Días que hay de una fecha a otra, contando las dos: del 1 al 2 son 2 días. */
function daysBetween(from, to) {
  if (!from || !to || to < from) return 0;
  const [y1, m1, d1] = String(from).split('-').map(Number);
  const [y2, m2, d2] = String(to).split('-').map(Number);
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.round(ms / 86400000) + 1;
}

/** Mes anterior a uno dado: '2026-01' → '2025-12'. */
function previousMonth(month) {
  return desplazaMes(month, -1);
}

/** Mes siguiente a uno dado: '2026-12' → '2027-01'. */
function nextMonth(month) {
  return desplazaMes(month, 1);
}

function desplazaMes(month, cuantos) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + cuantos, 1));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}`;
}

/** Etiqueta legible de un mes: '2026-07' → 'julio 2026'. */
function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return month;
  const nombre = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
  return `${nombre} ${y}`;
}

/** Lista de los últimos N meses (incluido el actual) para los desplegables. */
function recentMonths(n = 13) {
  const [y, m] = currentMonth().split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}`);
  }
  return out;
}

/** '2026-07-25' → '25/07/2026'. */
function formatDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** '2026-07-25' → 'sáb 25 jul'. */
function formatDateShort(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Las marcas de tiempo se guardan en UTC ("2026-07-25 22:59:01").
 * Aquí se pasan a la fecha del negocio: '26/07/2026'.
 */
function formatStamp(utcString) {
  const s = String(utcString || '').trim();
  if (!s) return '';
  const date = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return s.slice(0, 10).split('-').reverse().join('/');
  return formatDate(todayISO(date));
}

function isValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pad(n, len) {
  return String(n).padStart(len, '0');
}

/** Escapa texto para insertarlo en HTML. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  TZ,
  BRAND,
  todayISO,
  nowHM,
  hmFromStamp,
  isValidTime,
  currentMonth,
  monthRange,
  monthCutoff,
  monthInProgress,
  addDays,
  daysBetween,
  previousMonth,
  nextMonth,
  monthLabel,
  recentMonths,
  formatDate,
  formatDateShort,
  formatStamp,
  isValidDate,
  esc,
};
