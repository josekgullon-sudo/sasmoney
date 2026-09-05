'use strict';

const { calcRetention, retentionLabel, formatEuro, fmtPercent, profitShares } = require('./commission');

/**
 * El trabajador que cobra un porcentaje **del beneficio de toda la empresa**.
 *
 * No es un comisionista: no cobra por los clientes que hace él (puede no hacer
 * ninguno). Cobra un porcentaje de lo que le queda limpio al negocio entero
 * después de pagar todo:
 *
 *     lo que factura el equipo
 *   + los otros ingresos de la caja
 *   − todos los gastos (con su IVA y repartidos por días)
 *   − lo que cobran las trabajadoras
 *   ─────────────────────────────────
 *   = beneficio, que se parte entre la empresa y él
 *
 * Dos cosas que lo separan del resto de reglas:
 *
 *  - **Los días malos restan.** Aquí no se mira día a día poniendo un cero
 *    cuando no se cubren gastos: se suma el periodo entero, porque eso es lo
 *    que gana de verdad la empresa. Si el total sale negativo no cobra nada,
 *    pero tampoco pone dinero: la pérdida es de la empresa.
 *  - **No tiene servicios que liquidar**, así que lo que marca lo ya pagado no
 *    son los servicios sino los **días**: los que ya entraron en una
 *    liquidación suya no se vuelven a contar.
 */

/**
 * @param {object} worker    Su ficha (de ahí sale el reparto).
 * @param {object} datos     Lo que ha pasado en los días que se cuentan:
 *        facturadoCents  lo que ha facturado el equipo entero
 *        ingresosCents   otros ingresos de la caja
 *        gastosCents     todos los gastos, con IVA
 *        pagadoCents     lo que cobran las trabajadoras por esos días
 *        dias            los días contados (para explicarlo en pantalla)
 *        retencion       la retención, o null
 */
function calcReparto(worker, { facturadoCents = 0, ingresosCents = 0, gastosCents = 0, pagadoCents = 0, dias = [], retencion = null }) {
  const { empresa, trabajador } = profitShares(worker);

  const gananciaCents = facturadoCents + ingresosCents - gastosCents - pagadoCents;
  // En pérdidas no cobra, pero tampoco paga: el agujero es de la empresa.
  const suyoCents = gananciaCents > 0 ? Math.round((gananciaCents * trabajador) / 100) : 0;

  const breakdown = [
    { concept: 'Ha facturado el equipo', amountCents: facturadoCents },
  ];
  if (ingresosCents !== 0) breakdown.push({ concept: 'Otros ingresos', amountCents: ingresosCents });
  breakdown.push(
    { concept: 'Gastos (con IVA)', amountCents: -gastosCents },
    { concept: 'Lo que cobran las trabajadoras', amountCents: -pagadoCents },
    {
      concept:
        gananciaCents > 0
          ? `La empresa se queda el ${fmtPercent(empresa)} de los ${formatEuro(gananciaCents)} de beneficio`
          : 'No hay beneficio que repartir en estos días',
      amountCents: suyoCents - gananciaCents,
    }
  );

  const retentionCents = calcRetention(retencion, suyoCents);
  if (retentionCents > 0) {
    breakdown.push({ concept: retentionLabel(retencion), amountCents: -retentionCents });
  }

  return {
    grossCommissionCents: suyoCents,
    retentionCents,
    commissionCents: suyoCents - retentionCents,
    // Lo que le queda a la empresa del beneficio, ya descontado lo suyo.
    companyCents: gananciaCents - suyoCents + retentionCents,
    label: `${fmtPercent(trabajador)} del beneficio de la empresa`,
    breakdown,
    capped: false,
    beneficio: {
      facturadoCents,
      ingresosCents,
      gastosCents,
      pagadoCents,
      gananciaCents,
      suyoCents,
      percent: trabajador,
      empresaPercent: empresa,
      dias,
      diasCount: dias.length,
      desde: dias.length ? dias[0] : '',
      hasta: dias.length ? dias[dias.length - 1] : '',
    },
  };
}

module.exports = { calcReparto };
