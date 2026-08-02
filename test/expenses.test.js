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

test('un gasto diario cae todos los días del mes', () => {
  const { monthOccurrences } = require('../src/expenses');
  const pub = gasto('daily', '2026-07-01');
  assert.equal(monthOccurrences(pub, '2026-07').length, 31);
  assert.equal(monthOccurrences(pub, '2026-07')[0].fecha, '2026-07-01');
  assert.equal(monthOccurrences(pub, '2026-06').length, 0); // aún no había empezado
  assert.equal(monthOccurrences(pub, '2026-09').length, 30);
  assert.equal(monthOccurrences(gasto('daily', '2026-02-01'), '2026-02').length, 28);
  assert.equal(monthOccurrences(gasto('daily', '2028-02-01'), '2028-02').length, 29);
});

test('un gasto diario que empieza a mitad de mes sólo cuenta desde ese día', () => {
  const { monthOccurrences } = require('../src/expenses');
  const fechas = monthOccurrences(gasto('daily', '2026-07-20'), '2026-07');
  assert.equal(fechas.length, 12); // del 20 al 31
  assert.equal(fechas[0].fecha, '2026-07-20');
  assert.equal(fechas[fechas.length - 1].fecha, '2026-07-31');
});

test('el próximo pago de un gasto diario es hoy mismo', () => {
  assert.equal(nextDate(gasto('daily', '2026-01-01'), '2026-07-28'), '2026-07-28');
  assert.equal(nextDate(gasto('daily', '2026-09-01'), '2026-07-28'), '2026-09-01');
});

test('el mes se resume separando lo gastado de lo que aún queda por caer', () => {
  const { createExpense, monthSummary } = require('../src/expenses');
  const { todayISO, currentMonth, monthRange } = require('../src/util');

  const mes = currentMonth();
  const { from, to } = monthRange(mes);
  const hoy = todayISO();
  const dia = Number(hoy.slice(8, 10));
  const dias = Number(to.slice(8, 10));

  // 20 €/día de publicidad desde el día 1, y un alquiler suelto ya pagado el día 1.
  createExpense({ name: 'Publicidad', amount_cents: 2000, kind: 'daily', anchor_date: from, notes: '', is_investment: 1 });
  createExpense({ name: 'Alquiler', amount_cents: 50000, kind: 'once', anchor_date: from, notes: '', is_investment: 0 });

  const r = monthSummary(mes, 'out');

  // La publicidad cuenta sólo los días transcurridos, no el mes entero.
  assert.equal(r.inversion.hastaHoyCents, 2000 * dia);
  assert.equal(r.inversion.totalCents, 2000 * dias);
  assert.equal(r.otros.hastaHoyCents, 50000);
  assert.equal(r.otros.totalCents, 50000);

  assert.equal(r.hastaHoyCents, 2000 * dia + 50000);
  assert.equal(r.totalCents, 2000 * dias + 50000);
  assert.equal(r.hastaHoyCents + r.pendienteCents, r.totalCents);
});

test('un gasto que se repite cae varias veces si el periodo abarca varios meses', () => {
  const { rangeOccurrences } = require('../src/expenses');
  const alquiler = { ...gasto('monthly', '2026-01-05'), amount_cents: 50000 };

  // Tres meses, tres recibos.
  const tres = rangeOccurrences(alquiler, '2026-03-01', '2026-05-31');
  assert.deepEqual(tres.map((d) => d.fecha), ['2026-03-05', '2026-04-05', '2026-05-05']);

  // Un trozo de mes que no llega al día 5 no coge ninguno.
  assert.equal(rangeOccurrences(alquiler, '2026-03-06', '2026-04-04').length, 0);

  const trimestral = { ...gasto('quarterly', '2026-01-20'), amount_cents: 10000 };
  assert.deepEqual(rangeOccurrences(trimestral, '2026-01-01', '2026-12-31').map((d) => d.fecha), [
    '2026-01-20',
    '2026-04-20',
    '2026-07-20',
    '2026-10-20',
  ]);
});

test('el gasto diario cuenta los días exactos que pidas, no el mes entero', () => {
  const { rangeOccurrences } = require('../src/expenses');
  const pub = { ...gasto('daily', '2026-08-01'), amount_cents: 2000 };

  assert.equal(rangeOccurrences(pub, '2026-08-02', '2026-08-02').length, 1);
  assert.equal(rangeOccurrences(pub, '2026-08-01', '2026-08-07').length, 7);
  // Un periodo a caballo entre dos meses tampoco se corta por el cambio de mes.
  assert.equal(rangeOccurrences(pub, '2026-08-28', '2026-09-03').length, 7);
  // Antes de empezar no cuenta nada.
  assert.equal(rangeOccurrences(pub, '2026-07-01', '2026-07-31').length, 0);
  // Y un periodo del revés no devuelve nada en lugar de dar vueltas.
  assert.equal(rangeOccurrences(pub, '2026-08-10', '2026-08-01').length, 0);
});

test('el resumen por fechas cuadra con el del mes', () => {
  const { createExpense, monthSummary, rangeSummary } = require('../src/expenses');
  const { currentMonth, monthRange } = require('../src/util');

  const mes = currentMonth();
  const { from, to } = monthRange(mes);
  createExpense({ name: 'Gestoría', amount_cents: 12000, kind: 'monthly', anchor_date: from, notes: '' });

  const porMes = monthSummary(mes, 'out');
  const porFechas = rangeSummary({ from, to, direction: 'out' });
  assert.equal(porFechas.totalCents, porMes.totalCents);
  assert.equal(porFechas.hastaHoyCents, porMes.hastaHoyCents);
});

test('un gasto que se repite se reparte entre los días que cubre', () => {
  const { rangeAccrual } = require('../src/expenses');
  const alquiler = { id: 0, kind: 'monthly', anchor_date: '2026-08-01', amount_cents: 50000 };
  const cents = (f, t) => rangeAccrual(alquiler, f, t).cents;

  // El mes entero suma el recibo completo, ni un céntimo de más ni de menos.
  assert.equal(cents('2026-08-01', '2026-08-31'), 50000);
  // Un día suelto son 500/31, no 0 € (que era lo que salía antes) ni 500 €.
  assert.equal(cents('2026-08-02', '2026-08-02'), Math.round(50000 / 31));
  assert.equal(cents('2026-08-01', '2026-08-15'), Math.round((50000 * 15) / 31));
  // Antes de empezar no cuenta nada.
  assert.equal(cents('2026-07-01', '2026-07-31'), 0);

  // Febrero es más corto, así que el día vale más.
  const feb = { id: 0, kind: 'monthly', anchor_date: '2026-02-01', amount_cents: 50000 };
  assert.equal(rangeAccrual(feb, '2026-02-10', '2026-02-10').cents, Math.round(50000 / 28));
});

test('el trimestral y el anual se reparten por sus días, no por su mes de pago', () => {
  const { rangeAccrual } = require('../src/expenses');
  // Se paga el 20 de enero y cubre hasta el 19 de abril: 90 días.
  const trimestral = { id: 0, kind: 'quarterly', anchor_date: '2026-01-20', amount_cents: 30000 };

  // A agosto le tocan sus 31 días del tramo que empezó el 20 de julio (92 días).
  assert.equal(rangeAccrual(trimestral, '2026-08-01', '2026-08-31').cents, Math.round((30000 * 31) / 92));
  // Y no cero, que es lo que pasaría si sólo contara el mes en que se paga.
  assert.ok(rangeAccrual(trimestral, '2026-08-02', '2026-08-02').cents > 0);

  const anual = { id: 0, kind: 'yearly', anchor_date: '2026-03-10', amount_cents: 36500 };
  assert.ok(rangeAccrual(anual, '2026-09-01', '2026-09-30').cents > 0);
  // Un año entero desde su fecha suma el recibo completo.
  assert.equal(rangeAccrual(anual, '2026-03-10', '2027-03-09').cents, 36500);
});

test('los diarios y los pagos sueltos no se reparten: caen donde caen', () => {
  const { rangeAccrual } = require('../src/expenses');
  const pub = { id: 0, kind: 'daily', anchor_date: '2026-08-01', amount_cents: 2000 };
  assert.equal(rangeAccrual(pub, '2026-08-02', '2026-08-02').cents, 2000);
  assert.equal(rangeAccrual(pub, '2026-08-01', '2026-08-31').cents, 2000 * 31);

  const suelto = { id: 0, kind: 'once', anchor_date: '2026-08-10', amount_cents: 7500 };
  assert.equal(rangeAccrual(suelto, '2026-08-10', '2026-08-10').cents, 7500);
  assert.equal(rangeAccrual(suelto, '2026-08-01', '2026-08-09').cents, 0);
});

test('mirando un solo día siguen apareciendo los gastos que se repiten', () => {
  const { createExpense, rangeExpenses } = require('../src/expenses');
  const { todayISO, currentMonth, monthRange } = require('../src/util');

  const hoy = todayISO();
  const { from } = monthRange(currentMonth());
  createExpense({ name: 'Gestoría mensual', amount_cents: 9300, kind: 'monthly', anchor_date: from, notes: '' });

  const deHoy = rangeExpenses({ from: hoy, to: hoy, direction: 'out' });
  const gestoria = deHoy.find((g) => g.name === 'Gestoría mensual');

  // Antes desaparecía porque ese día no tocaba pagarla.
  assert.ok(gestoria, 'la gestoría tiene que salir aunque hoy no toque pagarla');
  assert.equal(gestoria.prorrateado, true);
  assert.ok(gestoria.total_cents > 0 && gestoria.total_cents < 9300);
});
