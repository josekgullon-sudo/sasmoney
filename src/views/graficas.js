'use strict';

const { esc, formatDateShort, monthLabel } = require('../util');
const { money } = require('./common');

/**
 * Las gráficas: de un vistazo, cuáles son los mejores días.
 *
 * Están hechas con barras de HTML normales, no con un dibujo ni con ninguna
 * librería. Es a propósito: así los números son texto de verdad (se leen bien
 * en cualquier móvil, se pueden copiar y los lee un lector de pantalla), la
 * página no engorda ni un kilobyte y no hay nada que se pueda quedar en blanco
 * si falla una descarga.
 *
 * Cada barra es una **pastilla que responde**: al pasar el ratón se ilumina y
 * sale un cartelito con el detalle. En el móvil no hay ratón, así que cada
 * barra es un botón de verdad: se toca y sale el cartelito, se llega con el
 * tabulador y lo lee un lector de pantalla.
 *
 * Cuando se compara con otro periodo, cada columna lleva dos barras: la del
 * periodo que se mira y, al lado y más apagada, la del comparado.
 */

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTOS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/** El cartelito: un título y unas cuantas líneas de "cosa: valor". */
function cartel(titulo, filas) {
  return `<span class="tip">
    <strong>${esc(titulo)}</strong>
    ${filas
      .filter(Boolean)
      .map(([k, v]) => `<span class="l"><span>${esc(k)}</span><b>${esc(v)}</b></span>`)
      .join('')}
  </span>`;
}

/**
 * Una gráfica de barras.
 *
 * @param {Array} items  [{ etiqueta, titulo, filas, valor, valor2, referencia, destacado }]
 *        `valor2` es la barra del periodo comparado, si se compara.
 *        `referencia` es la rayita del coste; puede faltar.
 */
function barras(items, { alto = 150, conTope = true } = {}) {
  if (items.length === 0) return '';

  // La escala la manda lo más alto que se pinte —barra, barra comparada o
  // rayita— para que nada se salga por arriba.
  const tope = Math.max(
    1,
    ...items.map((i) => Math.max(i.valor || 0, i.valor2 || 0, i.referencia || 0))
  );
  const pct = (v) => Math.max(0, Math.min(100, ((v || 0) / tope) * 100));
  const ultimo = Math.max(1, items.length - 1);

  return `<div class="grafica" style="--alto:${alto}px">
    ${conTope ? `<div class="tope"><span>${money(tope)}</span></div>` : ''}
    <div class="cols">
      ${items
        .map((i, n) => {
          const bajoCoste = i.referencia > 0 && i.valor < i.referencia;
          const clases = ['relleno', bajoCoste ? 'flojo' : '', i.destacado ? 'top' : '']
            .filter(Boolean)
            .join(' ');
          // El cartelito de las primeras y las últimas columnas se pega a su
          // lado: centrado se saldría de la pantalla justo por donde no se
          // puede arrastrar para verlo.
          const lado = n / ultimo <= 0.2 ? ' tip-izq' : n / ultimo >= 0.8 ? ' tip-der' : '';
          return `<button class="col${lado}" type="button">
        <span class="barra">
          <span class="${clases}" style="height:${pct(i.valor).toFixed(1)}%"></span>
          ${
            i.valor2 === undefined
              ? ''
              : `<span class="relleno cmp" style="height:${pct(i.valor2).toFixed(1)}%"></span>`
          }
          ${
            i.referencia > 0
              ? `<span class="coste" style="bottom:${pct(i.referencia).toFixed(1)}%"></span>`
              : ''
          }
        </span>
        <span class="etq">${esc(i.etiqueta)}</span>
        ${cartel(i.titulo, i.filas || [])}
      </button>`;
        })
        .join('')}
    </div>
  </div>`;
}

/** La leyenda, para que nadie tenga que adivinar qué es cada color. */
function leyenda({ coste = false, comparado = '' } = {}) {
  const partes = [
    coste ? '<span><i class="mu bien"></i> Cubre los gastos</span>' : '',
    coste ? '<span><i class="mu flojo"></i> No los cubre</span>' : '',
    coste ? '<span><i class="mu linea"></i> Lo que costó el día</span>' : '',
    comparado ? `<span><i class="mu cmp"></i> ${esc(comparado)}</span>` : '',
  ].filter(Boolean);
  return partes.length ? `<p class="grafica-leyenda">${partes.join('')}</p>` : '';
}

/**
 * Día a día del periodo: lo facturado por todo el equipo y lo que costó cada día.
 *
 * @param {Array} dias  [{ fecha, facturadoCents, costeCents, count }]
 */
function porDia(dias) {
  if (dias.length === 0) return '';

  const mejor = dias.reduce((a, d) => (d.facturadoCents > a.facturadoCents ? d : a), dias[0]);
  // Con muchos días no cabe un número debajo de cada barra: se ponen sólo unos
  // cuantos repartidos, que es lo que hace falta para situarse.
  const cada = dias.length > 16 ? Math.ceil(dias.length / 8) : 1;
  // Si el periodo cruza de mes, el número del día solo despista (aparecen dos
  // "1"): en ese caso se pone día/mes.
  const cruzaMes = dias[0].fecha.slice(0, 7) !== dias[dias.length - 1].fecha.slice(0, 7);
  const etiquetaDe = (f) =>
    cruzaMes ? `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}` : String(Number(f.slice(8, 10)));

  const conCoste = dias.some((d) => d.costeCents > 0);

  const items = dias.map((d, i) => ({
    etiqueta: i % cada === 0 ? etiquetaDe(d.fecha) : '',
    titulo: formatDateShort(d.fecha),
    filas: [
      ['Facturado', money(d.facturadoCents)],
      d.count === undefined ? null : ['Servicios', String(d.count)],
      conCoste ? ['Gastos del día', money(d.costeCents || 0)] : null,
      conCoste ? ['Deja', money(d.facturadoCents - (d.costeCents || 0))] : null,
      d === mejor && mejor.facturadoCents > 0 ? ['', '⭐ El mejor día'] : null,
    ],
    valor: d.facturadoCents,
    referencia: d.costeCents,
    destacado: d === mejor && mejor.facturadoCents > 0,
  }));

  return `${barras(items)}
  ${
    mejor.facturadoCents > 0
      ? `<p class="grafica-nota">Tu mejor día: <strong>${esc(formatDateShort(mejor.fecha))}</strong>,
         ${money(mejor.facturadoCents)}.</p>`
      : ''
  }
  ${leyenda({ coste: conCoste })}`;
}

/**
 * Lo que se factura de media cada día de la semana. Es lo que contesta a
 * "¿qué días conviene abrir?": no vale sumar, porque de unos días de la semana
 * hay más que de otros en el periodo.
 *
 * @param {Array} dias  Lo que devuelve analytics.porDiaSemana (de lunes a domingo).
 */
function porDiaSemana(dias, { cmp = null, etiquetaCmp = '' } = {}) {
  if (!dias || dias.length === 0) return '';
  const mejor = dias.reduce((a, d) => (d.mediaCents > a.mediaCents ? d : a), dias[0]);
  if (mejor.mediaCents === 0) return '';

  const items = dias.map((d, i) => ({
    etiqueta: DIAS_CORTOS[d.dow],
    titulo: DIAS_SEMANA[d.dow],
    filas: [
      ['De media', money(d.mediaCents)],
      ['En total', money(d.cents)],
      ['Servicios', String(d.count)],
      ['Cuántos hubo', String(d.veces)],
      cmp && cmp[i] ? [etiquetaCmp || 'Antes', money(cmp[i].mediaCents)] : null,
    ],
    valor: d.mediaCents,
    valor2: cmp && cmp[i] ? cmp[i].mediaCents : undefined,
    destacado: d === mejor,
  }));

  return `${barras(items, { alto: 120 })}
  <p class="grafica-nota">El mejor día de la semana es el <strong>${esc(
    DIAS_SEMANA[mejor.dow].toLowerCase()
  )}</strong>: ${money(mejor.mediaCents)} de media.</p>
  ${cmp ? leyenda({ comparado: etiquetaCmp }) : ''}`;
}

/** Las horas del día: cuándo entra el dinero. */
function porHora(horas, { cmp = null, etiquetaCmp = '' } = {}) {
  const conAlgo = horas.filter((h) => h.cents > 0);
  if (conAlgo.length === 0) return '';

  // Fuera las horas de madrugada en las que nunca pasa nada: ocupan media
  // gráfica y no cuentan nada.
  const desde = Math.max(0, conAlgo[0].hora - 1);
  const hasta = Math.min(23, conAlgo[conAlgo.length - 1].hora + 1);
  const dentro = horas.filter((h) => h.hora >= desde && h.hora <= hasta);
  const mejor = dentro.reduce((a, h) => (h.cents > a.cents ? h : a), dentro[0]);

  const items = dentro.map((h) => ({
    etiqueta: String(h.hora),
    titulo: `A las ${String(h.hora).padStart(2, '0')}:00`,
    filas: [
      ['Facturado', money(h.cents)],
      ['Servicios', String(h.count)],
      cmp && cmp[h.hora] ? [etiquetaCmp || 'Antes', money(cmp[h.hora].cents)] : null,
    ],
    valor: h.cents,
    valor2: cmp && cmp[h.hora] ? cmp[h.hora].cents : undefined,
    destacado: h === mejor,
  }));

  return `${barras(items, { alto: 120 })}
  <p class="grafica-nota">La mejor hora: las <strong>${String(mejor.hora).padStart(2, '0')}:00</strong>,
     con ${money(mejor.cents)}.</p>
  ${cmp ? leyenda({ comparado: etiquetaCmp }) : ''}`;
}

/** Los últimos meses, para ver si el negocio sube o baja. */
function porMes(meses) {
  if (!meses || meses.length === 0) return '';
  const mejor = meses.reduce((a, m) => (m.cents > a.cents ? m : a), meses[0]);
  if (mejor.cents === 0) return '';

  const items = meses.map((m) => ({
    etiqueta: monthLabel(m.mes).slice(0, 3),
    titulo: monthLabel(m.mes),
    filas: [
      ['Facturado', money(m.cents)],
      ['Servicios', String(m.count)],
      m.count > 0 ? ['Ticket medio', money(Math.round(m.cents / m.count))] : null,
    ],
    valor: m.cents,
    destacado: m === mejor,
  }));

  return `${barras(items, { alto: 130 })}
  <p class="grafica-nota">El mejor mes: <strong>${esc(monthLabel(mejor.mes))}</strong>,
     ${money(mejor.cents)}.</p>`;
}

module.exports = { barras, leyenda, porDia, porDiaSemana, porHora, porMes, DIAS_SEMANA, DIAS_CORTOS };
