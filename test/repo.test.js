'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Base de datos de usar y tirar para no tocar la de verdad.
const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-repo-'));
process.env.DATA_DIR = tmp;

const { db } = require('../src/db');
const repo = require('../src/repo');
const retention = require('../src/retention');
const expenses = require('../src/expenses');

// Sin retención, para que los números de estas pruebas sean los de la comisión.
retention.setRetention({ percent: 0, desde: '2026-08-10' });

const DIA = '2026-08-12';

/** Un trabajador al 50 % con cinco servicios de 100 € a horas distintas. */
function montaEscenario() {
  db.exec('DELETE FROM entries; DELETE FROM settlements; DELETE FROM users');
  db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role, commission_type, commission_percent)
     VALUES (1, 'anita', 'Anita', 'x', 'worker', 'percent', 50)`
  ).run();

  const alta = db.prepare(
    `INSERT INTO entries (user_id, service_date, service_time, amount_cents) VALUES (1, ?, ?, 10000)`
  );
  for (const hora of ['09:00', '11:00', '13:00', '16:00', '19:00']) alta.run(DIA, hora);
  return repo.getUser(1);
}

const soloDelDia = (extra) => repo.settlementRows({ from: DIA, to: DIA, userId: 1, ...extra });

test('sin recortes se liquida el día entero', () => {
  montaEscenario();
  const [fila] = soloDelDia();
  assert.equal(fila.count, 5);
  assert.equal(fila.calc.commissionCents, 25000);
  assert.equal(fila.fueraCount, 0);
});

test('la hora de corte deja fuera lo de después', () => {
  montaEscenario();
  const [fila] = soloDelDia({ corte: { fecha: DIA, hora: '13:00' } });
  // Las 13:00 entran: es "hasta las 13:00", no "antes de".
  assert.equal(fila.count, 3);
  assert.equal(fila.calc.commissionCents, 15000);
  assert.equal(fila.fueraCount, 2);

  assert.equal(soloDelDia({ corte: { fecha: DIA, hora: '08:59' } }).length, 0);
  assert.equal(soloDelDia({ corte: { fecha: DIA, hora: '23:59' } })[0].count, 5);
});

test('la hora de corte sólo recorta el último día, no los anteriores', () => {
  const worker = montaEscenario();
  db.prepare(
    `INSERT INTO entries (user_id, service_date, service_time, amount_cents)
     VALUES (1, '2026-08-11', '20:00', 10000)`
  ).run();

  // El servicio de las 20:00 del día 11 entra, aunque el corte del 12 sea a las 13:00.
  const [fila] = repo.settlementRows({ from: '2026-08-11', to: DIA, userId: worker.id, corte: { fecha: DIA, hora: '13:00' } });
  assert.equal(fila.count, 4);
});

test('el tope coge los servicios más antiguos que quepan', () => {
  montaEscenario();

  // Cada servicio son 50 € de comisión: con 120 € caben dos.
  const [dos] = soloDelDia({ maxCents: 12000 });
  assert.equal(dos.count, 2);
  assert.equal(dos.calc.commissionCents, 10000);
  assert.equal(dos.fueraCount, 3);
  // Y son los primeros del día, no unos cualesquiera.
  assert.deepEqual(dos.entries.map((e) => e.service_time).sort(), ['09:00', '11:00']);

  // Justo lo que cuesta uno entra entero.
  assert.equal(soloDelDia({ maxCents: 5000 })[0].count, 1);
  // Y por debajo no cabe ninguno.
  assert.equal(soloDelDia({ maxCents: 4999 }).length, 0);
});

test('los dos recortes se pueden usar a la vez', () => {
  montaEscenario();
  const [fila] = soloDelDia({ corte: { fecha: DIA, hora: '13:00' }, maxCents: 6000 });
  assert.equal(fila.count, 1);
  assert.equal(fila.calc.commissionCents, 5000);
  // Se avisa de los cuatro que quedan, no sólo de los que quitó el tope.
  assert.equal(fila.fueraCount, 4);
});

test('liquidar a trozos deja el resto pendiente y acaba cuadrando', () => {
  const worker = montaEscenario();

  const primera = repo.closeSettlement({ worker, from: DIA, to: DIA, corte: { fecha: DIA, hora: '13:00' } });
  assert.equal(primera.entryCount, 3);
  assert.equal(primera.commissionCents, 15000);
  assert.equal(primera.fueraCount, 2);

  const segunda = repo.closeSettlement({ worker, from: DIA, to: DIA, maxCents: 6000 });
  assert.equal(segunda.entryCount, 1);
  assert.equal(segunda.commissionCents, 5000);
  assert.equal(segunda.fueraCount, 1);

  const tercera = repo.closeSettlement({ worker, from: DIA, to: DIA });
  assert.equal(tercera.entryCount, 1);

  // Los tres trozos suman lo mismo que habría salido de una vez.
  assert.equal(primera.commissionCents + segunda.commissionCents + tercera.commissionCents, 25000);
  // Y ya no queda nada pendiente.
  assert.equal(soloDelDia().length, 0);
});

test('con un tope que no llega para nada no se cierra nada', () => {
  const worker = montaEscenario();
  assert.equal(repo.closeSettlement({ worker, from: DIA, to: DIA, maxCents: 100 }), null);
  // Y no se ha tocado ningún servicio.
  assert.equal(soloDelDia()[0].count, 5);
});

test('el corte manda sobre el periodo: mirando el mes, se liquida hasta ese día', () => {
  const worker = montaEscenario();
  // Un servicio suelto del día siguiente, que no debería entrar.
  db.prepare(
    `INSERT INTO entries (user_id, service_date, service_time, amount_cents)
     VALUES (1, '2026-08-13', '10:00', 10000)`
  ).run();

  const mes = { from: '2026-08-01', to: '2026-08-31', userId: 1 };

  // Sin corte, el mes entero: los seis servicios.
  assert.equal(repo.settlementRows(mes)[0].count, 6);

  // "Hasta el 12 a las 16:00" son los cuatro primeros del día 12; ni el de las
  // 19:00 ni el del día 13. Antes esto no recortaba nada, porque la hora se
  // aplicaba al 31 de agosto en lugar de al día pedido.
  const [conCorte] = repo.settlementRows({ ...mes, corte: { fecha: '2026-08-12', hora: '16:00' } });
  assert.equal(conCorte.count, 4);
  assert.equal(conCorte.calc.commissionCents, 20000);
  assert.equal(conCorte.fueraCount, 2);

  // Un corte sin hora se lleva el día entero.
  assert.equal(repo.settlementRows({ ...mes, corte: { fecha: '2026-08-12' } })[0].count, 5);
  // Y un corte posterior al periodo no recorta nada.
  assert.equal(repo.settlementRows({ ...mes, corte: { fecha: '2026-09-30', hora: '01:00' } })[0].count, 6);
});

test('al cerrar con corte se guarda hasta dónde se liquidó de verdad', () => {
  const worker = montaEscenario();
  const hecho = repo.closeSettlement({
    worker,
    from: '2026-08-01',
    to: '2026-08-31',
    corte: { fecha: DIA, hora: '13:00' },
  });
  assert.equal(hecho.entryCount, 3);

  const [guardada] = repo.listSettlements({ userId: 1 });
  assert.equal(guardada.period_from, '2026-08-01');
  // No pone el 31 de agosto: pone el día en el que se cortó.
  assert.equal(guardada.period_to, DIA);
});

test('el trabajador que reparte ganancias cobra sobre lo que queda tras gastos', () => {
  db.exec('DELETE FROM entries; DELETE FROM settlements; DELETE FROM users; DELETE FROM expenses');

  // Anita, al 50 % de lo que factura; Bea, que reparte ganancias con la empresa
  // (40 % para la empresa, 60 % para ella).
  db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role, commission_type, commission_percent)
     VALUES (1, 'anita', 'Anita', 'x', 'worker', 'percent', 50)`
  ).run();
  db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role, commission_type, profit_company_percent)
     VALUES (2, 'bea', 'Bea', 'x', 'worker', 'profit', 40)`
  ).run();

  // El día cuesta 150 €.
  expenses.createExpense({
    name: 'Publicidad',
    amount_cents: 15000,
    kind: 'daily',
    anchor_date: DIA,
    notes: '',
    is_investment: 1,
  });

  // Ese día el equipo factura 250 €: 150 € Anita y 100 € Bea.
  const alta = db.prepare(
    `INSERT INTO entries (user_id, service_date, service_time, amount_cents) VALUES (?, ?, '10:00', ?)`
  );
  alta.run(1, DIA, 15000);
  alta.run(2, DIA, 10000);

  const bea = repo.getUser(2);
  const [fila] = repo.settlementRows({ from: DIA, to: DIA, userId: 2 });

  // De los 100 € que trajo, le tocan 60 € de los gastos del día (100/250 de 150 €)
  // y le quedan 40 € de ganancia: se lleva el 60 %, o sea 24 €.
  assert.equal(fila.calc.umbral.facturadoCents, 10000);
  assert.equal(fila.calc.umbral.gastosCents, 6000);
  assert.equal(fila.calc.umbral.excesoCents, 4000);
  assert.equal(fila.calc.commissionCents, 2400);
  assert.equal(fila.calc.companyCents, 7600);
  assert.match(fila.calc.label, /ganancias/);

  // Y no es el 60 % de lo facturado, que serían 60 €.
  assert.notEqual(fila.calc.commissionCents, 6000);

  // Al cerrarla se paga eso mismo y sus servicios quedan liquidados.
  const hecho = repo.closeSettlement({ worker: bea, from: DIA, to: DIA });
  assert.equal(hecho.commissionCents, 2400);
  assert.equal(repo.settlementRows({ from: DIA, to: DIA, userId: 2 }).length, 0);

  db.exec('DELETE FROM expenses');
});
