'use strict';

const { esc, formatDate, formatDateShort, formatStamp } = require('../util');
const { periodQuery, rangeLabel, periodExplained } = require('../period');
const { ruleLabel, parseTiers } = require('../commission');
const { layout } = require('./layout');
const { stats, money, emptyState, periodPicker } = require('./common');
const { PAYMENT_METHODS, metodoLegible } = require('./worker');

/** 'agosto 2026' → 'Agosto 2026'. Para los títulos. */
function primeraMayuscula(texto) {
  const s = String(texto || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** El periodo escondido dentro de otro formulario, para no perderlo al filtrar. */
function camposPeriodo(periodo) {
  return periodo.month
    ? `<input type="hidden" name="month" value="${esc(periodo.month)}">`
    : `<input type="hidden" name="from" value="${esc(periodo.from)}">
       <input type="hidden" name="to" value="${esc(periodo.to)}">`;
}

function adminHome({
  user, flash, warning, periodo, vista, rows, totals, pendingTotalCents,
  gastos, ingresos, inversion, inversionSinAsignarCents, otrosGastos, trabajadoresActivos,
}) {
  const { corte, enCurso } = periodo;
  const q = periodQuery(periodo, { vista });

  // Las cifras de arriba siguen la vista elegida; el cuadro de abajo enseña
  // siempre las dos, que es donde se ve la diferencia de un vistazo.
  const quedaCents =
    totals.totalCents - totals.commissionCents + ingresos.cents - gastos.cents;
  const quedaHoyCents =
    totals.totalCents - totals.commissionCents + ingresos.hastaHoyCents - gastos.hastaHoyCents;
  const quedaMesCents =
    totals.totalCents - totals.commissionCents + ingresos.totalCents - gastos.totalCents;

  // En el cuadro del periodo manda la vista elegida: su columna va primera y
  // siempre se ve; la otra queda al lado, y en el móvil se esconde.
  const orden = (hoyCents, mesCents) =>
    vista === 'hastahoy' ? [hoyCents, mesCents] : [mesCents, hoyCents];
  // Si al periodo no le quedan días, las dos vistas son la misma: sobra el matiz.
  const cabeceras = enCurso
    ? orden('Lo que llevas', periodo.month ? 'Todo el mes' : 'Todo el periodo')
    : ['Total', ''];

  const pct = (parte, todo) => (todo > 0 ? (parte / todo) * 100 : 0);
  const fmtPct = (n) => `${n.toFixed(1).replace('.', ',')} %`;

  const body = `
<h1>Resumen · ${esc(primeraMayuscula(periodo.label))}</h1>
<p class="sub">${esc(periodExplained(periodo, vista))}</p>
${periodPicker('/admin', periodo, {}, vista)}

${stats([
  { k: 'Entra', v: money(totals.totalCents + ingresos.cents), sub: `${totals.count} servicio(s)` },
  { k: 'Se llevan ellas', v: money(totals.commissionCents), sub: 'comisiones' },
  { k: 'Gastos', v: money(gastos.cents), sub: `${money(inversion.cents)} de marketing` },
  { k: 'Me queda', v: money(quedaCents), sub: 'para la empresa', accent: true },
])}

<div class="card" style="margin-top:16px">
  <h2>Cada trabajador</h2>
  <p class="sub">Lo que factura, lo que se lleva, el marketing que carga y lo que deja
     ${esc(vista === 'hastahoy' ? rangeLabel(periodo.from, corte) : rangeLabel(periodo.from, periodo.to))}.</p>
  ${
    rows.length === 0
      ? emptyState('Nadie ha apuntado nada en este periodo.')
      : `${rows
          .map(
            (r) => `<div class="wcard only-narrow">
      <div class="top">
        <div>
          <div class="name"><a href="/admin/servicios?worker=${r.user.id}&amp;${esc(q)}">${esc(
              r.user.name
            )}</a></div>
          <div class="small muted">${esc(ruleLabel(r.user))}</div>
        </div>
        <div class="money">${money(r.totalCents)}</div>
      </div>
      <div class="lines">
        <div><span class="muted">Se lleva</span><span>${money(r.calc.commissionCents)}</span></div>
        <div><span class="muted">Marketing · <strong>${esc(
          fmtPct(r.sharePercent)
        )}</strong></span><span>${money(r.inversionCents)}</span></div>
        <div><span class="muted">Resto de gastos</span><span>${money(r.gastosGeneralesCents)}</span></div>
        <div class="deja"><span>Deja</span><span style="color:${
          r.beneficioCents < 0 ? 'var(--danger)' : 'inherit'
        }">${money(r.beneficioCents)} · ${esc(fmtPct(pct(r.beneficioCents, r.totalCents)))}</span></div>
      </div>
      <div class="cta">
        <div><span class="muted small">A liquidar</span><br><strong>${money(
          r.pendingCommissionCents
        )}</strong></div>
        ${
          r.pendingCommissionCents > 0
            ? `<a class="btn small" href="/admin/liquidacion?worker=${r.user.id}&amp;${esc(q)}">Liquidar</a>`
            : '<span class="pill ok">Al día</span>'
        }
      </div>
    </div>`
          )
          .join('')}
    <div class="table-wrap wide-only"><table>
    <thead><tr>
      <th>Trabajador</th>
      <th class="num">Factura</th>
      <th class="num hide-narrow">Se lleva</th>
      <th class="num">Marketing</th>
      <th class="num hide-narrow">Resto de gastos</th>
      <th class="num">Deja</th>
      <th class="num">A liquidar</th>
    </tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td class="nowrap"><a href="/admin/servicios?worker=${r.user.id}&amp;${esc(q)}">${esc(
            r.user.name
          )}</a><div class="small muted hide-narrow">${esc(ruleLabel(r.user))}</div></td>
        <td class="num">${money(r.totalCents)}<div class="small muted">${r.count} serv.</div></td>
        <td class="num hide-narrow">${money(r.calc.commissionCents)}</td>
        <td class="num"><strong>${esc(fmtPct(r.sharePercent))}</strong>
          <div class="small muted">${money(r.inversionCents)}</div></td>
        <td class="num hide-narrow">${money(r.gastosGeneralesCents)}</td>
        <td class="num"><strong style="color:${
          r.beneficioCents < 0 ? 'var(--danger)' : 'inherit'
        }">${money(r.beneficioCents)}</strong>
          <div class="small muted">${esc(fmtPct(pct(r.beneficioCents, r.totalCents)))}</div></td>
        <td class="num nowrap">
          <strong>${money(r.pendingCommissionCents)}</strong>
          <div style="margin-top:5px">${
            r.pendingCommissionCents > 0
              ? `<a class="btn small" href="/admin/liquidacion?worker=${r.user.id}&amp;${esc(q)}">Liquidar</a>`
              : '<span class="pill ok">Al día</span>'
          }</div>
        </td>
      </tr>`
        )
        .join('')}
    </tbody>
    <tfoot><tr>
      <td>Total</td>
      <td class="num">${money(totals.totalCents)}</td>
      <td class="num hide-narrow">${money(totals.commissionCents)}</td>
      <td class="num">${esc(fmtPct(rows.reduce((a, r) => a + r.sharePercent, 0)))}
        <div class="small muted">${money(rows.reduce((a, r) => a + r.inversionCents, 0))}</div></td>
      <td class="num hide-narrow">${money(rows.reduce((a, r) => a + r.gastosGeneralesCents, 0))}</td>
      <td class="num">${money(rows.reduce((a, r) => a + r.beneficioCents, 0))}</td>
      <td class="num">${money(pendingTotalCents)}</td>
    </tr></tfoot>
  </table></div>`
  }
  <details class="box">
    <summary>Qué significa cada columna</summary>
    <p class="small"><strong>Marketing</strong>: el porcentaje de la publicidad que le has asignado
       y, debajo, lo que eso supone en euros. De la publicidad del periodo (${money(
         inversion.totalCents
       )}) van gastados ${money(inversion.hastaHoyCents)}. Los porcentajes se cambian en
       <a href="/admin/caja?${esc(q)}">Caja</a>.${
         inversionSinAsignarCents > 0
           ? ` Quedan ${money(inversionSinAsignarCents)} sin asignar a nadie: los paga la empresa.`
           : ''
       }</p>
    <p class="small"><strong>Resto de gastos</strong>: lo que no es marketing (${money(
      otrosGastos.cents
    )}) dividido <strong>a partes iguales</strong> entre los ${trabajadoresActivos}
       trabajadores en activo, así que si entra alguien nuevo el reparto se ajusta solo.
       Los gastos que se repiten se reparten por días: un alquiler de 500 € al mes son
       16,13 € si miras un solo día.</p>
    <p class="small"><strong>Deja</strong>: lo que factura menos su comisión y menos los gastos que
       carga. Es lo que aporta de verdad a la empresa.</p>
    <p class="small"><strong>A liquidar</strong>: lo que le debes ahora mismo, de lo que aún no le has pagado.</p>
  </details>
</div>

<div class="card">
  <h2>Cómo va ${esc(periodo.label)}</h2>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th></th>
        <th class="num">${esc(cabeceras[0])}</th>
        ${enCurso ? `<th class="num hide-narrow">${esc(cabeceras[1])}</th>` : ''}
      </tr></thead>
      <tbody>
        ${filaMes('Facturado por todos', orden(totals.totalCents, totals.totalCents), enCurso)}
        ${
          ingresos.totalCents > 0
            ? filaMes('+ Otros ingresos', orden(ingresos.hastaHoyCents, ingresos.totalCents), enCurso, '+')
            : ''
        }
        ${filaMes('− Comisiones', orden(totals.commissionCents, totals.commissionCents), enCurso, '−')}
        ${
          inversion.totalCents > 0
            ? filaMes('− Marketing', orden(inversion.hastaHoyCents, inversion.totalCents), enCurso, '−')
            : ''
        }
        ${
          otrosGastos.totalCents > 0
            ? filaMes(
                '− Resto de gastos',
                orden(otrosGastos.hastaHoyCents, otrosGastos.totalCents),
                enCurso,
                '−'
              )
            : ''
        }
        ${(() => {
          const [primero, segundo] = orden(quedaHoyCents, quedaMesCents);
          return `<tr>
          <td><strong>Me queda</strong></td>
          <td class="num"><strong style="color:${
            primero < 0 ? 'var(--danger)' : 'inherit'
          }">${money(primero)}</strong></td>
          ${enCurso ? `<td class="num muted hide-narrow">${money(segundo)}</td>` : ''}
        </tr>`;
        })()}
      </tbody>
    </table>
  </div>
  ${
    enCurso
      ? vista === 'completo'
        ? `<p class="sub" style="margin-top:12px">Estás viendo el periodo entero: de esos gastos,
           <strong>${money(gastos.pendientesCents)}</strong> aún están por caer. De momento llevas
           gastado ${money(gastos.hastaHoyCents)} y te quedarían
           <strong>${money(quedaHoyCents)}</strong>.</p>`
        : `<p class="sub" style="margin-top:12px">Estás viendo sólo lo que ha corrido: quedan por
           caer <strong>${money(gastos.pendientesCents)}</strong> de gastos, así que si no entrara
           nada más el periodo acabaría en <strong>${money(quedaMesCents)}</strong>.</p>`
      : ''
  }
  ${
    gastos.proximo
      ? `<p class="sub">Próximo gasto: <strong>${esc(gastos.proximo.name)}</strong>, ${money(
          gastos.proximo.amount_cents
        )} el ${esc(formatDate(gastos.proximo.fecha))}.</p>`
      : ''
  }
  <div class="actions" style="margin-top:6px">
    <a class="btn" href="/admin/liquidacion?${esc(q)}">Pagar a los trabajadores</a>
    <a class="btn ghost" href="/admin/caja?${esc(q)}">Gastos e ingresos</a>
  </div>
</div>`;

  return layout({ title: 'Resumen', user, body, active: 'resumen', flash, warning });
}

/** Una fila del cuadro del periodo: la cifra que manda y, al lado, la otra. */
function filaMes(concepto, [primero, segundo], enCurso, signo = '') {
  return `<tr>
    <td>${esc(concepto)}</td>
    <td class="num">${signo}${money(primero)}</td>
    ${enCurso ? `<td class="num muted hide-narrow">${signo}${money(segundo)}</td>` : ''}
  </tr>`;
}

function adminSettlement({ user, flash, warning, periodo, from, to, onlyPending, rows, totals, history, workers, workerId }) {
  const elegida = workerId ? workers.find((w) => w.id === workerId) : null;
  const body = `
<h1>Liquidación${elegida ? ` de ${esc(elegida.name)}` : ''}</h1>
<p class="sub">Elige el trabajador y el periodo: te dice exactamente cuánto le tienes que pagar.
   Cuando le pagues, pulsa <strong>Liquidado</strong> y su cuenta vuelve a cero.</p>

${periodPicker('/admin/liquidacion', periodo, {
  worker: workerId || '',
  only_pending: onlyPending ? '1' : '0',
})}

<form method="get" action="/admin/liquidacion" class="card">
  ${camposPeriodo(periodo)}
  <div class="row">
    <div style="flex:1 1 200px">
      <label for="worker">Trabajador</label>
      <select id="worker" name="worker" onchange="this.form.submit()">
        <option value="">Todos</option>
        ${workers
          .map(
            (w) =>
              `<option value="${w.id}" ${String(workerId) === String(w.id) ? 'selected' : ''}>${esc(w.name)}</option>`
          )
          .join('')}
      </select>
    </div>
  </div>
  <div class="field" style="margin-top:10px">
    <input type="hidden" name="only_pending" value="0">
    <label style="display:flex;align-items:center;gap:9px;font-weight:500;color:var(--ink)">
      <input type="checkbox" name="only_pending" value="1" ${onlyPending ? 'checked' : ''} style="width:auto">
      Contar sólo lo que aún no he pagado
    </label>
  </div>
  <button class="btn big block" type="submit">Calcular lo que tengo que pagar</button>
</form>

${stats([
  { k: 'Facturado', v: money(totals.totalCents), sub: `${totals.count} servicio(s)` },
  { k: 'A pagar a los trabajadores', v: money(totals.commissionCents), accent: true },
  { k: 'Queda para la empresa', v: money(totals.companyCents) },
])}

<div class="card" style="margin-top:16px">
  <h2>Del ${esc(formatDate(from))} al ${esc(formatDate(to))}</h2>
  <p class="sub">${onlyPending ? 'Sólo servicios todavía no liquidados.' : 'Todos los servicios del periodo, estén pagados o no.'}</p>
  ${
    rows.length === 0
      ? emptyState('No hay nada que liquidar en este periodo.')
      : rows
          .map((r) =>
            r.count === 0
              ? `<div class="banner ok" style="margin:0 0 12px">
                   <strong>${esc(r.user.name)}</strong>: no queda nada pendiente en este periodo. Está todo liquidado.
                 </div>`
              : settlementCard(r, { from, to, onlyPending })
          )
          .join('')
  }
  <div class="actions no-print" style="margin-top:14px">
    <a class="btn ghost" href="/admin/liquidacion.csv?from=${esc(from)}&to=${esc(to)}&only_pending=${onlyPending ? 1 : 0}${workerId ? `&worker=${workerId}` : ''}">Descargar CSV</a>
    <button class="btn ghost" type="button" onclick="window.print()">Imprimir</button>
  </div>
</div>

<div class="card">
  <h2>Liquidaciones ya cerradas${elegida ? ` de ${esc(elegida.name)}` : ''}</h2>
  ${
    history.length === 0
      ? emptyState('Aún no has cerrado ninguna liquidación.')
      : `<div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Trabajador</th><th>Periodo</th><th class="num">Servicios</th><th class="num">Facturado</th><th class="num">Pagado</th></tr></thead>
      <tbody>
        ${history
          .map(
            (s) => `<tr>
          <td class="small">${esc(formatStamp(s.created_at))}</td>
          <td>${esc(s.worker_name)}</td>
          <td class="small">${esc(formatDate(s.period_from))} – ${esc(formatDate(s.period_to))}</td>
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

  return layout({ title: 'Liquidación', user, body, active: 'liquidacion', flash, warning });
}

function settlementCard(r, { from, to, onlyPending }) {
  return `<div class="card" style="box-shadow:none;margin-bottom:12px">
  <div class="item" style="border:0;padding-top:0">
    <div class="grow">
      <div class="title">${esc(r.user.name)}</div>
      <div class="meta">${r.count} servicio(s) · ${money(r.totalCents)} facturados · ${esc(ruleLabel(r.user))}</div>
    </div>
    <div class="money" style="font-size:1.25rem">${money(r.calc.commissionCents)}</div>
  </div>

  <details class="box">
    <summary>Ver el desglose</summary>
    <div class="table-wrap">
      <table>
        <tbody>
          ${r.calc.breakdown
            .map((b) => `<tr><td>${esc(b.concept)}</td><td class="num">${money(b.amountCents)}</td></tr>`)
            .join('')}
          <tr><td><strong>A pagar</strong></td><td class="num"><strong>${money(r.calc.commissionCents)}</strong></td></tr>
          <tr><td class="muted">Queda para la empresa</td><td class="num muted">${money(r.calc.companyCents)}</td></tr>
        </tbody>
      </table>
    </div>
    ${
      r.calc.capped
        ? '<p class="small" style="color:var(--warn)">Ojo: la regla daba más de lo facturado, se ha limitado al total facturado.</p>'
        : ''
    }
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th class="num">Importe</th></tr></thead>
        <tbody>
          ${r.entries
            .map(
              (e) => `<tr>
            <td class="small nowrap">${esc(formatDateShort(e.service_date))}${
              e.service_time ? ` ${esc(e.service_time)}` : ''
            }</td>
            <td>${esc(e.display_label)}</td>
            <td class="num">${money(e.amount_cents)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </details>

  ${
    onlyPending && r.count > 0
      ? `<form method="post" action="/admin/liquidacion/cerrar" class="no-print" style="margin-top:12px">
      <input type="hidden" name="user_id" value="${r.user.id}">
      <input type="hidden" name="from" value="${esc(from)}">
      <input type="hidden" name="to" value="${esc(to)}">
      <button class="btn big" type="submit" data-confirm="Vas a dar por pagados ${r.count} servicio(s) de ${esc(
        r.user.name
      )} por ${money(r.calc.commissionCents)}.

Su cuenta de este periodo quedará a cero y esos servicios ya no se podrán modificar. ¿Confirmas?">✓ Liquidado: ya le he pagado ${money(
        r.calc.commissionCents
      )}</button>
      <p class="hint">Al pulsarlo, ${esc(r.user.name)} empieza de cero en este periodo.</p>
    </form>`
      : ''
  }
</div>`;
}

function adminWorkers({ user, flash, warning, workers, retencion }) {
  const body = `
<h1>Trabajadores</h1>

<div class="card">
  <h2>Retención sobre lo que cobran</h2>
  <p class="sub">De cada servicio a partir de la fecha que pongas se le descuenta este porcentaje
     a lo que le tocaba cobrar: si le tocaban 100 €, cobra ${money(
       Math.round(10000 * (1 - Math.min(100, Math.max(0, retencion.percent)) / 100))
     )}. Lo retenido se queda en la empresa.</p>
  <form method="post" action="/admin/retencion">
    <div class="row">
      <div class="field">
        <label for="r_percent">Porcentaje</label>
        <input id="r_percent" name="percent" inputmode="decimal"
               value="${esc(String(retencion.percent).replace('.', ','))}">
        <div class="hint">Pon 0 para no retener nada.</div>
      </div>
      <div class="field">
        <label for="r_desde">A partir de los servicios del…</label>
        <input id="r_desde" name="desde" type="date" value="${esc(retencion.desde)}" required>
        <div class="hint">Los anteriores se pagan enteros, aunque los liquides hoy.</div>
      </div>
    </div>
    <button class="btn" type="submit">Guardar la retención</button>
  </form>
  <p class="hint">Sólo afecta a lo que aún esté sin liquidar: las liquidaciones ya cerradas no
     se tocan.</p>
</div>

<div class="card">
  <div class="actions" style="margin-bottom:12px">
    <a class="btn" href="/admin/trabajadores/nuevo">+ Nuevo trabajador</a>
  </div>
  ${
    workers.length === 0
      ? emptyState('Todavía no has dado de alta a nadie.')
      : `<div class="table-wrap"><table>
    <thead><tr><th>Nombre</th><th>Usuario</th><th>Comisión</th><th></th></tr></thead>
    <tbody>
      ${workers
        .map(
          (w) => `<tr>
        <td>${esc(w.name)} ${w.active ? '' : '<span class="pill grey">Inactivo</span>'}</td>
        <td class="muted">${esc(w.username)}</td>
        <td class="small">${esc(ruleLabel(w))}</td>
        <td class="right"><a class="btn ghost small" href="/admin/trabajadores/${w.id}">Editar</a></td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table></div>`
  }
</div>`;

  return layout({ title: 'Trabajadores', user, body, active: 'trabajadores', flash, warning });
}

function adminWorkerForm({ user, flash, warning, worker }) {
  const isNew = !worker;
  const w = worker || {
    name: '',
    username: '',
    active: 1,
    commission_type: 'percent',
    commission_percent: 40,
    fixed_cents: 0,
    tiers_json: '[]',
    tier_mode: 'total',
  };
  const tiers = parseTiers(w.tiers_json);

  const body = `
<h1>${isNew ? 'Nuevo trabajador' : esc(w.name)}</h1>
<form method="post" action="${isNew ? '/admin/trabajadores' : `/admin/trabajadores/${worker.id}`}">
  <div class="card">
    <h2>Datos</h2>
    <div class="field">
      <label for="name">Nombre</label>
      <input id="name" name="name" value="${esc(w.name)}" required>
    </div>
    <div class="field">
      <label for="username">Usuario para entrar</label>
      <input id="username" name="username" value="${esc(w.username)}" autocapitalize="none" required
             pattern="[A-Za-z0-9._-]{3,}" title="Al menos 3 caracteres: letras, números, punto, guion o guion bajo">
    </div>
    <div class="field">
      <label for="password">${isNew ? 'Contraseña' : 'Nueva contraseña (déjalo vacío para no cambiarla)'}</label>
      <input id="password" name="password" type="text" autocomplete="off" minlength="6" ${isNew ? 'required' : ''}
             placeholder="${isNew ? 'Mínimo 6 caracteres' : 'Sin cambios'}">
      <div class="hint">Se la puedes dar tal cual; ella puede cambiarla luego desde "Mi cuenta".</div>
    </div>
    ${
      isNew
        ? ''
        : `<div class="field">
      <label style="display:flex;align-items:center;gap:9px;font-weight:500;color:var(--ink)">
        <input type="checkbox" name="active" value="1" ${w.active ? 'checked' : ''} style="width:auto">
        Puede entrar en la aplicación
      </label>
    </div>`
    }
  </div>

  <div class="card">
    <h2>¿Cuánto se lleva?</h2>
    <p class="sub">Esto lo decides tú y lo puedes cambiar cuando quieras.</p>
    <div class="field">
      <label for="commission_type">Tipo</label>
      <select id="commission_type" name="commission_type" data-commission-type>
        <option value="percent" ${w.commission_type === 'percent' ? 'selected' : ''}>Un porcentaje de todo lo que factura</option>
        <option value="tiers" ${w.commission_type === 'tiers' ? 'selected' : ''}>Varios porcentajes por tramos</option>
        <option value="fixed" ${w.commission_type === 'fixed' ? 'selected' : ''}>Una cantidad fija por servicio</option>
      </select>
    </div>

    <div data-when-type="percent">
      <div class="field">
        <label for="commission_percent">Porcentaje</label>
        <input id="commission_percent" name="commission_percent" inputmode="decimal" value="${esc(w.commission_percent)}">
        <div class="hint">Ejemplo: 40 significa que se lleva el 40 % de lo que factura.</div>
      </div>
    </div>

    <div data-when-type="tiers">
      <div class="field">
        <label for="tier_mode">Cómo se aplican los tramos</label>
        <select id="tier_mode" name="tier_mode">
          <option value="total" ${w.tier_mode === 'total' ? 'selected' : ''}>El % del tramo alcanzado se aplica a TODO lo facturado</option>
          <option value="progressive" ${w.tier_mode === 'progressive' ? 'selected' : ''}>Cada tramo cobra su % sólo sobre su parte</option>
        </select>
      </div>
      <label>Tramos</label>
      <div id="tiers">
        ${(tiers.length ? tiers : [{ min_cents: 0, percent: 30 }])
          .map(
            (t) => `<div class="tier-row">
          <div><label>Desde (€ facturados)</label><input type="text" name="tier_from" inputmode="decimal" value="${esc(
            (t.min_cents / 100).toFixed(2).replace('.', ',')
          )}"></div>
          <div><label>Porcentaje</label><input type="text" name="tier_percent" inputmode="decimal" value="${esc(t.percent)}"></div>
          <button type="button" class="btn ghost small" data-remove-tier>Quitar</button>
        </div>`
          )
          .join('')}
      </div>
      <button type="button" class="btn ghost small" id="add-tier">+ Añadir tramo</button>
      <div class="hint" style="margin-top:8px">Ejemplo: desde 0 € → 30 %, desde 2.000 € → 35 %, desde 4.000 € → 40 %.</div>
    </div>

    <div data-when-type="fixed">
      <div class="field">
        <label for="fixed_amount">Euros por servicio</label>
        <input id="fixed_amount" name="fixed_amount" inputmode="decimal" value="${esc(
          (w.fixed_cents / 100).toFixed(2).replace('.', ',')
        )}">
        <div class="hint">Se le paga esta cantidad por cada cliente que apunte, sea cual sea el importe.</div>
      </div>
    </div>
  </div>

  <div class="actions">
    <button class="btn big" type="submit">${isNew ? 'Crear trabajador' : 'Guardar cambios'}</button>
    <a class="btn ghost" href="/admin/trabajadores">Cancelar</a>
  </div>
</form>
${
  isNew
    ? ''
    : `<div class="card" style="margin-top:16px">
  <h2>Cerrar sus sesiones</h2>
  <p class="sub">Si ha perdido el móvil, esto la obliga a entrar otra vez con su contraseña.</p>
  <form method="post" action="/admin/trabajadores/${worker.id}/sesiones">
    <button class="btn danger" type="submit" data-confirm="¿Cerrar todas las sesiones de ${esc(w.name)}?">Cerrar sus sesiones</button>
  </form>
</div>`
}`;

  return layout({
    title: isNew ? 'Nuevo trabajador' : w.name,
    user,
    body,
    active: 'trabajadores',
    flash,
    warning,
  });
}

function adminEntries({ user, flash, warning, entries, workers, periodo, filters, totalCents, today, ahora }) {
  const body = `
<h1>Servicios · ${esc(primeraMayuscula(periodo.label))}</h1>

${periodPicker('/admin/servicios', periodo, { worker: filters.worker || '' })}

<form method="get" action="/admin/servicios" class="card" style="padding:12px 14px">
  ${camposPeriodo(periodo)}
  <div class="row">
    <div style="flex:1 1 200px">
      <label for="worker">Trabajador</label>
      <select id="worker" name="worker" onchange="this.form.submit()">
        <option value="">Todos</option>
        ${workers
          .map(
            (w) =>
              `<option value="${w.id}" ${String(filters.worker) === String(w.id) ? 'selected' : ''}>${esc(w.name)}</option>`
          )
          .join('')}
      </select>
    </div>
    <div style="flex:0 0 auto;align-self:end;margin-bottom:14px"><button class="btn ghost" type="submit">Filtrar</button></div>
  </div>
</form>

<div class="card">
  <h2>${entries.length} servicio(s) · ${money(totalCents)}</h2>
  ${
    entries.length === 0
      ? emptyState('No hay servicios con estos filtros.')
      : `${entries.map(fichaServicio).join('')}
    <div class="item only-narrow"><div class="grow title">Total</div><div class="money">${money(
      totalCents
    )}</div></div>
    <div class="table-wrap wide-only"><table>
    <thead><tr><th>Fecha</th><th>Trabajador</th><th>Cliente</th><th class="hide-narrow">Pago</th><th class="num">Importe</th><th></th></tr></thead>
    <tbody>
      ${entries
        .map(
          (e) => `<tr>
        <td class="small nowrap">${esc(formatDateShort(e.service_date))}${
          e.service_time ? `<div class="muted">${esc(e.service_time)}</div>` : ''
        }</td>
        <td>${esc(e.worker_name)}</td>
        <td>${esc(e.display_label)}${e.notes ? `<div class="small muted">${esc(e.notes)}</div>` : ''}</td>
        <td class="small muted hide-narrow">${esc(metodoLegible(e.payment_method))}</td>
        <td class="num">${money(e.amount_cents)}</td>
        <td class="right">${
          e.settlement_id
            ? '<span class="pill grey">Pagado</span>'
            : `<a class="btn ghost small" href="/admin/servicios/${e.id}">Editar</a>`
        }</td>
      </tr>`
        )
        .join('')}
    </tbody>
    <tfoot><tr><td colspan="4">Total</td><td class="num">${money(totalCents)}</td><td></td></tr></tfoot>
  </table></div>`
  }
  <div class="actions" style="margin-top:14px">
    <a class="btn ghost" href="/admin/servicios.csv?${esc(filters.qs)}">Descargar CSV</a>
  </div>
</div>

<div class="card">
  <h2>Apuntar un servicio a mano</h2>
  <p class="sub">Por si alguien se ha dejado uno sin apuntar.</p>
  <form method="post" action="/admin/servicios" data-once data-celebrar>
    <div class="row">
      <div class="field">
        <label for="a_user">Trabajador</label>
        <select id="a_user" name="user_id" required>
          ${workers.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="a_amount">Importe</label>
        <input id="a_amount" name="amount" inputmode="decimal" placeholder="0,00" required>
      </div>
      <div class="field">
        <label for="a_date">Fecha</label>
        <input id="a_date" name="service_date" type="date" value="${esc(today)}">
      </div>
      <div class="field">
        <label for="a_time">Hora</label>
        <input id="a_time" name="service_time" type="time" value="${esc(ahora)}">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="a_client">Cliente (opcional)</label>
        <input id="a_client" name="client_label">
      </div>
      <div class="field">
        <label for="a_method">Cómo ha pagado</label>
        <select id="a_method" name="payment_method">
          ${PAYMENT_METHODS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
        </select>
      </div>
    </div>
    <button class="btn" type="submit">Apuntar</button>
  </form>
</div>`;

  return layout({ title: 'Servicios', user, body, active: 'servicios', flash, warning });
}

/** Un servicio en móvil: la tabla no cabe, así que cada uno va en su línea. */
function fichaServicio(e) {
  return `<div class="item only-narrow">
  <div class="grow">
    <div class="title">${esc(e.display_label)}</div>
    <div class="meta">${esc(e.worker_name)} · ${esc(formatDateShort(e.service_date))}${
      e.service_time ? ` · ${esc(e.service_time)}` : ''
    } · ${esc(metodoLegible(e.payment_method))}${e.notes ? ` · ${esc(e.notes)}` : ''}</div>
  </div>
  <div class="money">${money(e.amount_cents)}</div>
  ${
    e.settlement_id
      ? '<span class="pill grey nowrap">Pagado</span>'
      : `<a class="btn ghost small" href="/admin/servicios/${e.id}">Editar</a>`
  }
</div>`;
}

function adminEntryForm({ user, flash, warning, entry, workers, today, ahora }) {
  const body = `
<h1>Editar servicio</h1>
<div class="card">
  <form method="post" action="/admin/servicios/${entry.id}">
    <div class="row">
      <div class="field">
        <label for="user_id">Trabajador</label>
        <select id="user_id" name="user_id" required>
          ${workers
            .map(
              (w) =>
                `<option value="${w.id}" ${w.id === entry.user_id ? 'selected' : ''}>${esc(w.name)}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label for="amount">Importe</label>
        <input id="amount" name="amount" inputmode="decimal" value="${esc(
          (entry.amount_cents / 100).toFixed(2).replace('.', ',')
        )}" required>
      </div>
      <div class="field">
        <label for="service_date">Fecha</label>
        <input id="service_date" name="service_date" type="date" value="${esc(entry.service_date)}" max="${esc(today)}">
      </div>
      <div class="field">
        <label for="service_time">Hora</label>
        <input id="service_time" name="service_time" type="time" value="${esc(entry.service_time || ahora)}">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="client_label">Cliente</label>
        <input id="client_label" name="client_label" value="${esc(entry.client_label)}">
      </div>
      <div class="field">
        <label for="payment_method">Cómo ha pagado</label>
        <select id="payment_method" name="payment_method">
          ${PAYMENT_METHODS.map(
            ([v, l]) => `<option value="${v}" ${entry.payment_method === v ? 'selected' : ''}>${esc(l)}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="notes">Nota</label>
      <input id="notes" name="notes" value="${esc(entry.notes)}">
    </div>
    <button class="btn" type="submit">Guardar cambios</button>
  </form>
</div>
<div class="card">
  <h2>Borrar</h2>
  <form method="post" action="/admin/servicios/${entry.id}/borrar">
    <button class="btn danger" type="submit" data-confirm="¿Seguro que quieres borrar este servicio?">Borrar servicio</button>
  </form>
</div>
<p><a href="/admin/servicios">← Volver</a></p>`;

  return layout({ title: 'Editar servicio', user, body, active: 'servicios', flash, warning });
}


module.exports = {
  adminHome,
  adminSettlement,
  adminWorkers,
  adminWorkerForm,
  adminEntries,
  adminEntryForm,
};
