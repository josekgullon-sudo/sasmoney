'use strict';

const { esc, formatDate, formatDateShort, monthLabel, recentMonths } = require('../util');
const { ruleLabel } = require('../commission');
const { layout } = require('./layout');
const { stats, money, emptyState } = require('./common');

const PAYMENT_METHODS = [
  ['efectivo', 'Efectivo'],
  ['bizum', 'Bizum'],
  ['tarjeta', 'Tarjeta'],
  ['transferencia', 'Transferencia'],
  ['otro', 'Otro'],
];

/**
 * Formulario de alta rápida: sólo el importe es obligatorio.
 * Todo lo demás viene ya rellenado con lo último que usó el trabajador.
 */
function quickForm({ towns, lastTownId, today, suggestions, action = '/servicios', entry = null }) {
  const isEdit = Boolean(entry);
  const selectedTown = isEdit ? entry.town_id : lastTownId;
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

  <div class="field">
    <label for="town_id">Pueblo</label>
    <select id="town_id" name="town_id">
      <option value="">— Sin pueblo —</option>
      ${towns
        .map(
          (t) =>
            `<option value="${t.id}" ${String(selectedTown) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`
        )
        .join('')}
    </select>
    <div class="hint">Se queda marcado el último que usaste.</div>
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

function workerHome({ user, flash, warning, towns, lastTownId, today, suggestions, todayEntries, todayCents, monthCents, monthCount, monthCommissionCents, month }) {
  const body = `
${stats([
  { k: 'Hoy', v: money(todayCents), sub: `${todayEntries.length} servicio(s)` },
  { k: monthLabel(month), v: money(monthCents), sub: `${monthCount} servicio(s)` },
  { k: 'Llevas ganado', v: money(monthCommissionCents), sub: ruleLabel(user), accent: true },
])}

<div class="card" style="margin-top:16px">
  <h2>Apuntar un cobro</h2>
  <p class="sub">Con poner el importe ya vale. Lo demás es opcional.</p>
  ${quickForm({ towns, lastTownId, today, suggestions })}
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
      e.town_name ? ` · ${esc(e.town_name)}` : ''
    } · ${esc(e.payment_method)}${e.notes ? ` · ${esc(e.notes)}` : ''}</div>
  </div>
  <div class="money">${money(e.amount_cents)}</div>
  ${
    locked
      ? '<span class="pill grey nowrap">Pagado</span>'
      : `<a class="btn ghost small" href="/servicios/${e.id}/editar">Editar</a>`
  }
</div>`;
}

function workerEntries({ user, flash, warning, month, entries, totalCents, commissionCents }) {
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.service_date)) byDate.set(e.service_date, []);
    byDate.get(e.service_date).push(e);
  }

  const body = `
<h1>Mis servicios</h1>
${monthPicker('/mis-servicios', month)}

${stats([
  { k: 'Facturado', v: money(totalCents), sub: `${entries.length} servicio(s)` },
  { k: 'Tu parte', v: money(commissionCents), sub: ruleLabel(user), accent: true },
])}

${
  entries.length === 0
    ? `<div class="card">${emptyState('No hay servicios en este mes.')}</div>`
    : [...byDate.entries()]
        .map(
          ([date, list]) => `<div class="card">
  <h2>${esc(formatDateShort(date))}</h2>
  <p class="sub">${list.length} servicio(s) · ${money(list.reduce((a, e) => a + e.amount_cents, 0))}</p>
  ${list.map((e) => entryItem(e)).join('')}
</div>`
        )
        .join('')
}`;

  return layout({ title: 'Mis servicios', user, body, active: 'servicios', flash, warning });
}

function workerEarnings({ user, flash, warning, month, totalCents, count, calc, pendingCents, settlements }) {
  const body = `
<h1>Mis ganancias</h1>
${monthPicker('/mis-ganancias', month)}

${stats([
  { k: 'Facturado', v: money(totalCents), sub: `${count} servicio(s)` },
  { k: 'Tu comisión', v: money(calc.commissionCents), sub: calc.label, accent: true },
])}

<div class="card" style="margin-top:16px">
  <h2>Cómo sale tu comisión</h2>
  <p class="sub">Regla que te ha puesto el jefe: <strong>${esc(ruleLabel(user))}</strong></p>
  <div class="table-wrap">
    <table>
      <tbody>
        ${calc.breakdown
          .map((b) => `<tr><td>${esc(b.concept)}</td><td class="num">${money(b.amountCents)}</td></tr>`)
          .join('')}
        <tr><td><strong>Total ${esc(monthLabel(month))}</strong></td><td class="num"><strong>${money(
          calc.commissionCents
        )}</strong></td></tr>
      </tbody>
    </table>
  </div>
  ${
    pendingCents !== calc.commissionCents
      ? `<p class="sub" style="margin-top:12px">Pendiente de cobrar de este mes: <strong>${money(pendingCents)}</strong> (el resto ya te lo han liquidado).</p>`
      : ''
  }
</div>

<div class="card">
  <h2>Liquidaciones que ya te han pagado</h2>
  ${
    settlements.length === 0
      ? emptyState('Todavía no hay liquidaciones cerradas.')
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

  return layout({ title: 'Mis ganancias', user, body, active: 'ganancias', flash, warning });
}

function workerEditEntry({ user, flash, warning, entry, towns, today }) {
  const body = `
<h1>Editar servicio</h1>
<div class="card">
  ${quickForm({ towns, lastTownId: entry.town_id, today, suggestions: [], action: `/servicios/${entry.id}`, entry })}
</div>
<div class="card">
  <h2>Borrar</h2>
  <p class="sub">Si lo apuntaste por error, puedes borrarlo mientras no esté liquidado.</p>
  <form method="post" action="/servicios/${entry.id}/borrar">
    <button class="btn danger" type="submit" data-confirm="¿Seguro que quieres borrar este servicio?">Borrar servicio</button>
  </form>
</div>
<p><a href="/mis-servicios">← Volver</a></p>`;

  return layout({ title: 'Editar servicio', user, body, active: 'servicios', flash, warning });
}

/** Selector de mes reutilizable. */
function monthPicker(action, month, extra = '') {
  return `<form method="get" action="${action}" class="card" style="padding:12px 14px">
  <div class="row">
    <div style="flex:1 1 200px">
      <label for="month">Mes</label>
      <select id="month" name="month" onchange="this.form.submit()">
        ${recentMonths()
          .map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`)
          .join('')}
      </select>
    </div>
    ${extra}
    <div style="flex:0 0 auto"><button class="btn ghost" type="submit">Ver</button></div>
  </div>
</form>`;
}

module.exports = {
  PAYMENT_METHODS,
  workerHome,
  workerEntries,
  workerEarnings,
  workerEditEntry,
  entryItem,
  monthPicker,
  quickForm,
};
