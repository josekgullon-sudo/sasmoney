'use strict';

const { esc, BRAND } = require('../util');

/**
 * Envoltorio HTML común a todas las páginas.
 *
 * @param {object} opts
 * @param {string} opts.title    Título de la pestaña / cabecera.
 * @param {object} opts.user     Usuario con sesión iniciada (o null).
 * @param {string} opts.body     HTML del contenido.
 * @param {string} [opts.active] Pestaña activa de la navegación.
 * @param {Array}  [opts.flash]  Mensajes [{type, text}].
 * @param {string} [opts.warning] Aviso fijo (por ejemplo, contraseña por defecto).
 */
function layout({ title, user, body, active = '', flash = [], warning = '' }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f766e">
<title>${esc(title)} · ${esc(BRAND)}</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💶</text></svg>">
</head>
<body>
${user ? nav(user, active) : ''}
<main class="wrap">
  ${warning ? `<div class="banner warn">${warning}</div>` : ''}
  ${flash.map((f) => `<div class="banner ${esc(f.type)}">${esc(f.text)}</div>`).join('')}
  ${body}
</main>
<script src="/app.js" defer></script>
</body>
</html>`;
}

function nav(user, active) {
  const links =
    user.role === 'admin'
      ? [
          ['/admin', 'Resumen', 'resumen'],
          ['/admin/liquidacion', 'Liquidar', 'liquidacion'],
          ['/admin/caja', 'Caja', 'caja'],
          ['/admin/servicios', 'Servicios', 'servicios'],
          ['/admin/trabajadores', 'Trabajadores', 'trabajadores'],
        ]
      : [
          ['/', 'Hoy', 'hoy'],
          ['/mis-cuentas', 'Mis cuentas', 'cuentas'],
        ];

  return `<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="${user.role === 'admin' ? '/admin' : '/'}">💶 ${esc(BRAND)}</a>
    <div class="topbar-right">
      <span class="who">${esc(user.name)}${
        user.role === 'admin' && user.name.trim().toLowerCase() !== 'jefe' ? ' · jefe' : ''
      }</span>
      <a class="btn-link" href="/cuenta">Mi cuenta</a>
      <form method="post" action="/logout" class="inline"><button class="btn-link" type="submit">Salir</button></form>
    </div>
  </div>
  <nav class="tabs">
    ${links
      .map(
        ([href, label, key]) =>
          `<a href="${href}" class="tab ${active === key ? 'is-active' : ''}">${esc(label)}</a>`
      )
      .join('')}
  </nav>
</header>`;
}

module.exports = { layout };
