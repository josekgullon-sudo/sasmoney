'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-ganancias-'));
process.env.DATA_DIR = tmp;

const { calcReparto } = require('../src/profit');
const { ruleLabel, profitShares } = require('../src/commission');

// El trato: la empresa se queda el 60 % del beneficio y él el 40 %.
const socio = { commission_type: 'profit', profit_company_percent: 60 };

const dias = (n) => Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);

test('el reparto se lee en las dos direcciones', () => {
  assert.deepEqual(profitShares(socio), { empresa: 60, trabajador: 40 });
  assert.match(ruleLabel(socio), /40% del beneficio/);
  assert.match(ruleLabel(socio), /empresa se queda 60%/);
});

test('cobra sobre lo que queda limpio, no sobre lo facturado', () => {
  // El equipo factura 1.000 €, hay 300 € de gastos y las trabajadoras cobran
  // 400 €: quedan 300 € de beneficio, y él se lleva el 40 % → 120 €.
  const calc = calcReparto(socio, {
    facturadoCents: 100000,
    gastosCents: 30000,
    pagadoCents: 40000,
    dias: dias(3),
  });

  assert.equal(calc.beneficio.gananciaCents, 30000);
  assert.equal(calc.commissionCents, 12000);
  // Y no el 40 % de lo facturado, que serían 400 €.
  assert.notEqual(calc.commissionCents, 40000);
  // A la empresa le quedan los otros 180 € del beneficio.
  assert.equal(calc.companyCents, 18000);
});

test('los otros ingresos de la caja también son beneficio', () => {
  const calc = calcReparto(socio, {
    facturadoCents: 100000,
    ingresosCents: 10000,
    gastosCents: 30000,
    pagadoCents: 40000,
    dias: dias(3),
  });
  assert.equal(calc.beneficio.gananciaCents, 40000);
  assert.equal(calc.commissionCents, 16000);
});

test('si el periodo entero pierde dinero no cobra, pero tampoco paga', () => {
  const calc = calcReparto(socio, {
    facturadoCents: 20000,
    gastosCents: 50000,
    pagadoCents: 8000,
    dias: dias(2),
  });
  assert.equal(calc.beneficio.gananciaCents, -38000);
  assert.equal(calc.commissionCents, 0);
  assert.equal(calc.grossCommissionCents, 0);
});

test('los días malos restan de los buenos: manda el total del periodo', () => {
  // Un día que deja 500 € y otro que pierde 200 €: el beneficio son 300 €.
  const calc = calcReparto(socio, {
    facturadoCents: 80000,
    gastosCents: 30000,
    pagadoCents: 20000,
    dias: dias(2),
  });
  assert.equal(calc.beneficio.gananciaCents, 30000);
  assert.equal(calc.commissionCents, 12000);
});

test('el desglose cuadra con lo que se paga, también con retención', () => {
  const datos = {
    facturadoCents: 100000,
    gastosCents: 30000,
    pagadoCents: 40000,
    dias: dias(3),
  };

  const sin = calcReparto(socio, datos);
  assert.equal(sin.breakdown.reduce((a, b) => a + b.amountCents, 0), sin.commissionCents);

  const con = calcReparto(socio, {
    ...datos,
    retencion: { percent: 15, desde: '2026-08-10', baseTotal: 3, baseAfectada: 3 },
  });
  assert.equal(con.grossCommissionCents, 12000);
  assert.equal(con.retentionCents, 1800);
  assert.equal(con.commissionCents, 10200);
  assert.equal(con.breakdown.reduce((a, b) => a + b.amountCents, 0), 10200);
});

test('la retención va por días: sólo la parte posterior a su fecha', () => {
  // De cuatro días, dos son anteriores a la fecha de arranque.
  const calc = calcReparto(socio, {
    facturadoCents: 100000,
    gastosCents: 30000,
    pagadoCents: 40000,
    dias: dias(4),
    retencion: { percent: 15, desde: '2026-09-03', baseTotal: 4, baseAfectada: 2 },
  });
  // El 15 % de la mitad de los 120 €.
  assert.equal(calc.retentionCents, 900);
  assert.equal(calc.commissionCents, 11100);
});

test('cambiar el reparto cambia lo que se lleva', () => {
  const datos = { facturadoCents: 100000, gastosCents: 30000, pagadoCents: 40000, dias: dias(1) };

  assert.equal(
    calcReparto({ commission_type: 'profit', profit_company_percent: 50 }, datos).commissionCents,
    15000
  );
  assert.equal(
    calcReparto({ commission_type: 'profit', profit_company_percent: 100 }, datos).commissionCents,
    0
  );
});

test('sin días que contar no hay nada que pagar', () => {
  const calc = calcReparto(socio, { dias: [] });
  assert.equal(calc.commissionCents, 0);
  assert.equal(calc.beneficio.diasCount, 0);
});
