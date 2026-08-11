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

test('la retención descuenta un porcentaje de lo que iba a cobrar', () => {
  const regla = { commission_type: 'percent', commission_percent: 40 };

  // Sin retención, lo de siempre.
  const sin = calcCommission(regla, { totalCents: 100000, serviceCount: 4 });
  assert.equal(sin.commissionCents, 40000);
  assert.equal(sin.retentionCents, 0);

  // Con el 15 % sobre todos los servicios: de 400 € cobra 340 €.
  const todo = calcCommission(regla, {
    totalCents: 100000,
    serviceCount: 4,
    retencion: { percent: 15, desde: '2026-08-10', baseTotal: 100000, baseAfectada: 100000 },
  });
  assert.equal(todo.grossCommissionCents, 40000);
  assert.equal(todo.retentionCents, 6000);
  assert.equal(todo.commissionCents, 34000);
  // Lo retenido se queda en la empresa.
  assert.equal(todo.companyCents, 100000 - 34000);
});

test('la retención sólo pilla los servicios a partir de su fecha', () => {
  const regla = { commission_type: 'percent', commission_percent: 40 };

  // La mitad de lo facturado es de antes del 10 de agosto: sólo retiene la otra mitad.
  const mitad = calcCommission(regla, {
    totalCents: 100000,
    serviceCount: 4,
    retencion: { percent: 15, desde: '2026-08-10', baseTotal: 100000, baseAfectada: 50000 },
  });
  assert.equal(mitad.retentionCents, 3000); // 15 % de los 200 € de comisión afectada
  assert.equal(mitad.commissionCents, 37000);

  // Y si nada cae dentro, no se retiene nada.
  const nada = calcCommission(regla, {
    totalCents: 100000,
    serviceCount: 4,
    retencion: { percent: 15, desde: '2026-08-10', baseTotal: 100000, baseAfectada: 0 },
  });
  assert.equal(nada.retentionCents, 0);
  assert.equal(nada.commissionCents, 40000);
});

test('con cantidad fija por servicio la retención va por servicios, no por euros', () => {
  const regla = { commission_type: 'fixed', fixed_cents: 1500 };
  // 4 servicios a 15 €, dos de ellos con retención: 60 € − 15 % de 30 € = 55,50 €.
  const calc = calcCommission(regla, {
    totalCents: 100000,
    serviceCount: 4,
    retencion: { percent: 15, desde: '2026-08-10', baseTotal: 4, baseAfectada: 2 },
  });
  assert.equal(calc.grossCommissionCents, 6000);
  assert.equal(calc.retentionCents, 450);
  assert.equal(calc.commissionCents, 5550);
});

test('la retención se explica en el desglose', () => {
  const calc = calcCommission(
    { commission_type: 'percent', commission_percent: 40 },
    {
      totalCents: 100000,
      serviceCount: 4,
      retencion: { percent: 15, desde: '2026-08-10', baseTotal: 100000, baseAfectada: 100000 },
    }
  );
  const linea = calc.breakdown[calc.breakdown.length - 1];
  assert.equal(linea.concept, '− Retención 15% (servicios desde el 10/08/2026)');
  assert.equal(linea.amountCents, -6000);
  // Y el desglose cuadra con lo que se paga.
  assert.equal(
    calc.breakdown.reduce((a, b) => a + b.amountCents, 0),
    calc.commissionCents
  );
});

test('un porcentaje de retención de 0 no cambia nada', () => {
  const calc = calcCommission(
    { commission_type: 'percent', commission_percent: 40 },
    {
      totalCents: 100000,
      serviceCount: 4,
      retencion: { percent: 0, desde: '2026-08-10', baseTotal: 100000, baseAfectada: 100000 },
    }
  );
  assert.equal(calc.commissionCents, 40000);
  assert.equal(calc.breakdown.length, 1);
});
