'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePeriod, periodLabel, rangeLabel, periodQuery } = require('../src/period');

const HOY = '2026-08-02';

test('sin nada en la dirección se mira el mes actual', () => {
  const p = resolvePeriod({}, HOY);
  assert.equal(p.from, '2026-08-01');
  assert.equal(p.to, '2026-08-31');
  assert.equal(p.month, '2026-08');
  assert.equal(p.label, 'agosto 2026');
});

test('los atajos salen del día de hoy', () => {
  assert.deepEqual(pick(resolvePeriod({ p: 'hoy' }, HOY)), ['2026-08-02', '2026-08-02']);
  assert.deepEqual(pick(resolvePeriod({ p: 'ayer' }, HOY)), ['2026-08-01', '2026-08-01']);
  assert.deepEqual(pick(resolvePeriod({ p: '7dias' }, HOY)), ['2026-07-27', '2026-08-02']);
  assert.deepEqual(pick(resolvePeriod({ p: '30dias' }, HOY)), ['2026-07-04', '2026-08-02']);
  assert.deepEqual(pick(resolvePeriod({ p: 'mes' }, HOY)), ['2026-08-01', '2026-08-31']);
  assert.deepEqual(pick(resolvePeriod({ p: 'mes_pasado' }, HOY)), ['2026-07-01', '2026-07-31']);
});

test('un atajo desconocido no rompe: se cae al mes actual', () => {
  assert.equal(resolvePeriod({ p: 'rompeme' }, HOY).month, '2026-08');
});

test('se puede pedir un día suelto de varias maneras', () => {
  assert.deepEqual(pick(resolvePeriod({ day: '2026-07-14' }, HOY)), ['2026-07-14', '2026-07-14']);
  // Con una sola fecha se entiende que quiere ver ese día.
  assert.deepEqual(pick(resolvePeriod({ from: '2026-07-14' }, HOY)), ['2026-07-14', '2026-07-14']);
  assert.deepEqual(pick(resolvePeriod({ to: '2026-07-14' }, HOY)), ['2026-07-14', '2026-07-14']);
  assert.equal(resolvePeriod({ day: '2026-07-14' }, HOY).esUnDia, true);
});

test('dos fechas al revés se enderezan solas', () => {
  assert.deepEqual(pick(resolvePeriod({ from: '2026-08-20', to: '2026-08-05' }, HOY)), [
    '2026-08-05',
    '2026-08-20',
  ]);
});

test('una fecha imposible no cuela: se usa el mes', () => {
  assert.equal(resolvePeriod({ from: '2026-02-30' }, HOY).month, '2026-08');
  assert.equal(resolvePeriod({ day: 'ayer' }, HOY).month, '2026-08');
});

test('dos fechas que cuadran con un mes entero se tratan como ese mes', () => {
  const p = resolvePeriod({ from: '2026-07-01', to: '2026-07-31' }, HOY);
  assert.equal(p.month, '2026-07');
  assert.equal(p.label, 'julio 2026');
});

test('el corte marca hasta dónde hay algo que contar', () => {
  // Mes en curso: se corta hoy y aún quedan días por delante.
  const enMarcha = resolvePeriod({ month: '2026-08' }, HOY);
  assert.equal(enMarcha.corte, HOY);
  assert.equal(enMarcha.enCurso, true);

  // Periodo ya cerrado: cuenta entero.
  const pasado = resolvePeriod({ month: '2026-07' }, HOY);
  assert.equal(pasado.corte, '2026-07-31');
  assert.equal(pasado.enCurso, false);

  // Todavía no ha empezado: no ha pasado nada.
  const futuro = resolvePeriod({ month: '2026-09' }, HOY);
  assert.equal(futuro.corte, '');
  assert.equal(futuro.enCurso, true);
});

test('el periodo se lee en cristiano', () => {
  assert.equal(periodLabel({ from: HOY, to: HOY }, HOY), 'hoy');
  assert.equal(periodLabel({ from: '2026-08-01', to: '2026-08-01' }, HOY), 'ayer');
  assert.equal(periodLabel({ from: '2026-07-14', to: '2026-07-14' }, HOY), 'mar, 14 jul');
  assert.equal(periodLabel({ from: '2026-07-01', to: '2026-07-31', month: '2026-07' }, HOY), 'julio 2026');
  assert.equal(
    periodLabel({ from: '2026-07-01', to: '2026-07-15' }, HOY),
    'del mié, 1 jul al mié, 15 jul'
  );

  assert.equal(rangeLabel('2026-07-14', '2026-07-14'), 'el mar, 14 jul');
  assert.equal(rangeLabel('2026-07-01', '2026-07-15'), 'del mié, 1 jul al mié, 15 jul');
});

test('el periodo viaja en la dirección sin perderse', () => {
  assert.equal(periodQuery(resolvePeriod({ month: '2026-07' }, HOY)), 'month=2026-07');
  assert.equal(
    periodQuery(resolvePeriod({ p: 'hoy' }, HOY)),
    'from=2026-08-02&to=2026-08-02'
  );
  // Los filtros vacíos no ensucian la dirección.
  assert.equal(
    periodQuery(resolvePeriod({ month: '2026-07' }, HOY), { worker: 3, editar: '' }),
    'month=2026-07&worker=3'
  );

  // Y lo que sale se vuelve a entender igual al entrar.
  const ida = resolvePeriod({ p: '7dias' }, HOY);
  const vuelta = resolvePeriod(Object.fromEntries(new URLSearchParams(periodQuery(ida))), HOY);
  assert.deepEqual(pick(vuelta), pick(ida));
});

test('el periodo se explica sin que quepa duda de qué se está mirando', () => {
  const { periodExplained } = require('../src/period');
  const di = (q) => periodExplained(resolvePeriod(q, HOY));

  // Un mes en marcha: se dice cuántos días llevas, para que no parezca el día suelto.
  assert.equal(
    di({ month: '2026-08' }),
    'Van 2 de los 31 días de agosto 2026. Todo lo que ves es lo acumulado desde el sáb, 1 ago,' +
      ' no la previsión de todo el periodo.'
  );
  assert.equal(di({ p: 'hoy' }), 'Sólo el dom, 2 ago.');
  assert.equal(di({ month: '2026-07' }), 'julio 2026 entero, del mié, 1 jul al vie, 31 jul.');
  assert.match(di({ from: '2026-08-01', to: '2026-08-15' }), /^Van 2 de los 15 días del sáb, 1 ago/);
  assert.match(di({ month: '2026-09' }), /todavía no ha empezado/);
});

test('cuenta bien los días de cada periodo', () => {
  const agosto = resolvePeriod({ month: '2026-08' }, HOY);
  assert.equal(agosto.dias, 31);
  assert.equal(agosto.diasHastaHoy, 2);

  const semana = resolvePeriod({ p: '7dias' }, HOY);
  assert.equal(semana.dias, 7);
  assert.equal(semana.diasHastaHoy, 7); // acaba hoy: ya han pasado los siete

  const futuro = resolvePeriod({ month: '2026-09' }, HOY);
  assert.equal(futuro.dias, 30);
  assert.equal(futuro.diasHastaHoy, 0);
});

function pick(p) {
  return [p.from, p.to];
}
