'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-ganancias-'));
process.env.DATA_DIR = tmp;

const { calcSobreGanancias } = require('../src/threshold');
const { calcCommission, ruleLabel, profitShares } = require('../src/commission');

const DIA = '2026-09-03';
const AYER = '2026-09-02';

// El trato nuevo: la empresa se lleva el 40 % de las ganancias, él el 60 %.
const socio = { commission_type: 'profit', profit_company_percent: 40 };

const dia = (equipo, coste) => ({
  equipoPorDia: new Map([[DIA, equipo]]),
  costePorDia: new Map([[DIA, coste]]),
});

const servicio = (cents, fecha = DIA) => ({ service_date: fecha, amount_cents: cents });

test('el reparto se lee en las dos direcciones', () => {
  assert.deepEqual(profitShares(socio), { empresa: 40, trabajador: 60 });
  assert.match(ruleLabel(socio), /60%/);
  assert.match(ruleLabel(socio), /40%/);
});

test('se reparte lo que queda tras los gastos, no lo facturado', () => {
  // Él solo ese día: factura 250 €, el día cuesta 150 € → gana 100 €.
  const calc = calcSobreGanancias(socio, [servicio(25000)], dia(25000, 15000));

  assert.equal(calc.umbral.facturadoCents, 25000);
  assert.equal(calc.umbral.gastosCents, 15000);
  assert.equal(calc.umbral.excesoCents, 10000); // la ganancia
  // El 60 % de los 100 € de ganancia, no de los 250 € facturados.
  assert.equal(calc.commissionCents, 6000);
  assert.equal(calc.companyCents, 19000);
});

test('un día que no cubre gastos no deja nada que repartir', () => {
  const calc = calcSobreGanancias(socio, [servicio(12000)], dia(12000, 15000));
  assert.equal(calc.commissionCents, 0);
  assert.equal(calc.umbral.excesoCents, 0);
  assert.equal(calc.umbral.diasSinCubrir, 1);
});

test('los gastos del día se reparten según lo que ha facturado cada uno', () => {
  // Equipo 250 € (él 150), gastos 150 €: sobran 100 € y le tocan 60 €.
  const calc = calcSobreGanancias(socio, [servicio(15000)], dia(25000, 15000));
  assert.equal(calc.umbral.excesoCents, 6000);
  assert.equal(calc.commissionCents, 3600); // el 60 % de 60 €
});

test('cada día va por su cuenta: uno malo no se come al bueno', () => {
  const calc = calcSobreGanancias(socio, [servicio(10000, AYER), servicio(25000, DIA)], {
    equipoPorDia: new Map([[AYER, 10000], [DIA, 25000]]),
    costePorDia: new Map([[AYER, 15000], [DIA, 15000]]),
  });
  assert.equal(calc.umbral.diasSinCubrir, 1);
  assert.equal(calc.umbral.excesoCents, 10000);
  assert.equal(calc.commissionCents, 6000);
});

test('el desglose cuadra con lo que se paga, también con retención', () => {
  const sin = calcSobreGanancias(socio, [servicio(25000)], dia(25000, 15000));
  assert.equal(sin.breakdown.reduce((a, b) => a + b.amountCents, 0), sin.commissionCents);

  const con = calcSobreGanancias(socio, [servicio(25000)], {
    ...dia(25000, 15000),
    retencion: { percent: 15, desde: '2026-08-10', baseTotal: 25000, baseAfectada: 25000 },
  });
  assert.equal(con.grossCommissionCents, 6000);
  assert.equal(con.retentionCents, 900);
  assert.equal(con.commissionCents, 5100);
  assert.equal(con.breakdown.reduce((a, b) => a + b.amountCents, 0), 5100);
});

test('cambiar el reparto cambia lo que se lleva cada uno', () => {
  const mitad = calcSobreGanancias(
    { commission_type: 'profit', profit_company_percent: 50 },
    [servicio(25000)],
    dia(25000, 15000)
  );
  assert.equal(mitad.commissionCents, 5000);

  const todoEmpresa = calcSobreGanancias(
    { commission_type: 'profit', profit_company_percent: 100 },
    [servicio(25000)],
    dia(25000, 15000)
  );
  assert.equal(todoEmpresa.commissionCents, 0);
});

test('sin servicios no se paga nada, y no se cuela el % de otra regla', () => {
  // Sin días que mirar la cuenta cae en calcCommission: no hay ganancia y no
  // puede pagarse nada sobre lo facturado.
  const calc = calcCommission(socio, { totalCents: 0, serviceCount: 0 });
  assert.equal(calc.commissionCents, 0);

  const conTotal = calcCommission(socio, { totalCents: 25000, serviceCount: 3 });
  assert.equal(conTotal.commissionCents, 0);
});
