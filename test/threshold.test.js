'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-umbral-'));
process.env.DATA_DIR = tmp;

const {
  calcConUmbral,
  normalizaTramos,
  puntosDe,
  tramosDe,
  tieneTramosPropios,
} = require('../src/threshold');

const DIA = '2026-09-03';
const anita = { commission_type: 'percent', commission_percent: 40 };
const milu = { commission_type: 'percent', commission_percent: 35 };

/** Un día con lo que facturó el equipo y lo que costó. */
const dia = (equipo, coste) => ({
  equipoPorDia: new Map([[DIA, equipo]]),
  costePorDia: new Map([[DIA, coste]]),
});

const servicio = (cents, fecha = DIA) => ({ service_date: fecha, amount_cents: cents });

const sinTramos = [{ min_cents: 0, puntos: 0 }];

test('hasta cubrir los gastos del día no se comisiona', () => {
  // El equipo factura 120 € y el día costó 150 €: nadie llega.
  const calc = calcConUmbral(anita, [servicio(12000)], {
    tramos: sinTramos,
    ...dia(12000, 15000),
  });
  assert.equal(calc.commissionCents, 0);
  assert.equal(calc.umbral.excesoCents, 0);
  assert.equal(calc.umbral.diasSinCubrir, 1);
});

test('a partir de los gastos se comisiona sólo sobre lo que pasa de ahí', () => {
  // Equipo 250 €, gastos 150 €: sobran 100 €. Anita lo facturó todo → 40 % de 100 €.
  const calc = calcConUmbral(anita, [servicio(25000)], {
    tramos: sinTramos,
    ...dia(25000, 15000),
  });
  assert.equal(calc.umbral.excesoCents, 10000);
  assert.equal(calc.commissionCents, 4000);
  // Y no el 40 % de los 250 € facturados, que serían 100 €.
  assert.notEqual(calc.commissionCents, 10000);
});

test('el exceso se reparte entre los que han facturado ese día', () => {
  // Equipo 250 € (Anita 150, Milu 100), gastos 150 €: sobran 100 €.
  const contexto = { tramos: sinTramos, ...dia(25000, 15000) };

  const deAnita = calcConUmbral(anita, [servicio(15000)], contexto);
  const deMilu = calcConUmbral(milu, [servicio(10000)], contexto);

  // A Anita le tocan 60 € del exceso (150/250) y a Milu 40 €.
  assert.equal(deAnita.umbral.excesoCents, 6000);
  assert.equal(deMilu.umbral.excesoCents, 4000);
  // Cada uno con su porcentaje de siempre.
  assert.equal(deAnita.commissionCents, 2400); // 40 % de 60 €
  assert.equal(deMilu.commissionCents, 1400); // 35 % de 40 €
  // Lo repartido no se pasa del exceso del equipo.
  assert.equal(deAnita.umbral.excesoCents + deMilu.umbral.excesoCents, 10000);
});

test('los tramos suman puntos al porcentaje de cada uno', () => {
  const tramos = normalizaTramos([
    { min_cents: 0, puntos: 0 },
    { min_cents: 20000, puntos: 5 },
    { min_cents: 50000, puntos: 10 },
  ]);
  // Equipo = Anita sola. Gastos 150 €.
  const conExceso = (facturado) =>
    calcConUmbral(anita, [servicio(facturado)], { tramos, ...dia(facturado, 15000) });

  // 250 € facturados → 100 € de exceso → primer tramo, su 40 % de siempre.
  assert.equal(conExceso(25000).commissionCents, 4000);
  // 400 € → 250 € de exceso → +5 puntos → 45 %.
  assert.equal(conExceso(40000).commissionCents, Math.round(25000 * 0.45));
  // 800 € → 650 € de exceso → +10 puntos → 50 %.
  assert.equal(conExceso(80000).commissionCents, Math.round(65000 * 0.5));

  // Y a Milu, con la misma escalera, le suben desde su 35 %.
  const deMilu = calcConUmbral(milu, [servicio(40000)], { tramos, ...dia(40000, 15000) });
  assert.equal(deMilu.commissionCents, Math.round(25000 * 0.4)); // 35 + 5
});

test('el tramo alcanzado se aplica a todo el exceso del día, no sólo a la punta', () => {
  const tramos = normalizaTramos([{ min_cents: 0, puntos: 0 }, { min_cents: 20000, puntos: 5 }]);
  // 350 € facturados, 150 € de gastos → 200 € de exceso, justo el tramo.
  const calc = calcConUmbral(anita, [servicio(35000)], { tramos, ...dia(35000, 15000) });
  // 45 % de los 200 €, no 40 % de 200 € + 5 % de 0.
  assert.equal(calc.commissionCents, 9000);
});

test('cada día va por su cuenta: uno malo no arrastra al bueno', () => {
  const AYER = '2026-09-02';
  const contexto = {
    tramos: sinTramos,
    equipoPorDia: new Map([[AYER, 10000], [DIA, 25000]]),
    costePorDia: new Map([[AYER, 15000], [DIA, 15000]]),
  };
  const calc = calcConUmbral(anita, [servicio(10000, AYER), servicio(25000, DIA)], contexto);

  // Ayer se facturó 100 € con 150 € de gastos: ese día no comisiona.
  // Hoy sobran 100 €: 40 € de comisión. En total, 40 €.
  assert.equal(calc.commissionCents, 4000);
  assert.equal(calc.umbral.diasSinCubrir, 1);
  // Y el mal día no resta de lo del bueno.
  assert.equal(calc.umbral.excesoCents, 10000);
});

test('la retención se aplica después, sobre lo que ya sale del umbral', () => {
  const calc = calcConUmbral(anita, [servicio(25000)], {
    tramos: sinTramos,
    ...dia(25000, 15000),
    retencion: { percent: 15, desde: '2026-08-10', baseTotal: 25000, baseAfectada: 25000 },
  });
  assert.equal(calc.grossCommissionCents, 4000);
  assert.equal(calc.retentionCents, 600);
  assert.equal(calc.commissionCents, 3400);
  // El desglose cuadra con lo que se paga.
  assert.equal(calc.breakdown.reduce((a, b) => a + b.amountCents, 0), 3400);
});

test('la escalera se ordena sola y siempre arranca en 0', () => {
  const t = normalizaTramos([{ min_cents: 50000, puntos: 10 }, { min_cents: 20000, puntos: 5 }]);
  assert.deepEqual(t[0], { min_cents: 0, puntos: 0 });
  assert.deepEqual(t.map((x) => x.min_cents), [0, 20000, 50000]);

  assert.equal(puntosDe(t, 0), 0);
  assert.equal(puntosDe(t, 19999), 0);
  assert.equal(puntosDe(t, 20000), 5);
  assert.equal(puntosDe(t, 999999), 10);
});

test('cada trabajador puede tener su propia escalera', () => {
  const general = normalizaTramos([{ min_cents: 0, puntos: 0 }, { min_cents: 20000, puntos: 5 }]);

  // Sin nada suyo, la general.
  assert.deepEqual(tramosDe({ commission_percent: 40 }, general), general);
  assert.equal(tieneTramosPropios({}), false);

  // Con la suya puesta, manda la suya (y se ordena y se completa igual).
  const suya = { umbral_tramos_json: JSON.stringify([{ min_cents: 10000, puntos: 12 }]) };
  assert.equal(tieneTramosPropios(suya), true);
  assert.deepEqual(tramosDe(suya, general), [
    { min_cents: 0, puntos: 0 },
    { min_cents: 10000, puntos: 12 },
  ]);

  // Un json roto o vacío no rompe nada: se sigue la general.
  assert.deepEqual(tramosDe({ umbral_tramos_json: 'esto no es json' }, general), general);
  assert.deepEqual(tramosDe({ umbral_tramos_json: '[]' }, general), general);
});

test('con escalera propia comisiona distinto que sus compañeras', () => {
  // Equipo 500 €, gastos 100 €: sobran 400 €. Cada una facturó la mitad, así
  // que a cada una le tocan 200 € de exceso.
  const contexto = {
    equipoPorDia: new Map([[DIA, 50000]]),
    costePorDia: new Map([[DIA, 10000]]),
  };
  const general = normalizaTramos([{ min_cents: 0, puntos: 0 }]);
  const conPremio = { ...anita, umbral_tramos_json: JSON.stringify([{ min_cents: 15000, puntos: 10 }]) };

  const normal = calcConUmbral(anita, [servicio(25000)], {
    tramos: tramosDe(anita, general),
    ...contexto,
  });
  const premiada = calcConUmbral(conPremio, [servicio(25000)], {
    tramos: tramosDe(conPremio, general),
    ...contexto,
  });

  assert.equal(normal.commissionCents, 8000); // 40 % de 200 €
  assert.equal(premiada.commissionCents, 10000); // 50 % de 200 €: su tramo propio
});
