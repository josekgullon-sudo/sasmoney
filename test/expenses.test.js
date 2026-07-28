'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Base de datos de usar y tirar para no tocar la de verdad.
const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-test-'));
process.env.DATA_DIR = tmp;

const { nextDate, dateInMonth, addMonths } = require('../src/expenses');

const gasto = (kind, anchor_date) => ({ kind, anchor_date });

test('suma meses ajustando el día en los meses cortos', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29'); // año bisiesto
  assert.equal(addMonths('2026-01-15', 1), '2026-02-15');
  assert.equal(addMonths('2026-12-10', 1), '2027-01-10');
  assert.equal(addMonths('2026-03-31', 3), '2026-06-30');
});

test('un pago suelto sólo cuenta si aún no ha pasado', () => {
  assert.equal(nextDate(gasto('once', '2026-08-15'), '2026-07-28'), '2026-08-15');
  assert.equal(nextDate(gasto('once', '2026-07-28'), '2026-07-28'), '2026-07-28');
  assert.equal(nextDate(gasto('once', '2026-07-01'), '2026-07-28'), null);
});

test('un gasto mensual salta al siguiente día 5', () => {
  const g = gasto('monthly', '2026-01-05');
  assert.equal(nextDate(g, '2026-07-28'), '2026-08-05');
  assert.equal(nextDate(g, '2026-07-05'), '2026-07-05');
  assert.equal(nextDate(g, '2026-07-04'), '2026-07-05');
});

test('un gasto mensual que empieza más adelante espera a su fecha', () => {
  assert.equal(nextDate(gasto('monthly', '2026-10-01'), '2026-07-28'), '2026-10-01');
});

test('el día 31 se respeta en los meses que lo tienen', () => {
  const g = gasto('monthly', '2026-01-31');
  assert.equal(nextDate(g, '2026-02-01'), '2026-02-28');
  assert.equal(nextDate(g, '2026-03-01'), '2026-03-31');
  assert.equal(nextDate(g, '2026-04-01'), '2026-04-30');
});

test('trimestral y anual saltan lo que toca', () => {
  assert.equal(nextDate(gasto('quarterly', '2026-01-20'), '2026-07-28'), '2026-10-20');
  assert.equal(nextDate(gasto('quarterly', '2026-01-20'), '2026-02-01'), '2026-04-20');
  assert.equal(nextDate(gasto('yearly', '2026-03-10'), '2026-07-28'), '2027-03-10');
  assert.equal(nextDate(gasto('yearly', '2026-03-10'), '2026-01-01'), '2026-03-10');
});

test('salta bien aunque hayan pasado años sin mirarlo', () => {
  assert.equal(nextDate(gasto('monthly', '2020-06-12'), '2026-07-28'), '2026-08-12');
  assert.equal(nextDate(gasto('quarterly', '2020-01-01'), '2026-07-28'), '2026-10-01');
});

test('dice qué día cae dentro de un mes concreto', () => {
  assert.equal(dateInMonth(gasto('monthly', '2026-01-05'), '2026-09'), '2026-09-05');
  assert.equal(dateInMonth(gasto('once', '2026-09-20'), '2026-09'), '2026-09-20');
  assert.equal(dateInMonth(gasto('once', '2026-08-20'), '2026-09'), null);
  // Un trimestral de enero cae en abril, julio y octubre, no en septiembre.
  assert.equal(dateInMonth(gasto('quarterly', '2026-01-10'), '2026-10'), '2026-10-10');
  assert.equal(dateInMonth(gasto('quarterly', '2026-01-10'), '2026-09'), null);
});

test('un gasto no cuenta en los meses anteriores a su primera fecha', () => {
  assert.equal(dateInMonth(gasto('monthly', '2026-06-01'), '2026-03'), null);
  assert.equal(dateInMonth(gasto('yearly', '2026-06-01'), '2025-06'), null);
});

test('el anual cae en su mes cada año', () => {
  assert.equal(dateInMonth(gasto('yearly', '2026-03-10'), '2027-03'), '2027-03-10');
  assert.equal(dateInMonth(gasto('yearly', '2026-03-10'), '2027-04'), null);
});
