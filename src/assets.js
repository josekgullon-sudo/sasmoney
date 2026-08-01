'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Marca de versión para los ficheros de estilos y de JavaScript.
 *
 * Sin esto, al cambiar el diseño los navegadores siguen usando el CSS que ya
 * tenían guardado y la página se ve rota: el HTML nuevo con los estilos viejos.
 * Añadiendo un trozo del hash a la dirección (`/styles.css?v=a1b2c3d4`), cuando
 * el fichero cambia la dirección cambia con él y el navegador se lo baja otra
 * vez. Si no cambia, se sigue aprovechando la copia guardada.
 */

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function hashOf(fichero) {
  try {
    const contenido = fs.readFileSync(path.join(PUBLIC_DIR, fichero));
    return crypto.createHash('md5').update(contenido).digest('hex').slice(0, 8);
  } catch {
    // Si no se puede leer, se usa la hora de arranque: peor que el hash, pero
    // al menos cambia en cada despliegue.
    return String(Date.now()).slice(-8);
  }
}

const VERSIONS = {
  'styles.css': hashOf('styles.css'),
  'app.js': hashOf('app.js'),
};

/** Dirección del fichero con su marca de versión. */
function asset(fichero) {
  return `/${fichero}?v=${VERSIONS[fichero] || '1'}`;
}

module.exports = { asset };
