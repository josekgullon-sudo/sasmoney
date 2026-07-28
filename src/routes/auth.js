'use strict';

const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const {
  COOKIE_NAME,
  checkPassword,
  hashPassword,
  createSession,
  destroySession,
  setSessionCookie,
  requireLogin,
} = require('../auth');
const { loginPage, accountPage } = require('../views/common');
const throttle = require('../throttle');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/');
  const hint =
    getSetting('admin_password_changed') === '0'
      ? 'Primer arranque: entra con el usuario de administrador y cambia la contraseña.'
      : '';
  res.send(loginPage({ next: String(req.query.next || ''), hint }));
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const next = String(req.body.next || '');

  // Freno contra quien se dedique a probar contraseñas a lo bruto.
  const espera = throttle.comprobar(username, req.ip);
  if (!espera.permitido) {
    return res.status(429).send(
      loginPage({
        error: `Demasiados intentos fallidos. Prueba otra vez dentro de ${espera.minutos} minuto(s).`,
        next,
      })
    );
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.active || !checkPassword(password, user.password_hash)) {
    const r = throttle.fallo(username, req.ip);
    const aviso = r.bloqueado
      ? `Demasiados intentos fallidos. Prueba otra vez dentro de ${r.minutos} minutos.`
      : r.restantes <= 3
        ? `Usuario o contraseña incorrectos. Te quedan ${r.restantes} intento(s).`
        : 'Usuario o contraseña incorrectos.';
    return res.status(401).send(loginPage({ error: aviso, next }));
  }

  throttle.acierto(username, req.ip);
  setSessionCookie(res, createSession(user.id));
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : null;
  res.redirect(safeNext || (user.role === 'admin' ? '/admin' : '/'));
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/login');
});

router.get('/cuenta', requireLogin, (req, res) => {
  res.send(
    accountPage({ user: req.user, flash: res.locals.flash, warning: res.locals.warning })
  );
});

router.post('/cuenta/password', requireLogin, (req, res) => {
  const current = String(req.body.current || '');
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 || '');

  if (!checkPassword(current, req.user.password_hash)) {
    res.flash('error', 'La contraseña actual no es correcta.');
    return res.redirect('/cuenta');
  }
  if (password.length < 6) {
    res.flash('error', 'La contraseña nueva debe tener al menos 6 caracteres.');
    return res.redirect('/cuenta');
  }
  if (password !== password2) {
    res.flash('error', 'Las dos contraseñas nuevas no coinciden.');
    return res.redirect('/cuenta');
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(password),
    req.user.id
  );
  if (req.user.role === 'admin') setSetting('admin_password_changed', '1');

  res.flash('ok', 'Contraseña cambiada.');
  res.redirect('/cuenta');
});

module.exports = router;
