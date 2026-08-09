'use strict';

const { esc, BRAND, monthLabel, recentMonths } = require('../util');
const { ATAJO_LABELS, ATAJOS_RAPIDOS, atajoActivo } = require('../period');
const { asset } = require('../assets');
const { formatEuro } = require('../commission');
const { layout } = require('./layout');

function loginPage({ error = '', next = '', hint = '' }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f766e">
<title>Entrar · ${esc(BRAND)}</title>
<link rel="stylesheet" href="${asset('styles.css')}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💶</text></svg>">
</head>
<body>
<div class="login-wrap">
  <div class="login-logo">💶</div>
  <h1 class="login-title">${esc(BRAND)}</h1>
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
<script src="${asset('app.js')}" defer></script>
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
  <h2>El chin-chin de la caja</h2>
  <p class="sub">Al apuntar un cobro suena una caja registradora y caen billetes por la pantalla.
     Si estás en un sitio en el que no pega, quítale el sonido: los billetes se quedan.</p>
  <label style="display:flex;align-items:center;gap:9px;font-weight:500;color:var(--ink)">
    <input type="checkbox" data-sonido style="width:auto" checked>
    Que suene al apuntar un cobro
  </label>
  <p class="hint">Esto se guarda en este móvil o en este ordenador, no en tu cuenta:
     cada uno lo pone como quiera.</p>
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

/**
 * Elegir qué trozo de tiempo se mira: un atajo, un mes entero o dos fechas.
 *
 * Son tres formularios sueltos a propósito. Si fueran uno solo, al elegir un mes
 * viajarían también las fechas de abajo y no se sabría cuál manda; así cada
 * manera de pedir el periodo va por su lado y siempre gana la que has tocado.
 *
 * @param {string} action  A dónde se envía ('/admin', '/admin/servicios'…).
 * @param {object} periodo Lo que devuelve resolvePeriod().
 * @param {object} extra   Otros filtros que hay que conservar (trabajador…).
 * @param {string} vista   'completo' | 'hastahoy' en las pantallas de dinero;
 *                         null en las que no manejan gastos.
 */
function periodPicker(action, periodo, extra = {}, vista = null) {
  // Todo lo que no es el periodo viaja igual en los enlaces y en los
  // formularios, para no perder el trabajador elegido ni la vista al filtrar.
  const filtros = limpio({ ...extra, ...(vista ? { vista } : {}) });

  const ocultos = Object.entries(filtros)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');

  const enlace = (params) => `${action}?${new URLSearchParams({ ...filtros, ...params })}`;

  // Si lo que se está viendo no es ninguno de los atajos, el cajón de fechas se
  // abre solo: es la única forma de ver cuál es el periodo elegido.
  const activo = atajoActivo(periodo);

  // Mirar el periodo entero o sólo lo corrido sólo tiene sentido mientras le
  // queden días por delante; si ya acabó, las dos cosas son lo mismo.
  const conVista = vista && periodo.enCurso && periodo.corte;
  const todoEl = periodo.month ? 'Todo el mes' : 'Todo el periodo';

  return `<div class="card period" style="padding:12px 14px">
  <div class="chips" style="margin-top:0">
    ${ATAJOS_RAPIDOS.map(
      (a) =>
        `<a class="chip ${activo === a ? 'is-on' : ''}" href="${esc(enlace({ p: a }))}">${esc(
          ATAJO_LABELS[a]
        )}</a>`
    ).join('')}
  </div>
  ${
    conVista
      ? `<div class="chips">
      <a class="chip ${vista === 'completo' ? 'is-on' : ''}" href="${esc(
          enlace({ ...periodoParams(periodo), vista: 'completo' })
        )}">${esc(todoEl)}</a>
      <a class="chip ${vista === 'hastahoy' ? 'is-on' : ''}" href="${esc(
          enlace({ ...periodoParams(periodo), vista: 'hastahoy' })
        )}">Sólo hasta hoy</a>
    </div>`
      : ''
  }
  <details class="box" style="margin-top:12px" ${activo ? '' : 'open'}>
    <summary>Otro mes, un día suelto o entre dos fechas</summary>
    <div class="row">
      <form method="get" action="${esc(action)}" style="flex:1 1 190px">
        ${ocultos}
        <label for="pp_month">Un mes entero</label>
        <select id="pp_month" name="month" onchange="this.form.submit()">
          ${recentMonths()
            .map(
              (m) =>
                `<option value="${m}" ${m === periodo.month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`
            )
            .join('')}
        </select>
      </form>
      <form method="get" action="${esc(action)}" class="row" style="flex:2 1 330px;gap:10px">
        ${ocultos}
        <div style="flex:1 1 130px">
          <label for="pp_from">Desde el día</label>
          <input id="pp_from" name="from" type="date" value="${esc(periodo.from)}">
        </div>
        <div style="flex:1 1 130px">
          <label for="pp_to">Hasta el día</label>
          <input id="pp_to" name="to" type="date" value="${esc(periodo.to)}">
        </div>
        <div style="flex:0 0 auto;align-self:end;margin-bottom:14px">
          <button class="btn" type="submit">Ver</button>
        </div>
      </form>
    </div>
    <div class="hint">Para ver <strong>un solo día</strong>, pon esa fecha en "Desde" y deja "Hasta" vacío.</div>
  </details>
</div>`;
}

/** El periodo como parámetros sueltos, para componer una dirección. */
function periodoParams(periodo) {
  return periodo.month ? { month: periodo.month } : { from: periodo.from, to: periodo.to };
}

/** Quita del objeto lo que no tiene valor, para no ensuciar las direcciones. */
function limpio(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '')
  );
}

function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

module.exports = { loginPage, accountPage, stats, money, emptyState, periodPicker };
