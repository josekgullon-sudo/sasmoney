'use strict';

const path = require('node:path');
const express = require('express');

const { ensureAdmin, getSetting, setSetting } = require('./db');
const { attachUser, pruneSessions } = require('./auth');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

/** Lector de cookies mínimo: evita una dependencia más. */
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) {
        try {
          req.cookies[k] = decodeURIComponent(v);
        } catch {
          req.cookies[k] = v;
        }
      }
    }
  }
  next();
});

/**
 * Los formularios sólo se aceptan si vienen de esta misma aplicación.
 * Junto con la cookie SameSite=Lax, cierra la puerta a envíos desde otras webs.
 */
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  if (!origin) return next(); // Los formularios normales no siempre mandan Origin.
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).send('Origen no válido.');
  }
  if (originHost !== req.get('host')) return res.status(403).send('Origen no válido.');
  next();
});

/** Mensajes de una sola lectura ("Guardado", "Error…"), viajan en una cookie. */
app.use((req, res, next) => {
  res.locals.flash = [];
  const raw = req.cookies.sm_flash;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) res.locals.flash = parsed.slice(0, 5);
    } catch {
      /* cookie corrupta: se ignora */
    }
    res.clearCookie('sm_flash', { path: '/' });
  }
  res.flash = (type, text) => {
    const current = [];
    current.push({ type, text: String(text).slice(0, 300) });
    res.cookie('sm_flash', JSON.stringify(current), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === '1',
      path: '/',
      maxAge: 60 * 1000,
    });
  };
  next();
});

app.use(attachUser);

/** Aviso permanente mientras el jefe siga con la contraseña por defecto. */
app.use((req, res, next) => {
  res.locals.warning = '';
  if (req.user && req.user.role === 'admin' && getSetting('admin_password_changed') !== '1') {
    res.locals.warning =
      'Estás usando la contraseña por defecto. <a href="/cuenta">Cámbiala ahora</a> para que nadie más pueda entrar.';
  }
  next();
});

app.use(require('./routes/auth'));
app.use(require('./routes/worker'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).send('Página no encontrada. <a href="/">Volver al inicio</a>');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).send('Ha ocurrido un error. Vuelve a intentarlo.');
});

const PORT = Number(process.env.PORT || 3000);

if (require.main === module) {
  pruneSessions();
  const seeded = ensureAdmin();
  if (seeded) {
    setSetting('admin_password_changed', process.env.ADMIN_PASSWORD ? '1' : '0');
    console.log('──────────────────────────────────────────────');
    console.log('  Administrador creado');
    console.log(`  Usuario:    ${seeded.username}`);
    console.log(`  Contraseña: ${seeded.password}`);
    if (seeded.generated) console.log('  ¡Cámbiala nada más entrar!');
    console.log('──────────────────────────────────────────────');
  }
  app.listen(PORT, () => console.log(`SasMoney escuchando en http://localhost:${PORT}`));
}

module.exports = app;
