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
