'use strict';

const { esc, formatDate, monthLabel, recentMonths, previousMonth, nextMonth } = require('../util');
const { layout } = require('./layout');
const { stats, money, emptyState } = require('./common');

/**
 * El mes día a día de un gasto diario.
 *
 * La publicidad no se gasta igual todos los días: unos se invierte más y otros
 * menos. Ir corrigiendo día por día desde el formulario de edición era un
 * suplicio, así que aquí está el mes entero en una pantalla, con una casilla por
 * día y un solo botón de guardar.
 *
 * Las casillas salen **vacías** cuando ese día va al importe de siempre, con ese
 * importe puesto de fondo en gris. Así se distingue de un vistazo lo que has
 * escrito tú de lo que se está suponiendo, y borrar una casilla devuelve el día
 * a lo normal.
 */
function adminCalendario({ user, flash, warning, gasto, month, dias, hoy, volverA }) {
  const totalCents = dias.reduce((a, d) => a + d.amount_cents, 0);
  const ajustados = dias.filter((d) => d.ajustado).length;
  const normal = money(gasto.amount_cents);

  // Los días se ponen bajo su día de la semana, como un calendario de pared.
  const huecos = dias.length ? diaSemana(dias[0].fecha) : 0;

  const body = `
<h1>${esc(gasto.name)} · día a día</h1>
<p class="sub">Escribe lo que se gastó de verdad cada día. Lo que dejes en blanco cuenta como
   el importe de siempre (${esc(normal)}).</p>

<form method="get" action="/admin/caja/${gasto.id}/calendario" class="card" style="padding:12px 14px">
  <div class="row">
    <div style="flex:0 0 auto;align-self:end;margin-bottom:14px">
      <a class="btn ghost" href="/admin/caja/${gasto.id}/calendario?month=${esc(previousMonth(month))}">←</a>
    </div>
    <div style="flex:1 1 200px">
      <label for="cal_month">Mes</label>
      <select id="cal_month" name="month" onchange="this.form.submit()">
        ${recentMonths()
          .map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`)
          .join('')}
      </select>
    </div>
    <div style="flex:0 0 auto;align-self:end;margin-bottom:14px">
      <a class="btn ghost" href="/admin/caja/${gasto.id}/calendario?month=${esc(nextMonth(month))}">→</a>
    </div>
  </div>
</form>

${stats([
  { k: monthLabel(month), v: money(totalCents), sub: `${dias.length} día(s)`, accent: true },
  { k: 'Importe de siempre', v: normal, sub: 'para los días en blanco' },
  { k: 'Días escritos a mano', v: String(ajustados), sub: `de ${dias.length}` },
])}

${
  dias.length === 0
    ? `<div class="card" style="margin-top:16px">${emptyState(
        `Este gasto empieza el ${esc(formatDate(gasto.anchor_date))}: en ${esc(
          monthLabel(month)
        )} todavía no cuenta.`
      )}</div>`
    : `<form method="post" action="/admin/caja/${gasto.id}/calendario" class="card" style="margin-top:16px">
  <input type="hidden" name="month" value="${esc(month)}">
  <input type="hidden" name="volver" value="${esc(volverA)}">

  <div class="calendario">
    ${'<div class="hueco"></div>'.repeat(huecos)}
    ${dias
      .map(
        (d) => `<label class="dia ${d.ajustado ? 'escrito' : ''} ${d.fecha === hoy ? 'es-hoy' : ''}">
      <span class="cabeza">${esc(SEMANA[diaSemana(d.fecha)])} ${Number(d.fecha.slice(8))}</span>
      <input type="hidden" name="dia" value="${esc(d.fecha)}">
      <input name="importe" inputmode="decimal" autocomplete="off"
             placeholder="${esc(sinEuro(gasto.amount_cents))}"
             value="${d.ajustado ? esc(sinEuro(d.amount_cents)) : ''}">
    </label>`
      )
      .join('')}
  </div>

  <p class="hint" style="margin-top:10px">Las casillas en gris claro son el importe de siempre
     (${esc(normal)}); las que escribas tú se quedan marcadas.</p>

  <div class="actions" style="margin-top:14px">
    <button class="btn big" type="submit">Guardar el mes</button>
    <a class="btn ghost" href="${esc(volverA)}">Volver a Caja</a>
  </div>
  <p class="hint">Total del mes ahora mismo: <strong>${money(totalCents)}</strong>.
     Borra una casilla para que ese día vuelva a ${esc(normal)}.</p>
</form>

<div class="card">
  <h2>Empezar de cero</h2>
  <p class="sub">Quita todos los importes que hayas escrito a mano en ${esc(monthLabel(month))}
     y deja el mes entero a ${esc(normal)} al día.</p>
  <form method="post" action="/admin/caja/${gasto.id}/calendario">
    <input type="hidden" name="month" value="${esc(month)}">
    <input type="hidden" name="volver" value="${esc(volverA)}">
    <input type="hidden" name="vaciar" value="1">
    <button class="btn danger" type="submit"
            data-confirm="Vas a borrar los ${ajustados} importe(s) escritos a mano de ${esc(
              monthLabel(month)
            )}. ¿Seguro?" ${ajustados === 0 ? 'disabled' : ''}>Vaciar los ajustes del mes</button>
  </form>
</div>`
}`;

  return layout({ title: `${gasto.name} día a día`, user, body, active: 'caja', flash, warning });
}

const SEMANA = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/** 0 = lunes … 6 = domingo, para colocar los días bajo su columna. */
function diaSemana(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** '20,00' — sin el símbolo, que en una casilla de escribir estorba. */
function sinEuro(cents) {
  return (Math.round(cents) / 100).toFixed(2).replace('.', ',');
}

module.exports = { adminCalendario };
