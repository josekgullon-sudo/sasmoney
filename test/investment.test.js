'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-inv-'));
process.env.DATA_DIR = tmp;

const { split, sharesFromBilling } = require('../src/investment');

const fila = (nombre, facturado, comision, share = 0) => ({
  user: { id: nombre, name: nombre, investment_share: share },
  totalCents: facturado,
  calc: { commissionCents: comision },
});

test('cada uno carga exactamente el porcentaje que le has puesto', () => {
  const r = split(100000, [fila('Ana', 300000, 120000, 60), fila('Lucia', 100000, 30000, 30)]);
  assert.equal(r.rows[0].inversionCents, 60000); // 60 % literal
  assert.equal(r.rows[1].inversionCents, 30000); // 30 % literal
});

test('lo que no llega a 100 se queda sin asignar, no se reparte a la fuerza', () => {
  // 60 + 30 = 90: el 10 % restante es gasto de la empresa, de nadie.
  const r = split(100000, [fila('Ana', 300000, 120000, 60), fila('Lucia', 100000, 30000, 30)]);
  assert.equal(r.asignadoCents, 90000);
  assert.equal(r.sinAsignarCents, 10000);
  assert.equal(r.sumaPercent, 90);
});

test('con 100 % repartido no queda nada sin asignar', () => {
  const r = split(62000, [fila('Ana', 300000, 120000, 20), fila('Lucia', 100000, 30000, 80)]);
  assert.equal(r.rows[0].inversionCents, 12400);
  assert.equal(r.rows[1].inversionCents, 49600);
  assert.equal(r.sinAsignarCents, 0);
});

test('el porcentaje manda, no lo que factura cada uno', () => {
  // Ana factura el triple pero sólo carga el 20 %.
  const r = split(100000, [fila('Ana', 3000000, 0, 20), fila('Lucia', 100000, 0, 80)]);
  assert.equal(r.rows[0].inversionCents, 20000);
  assert.equal(r.rows[1].inversionCents, 80000);
});

test('sin porcentajes puestos, la inversión no carga sobre nadie', () => {
  const r = split(50000, [fila('A', 100000, 0), fila('B', 100000, 0)]);
  assert.equal(r.asignadoCents, 0);
  assert.equal(r.sinAsignarCents, 50000);
});

test('sin inversión no se reparte nada', () => {
  const r = split(0, [fila('A', 100000, 40000, 50), fila('B', 100000, 40000, 50)]);
  assert.equal(r.rows[0].inversionCents, 0);
  assert.equal(r.sinAsignarCents, 0);
});

test('lo que deja cada uno descuenta su comisión y su parte de la inversión', () => {
  const r = split(10000, [fila('Ana', 300000, 120000, 100)]);
  assert.equal(r.rows[0].beneficioCents, 300000 - 120000 - 10000);
});

test('el atajo de repartir según lo facturado suma 100', () => {
  const shares = sharesFromBilling([fila('Ana', 300000, 0), fila('Lucia', 100000, 0)]);
  assert.deepEqual(shares, [
    { id: 'Ana', share: 75 },
    { id: 'Lucia', share: 25 },
  ]);
  assert.equal(shares.reduce((a, s) => a + s.share, 0), 100);
});

test('el atajo cuadra a 100 aunque los decimales no salgan redondos', () => {
  const shares = sharesFromBilling([fila('A', 100, 0), fila('B', 100, 0), fila('C', 100, 0)]);
  assert.equal(shares.reduce((a, s) => a + s.share, 0), 100);
});

test('sin facturación el atajo deja todo a cero', () => {
  const shares = sharesFromBilling([fila('A', 0, 0), fila('B', 0, 0)]);
  assert.deepEqual(shares, [{ id: 'A', share: 0 }, { id: 'B', share: 0 }]);
});
