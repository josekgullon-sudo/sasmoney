'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const COOKIE_NAME = 'sm_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function checkPassword(plain, hash) {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expires
  );
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function userFromToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
    )
    .get(token, new Date().toISOString());
  return row || null;
}

/** Borra sesiones caducadas; se llama al arrancar. */
function pruneSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

/** Middleware: deja el usuario en req.user si hay sesión válida. */
function attachUser(req, res, next) {
  req.user = userFromToken(req.cookies[COOKIE_NAME]);
  res.locals.user = req.user;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    const next_ = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${next_}`);
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.status(403).send('Solo el administrador puede entrar aquí.');
  next();
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  checkPassword,
  createSession,
  destroySession,
  destroyUserSessions,
  userFromToken,
  pruneSessions,
  attachUser,
  requireLogin,
  requireAdmin,
  setSessionCookie,
};
