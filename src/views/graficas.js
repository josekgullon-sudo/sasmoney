'use strict';

const { esc, formatDateShort } = require('../util');
const { money } = require('./common');

/**
 * Las gráficas del resumen: de un vistazo, cuáles son los mejores días.
 *
 * Están hechas con barras de HTML normales, no con un dibujo ni con ninguna
 * librería. Es a propósito: así los números son texto de verdad (se leen bien
 * en cualquier móvil, se pueden copiar y los lee un lector de pantalla), la
 * página no engorda ni un kilobyte y no hay nada que se pueda quedar en blanco
 * si falla una descarga.
 *
 * Cada barra es lo que se facturó. La rayita que la cruza es lo que costó ese
 * día: si la barra no llega a la rayita, ese día no se cubrieron los gastos y
 * se pinta en rojo. Es la misma idea que el umbral de las comisiones, vista de
 * un golpe.
 */

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTOS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/** El día de la semana de una fecha ISO, sin líos de zona horaria. */
function diaSemana(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/**
 * Una gráfica de barras.
 *
 * @param {Array} items  [{ etiqueta, titulo, valor, referencia, destacado }]
 *        `referencia` es la rayita del coste; puede faltar.
 */
function barras(items, { alto = 150 } = {}) {
  if (items.length === 0) return '';

  // La escala la manda el más alto de todo lo que se pinta, barra o rayita,
  // para que la rayita del coste nunca se salga por arriba.
  const tope = Math.max(1, ...items.map((i) => Math.max(i.valor, i.referencia || 0)));
  const pct = (v) => Math.max(0, Math.min(100, (v / tope) * 100));

  return `<div class="grafica" style="--alto:${alto}px">
    <div class="cols">
      ${items
        .map((i) => {
          const bajoCoste = i.referencia > 0 && i.valor < i.referencia;
          const clases = ['relleno', bajoCoste ? 'flojo' : '', i.destacado ? 'top' : '']
            .filter(Boolean)
            .join(' ');
          return `<div class="col" title="${esc(i.titulo || i.etiqueta)}">
        <div class="barra">
          <div class="${clases}" style="height:${pct(i.valor).toFixed(1)}%"></div>
          ${
            i.referencia > 0
              ? `<div class="coste" style="bottom:${pct(i.referencia).toFixed(1)}%"></div>`
              : ''
          }
        </div>
        <div class="etq">${esc(i.etiqueta)}</div>
      </div>`;
        })
        .join('')}
    </div>
  </div>`;
}

/** La leyenda, para que nadie tenga que adivinar qué es cada color. */
const leyenda = `<p class="grafica-leyenda">
  <span><i class="mu bien"></i> Cubre los gastos</span>
  <span><i class="mu flojo"></i> No los cubre</span>
  <span><i class="mu linea"></i> Lo que costó el día</span>
</p>`;

/**
 * Día a día del periodo: lo facturado por todo el equipo y lo que costó cada día.
 *
 * @param {Array} dias  [{ fecha, facturadoCents, costeCents }]
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

  const items = dias.map((d, i) => ({
    etiqueta: i % cada === 0 ? etiquetaDe(d.fecha) : '',
    titulo: `${formatDateShort(d.fecha)}: ${money(d.facturadoCents)} facturados, ${money(
      d.costeCents
    )} de gastos`,
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
  ${leyenda}`;
}

/**
 * Lo que se factura de media cada día de la semana. Es lo que contesta a
 * "¿qué días conviene abrir?": no vale sumar, porque de unos días de la semana
 * hay más que de otros en el periodo.
 */
function porDiaSemana(dias) {
  if (dias.length < 7) return '';

  const suma = new Array(7).fill(0);
  const cuenta = new Array(7).fill(0);
  for (const d of dias) {
    const n = diaSemana(d.fecha);
    suma[n] += d.facturadoCents;
    cuenta[n] += 1;
  }

  // Empieza en lunes, que es como se mira una semana aquí.
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const medias = orden.map((n) => ({
    n,
    media: cuenta[n] > 0 ? Math.round(suma[n] / cuenta[n]) : 0,
    veces: cuenta[n],
  }));

  const mejor = medias.reduce((a, m) => (m.media > a.media ? m : a), medias[0]);
  if (mejor.media === 0) return '';

  return `${barras(
    medias.map((m) => ({
      etiqueta: DIAS_CORTOS[m.n],
      titulo: `${DIAS_SEMANA[m.n]}: ${money(m.media)} de media (${m.veces} ${
        m.veces === 1 ? 'día' : 'días'
      })`,
      valor: m.media,
      destacado: m === mejor,
    })),
    { alto: 110 }
  )}
  <p class="grafica-nota">El mejor día de la semana es el <strong>${esc(
    DIAS_SEMANA[mejor.n].toLowerCase()
  )}</strong>: ${money(mejor.media)} de media.</p>`;
}

/** Las horas del día, para cuando se está mirando un solo día. */
function porHora(horas) {
  const conAlgo = horas.filter((h) => h.cents > 0);
  if (conAlgo.length === 0) return '';

  const desde = Math.max(0, Number(conAlgo[0].hora) - 1);
  const hasta = Math.min(23, Number(conAlgo[conAlgo.length - 1].hora) + 1);
  const dentro = horas.filter((h) => h.hora >= desde && h.hora <= hasta);

  const mejor = dentro.reduce((a, h) => (h.cents > a.cents ? h : a), dentro[0]);

  return `${barras(
    dentro.map((h) => ({
      etiqueta: String(h.hora),
      titulo: `A las ${String(h.hora).padStart(2, '0')}:00 · ${money(h.cents)} (${h.count} servicio(s))`,
      valor: h.cents,
      destacado: h === mejor,
    })),
    { alto: 110 }
  )}
  <p class="grafica-nota">La mejor hora fue las <strong>${String(mejor.hora).padStart(
    2,
    '0'
  )}:00</strong>, con ${money(mejor.cents)}.</p>`;
}

module.exports = { porDia, porDiaSemana, porHora };
