'use strict';

const { db } = require('./db');

/**
 * Freno para los intentos de entrada.
 *
 * Con la aplicación abierta a internet, sin esto cualquiera podría probar
 * contraseñas a miles por minuto hasta acertar. Se cuenta por usuario y por
 * origen: tras varios fallos seguidos, esa combinación queda bloqueada un rato.
 * Los intentos acertados borran la cuenta.
 *
 * Se guarda en la base de datos para que un reinicio no regale intentos nuevos.
 */

const MAX_FALLOS = Number(process.env.LOGIN_MAX_FALLOS || 8);
const VENTANA_MIN = Number(process.env.LOGIN_VENTANA_MIN || 15);
const BLOQUEO_MIN = Number(process.env.LOGIN_BLOQUEO_MIN || 15);

db.exec(`
CREATE TABLE IF NOT EXISTS login_attempts (
  key            TEXT PRIMARY KEY,
  fails          INTEGER NOT NULL DEFAULT 0,
  first_fail_at  TEXT    NOT NULL,
  blocked_until  TEXT
);
`);

function ahora() {
  return new Date();
}

function clave(username, ip) {
  return `${String(username || '').toLowerCase()}|${ip || '?'}`;
}

/**
 * ¿Puede intentar entrar? Devuelve los minutos que faltan si está bloqueado.
 * @returns {{permitido:boolean, minutos:number}}
 */
function comprobar(username, ip) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(clave(username, ip));
  if (!row || !row.blocked_until) return { permitido: true, minutos: 0 };

  const restante = new Date(row.blocked_until).getTime() - ahora().getTime();
  if (restante <= 0) {
    db.prepare('DELETE FROM login_attempts WHERE key = ?').run(clave(username, ip));
    return { permitido: true, minutos: 0 };
  }
  return { permitido: false, minutos: Math.max(1, Math.ceil(restante / 60000)) };
}

/** Apunta un intento fallido y bloquea si se han pasado de la raya. */
function fallo(username, ip) {
  const key = clave(username, ip);
  const ahoraISO = ahora().toISOString();
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);

  // Si el último fallo fue hace mucho, se empieza a contar de cero.
  const dentroDeVentana =
    row && ahora().getTime() - new Date(row.first_fail_at).getTime() < VENTANA_MIN * 60000;

  const fails = dentroDeVentana ? row.fails + 1 : 1;
  const first = dentroDeVentana ? row.first_fail_at : ahoraISO;
  const blocked =
    fails >= MAX_FALLOS ? new Date(ahora().getTime() + BLOQUEO_MIN * 60000).toISOString() : null;

  db.prepare(
    `INSERT INTO login_attempts (key, fails, first_fail_at, blocked_until)
     VALUES (@key, @fails, @first, @blocked)
     ON CONFLICT(key) DO UPDATE SET fails = @fails, first_fail_at = @first, blocked_until = @blocked`
  ).run({ key, fails, first, blocked });

  return {
    bloqueado: Boolean(blocked),
    restantes: Math.max(0, MAX_FALLOS - fails),
    minutos: BLOQUEO_MIN,
  };
}

/** Entrada correcta: se borra el historial de fallos. */
function acierto(username, ip) {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(clave(username, ip));
}

/** Limpieza de registros viejos; se llama al arrancar. */
function limpiar() {
  const limite = new Date(Date.now() - Math.max(VENTANA_MIN, BLOQUEO_MIN) * 60000).toISOString();
  db.prepare(
    'DELETE FROM login_attempts WHERE (blocked_until IS NULL OR blocked_until < ?) AND first_fail_at < ?'
  ).run(new Date().toISOString(), limite);
}

module.exports = { comprobar, fallo, acierto, limpiar, MAX_FALLOS, BLOQUEO_MIN };
