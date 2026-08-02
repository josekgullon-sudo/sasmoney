'use strict';

const { esc, formatDate, formatDateShort, monthLabel } = require('../util');
const { periodExplained } = require('../period');
const { ruleLabel } = require('../commission');
const { layout } = require('./layout');
const { stats, money, emptyState, periodPicker } = require('./common');

/** 'agosto 2026' → 'Agosto 2026'. Para los títulos. */
function primeraMayuscula(texto) {
  const s = String(texto || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PAYMENT_METHODS = [
  ['efectivo', 'Efectivo'],
  ['bizum', 'Bizum'],
  ['tarjeta', 'Tarjeta'],
  ['transferencia', 'Transferencia'],
  ['paypal', 'PayPal'],
  ['otro', 'Otro'],
];

/** Nombre bonito del método de pago ('bizum' -> 'Bizum'). */
function metodoLegible(valor) {
  const par = PAYMENT_METHODS.find(([v]) => v === valor);
  return par ? par[1] : valor;
}

/**
 * Formulario de alta rápida: sólo el importe es obligatorio.
 * Todo lo demás viene ya rellenado con lo último que usó el trabajador.
 */
function quickForm({ today, ahora, suggestions, action = '/servicios', entry = null }) {
  const isEdit = Boolean(entry);
  const method = isEdit ? entry.payment_method : 'efectivo';

  return `<form method="post" action="${action}" data-once>
  <div class="field">
    <label for="amount">¿Cuánto has cobrado?</label>
    <input id="amount" name="amount" class="amount-input" inputmode="decimal" autocomplete="off"
           placeholder="0,00" value="${isEdit ? esc((entry.amount_cents / 100).toFixed(2).replace('.', ',')) : ''}"
           required data-amount-input ${isEdit ? '' : 'data-autofocus'}>
    ${
      suggestions && suggestions.length
        ? `<div class="chips">${suggestions
            .map((s) => `<button type="button" class="chip" data-amount="${esc(s.value)}">${esc(s.label)}</button>`)
            .join('')}</div>
           <div class="hint">Tus importes más habituales, para no escribir.</div>`
        : ''
    }
  </div>

  <details class="box" ${isEdit ? 'open' : ''}>
    <summary>Más detalles (opcional)</summary>
    <div class="field">
      <label for="client_label">Cliente</label>
      <input id="client_label" name="client_label" autocomplete="off" placeholder="Déjalo vacío si no hace falta"
             value="${isEdit ? esc(entry.client_label) : ''}">
      <div class="hint">Puedes poner el nombre, un mote o nada. Si lo dejas vacío se numera solo.</div>
    </div>
    <div class="row">
      <div class="field">
        <label for="service_date">Fecha</label>
        <input id="service_date" name="service_date" type="date" value="${esc(isEdit ? entry.service_date : today)}" max="${esc(today)}">
      </div>
      <div class="field">
        <label for="service_time">Hora</label>
        <input id="service_time" name="service_time" type="time"
               value="${esc(isEdit ? entry.service_time || ahora : ahora)}">
        <div class="hint">Se pone sola con la hora de ahora.</div>
      </div>
      <div class="field">
        <label for="payment_method">Cómo ha pagado</label>
        <select id="payment_method" name="payment_method">
          ${PAYMENT_METHODS.map(
            ([v, l]) => `<option value="${v}" ${method === v ? 'selected' : ''}>${esc(l)}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="notes">Nota</label>
      <input id="notes" name="notes" autocomplete="off" value="${isEdit ? esc(entry.notes) : ''}" placeholder="Lo que quieras apuntar">
    </div>
  </details>

  <button class="btn block big" type="submit">${isEdit ? 'Guardar cambios' : 'Apuntar cobro'}</button>
</form>`;
}

function workerHome({ user, flash, warning, today, ahora, suggestions, todayEntries, todayCents, monthCents, monthCount, monthCommissionCents, month }) {
  const body = `
${stats([
  { k: 'Hoy', v: money(todayCents), sub: `${todayEntries.length} servicio(s)` },
  { k: monthLabel(month), v: money(monthCents), sub: `${monthCount} servicio(s)` },
  { k: 'Llevas ganado', v: money(monthCommissionCents), sub: ruleLabel(user), accent: true },
])}

<div class="card" style="margin-top:16px">
  <h2>Apuntar un cobro</h2>
  <p class="sub">Con poner el importe ya vale. Lo demás es opcional.</p>
  ${quickForm({ today, ahora, suggestions })}
</div>

<div class="card">
  <h2>Lo de hoy · ${esc(formatDate(today))}</h2>
  ${
    todayEntries.length === 0
      ? emptyState('Todavía no has apuntado nada hoy.')
      : todayEntries.map((e) => entryItem(e)).join('') +
        `<div class="item"><div class="grow title">Total de hoy</div><div class="money">${money(todayCents)}</div></div>`
  }
</div>`;

  return layout({ title: 'Hoy', user, body, active: 'hoy', flash, warning });
}

function entryItem(e, { showWorker = false } = {}) {
  const locked = Boolean(e.settlement_id);
  return `<div class="item">
  <div class="grow">
    <div class="title">${esc(e.display_label)}</div>
    <div class="meta">${showWorker ? `${esc(e.worker_name)} · ` : ''}${esc(formatDateShort(e.service_date))}${
      e.service_time ? ` · ${esc(e.service_time)}` : ''
    } · ${esc(metodoLegible(e.payment_method))}${e.notes ? ` · ${esc(e.notes)}` : ''}</div>
  </div>
  <div class="money">${money(e.amount_cents)}</div>
  ${
    locked
      ? '<span class="pill grey nowrap">Pagado</span>'
      : `<a class="btn ghost small" href="/servicios/${e.id}/editar">Editar</a>`
  }
</div>`;
}

/**
 * Una sola pantalla con todo lo del trabajador en un mes: lo que ha cobrado,
 * lo que va a ganar, cómo sale esa cuenta y qué le han pagado ya.
 * Antes esto estaba partido en dos pantallas que enseñaban casi lo mismo.
 */
function workerAccount({
  user, flash, warning, periodo, entries, totalCents, calc, pendingCents, settlements, historial,
}) {
  const month = periodo.month;
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.service_date)) byDate.set(e.service_date, []);
    byDate.get(e.service_date).push(e);
  }

  const maxHistorial = Math.max(1, ...historial.map((h) => h.commissionCents));

  const body = `
<h1>Mis cuentas · ${esc(primeraMayuscula(periodo.label))}</h1>
<p class="sub">${esc(periodExplained(periodo))}</p>
${periodPicker('/mis-cuentas', periodo)}

${stats([
  { k: 'Facturado', v: money(totalCents), sub: `${entries.length} servicio(s)` },
  { k: 'Has ganado', v: money(calc.commissionCents), sub: ruleLabel(user), accent: true },
  { k: 'Te deben', v: money(pendingCents), sub: 'aún sin liquidar' },
])}

<div class="card" style="margin-top:16px">
  <h2>Cómo sale tu parte</h2>
  <div class="table-wrap">
    <table>
      <tbody>
        ${calc.breakdown
          .map((b) => `<tr><td>${esc(b.concept)}</td><td class="num">${money(b.amountCents)}</td></tr>`)
          .join('')}
        <tr><td><strong>Total de ${esc(periodo.label)}</strong></td>
            <td class="num"><strong>${money(calc.commissionCents)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  ${
    pendingCents !== calc.commissionCents
      ? `<p class="sub" style="margin-top:12px">De ese total, <strong>${money(
          pendingCents
        )}</strong> están pendientes de cobrar; el resto ya te lo han liquidado.</p>`
      : ''
  }
</div>

<div class="card">
  <h2>Tus últimos meses</h2>
  <p class="sub">Lo que has ganado cada mes, para que veas cómo va la cosa.</p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Mes</th><th class="num hide-narrow">Servicios</th><th class="num">Facturado</th><th class="num">Ganado</th><th class="hide-narrow"></th></tr></thead>
      <tbody>
        ${historial
          .map(
            (h) => `<tr${h.month === month ? ' style="background:var(--brand-soft)"' : ''}>
          <td class="nowrap"><a href="/mis-cuentas?month=${h.month}">${esc(monthLabel(h.month))}</a></td>
          <td class="num hide-narrow">${h.count}</td>
          <td class="num">${money(h.totalCents)}</td>
          <td class="num"><strong>${money(h.commissionCents)}</strong></td>
          <td class="hide-narrow" style="width:34%">
            <div style="background:var(--brand);height:9px;border-radius:5px;width:${Math.round(
              (h.commissionCents / maxHistorial) * 100
            )}%;min-width:2px"></div>
          </td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>
</div>

<div class="card">
  <h2>Lo que has apuntado en ${esc(periodo.label)}</h2>
  ${
    entries.length === 0
      ? emptyState('No hay servicios en este periodo.')
      : [...byDate.entries()]
          .map(
            ([date, list]) => `<details class="box" ${date === entries[0].service_date ? 'open' : ''}>
    <summary>${esc(formatDateShort(date))} · ${list.length} servicio(s) · ${money(
      list.reduce((a, e) => a + e.amount_cents, 0)
    )}</summary>
    ${list.map((e) => entryItem(e)).join('')}
  </details>`
          )
          .join('')
  }
</div>

<div class="card">
  <h2>Lo que ya te han pagado</h2>
  ${
    settlements.length === 0
      ? emptyState('Todavía no te han cerrado ninguna liquidación.')
      : `<div class="table-wrap"><table>
    <thead><tr><th>Periodo</th><th class="num">Servicios</th><th class="num">Facturado</th><th class="num">Cobrado</th></tr></thead>
    <tbody>
      ${settlements
        .map(
          (s) => `<tr>
        <td>${esc(formatDate(s.period_from))} – ${esc(formatDate(s.period_to))}</td>
        <td class="num">${s.entry_count}</td>
        <td class="num">${money(s.total_cents)}</td>
        <td class="num"><strong>${money(s.commission_cents)}</strong></td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table></div>`
  }
</div>`;

  return layout({ title: 'Mis cuentas', user, body, active: 'cuentas', flash, warning });
}

function workerEditEntry({ user, flash, warning, entry, today, ahora }) {
  const body = `
<h1>Editar servicio</h1>
<div class="card">
  ${quickForm({ today, ahora, suggestions: [], action: `/servicios/${entry.id}`, entry })}
</div>
<div class="card">
  <h2>Borrar</h2>
  <p class="sub">Si lo apuntaste por error, puedes borrarlo mientras no esté liquidado.</p>
  <form method="post" action="/servicios/${entry.id}/borrar">
    <button class="btn danger" type="submit" data-confirm="¿Seguro que quieres borrar este servicio?">Borrar servicio</button>
  </form>
</div>
<p><a href="/mis-cuentas">← Volver</a></p>`;

  return layout({ title: 'Editar servicio', user, body, active: 'servicios', flash, warning });
}

module.exports = {
  PAYMENT_METHODS,
  metodoLegible,
  workerHome,
  workerAccount,
  workerEditEntry,
  entryItem,
  quickForm,
};
