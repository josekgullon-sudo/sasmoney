'use strict';

const {
  todayISO,
  addDays,
  monthRange,
  monthLabel,
  currentMonth,
  previousMonth,
  daysBetween,
  formatDate,
  formatDateShort,
  isValidDate,
} = require('./util');

/**
 * El trozo de tiempo que se está mirando.
 *
 * Todas las pantallas del jefe (y las cuentas del trabajador) miran siempre un
 * periodo: puede ser un mes entero, un día suelto o dos fechas cualesquiera.
 * Aquí se decide cuál, a partir de lo que venga en la dirección:
 *
 *   ?p=hoy            un atajo con nombre (hoy, ayer, 7 días, mes pasado...)
 *   ?day=2026-08-02   un día suelto
 *   ?from=…&to=…      entre dos fechas (si falta una, se usa la otra)
 *   ?month=2026-08    un mes entero  ← lo de siempre, y lo que se usa si no viene nada
 *
 * Devuelve además hasta qué día hay que contar (`corte`) y si al periodo aún le
 * quedan días por delante (`enCurso`), que es lo que hace que las cifras sean
 * "lo que llevas hasta hoy" y no la previsión del periodo entero.
 */

const ATAJOS = {
  hoy: (hoy) => ({ from: hoy, to: hoy }),
  ayer: (hoy) => ({ from: addDays(hoy, -1), to: addDays(hoy, -1) }),
  '7dias': (hoy) => ({ from: addDays(hoy, -6), to: hoy }),
  '30dias': (hoy) => ({ from: addDays(hoy, -29), to: hoy }),
  mes: (hoy) => monthRange(hoy.slice(0, 7)),
  mes_pasado: (hoy) => monthRange(previousMonth(hoy.slice(0, 7))),
};

const ATAJO_LABELS = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '7dias': '7 días',
  '30dias': '30 días',
  mes: 'Este mes',
  mes_pasado: 'Mes pasado',
};

/** El orden en el que salen los botones rápidos. */
const ATAJOS_RAPIDOS = ['hoy', 'ayer', '7dias', '30dias', 'mes', 'mes_pasado'];

function validMonth(value) {
  const m = String(value || '');
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : currentMonth();
}

/** Si el periodo cuadra justo con un mes entero, devuelve ese mes. */
function mesExacto(from, to) {
  const mes = from.slice(0, 7);
  const r = monthRange(mes);
  return r.from === from && r.to === to ? mes : '';
}

function resolvePeriod(query = {}, hoy = todayISO()) {
  const atajo = String(query.p || '');
  if (ATAJOS[atajo]) return completar({ ...ATAJOS[atajo](hoy), atajo }, hoy);

  const day = String(query.day || '');
  if (isValidDate(day)) return completar({ from: day, to: day }, hoy);

  let from = String(query.from || '');
  let to = String(query.to || '');
  if (isValidDate(from) || isValidDate(to)) {
    // Con una sola fecha se entiende que quiere ver ese día.
    if (!isValidDate(from)) from = to;
    if (!isValidDate(to)) to = from;
    if (from > to) [from, to] = [to, from];
    return completar({ from, to }, hoy);
  }

  const month = validMonth(query.month);
  return completar({ ...monthRange(month), month }, hoy);
}

/** Rellena lo que se deduce de las dos fechas: mes, etiqueta, corte y si sigue abierto. */
function completar(base, hoy) {
  const { from, to } = base;
  const month = base.month || mesExacto(from, to);
  // Hasta qué día hay algo que contar: hoy si el periodo está en marcha, su
  // último día si ya pasó, y '' si todavía no ha empezado.
  const corte = hoy < from ? '' : hoy < to ? hoy : to;
  return {
    from,
    to,
    month,
    corte,
    atajo: base.atajo || '',
    esUnDia: from === to,
    enCurso: hoy < to,
    dias: daysBetween(from, to),
    diasHastaHoy: corte ? daysBetween(from, corte) : 0,
    label: periodLabel({ from, to, month }, hoy),
  };
}

/**
 * El periodo explicado en una frase, para que no haya duda de qué se está
 * mirando. Es lo que evita el "está filtrado por mes, ¿por qué salen datos
 * del día?": lo que sale es el mes, pero sólo los días que ya han pasado.
 */
function periodExplained(periodo) {
  const { from, to, month, corte, enCurso, esUnDia, label, dias, diasHastaHoy } = periodo;
  if (!corte) return 'Este periodo todavía no ha empezado: aún no hay nada que contar.';
  if (esUnDia) return `Sólo el ${formatDateShort(from)}.`;
  if (!enCurso) return `${label} entero, ${rangeLabel(from, to)}.`;
  return (
    `Van ${diasHastaHoy} de los ${dias} días ${month ? `de ${label}` : rangeLabel(from, to)}. ` +
    `Todo lo que ves es lo acumulado desde el ${formatDateShort(from)}, no la previsión ` +
    'de todo el periodo.'
  );
}

/** Cómo se lee el periodo: 'hoy', '2 de agosto', 'agosto 2026', 'del 1 al 15 de agosto'. */
function periodLabel({ from, to, month }, hoy = todayISO()) {
  if (from === to) {
    if (from === hoy) return 'hoy';
    if (from === addDays(hoy, -1)) return 'ayer';
    return formatDateShort(from);
  }
  if (month) return monthLabel(month);
  return `del ${formatDateShort(from)} al ${formatDateShort(to)}`;
}

/**
 * Cuál de los botones rápidos corresponde al periodo que se está viendo.
 * Se compara por fechas, no por el nombre: así "agosto 2026" enciende el botón
 * de "Este mes" aunque hayas llegado por `?month=`.
 */
function atajoActivo(periodo, hoy = todayISO()) {
  for (const nombre of ATAJOS_RAPIDOS) {
    const r = ATAJOS[nombre](hoy);
    if (r.from === periodo.from && r.to === periodo.to) return nombre;
  }
  return '';
}

/** 'el dom, 2 ago' cuando es un solo día; 'del sáb, 1 ago al dom, 2 ago' si son varios. */
function rangeLabel(from, to) {
  if (!from) return '';
  return from === to
    ? `el ${formatDateShort(from)}`
    : `del ${formatDateShort(from)} al ${formatDateShort(to)}`;
}

/**
 * El periodo puesto en dirección web, para no perderlo al saltar de pantalla.
 * Un mes entero viaja como `month=` (más corto y deja el desplegable puesto);
 * lo demás, como dos fechas.
 */
function periodQuery(periodo, extra = {}) {
  const params = new URLSearchParams();
  if (periodo.month) params.set('month', periodo.month);
  else {
    params.set('from', periodo.from);
    params.set('to', periodo.to);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== null && v !== undefined && v !== '') params.set(k, String(v));
  }
  return params.toString();
}

module.exports = {
  ATAJOS,
  ATAJO_LABELS,
  ATAJOS_RAPIDOS,
  resolvePeriod,
  atajoActivo,
  periodLabel,
  periodExplained,
  rangeLabel,
  periodQuery,
  validMonth,
};
