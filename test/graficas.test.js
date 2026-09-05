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

// Lo que devuelve analytics.porDiaSemana: de lunes a domingo.
const semana = (medias) =>
  medias.map((mediaCents, i) => ({
    dow: [1, 2, 3, 4, 5, 6, 0][i],
    cents: mediaCents * 2,
    count: mediaCents > 0 ? 2 : 0,
    veces: 2,
    mediaCents,
  }));

test('por día de la semana gana el de más media, no el de más suma', () => {
  // Los lunes (dos, a 100 € de media) suman más que el martes, pero el martes
  // es mejor día: 150 € cada vez.
  const html = graficas.porDiaSemana(semana([10000, 15000, 0, 0, 0, 0, 0]));
  assert.match(html, /el <strong>martes<\/strong>/);
  assert.match(html, /150,00 € de media/);
});

test('sin nada facturado no se dibuja la semana', () => {
  assert.equal(graficas.porDiaSemana(semana([0, 0, 0, 0, 0, 0, 0])), '');
});

test('comparando salen dos barras por columna y la leyenda', () => {
  const html = graficas.porDiaSemana(semana([10000, 15000, 0, 0, 0, 0, 0]), {
    cmp: semana([8000, 20000, 0, 0, 0, 0, 0]),
    etiquetaCmp: 'el mes pasado',
  });
  assert.equal((html.match(/relleno cmp/g) || []).length, 7);
  assert.match(html, /el mes pasado/);
  // El cartelito lleva el dato del periodo comparado.
  assert.match(html, /200,00 €/);
});

test('cada barra es un botón con su cartelito', () => {
  const html = graficas.porDia([dia('2026-09-01', 20000, 5000)]);
  assert.match(html, /<button class="col/);
  assert.match(html, /class="tip"/);
  // El cartelito explica el día entero, no sólo lo facturado.
  assert.match(html, /Gastos del día/);
  assert.match(html, /Deja/);
  assert.match(html, /150,00 €/);
});

test('las horas se recortan alrededor de lo que hay', () => {
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, cents: 0, count: 0 }));
  horas[10] = { hora: 10, cents: 20000, count: 2 };
  horas[13] = { hora: 13, cents: 30000, count: 3 };

  const html = graficas.porHora(horas);
  assert.match(html, /las <strong>13:00<\/strong>/);
  // De las 9 a las 14: lo que hay, con una hora de margen a cada lado.
  assert.equal((html.match(/<button class="col/g) || []).length, 6);
});

test('los cartelitos de los extremos se pegan a su lado', () => {
  const dias = Array.from({ length: 10 }, (_, i) => dia(`2026-09-0${i + 1}`.slice(0, 10), 10000));
  const html = graficas.porDia(dias);
  assert.match(html, /col tip-izq/);
  assert.match(html, /col tip-der/);
});
