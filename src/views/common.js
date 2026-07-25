'use strict';

const { esc } = require('../util');
const { formatEuro } = require('../commission');
const { layout } = require('./layout');

function loginPage({ error = '', next = '', hint = '' }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f766e">
<title>Entrar · SasMoney</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💶</text></svg>">
</head>
<body>
<div class="login-wrap">
  <div class="login-logo">💶</div>
  <h1 class="login-title">SasMoney</h1>
  ${error ? `<div class="banner error">${esc(error)}</div>` : ''}
  ${hint ? `<div class="banner warn">${hint}</div>` : ''}
  <div class="card">
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${esc(next)}">
      <div class="field">
        <label for="username">Usuario</label>
        <input id="username" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required data-autofocus>
      </div>
      <div class="field">
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn block big" type="submit">Entrar</button>
    </form>
  </div>
  <p class="sub right"><small>Si no puedes entrar, pide al jefe que te dé de alta.</small></p>
</div>
<script src="/app.js" defer></script>
</body>
</html>`;
}

function accountPage({ user, flash, warning }) {
  const body = `
<h1>Mi cuenta</h1>
<div class="card">
  <h2>${esc(user.name)}</h2>
  <p class="sub">Usuario: <strong>${esc(user.username)}</strong> · ${user.role === 'admin' ? 'Administrador (jefe)' : 'Trabajador'}</p>
</div>
<div class="card">
  <h2>Cambiar mi contraseña</h2>
  <p class="sub">Elige una que recuerdes: mínimo 6 caracteres.</p>
  <form method="post" action="/cuenta/password">
    <div class="field">
      <label for="current">Contraseña actual</label>
      <input id="current" name="current" type="password" autocomplete="current-password" required>
    </div>
    <div class="field">
      <label for="pw1">Contraseña nueva</label>
      <input id="pw1" name="password" type="password" autocomplete="new-password" required minlength="6">
    </div>
    <div class="field">
      <label for="pw2">Repite la contraseña nueva</label>
      <input id="pw2" name="password2" type="password" autocomplete="new-password" required minlength="6">
    </div>
    <button class="btn" type="submit">Guardar contraseña</button>
  </form>
</div>`;
  return layout({ title: 'Mi cuenta', user, body, flash, warning });
}

/** Bloque de cifras destacadas. */
function stats(items) {
  return `<div class="stats">${items
    .map(
      (i) =>
        `<div class="stat ${i.accent ? 'accent' : ''}"><div class="k">${esc(i.k)}</div><div class="v">${esc(i.v)}</div>${
          i.sub ? `<div class="small ${i.accent ? '' : 'muted'}">${esc(i.sub)}</div>` : ''
        }</div>`
    )
    .join('')}</div>`;
}

function money(cents) {
  return formatEuro(cents);
}

function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

module.exports = { loginPage, accountPage, stats, money, emptyState };
