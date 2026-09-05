'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sasmoney-arranque-'));
process.env.DATA_DIR = tmp;

/**
 * Que la aplicación entera se pueda cargar.
 *
 * Parece poca cosa, pero es la prueba que pilla los errores tontos que no ve
 * ninguna otra: una variable declarada dos veces, un require mal escrito, una
 * plantilla sin cerrar. Las demás pruebas cargan módulos sueltos y un fallo así
 * en las rutas no salta hasta que arranca el servidor de verdad.
 */
test('todos los módulos cargan sin romperse', () => {
  const modulos = [
    '../src/util', '../src/db', '../src/assets', '../src/auth', '../src/throttle',
    '../src/commission', '../src/retention', '../src/threshold', '../src/profit',
    '../src/expenses', '../src/investment', '../src/period', '../src/analytics', '../src/repo',
    '../src/views/layout', '../src/views/common', '../src/views/worker', '../src/views/admin',
    '../src/views/caja', '../src/views/calendario', '../src/views/graficas',
    '../src/routes/auth', '../src/routes/worker', '../src/routes/admin',
  ];
  for (const m of modulos) {
    assert.doesNotThrow(() => require(m), `no carga ${m}`);
  }
});
