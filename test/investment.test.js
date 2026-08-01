'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-inv-'));
process.env.DATA_DIR = tmp;

const { split } = require('../src/investment');

const fila = (nombre, facturado, comision, share = 0) => ({
  user: { id: nombre, name: nombre, investment_share: share },
  totalCents: facturado,
  calc: { commissionCents: comision },
});

test('reparto a mano: 20 % y 80 %', () => {
  const rows = split(100000, [fila('Ana', 300000, 120000, 20), fila('Lucia', 100000, 30000, 80)], 'manual');
  assert.equal(rows[0].inversionCents, 20000);
  assert.equal(rows[1].inversionCents, 80000);
  assert.equal(rows[0].inversionCents + rows[1].inversionCents, 100000);
});

test('reparto por facturación: manda lo que factura cada uno', () => {
  const rows = split(62000, [fila('Ana', 300000, 120000), fila('Lucia', 100000, 30000)], 'facturacion');
  assert.equal(rows[0].inversionCents, 46500); // 75 %
  assert.equal(rows[1].inversionCents, 15500); // 25 %
});

test('la suma cuadra al céntimo aunque el reparto no sea exacto', () => {
  // 100 € entre tres al 33,33 % daría 99,99: el último se lleva el céntimo suelto.
  const rows = split(
    10000,
    [fila('A', 100, 0, 33.33), fila('B', 100, 0, 33.33), fila('C', 100, 0, 33.34)],
    'manual'
  );
  assert.equal(rows.reduce((a, r) => a + r.inversionCents, 0), 10000);
});

test('los porcentajes a mano no tienen que sumar 100: se normalizan', () => {
  const rows = split(30000, [fila('A', 0, 0, 1), fila('B', 0, 0, 2)], 'manual');
  assert.equal(rows[0].inversionCents, 10000);
  assert.equal(rows[1].inversionCents, 20000);
});

test('si nadie tiene porcentaje, el último carga con todo antes que perderlo', () => {
  const rows = split(5000, [fila('A', 0, 0, 0), fila('B', 0, 0, 0)], 'manual');
  assert.equal(rows.reduce((a, r) => a + r.inversionCents, 0), 5000);
});

test('sin inversión no se reparte nada', () => {
  const rows = split(0, [fila('A', 100000, 40000, 50), fila('B', 100000, 40000, 50)], 'manual');
  assert.equal(rows[0].inversionCents, 0);
  assert.equal(rows[1].inversionCents, 0);
});

test('lo que deja cada uno descuenta comisión e inversión', () => {
  const rows = split(10000, [fila('Ana', 300000, 120000, 100)], 'manual');
  assert.equal(rows[0].beneficioCents, 300000 - 120000 - 10000);
});
