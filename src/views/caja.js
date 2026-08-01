'use strict';

const { esc, formatDate, formatDateShort, monthLabel, recentMonths } = require('../util');
const { KINDS, KIND_LABELS } = require('../expenses');
const { layout } = require('./layout');
const { stats, money, emptyState } = require('./common');

/**
 * Una sola pantalla para todo el dinero que no viene de los servicios:
 * lo que sale (gastos), lo que entra por otro lado (ingresos) y cómo se
 * reparte la inversión entre las trabajadoras.
 */
function adminCaja({
  user, flash, warning, month, hoy,
  gastos, ingresos, totales,
  editando, diasAjustados,
  workers, reparto,
}) {
  const e = editando;
  const esIngreso = e ? e.direction === 'in' : false;

  const body = `
<h1>Caja de ${esc(monthLabel(month))}</h1>
<p class="sub">El dinero que entra y sale por fuera de los servicios.</p>
${monthPickerCaja(month)}

${stats([
  { k: 'Entra', v: money(totales.entraCents), sub: 'servicios + otros ingresos' },
  { k: 'Sale', v: money(totales.gastosCents), sub: `${gastos.delMes.length} gasto(s)` },
  { k: 'De eso, inversión', v: money(totales.inversionCents), sub: 'publicidad y similares' },
  { k: 'Queda', v: money(totales.quedaCents), sub: 'para la empresa', accent: true },
])}

${e ? formularioEdicion(e, esIngreso, diasAjustados, month, hoy) : ''}

<div class="card" style="margin-top:16px">
  <h2>Gastos</h2>
  <p class="sub">Lo que paga la empresa. Los que se repiten se calculan solos.</p>
  ${e ? '' : formularioAlta('out', hoy)}
  ${listaMovimientos(gastos.todos, 'out')}
</div>

<div class="card">
  <h2>Otros ingresos</h2>
  <p class="sub">Dinero que llega por otro lado: una venta, una subvención, un alquiler…</p>
  ${e ? '' : formularioAlta('in', hoy)}
  ${listaMovimientos(ingresos.todos, 'in')}
</div>

${tarjetaReparto(workers, totales.inversionCents, reparto, month)}

<div class="card">
  <h2>Lo que viene</h2>
  <p class="sub">Próximos pagos y cobros de los tres meses que vienen.</p>
  ${
    gastos.proximos.length + ingresos.proximos.length === 0
      ? emptyState('No hay nada a la vista.')
      : `<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Importe</th></tr></thead>
    <tbody>
      ${[
        ...gastos.proximos.map((g) => ({ ...g, signo: '−' })),
        ...ingresos.proximos.map((g) => ({ ...g, signo: '+' })),
      ]
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map(
          (g) => `<tr>
        <td class="nowrap">${esc(formatDateShort(g.fecha))}${
            g.fecha === hoy ? ' <span class="pill warn">hoy</span>' : ''
          }</td>
        <td>${esc(g.name)}${g.is_investment ? ' <span class="pill">Inversión</span>' : ''}
            <div class="small muted">${esc(KIND_LABELS[g.kind])}</div></td>
        <td class="num">${g.signo}${money(g.amount_cents)}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table></div>`
  }
</div>`;

  return layout({ title: 'Caja', user, body, active: 'caja', flash, warning });
}

/** Formulario corto para añadir, escondido hasta que se necesita. */
function formularioAlta(direction, hoy) {
  const esIngreso = direction === 'in';
  return `<details class="box" style="margin-bottom:14px">
  <summary>+ Añadir ${esIngreso ? 'un ingreso' : 'un gasto'}</summary>
  <form method="post" action="/admin/caja">
    <input type="hidden" name="direction" value="${direction}">
    <div class="row">
      <div class="field" style="flex:2 1 220px">
        <label for="n_${direction}">Concepto</label>
        <input id="n_${direction}" name="name" required
               placeholder="${esIngreso ? 'Venta, subvención, alquiler…' : 'Publicidad, alquiler, gasolina…'}">
      </div>
      <div class="field">
        <label for="a_${direction}">Importe</label>
        <input id="a_${direction}" name="amount" inputmode="decimal" required placeholder="0,00">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="k_${direction}">¿Cada cuánto?</label>
        <select id="k_${direction}" name="kind">
          ${KINDS.map(
            (k) => `<option value="${k}" ${k === 'monthly' ? 'selected' : ''}>${esc(KIND_LABELS[k])}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label for="d_${direction}">Fecha (o la del primero)</label>
        <input id="d_${direction}" name="anchor_date" type="date" required value="${esc(hoy)}">
      </div>
    </div>
    ${
      esIngreso
        ? ''
        : `<div class="field">
      <label style="display:flex;align-items:center;gap:9px;font-weight:500;color:var(--ink)">
        <input type="checkbox" name="is_investment" value="1" style="width:auto">
        Es inversión (publicidad y similares)
      </label>
    </div>`
    }
    <button class="btn" type="submit">Añadir</button>
  </form>
</details>`;
}

/** Formulario grande, sólo cuando se está editando algo. */
function formularioEdicion(e, esIngreso, diasAjustados, month, hoy) {
  return `<div class="card" style="margin-top:16px;border-color:var(--brand)">
  <h2>Editar ${esIngreso ? 'ingreso' : 'gasto'}: ${esc(e.name)}</h2>
  <form method="post" action="/admin/caja/${e.id}">
    <div class="row">
      <div class="field" style="flex:2 1 220px">
        <label for="e_name">Concepto</label>
        <input id="e_name" name="name" required value="${esc(e.name)}">
      </div>
      <div class="field">
        <label for="e_amount">Importe${e.kind === 'daily' ? ' de cada día' : ''}</label>
        <input id="e_amount" name="amount" inputmode="decimal" required
               value="${esc((e.amount_cents / 100).toFixed(2).replace('.', ','))}">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="e_kind">¿Cada cuánto?</label>
        <select id="e_kind" name="kind">
          ${KINDS.map(
            (k) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${esc(KIND_LABELS[k])}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label for="e_date">Fecha (o la del primero)</label>
        <input id="e_date" name="anchor_date" type="date" required value="${esc(e.anchor_date)}">
      </div>
    </div>
    <div class="field">
      <label for="e_notes">Nota</label>
      <input id="e_notes" name="notes" value="${esc(e.notes)}" placeholder="Opcional">
    </div>
    ${
      esIngreso
        ? ''
        : `<div class="field">
      <label style="display:flex;align-items:center;gap:9px;font-weight:500;color:var(--ink)">
        <input type="checkbox" name="is_investment" value="1" ${e.is_investment ? 'checked' : ''} style="width:auto">
        Es inversión (publicidad y similares)
      </label>
    </div>`
    }
    <div class="field">
      <label style="display:flex;align-items:center;gap:9px;font-weight:500;color:var(--ink)">
        <input type="checkbox" name="active" value="1" ${e.active ? 'checked' : ''} style="width:auto">
        Sigue vigente
      </label>
      <div class="hint">Desmárcalo para dejar de contarlo sin borrarlo.</div>
    </div>
    <div class="actions">
      <button class="btn" type="submit">Guardar cambios</button>
      <a class="btn ghost" href="/admin/caja?month=${esc(month)}">Cancelar</a>
    </div>
  </form>

  ${
    e.kind === 'daily'
      ? `<hr class="divider">
  <h2>Importe de un día suelto</h2>
  <p class="sub">Unos días se invierte más y otros menos. Aquí cambias sólo ese día,
     sin tocar los demás.</p>
  <form method="post" action="/admin/caja/${e.id}/dia">
    <input type="hidden" name="month" value="${esc(month)}">
    <div class="row">
      <div class="field">
        <label for="dia">Día</label>
        <input id="dia" name="day" type="date" required value="${esc(hoy)}">
      </div>
      <div class="field">
        <label for="dia_importe">Ese día se gastó</label>
        <input id="dia_importe" name="amount" inputmode="decimal" required placeholder="0,00">
      </div>
      <div style="flex:0 0 auto;margin-bottom:14px"><button class="btn" type="submit">Ajustar</button></div>
    </div>
  </form>
  ${
    diasAjustados.length === 0
      ? `<p class="sub">Todos los días de ${esc(monthLabel(month))} van a ${money(e.amount_cents)}.</p>`
      : `<div class="table-wrap"><table>
      <thead><tr><th>Día</th><th class="num">Importe</th><th></th></tr></thead>
      <tbody>
        ${diasAjustados
          .map(
            (d) => `<tr>
          <td>${esc(formatDate(d.day))}</td>
          <td class="num">${money(d.amount_cents)}</td>
          <td class="right">
            <form method="post" action="/admin/caja/${e.id}/dia" class="inline">
              <input type="hidden" name="month" value="${esc(month)}">
              <input type="hidden" name="day" value="${esc(d.day)}">
              <input type="hidden" name="quitar" value="1">
              <button class="btn ghost small" type="submit">Volver al normal</button>
            </form>
          </td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table></div>`
  }`
      : ''
  }
</div>`;
}

function listaMovimientos(filas, direction) {
  if (filas.length === 0) {
    return emptyState(direction === 'in' ? 'Todavía no hay ingresos.' : 'Todavía no hay gastos.');
  }
  return `<div class="table-wrap"><table>
  <thead><tr>
    <th>Concepto</th><th class="hide-narrow">¿Cada cuánto?</th>
    <th class="num">Importe</th><th class="num">Este mes</th><th></th>
  </tr></thead>
  <tbody>
    ${filas
      .map(
        (g) => `<tr>
      <td>${esc(g.name)}
          ${g.active ? '' : '<span class="pill grey">En pausa</span>'}
          ${g.is_investment ? '<span class="pill">Inversión</span>' : ''}
          ${g.notes ? `<div class="small muted">${esc(g.notes)}</div>` : ''}</td>
      <td class="small muted hide-narrow">${esc(KIND_LABELS[g.kind])}</td>
      <td class="num">${money(g.amount_cents)}${g.kind === 'daily' ? '<div class="small muted">al día</div>' : ''}</td>
      <td class="num">${
        g.esteMes
          ? `<strong>${money(g.esteMes.total_cents)}</strong>${
              g.esteMes.veces > 1
                ? `<div class="small muted">${g.esteMes.veces} días${
                    g.esteMes.ajustados ? `, ${g.esteMes.ajustados} ajustado(s)` : ''
                  }</div>`
                : ''
            }`
          : '<span class="muted">—</span>'
      }</td>
      <td class="right nowrap">
        <a class="btn ghost small" href="/admin/caja?editar=${g.id}">Editar</a>
        <form method="post" action="/admin/caja/${g.id}/borrar" class="inline">
          <button class="btn ghost small" type="submit"
                  data-confirm="¿Borrar &quot;${esc(g.name)}&quot;? También se borran sus ajustes por día.">Borrar</button>
        </form>
      </td>
    </tr>`
      )
      .join('')}
  </tbody>
</table></div>`;
}

/** Quién carga con qué parte de la publicidad. Los porcentajes los pone el jefe. */
function tarjetaReparto(workers, inversionCents, reparto, month) {
  const suma = reparto.sumaPercent;
  const fmt = (n) => String(Number(n) % 1 === 0 ? n : n.toFixed(1)).replace('.', ',');

  return `<div class="card">
  <h2>Reparto de la inversión</h2>
  <p class="sub">Le dices a cada uno qué porcentaje de la publicidad carga. Ese porcentaje se
     mantiene mes tras mes hasta que lo cambies, y es lo que decide su rentabilidad.</p>

  ${
    workers.length === 0
      ? emptyState('Da de alta trabajadores para poder repartir.')
      : `<form method="post" action="/admin/caja/reparto">
    <input type="hidden" name="month" value="${esc(month)}">
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Trabajador</th>
        <th class="num" style="width:130px">Su porcentaje</th>
        <th class="num hide-narrow">Le toca este mes</th>
      </tr></thead>
      <tbody>
        ${reparto.rows
          .map(
            (r) => `<tr>
          <td>${esc(r.user.name)}</td>
          <td class="num">
            <input type="hidden" name="worker_id" value="${r.user.id}">
            <input name="share" inputmode="decimal" style="text-align:right"
                   value="${esc(fmt(r.sharePercent))}" aria-label="Porcentaje de ${esc(r.user.name)}">
          </td>
          <td class="num hide-narrow">${money(r.inversionCents)}</td>
        </tr>`
          )
          .join('')}
        ${
          reparto.sinAsignarCents > 0
            ? `<tr>
          <td class="muted">Sin asignar <span class="small">(lo paga la empresa)</span></td>
          <td class="num muted">${esc(fmt(Math.max(0, 100 - suma)))} %</td>
          <td class="num hide-narrow muted">${money(reparto.sinAsignarCents)}</td>
        </tr>`
            : ''
        }
      </tbody>
      <tfoot><tr>
        <td>Suma</td>
        <td class="num">${esc(fmt(suma))} %</td>
        <td class="num hide-narrow">${money(inversionCents)}</td>
      </tr></tfoot>
    </table></div>

    ${
      suma > 100.05
        ? `<div class="banner error" style="margin-top:12px">Los porcentajes suman ${esc(
            fmt(suma)
          )} %, más de 100. Se aplica lo que has puesto, así que estarías repartiendo más
            publicidad de la que hay. Repásalo.</div>`
        : ''
    }
    ${
      suma < 99.95
        ? `<p class="sub" style="margin-top:12px">Suman ${esc(
            fmt(suma)
          )} %: el ${esc(fmt(Math.max(0, 100 - suma)))} % restante (${money(
            reparto.sinAsignarCents
          )}) no carga sobre nadie y se queda como gasto de la empresa. Si quieres que se lo
          repartan entre todos, que sumen 100.</p>`
        : ''
    }

    <div class="actions" style="margin-top:12px">
      <button class="btn" type="submit">Guardar los porcentajes</button>
      <button class="btn ghost" type="submit" name="segun_facturacion" value="1"
              data-confirm="Se van a sustituir los porcentajes por los que salen de lo facturado este mes. ¿Sigo?">
        Calcular según lo facturado
      </button>
    </div>
    <p class="hint">El segundo botón sólo rellena los huecos con lo que ha facturado cada uno
       este mes, por si quieres partir de ahí. Luego los cambias a mano.</p>
  </form>`
  }
</div>`;
}

function monthPickerCaja(month) {
  return `<form method="get" action="/admin/caja" class="card" style="padding:12px 14px">
  <div class="row">
    <div style="flex:1 1 220px">
      <label for="month">Mes</label>
      <select id="month" name="month" onchange="this.form.submit()">
        ${recentMonths()
          .map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`)
          .join('')}
      </select>
    </div>
    <div style="flex:0 0 auto"><button class="btn ghost" type="submit">Ver</button></div>
  </div>
</form>`;
}

module.exports = { adminCaja };
