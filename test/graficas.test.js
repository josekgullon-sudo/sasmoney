'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-graficas-'));
process.env.DATA_DIR = tmp;

const graficas = require('../src/views/graficas');

const dia = (fecha, facturadoCents, costeCents = 0) => ({ fecha, facturadoCents, costeCents });

test('sin días no se dibuja nada', () => {
  assert.equal(graficas.porDia([]), '');
  assert.equal(graficas.porDiaSemana([]), '');
  assert.equal(graficas.porHora([]), '');
});

test('el mejor día sale nombrado y marcado', () => {
  const html = graficas.porDia([
    dia('2026-09-01', 20000),
    dia('2026-09-02', 55000),
    dia('2026-09-03', 30000),
  ]);
  assert.match(html, /mié, 2 sept/);
  assert.match(html, /550,00 €/);
  // Sólo una barra lleva la marca del mejor.
  assert.equal((html.match(/relleno top/g) || []).length, 1);
});

test('el día que no cubre gastos se pinta distinto', () => {
  const html = graficas.porDia([dia('2026-09-01', 10000, 15000), dia('2026-09-02', 40000, 15000)]);
  assert.equal((html.match(/relleno flojo/g) || []).length, 1);
});

test('las barras se miden con el más alto, rayita del coste incluida', () => {
  // Con un coste más alto que todo lo facturado, la rayita marca el 100 % y la
  // barra queda por debajo: si la escala fuera sólo de las barras, se saldría.
  const html = graficas.porDia([dia('2026-09-01', 10000, 20000)]);
  assert.match(html, /height:50\.0%/);
  assert.match(html, /bottom:100\.0%/);
});

test('por día de la semana se usa la media, no la suma', () => {
  // Dos lunes flojos (100 € cada uno) y un martes de 150 €: gana el martes,
  // aunque entre los dos lunes sumen más.
  const html = graficas.porDiaSemana([
    dia('2026-09-07', 10000), // lunes
    dia('2026-09-08', 15000), // martes
    dia('2026-09-09', 0),
    dia('2026-09-10', 0),
    dia('2026-09-11', 0),
    dia('2026-09-12', 0),
    dia('2026-09-13', 0),
    dia('2026-09-14', 10000), // otro lunes
  ]);
  assert.match(html, /el <strong>martes<\/strong>/);
  assert.match(html, /150,00 € de media/);
});

test('con menos de una semana no se enseña el día de la semana', () => {
  assert.equal(graficas.porDiaSemana([dia('2026-09-07', 10000), dia('2026-09-08', 15000)]), '');
});

test('las horas se recortan alrededor de lo que hay', () => {
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, cents: 0, count: 0 }));
  horas[10] = { hora: 10, cents: 20000, count: 2 };
  horas[13] = { hora: 13, cents: 30000, count: 3 };

  const html = graficas.porHora(horas);
  assert.match(html, /las <strong>13:00<\/strong>/);
  // De las 9 a las 14: lo que hay, con una hora de margen a cada lado.
  assert.equal((html.match(/class="col"/g) || []).length, 6);
});
