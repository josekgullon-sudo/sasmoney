'use strict';

const { esc, formatDateShort, formatDate } = require('../util');
const { periodQuery } = require('../period');
const { COMPARACIONES } = require('../period');
const { layout } = require('./layout');
const { money, emptyState, periodPicker } = require('./common');
const { metodoLegible } = require('./worker');
const graficas = require('./graficas');

/**
 * La pantalla de Analíticas: todo lo que se puede saber del negocio a partir de
 * lo que se apunta, y comparado con otro trozo de tiempo.
 *
 * La comparación es la mitad de la pantalla: un número suelto no dice si vas
 * bien o mal. Por eso cada cifra de arriba lleva debajo cuánto ha subido o
 * bajado y las gráficas de categorías fijas (días de la semana, horas) pintan
 * las dos épocas una al lado de la otra.
 */

/** 1.234 → '1.234'. Para contar cosas que no son dinero. */
function num(n) {
  return new Intl.NumberFormat('es-ES').format(n);
}

function pct1(n) {
  return `${n.toFixed(1).replace('.', ',')} %`;
}

/**
 * La flechita de "vas mejor o peor".
 *
 * Con `alReves` (los gastos, por ejemplo) subir es malo y bajar es bueno, que
 * si no un mes con el doble de gastos saldría en verde.
 */
function delta(ahora, antes, { alReves = false, formato = money } = {}) {
  if (antes === null || antes === undefined) return '';
  if (antes === 0) {
    if (ahora === 0) return '<span class="delta igual">= igual</span>';
    // Sin nada con qué comparar, un porcentaje sería un número inventado.
    return '<span class="muted small">antes no había nada</span>';
  }

  const dif = ahora - antes;
  const porcentaje = (dif / Math.abs(antes)) * 100;
  const sube = dif > 0;
  const bueno = alReves ? !sube : sube;
  const clase = dif === 0 ? 'igual' : bueno ? 'bien' : 'mal';
  const flecha = dif === 0 ? '=' : sube ? '▲' : '▼';

  return `<span class="delta ${clase}">${flecha} ${esc(
    pct1(Math.abs(porcentaje))
  )}</span> <span class="muted small">antes ${esc(formato(antes))}</span>`;
}

/** Las cifras de arriba, cada una con su comparación. */
function kpis(items) {
  return `<div class="kpis">${items
    .map(
      (i) => `<div class="kpi">
    <div class="k">${esc(i.k)}</div>
    <div class="v">${esc(i.v)}</div>
    <div class="d">${i.d || ''}</div>
    ${i.sub ? `<div class="small muted">${esc(i.sub)}</div>` : ''}
  </div>`
    )
    .join('')}</div>`;
}

/** Una tabla de "cosa / servicios / facturado / ticket medio / % del total". */
function tablaReparto({ titulo, filas, totalCents, columna = 'Concepto', vacio }) {
  if (filas.length === 0) return emptyState(vacio);

  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>${esc(columna)}</th>
      <th class="num hide-narrow">Servicios</th>
      <th class="num">Facturado</th>
      <th class="num hide-narrow">Ticket medio</th>
      <th class="num">%</th>
    </tr></thead>
    <tbody>
      ${filas
        .map(
          (f) => `<tr>
        <td>${esc(f.nombre)}</td>
        <td class="num hide-narrow">${num(f.count)}</td>
        <td class="num"><strong>${money(f.cents)}</strong></td>
        <td class="num hide-narrow">${money(f.ticketCents || 0)}</td>
        <td class="num">
          <span class="barrita"><i style="width:${
            totalCents > 0 ? Math.round((f.cents / totalCents) * 100) : 0
          }%"></i></span>
          ${esc(pct1(totalCents > 0 ? (f.cents / totalCents) * 100 : 0))}
        </td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table></div>`;
}

/** El selector de con qué se compara. */
function comparador(action, periodo, comparacion) {
  const base = periodQuery(periodo);
  const modo = comparacion ? comparacion.modo : 'no';

  return `<div class="card" style="padding:12px 14px">
  <label class="small muted" style="display:block;margin-bottom:6px">Comparar con</label>
  <div class="chips" style="margin-top:0">
    ${Object.entries(COMPARACIONES)
      .map(
        ([k, label]) =>
          `<a class="chip ${modo === k ? 'is-on' : ''}" href="${esc(
            `${action}?${base}&cmp=${k}`
          )}">${esc(label)}</a>`
      )
      .join('')}
  </div>
  <details class="box" style="margin-top:10px" ${modo === 'fechas' ? 'open' : ''}>
    <summary>Comparar con dos fechas concretas</summary>
    <form method="get" action="${action}" class="row" style="margin-top:8px">
      ${
        periodo.month
          ? `<input type="hidden" name="month" value="${esc(periodo.month)}">`
          : `<input type="hidden" name="from" value="${esc(periodo.from)}">
             <input type="hidden" name="to" value="${esc(periodo.to)}">`
      }
      <div class="field" style="flex:1 1 140px;margin:0">
        <label for="cmp_from">Desde</label>
        <input id="cmp_from" type="date" name="cmp_from" value="${esc(
          comparacion && comparacion.modo === 'fechas' ? comparacion.from : ''
        )}">
      </div>
      <div class="field" style="flex:1 1 140px;margin:0">
        <label for="cmp_to">Hasta</label>
        <input id="cmp_to" type="date" name="cmp_to" value="${esc(
          comparacion && comparacion.modo === 'fechas' ? comparacion.to : ''
        )}">
      </div>
      <div style="align-self:flex-end"><button class="btn" type="submit">Comparar</button></div>
    </form>
  </details>
  ${
    comparacion
      ? `<p class="hint" style="margin-top:8px">Comparando con <strong>${esc(
          comparacion.label
        )}</strong>: del ${esc(formatDate(comparacion.from))} al ${esc(formatDate(comparacion.to))}.</p>`
      : '<p class="hint" style="margin-top:8px">Sin comparar: sólo los números del periodo.</p>'
  }
</div>`;
}

function adminAnalytics({
  user, flash, warning, periodo, comparacion, datos, antes, dinero, meses,
}) {
  const etq = comparacion ? comparacion.label : '';
  const cmp = (campo) => (antes ? antes[campo] : null);

  const body = `
<h1>Analíticas · ${esc(periodo.label.charAt(0).toUpperCase() + periodo.label.slice(1))}</h1>
<p class="sub">Del ${esc(formatDate(periodo.from))} al ${esc(formatDate(periodo.to))}${
    comparacion ? `, comparado con ${esc(comparacion.label)}` : ''
  }.</p>

${periodPicker('/admin/analiticas', periodo, cmpParams(comparacion))}
${comparador('/admin/analiticas', periodo, comparacion)}

<div class="card">
  <h2>Lo que ha pasado</h2>
  ${kpis([
    {
      k: 'Facturado',
      v: money(datos.resumen.facturadoCents),
      d: delta(datos.resumen.facturadoCents, cmp('facturadoCents')),
      sub: `${num(datos.resumen.servicios)} servicios`,
    },
    {
      k: 'Servicios',
      v: num(datos.resumen.servicios),
      d: delta(datos.resumen.servicios, cmp('servicios'), { formato: num }),
      sub: `${datos.resumen.serviciosPorDia.toFixed(1).replace('.', ',')} al día`,
    },
    {
      k: 'Ticket medio',
      v: money(datos.resumen.ticketCents),
      d: delta(datos.resumen.ticketCents, cmp('ticketCents')),
      sub: `el mayor, ${money(datos.resumen.mayorCents)}`,
    },
    {
      k: 'Por día',
      v: money(datos.resumen.porDiaCents),
      d: delta(datos.resumen.porDiaCents, cmp('porDiaCents')),
      sub: `${datos.resumen.diasConAlgo} de ${datos.resumen.dias} días con trabajo`,
    },
  ])}
</div>

<div class="card">
  <h2>Lo que deja</h2>
  <p class="sub">Lo que entra menos lo que cuesta: los gastos del periodo y lo que se llevan ellas.</p>
  ${kpis([
    {
      k: 'Gastos',
      v: money(dinero.gastosCents),
      d: delta(dinero.gastosCents, antes ? antes.gastosCents : null, { alReves: true }),
      sub: `${money(dinero.marketingCents)} de marketing`,
    },
    {
      k: 'Comisiones',
      v: money(dinero.comisionesCents),
      d: delta(dinero.comisionesCents, antes ? antes.comisionesCents : null, { alReves: true }),
      sub:
        datos.resumen.facturadoCents > 0
          ? `${pct1((dinero.comisionesCents / datos.resumen.facturadoCents) * 100)} de lo facturado`
          : '',
    },
    {
      k: 'Beneficio',
      v: money(dinero.beneficioCents),
      d: delta(dinero.beneficioCents, antes ? antes.beneficioCents : null),
      sub: `margen ${pct1(dinero.margen)}`,
      accent: true,
    },
    {
      k: 'Por cada euro de marketing',
      v: dinero.marketingCents > 0 ? `${dinero.roas.toFixed(2).replace('.', ',')} €` : '—',
      d:
        antes && antes.marketingCents > 0 && dinero.marketingCents > 0
          ? delta(Math.round(dinero.roas * 100), Math.round(antes.roas * 100), {
              formato: (v) => `${(v / 100).toFixed(2).replace('.', ',')} €`,
            })
          : '',
      sub:
        dinero.marketingCents > 0
          ? `cuesta ${money(dinero.costePorServicioCents)} traer un cliente`
          : 'sin gasto de marketing',
    },
  ])}
</div>

<div class="card">
  <h2>Día a día</h2>
  <p class="sub">Cada barra es un día. Pásale el ratón por encima (o tócala en el móvil) para ver
     el detalle.</p>
  ${graficas.porDia(datos.dias) || emptyState('No hay servicios en este periodo.')}
</div>

${
  datos.semana && periodo.dias >= 7
    ? `<div class="card">
  <h2>Por día de la semana</h2>
  <p class="sub">La media de cada día, no la suma: si en el periodo hay cinco lunes y cuatro
     domingos, sumar diría que los lunes son mejores sólo por ser más.</p>
  ${graficas.porDiaSemana(datos.semana, { cmp: antes ? antes.semana : null, etiquetaCmp: etq })}
</div>`
    : ''
}

<div class="card">
  <h2>Por hora del día</h2>
  <p class="sub">A qué horas entra el dinero. Sirve para saber cuándo hace falta más gente.</p>
  ${
    graficas.porHora(datos.horas, { cmp: antes ? antes.horas : null, etiquetaCmp: etq }) ||
    emptyState('Todavía no hay servicios con hora en este periodo.')
  }
</div>

<div class="card">
  <h2>Cada trabajador</h2>
  ${tablaReparto({
    columna: 'Trabajador',
    filas: datos.trabajadores.map((t) => ({ ...t, nombre: t.name })),
    totalCents: datos.resumen.facturadoCents,
    vacio: 'Nadie ha apuntado nada en este periodo.',
  })}
</div>

<div class="card">
  <h2>Por pueblo</h2>
  ${tablaReparto({
    columna: 'Pueblo',
    filas: datos.pueblos.map((p) => ({ ...p, nombre: p.name })),
    totalCents: datos.resumen.facturadoCents,
    vacio: 'Sin servicios en este periodo.',
  })}
</div>

<div class="card">
  <h2>Cómo pagan</h2>
  ${tablaReparto({
    columna: 'Forma de pago',
    filas: datos.metodos.map((m) => ({
      ...m,
      nombre: metodoLegible(m.metodo),
      ticketCents: m.count > 0 ? Math.round(m.cents / m.count) : 0,
    })),
    totalCents: datos.resumen.facturadoCents,
    vacio: 'Sin servicios en este periodo.',
  })}
</div>

<div class="card">
  <h2>De qué importes se vive</h2>
  <p class="sub">Si el negocio son muchos servicios pequeños o pocos grandes.</p>
  ${tablaReparto({
    columna: 'Importe',
    filas: datos.importes
      .filter((t) => t.count > 0)
      .map((t) => ({
        nombre: t.label,
        count: t.count,
        cents: t.cents,
        ticketCents: Math.round(t.cents / t.count),
      })),
    totalCents: datos.resumen.facturadoCents,
    vacio: 'Sin servicios en este periodo.',
  })}
</div>

${
  datos.clientes.length === 0
    ? ''
    : `<div class="card">
  <h2>Clientes que repiten</h2>
  <p class="sub">De los que tienen nombre apuntado, los que más veces han vuelto en este periodo.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Cliente</th><th class="num">Veces</th><th class="num">Facturado</th>
      <th class="num hide-narrow">Última vez</th></tr></thead>
    <tbody>
      ${datos.clientes
        .map(
          (c) => `<tr>
        <td>${esc(c.cliente)}</td>
        <td class="num"><strong>${num(c.count)}</strong></td>
        <td class="num">${money(c.cents)}</td>
        <td class="num small hide-narrow">${esc(formatDateShort(c.ultima))}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table></div>
</div>`
}

<div class="card">
  <h2>Los últimos doce meses</h2>
  <p class="sub">Esto no depende del periodo de arriba: es la foto larga, para ver si el negocio
     sube o baja.</p>
  ${graficas.porMes(meses) || emptyState('Todavía no hay meses que comparar.')}
</div>`;

  return layout({ title: 'Analíticas', user, body, active: 'analiticas', flash, warning });
}

/** La comparación elegida, para que no se pierda al cambiar de periodo. */
function cmpParams(comparacion) {
  if (!comparacion) return { cmp: 'no' };
  if (comparacion.modo === 'fechas') {
    return { cmp_from: comparacion.from, cmp_to: comparacion.to };
  }
  return { cmp: comparacion.modo };
}

module.exports = { adminAnalytics };
