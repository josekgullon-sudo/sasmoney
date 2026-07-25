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

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.active || !checkPassword(password, user.password_hash)) {
    return res.status(401).send(
      loginPage({ error: 'Usuario o contraseña incorrectos.', next })
    );
  }

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
