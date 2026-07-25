'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcCommission,
  parseAmountToCents,
  formatEuro,
  ruleLabel,
} = require('../src/commission');

test('porcentaje único sobre lo facturado', () => {
  const rule = { commission_type: 'percent', commission_percent: 40 };
  const r = calcCommission(rule, { totalCents: 100000, serviceCount: 5 });
  assert.equal(r.commissionCents, 40000);
  assert.equal(r.companyCents, 60000);
});

test('porcentaje con decimales redondea al céntimo', () => {
  const rule = { commission_type: 'percent', commission_percent: 33.33 };
  const r = calcCommission(rule, { totalCents: 10000, serviceCount: 1 });
  assert.equal(r.commissionCents, 3333);
});

test('cantidad fija por servicio', () => {
  const rule = { commission_type: 'fixed', fixed_cents: 1500 };
  const r = calcCommission(rule, { totalCents: 20000, serviceCount: 7 });
  assert.equal(r.commissionCents, 10500);
});

test('la comisión nunca supera lo facturado', () => {
  const rule = { commission_type: 'fixed', fixed_cents: 5000 };
  const r = calcCommission(rule, { totalCents: 4000, serviceCount: 3 });
  assert.equal(r.commissionCents, 4000);
  assert.equal(r.companyCents, 0);
  assert.equal(r.capped, true);
});

test('tramos en modo total: se aplica el % del tramo alcanzado a todo', () => {
  const rule = {
    commission_type: 'tiers',
    tier_mode: 'total',
    tiers_json: JSON.stringify([
      { min_cents: 0, percent: 30 },
      { min_cents: 200000, percent: 35 },
      { min_cents: 400000, percent: 40 },
    ]),
  };
  assert.equal(calcCommission(rule, { totalCents: 100000, serviceCount: 3 }).commissionCents, 30000);
  assert.equal(calcCommission(rule, { totalCents: 250000, serviceCount: 8 }).commissionCents, 87500);
  assert.equal(calcCommission(rule, { totalCents: 400000, serviceCount: 12 }).commissionCents, 160000);
});

test('tramos en modo progresivo: cada tramo cobra sólo su parte', () => {
  const rule = {
    commission_type: 'tiers',
    tier_mode: 'progressive',
    tiers_json: JSON.stringify([
      { min_cents: 0, percent: 30 },
      { min_cents: 200000, percent: 40 },
    ]),
  };
  // 2.000 € al 30 % = 600 €; los 500 € siguientes al 40 % = 200 €.
  const r = calcCommission(rule, { totalCents: 250000, serviceCount: 9 });
  assert.equal(r.commissionCents, 80000);
});

test('los tramos se ordenan aunque el jefe los escriba desordenados', () => {
  const rule = {
    commission_type: 'tiers',
    tier_mode: 'total',
    tiers_json: JSON.stringify([
      { min_cents: 400000, percent: 40 },
      { min_cents: 0, percent: 30 },
    ]),
  };
  assert.equal(calcCommission(rule, { totalCents: 100000, serviceCount: 1 }).commissionCents, 30000);
});

test('si el primer tramo no empieza en 0, su % cubre también lo de abajo', () => {
  const rule = {
    commission_type: 'tiers',
    tier_mode: 'total',
    tiers_json: JSON.stringify([{ min_cents: 100000, percent: 50 }]),
  };
  assert.equal(calcCommission(rule, { totalCents: 50000, serviceCount: 1 }).commissionCents, 25000);
});

test('sin facturación no hay comisión', () => {
  const rule = { commission_type: 'percent', commission_percent: 40 };
  const r = calcCommission(rule, { totalCents: 0, serviceCount: 0 });
  assert.equal(r.commissionCents, 0);
});

test('lee importes escritos de cualquier manera', () => {
  assert.equal(parseAmountToCents('45'), 4500);
  assert.equal(parseAmountToCents('45,50'), 4550);
  assert.equal(parseAmountToCents('45.50'), 4550);
  assert.equal(parseAmountToCents('1.234,50'), 123450);
  assert.equal(parseAmountToCents('1,234.50'), 123450);
  assert.equal(parseAmountToCents('1.234'), 123400);
  assert.equal(parseAmountToCents(' 60 € '), 6000);
  assert.equal(parseAmountToCents('0'), 0);
  assert.equal(parseAmountToCents(''), null);
  assert.equal(parseAmountToCents('hola'), null);
  assert.equal(parseAmountToCents('-20'), null);
});

test('formatea euros a la española', () => {
  assert.equal(formatEuro(0), '0,00 €');
  assert.equal(formatEuro(4550), '45,50 €');
  assert.equal(formatEuro(123456789), '1.234.567,89 €');
});

test('describe la regla en una línea', () => {
  assert.match(ruleLabel({ commission_type: 'percent', commission_percent: 40 }), /40%/);
  assert.match(ruleLabel({ commission_type: 'fixed', fixed_cents: 1500 }), /15,00 €/);
  assert.match(
    ruleLabel({
      commission_type: 'tiers',
      tier_mode: 'total',
      tiers_json: JSON.stringify([{ min_cents: 0, percent: 30 }, { min_cents: 100000, percent: 40 }]),
    }),
    /30% \/ 40%/
  );
});
