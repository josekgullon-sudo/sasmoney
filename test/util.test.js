'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  todayISO,
  monthRange,
  monthLabel,
  formatDate,
  formatStamp,
  isValidDate,
  esc,
} = require('../src/util');

test('la fecha de hoy se calcula en la zona del negocio', () => {
  // 23:30 UTC del 25 de julio ya es día 26 en Madrid (verano, UTC+2).
  assert.equal(todayISO(new Date('2026-07-25T23:30:00Z')), '2026-07-26');
  // 08:00 UTC del 25 de julio sigue siendo día 25.
  assert.equal(todayISO(new Date('2026-07-25T08:00:00Z')), '2026-07-25');
});

test('el rango de un mes coge el primer y el último día', () => {
  assert.deepEqual(monthRange('2026-07'), { from: '2026-07-01', to: '2026-07-31' });
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
});

test('un mes inválido no rompe: se usa el mes actual', () => {
  const r = monthRange('rompeme');
  assert.match(r.from, /^\d{4}-\d{2}-01$/);
});

test('los meses se muestran en español', () => {
  assert.equal(monthLabel('2026-07'), 'julio 2026');
  assert.equal(monthLabel('2026-01'), 'enero 2026');
});

test('las fechas se muestran en formato español', () => {
  assert.equal(formatDate('2026-07-25'), '25/07/2026');
  assert.equal(formatDate(''), '');
});

test('las marcas de tiempo guardadas en UTC se muestran en hora local', () => {
  assert.equal(formatStamp('2026-07-25 23:30:00'), '26/07/2026');
  assert.equal(formatStamp('2026-07-25 08:00:00'), '25/07/2026');
  assert.equal(formatStamp(''), '');
});

test('valida fechas imposibles', () => {
  assert.equal(isValidDate('2026-07-25'), true);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('25/07/2026'), false);
  assert.equal(isValidDate(''), false);
});

test('escapa el HTML que escriben los usuarios', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('Casa "La Paz" & Cía'), 'Casa &quot;La Paz&quot; &amp; Cía');
  assert.equal(esc(null), '');
});

test('la hora se calcula en la zona del negocio', () => {
  const { nowHM, hmFromStamp, isValidTime } = require('../src/util');
  // 13:30 UTC son las 15:30 en Madrid (verano).
  assert.equal(nowHM(new Date('2026-08-01T13:30:00Z')), '15:30');
  // En invierno la diferencia es de una hora.
  assert.equal(nowHM(new Date('2026-01-15T13:30:00Z')), '14:30');
  assert.equal(hmFromStamp('2026-08-01 13:30:00'), '15:30');
  assert.equal(hmFromStamp(''), '');

  assert.equal(isValidTime('09:15'), true);
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('9:15'), false);
  assert.equal(isValidTime(''), false);
});

test('las cuentas van del día 1 hasta hoy, no hasta fin de mes', () => {
  const { monthCutoff, monthInProgress } = require('../src/util');

  // Mes en curso: se corta en el día de hoy.
  assert.equal(monthCutoff('2026-08', '2026-08-02'), '2026-08-02');
  assert.equal(monthInProgress('2026-08', '2026-08-02'), true);

  // Mes ya terminado: cuenta entero.
  assert.equal(monthCutoff('2026-07', '2026-08-02'), '2026-07-31');
  assert.equal(monthInProgress('2026-07', '2026-08-02'), false);

  // El último día del mes ya no queda nada por delante.
  assert.equal(monthCutoff('2026-08', '2026-08-31'), '2026-08-31');
  assert.equal(monthInProgress('2026-08', '2026-08-31'), false);

  // Mes que aún no ha empezado: no ha pasado nada.
  assert.equal(monthCutoff('2026-09', '2026-08-02'), '');
  assert.equal(monthInProgress('2026-09', '2026-08-02'), true);
});
