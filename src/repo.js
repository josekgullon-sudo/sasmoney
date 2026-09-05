'use strict';

const { db, transaction } = require('./db');
const { calcCommission } = require('./commission');
const { addDays, todayISO } = require('./util');
const retention = require('./retention');
const threshold = require('./threshold');
const profit = require('./profit');
const expenses = require('./expenses');

/** ¿Cobra un porcentaje del beneficio de la empresa en vez de comisión? */
const cobraDelBeneficio = (worker) => worker && worker.commission_type === 'profit';

/**
 * Lo que ha facturado **todo el equipo** cada día del periodo.
 *
 * Hace falta para el umbral: los gastos del día se cubren entre todos, así que
 * cuenta lo que facturó cualquiera ese día, esté liquidado o no. Lo que pase
 * después con esos servicios no cambia lo que costó el día.
 */
function teamBillingByDay(from, to) {
  const filas = db
    .prepare(
      `SELECT service_date AS fecha, COALESCE(SUM(amount_cents), 0) AS total
         FROM entries WHERE service_date >= ? AND service_date <= ?
        GROUP BY service_date`
    )
    .all(from, to);
  return new Map(filas.map((f) => [f.fecha, f.total]));
}

/** Lo que facturó el equipo y lo que costó cada día que tocan estos servicios. */
function porDia(entries) {
  const fechas = entries.map((e) => e.service_date).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];
  return {
    equipoPorDia: teamBillingByDay(desde, hasta),
    costePorDia: expenses.costByDay(desde, hasta),
  };
}

/**
 * Lo que hay que pagarle a un trabajador por unos servicios, ya con la
 * retención aplicada. Todo el mundo pasa por aquí para que no se le olvide a
 * nadie: si se calculara la comisión a pelo, se pagaría de más.
 *
 * Si está puesto que sólo se comisiona por encima de los gastos del día, la
 * cuenta la lleva threshold.js, que necesita saber qué facturó el equipo y qué
 * costó cada uno de esos días.
 */
function commissionForEntries(worker, entries) {
  const retencion = retention.forEntries(worker, entries);
  const umbral = threshold.getThreshold();

  if (umbral.activo && entries.length > 0 && worker.commission_type === 'percent') {
    return threshold.calcConUmbral(worker, entries, {
      tramos: umbral.tramos,
      ...porDia(entries),
      retencion,
    });
  }

  return calcCommission(worker, {
    totalCents: entries.reduce((a, e) => a + e.amount_cents, 0),
    serviceCount: entries.length,
    retencion,
  });
}

/**
 * Lo mismo, buscando los servicios por su cuenta. Con el umbral puesto hace
 * falta la lista día a día, así que los totales sueltos ya no bastan.
 */
function commissionFor({ userId, from, to, pendingOnly = false, hastaHoy = false }) {
  const worker = getUser(userId);
  if (cobraDelBeneficio(worker)) return beneficioFor(worker, { from, to, pendingOnly, hastaHoy });
  return commissionForEntries(worker, listEntries({ userId, from, to, pendingOnly }));
}

/* --------------------------------------------- El reparto del beneficio
 *
 * Quien cobra un porcentaje del beneficio de la empresa no tiene servicios que
 * liquidar, así que lo que marca lo ya pagado son los **días**: los que ya
 * entraron en una liquidación suya no se vuelven a contar.
 */

/** Todos los días del periodo, del primero al último. */
function listDays(from, to) {
  const dias = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dias.push(d);
  return dias;
}

/** Los días del periodo que este trabajador todavía no tiene liquidados. */
function diasPendientes(userId, from, to) {
  const cerradas = db
    .prepare('SELECT period_from, period_to FROM settlements WHERE user_id = ?')
    .all(userId);
  return listDays(from, to).filter(
    (d) => !cerradas.some((c) => d >= c.period_from && d <= c.period_to)
  );
}

/** Lo que facturó el equipo cada hora de un día, para la gráfica del día. */
function teamBillingByHour(dia) {
  const filas = db
    .prepare(
      `SELECT CAST(SUBSTR(COALESCE(NULLIF(service_time, ''), '00:00'), 1, 2) AS INTEGER) AS hora,
              COALESCE(SUM(amount_cents), 0) AS total,
              COUNT(*) AS n
         FROM entries WHERE service_date = ?
        GROUP BY hora ORDER BY hora`
    )
    .all(dia);
  const porHora = new Map(filas.map((f) => [f.hora, f]));
  return Array.from({ length: 24 }, (_, hora) => ({
    hora,
    cents: porHora.has(hora) ? porHora.get(hora).total : 0,
    count: porHora.has(hora) ? porHora.get(hora).n : 0,
  }));
}

/** Suma de un Map(fecha → céntimos) sólo en los días que cuentan. */
function sumaDias(mapa, dias) {
  return dias.reduce((a, d) => a + (mapa.get(d) || 0), 0);
}

/**
 * Lo que hay que pagarle a quien cobra del beneficio.
 *
 * El beneficio es de la empresa entera: lo que factura el equipo más los otros
 * ingresos, menos todos los gastos y menos lo que cobran las trabajadoras. Se
 * suma el periodo **entero**, sin poner a cero los días malos: un día en
 * pérdidas resta de los buenos, porque eso es lo que gana de verdad el negocio.
 *
 * Y el periodo entero es **el que se está mirando**, con los gastos que aún no
 * han caído incluidos. Si miras el mes en marcha, él está en números rojos como
 * lo está la empresa: su cuenta no se cierra hasta que el mes acaba. Con
 * `hastaHoy` se corta en hoy, que es lo que hace el interruptor "Sólo hasta
 * hoy" del resumen, y así su cifra siempre cuadra con la de "Me queda".
 */
function beneficioFor(worker, { from, to, pendingOnly = false, hastaHoy = false }) {
  const tope = hastaHoy && to > todayISO() ? todayISO() : to;
  if (tope < from) return profit.calcReparto(worker, { dias: [], retencion: null });

  const dias = pendingOnly ? diasPendientes(worker.id, from, tope) : listDays(from, tope);
  if (dias.length === 0) {
    return profit.calcReparto(worker, { dias: [], retencion: null });
  }

  const cuentan = new Set(dias);
  const desde = dias[0];
  const hasta = dias[dias.length - 1];

  let facturadoCents = 0;
  let pagadoCents = 0;

  for (const otro of listWorkers({ includeInactive: true })) {
    const suyos = listEntries({ userId: otro.id, from: desde, to: hasta }).filter((e) =>
      cuentan.has(e.service_date)
    );
    if (suyos.length === 0) continue;

    facturadoCents += suyos.reduce((a, e) => a + e.amount_cents, 0);
    // Los demás socios cobran del mismo beneficio, así que no son un coste que
    // descontar antes de calcularlo: cada uno se lleva su parte de lo mismo.
    if (!cobraDelBeneficio(otro)) {
      pagadoCents += commissionForEntries(otro, suyos).commissionCents;
    }
  }

  return profit.calcReparto(worker, {
    facturadoCents,
    ingresosCents: sumaDias(expenses.costByDay(desde, hasta, 'in'), dias),
    gastosCents: sumaDias(expenses.costByDay(desde, hasta, 'out'), dias),
    pagadoCents,
    dias,
    retencion: retention.forDays(dias),
  });
}

/**
 * Selección común de servicios: añade el nombre del trabajador, el del pueblo
 * y una etiqueta automática para el cliente cuando el trabajador no escribió ninguna
 * ("Cliente 1", "Cliente 2"... según el orden de ese día).
 */
const ENTRY_SELECT = `
  SELECT e.*,
         u.name AS worker_name,
         t.name AS town_name,
         CASE
           WHEN TRIM(e.client_label) <> '' THEN e.client_label
           ELSE 'Cliente ' || ROW_NUMBER() OVER (PARTITION BY e.user_id, e.service_date ORDER BY e.id)
         END AS display_label
  FROM entries e
  JOIN users u ON u.id = e.user_id
  LEFT JOIN towns t ON t.id = e.town_id
`;

function listEntries({
  userId = null,
  from = null,
  to = null,
  toTime = null,
  townId = null,
  pendingOnly = false,
} = {}) {
  const where = [];
  const params = {};
  if (userId) {
    where.push('e.user_id = @userId');
    params.userId = userId;
  }
  if (from) {
    where.push('e.service_date >= @from');
    params.from = from;
  }
  if (to) {
    if (toTime) {
      // El último día se corta a una hora: los servicios de después no entran.
      // Si a alguno le faltara la hora, se cuenta como de primera hora del día.
      where.push(
        "(e.service_date < @to OR (e.service_date = @to AND COALESCE(NULLIF(e.service_time, ''), '00:00') <= @toTime))"
      );
      params.toTime = toTime;
    } else {
      where.push('e.service_date <= @to');
    }
    params.to = to;
  }
  if (townId) {
    where.push('e.town_id = @townId');
    params.townId = townId;
  }
  if (pendingOnly) where.push('e.settlement_id IS NULL');

  const sql = `SELECT * FROM (${ENTRY_SELECT}) AS e2
    ${where.length ? 'WHERE ' + where.join(' AND ').replace(/e\./g, 'e2.') : ''}
    ORDER BY e2.service_date DESC, e2.id DESC`;

  return db.prepare(sql).all(params);
}

function getEntry(id) {
  return db.prepare(`SELECT * FROM (${ENTRY_SELECT}) AS e2 WHERE e2.id = ?`).get(id);
}

function createEntry(data) {
  const info = db
    .prepare(
      `INSERT INTO entries (user_id, service_date, service_time, amount_cents, client_label, town_id, payment_method, notes)
       VALUES (@user_id, @service_date, @service_time, @amount_cents, @client_label, @town_id, @payment_method, @notes)`
    )
    .run(data);
  return Number(info.lastInsertRowid);
}

function updateEntry(id, data) {
  db.prepare(
    `UPDATE entries
        SET service_date = @service_date,
            service_time = @service_time,
            amount_cents = @amount_cents,
            client_label = @client_label,
            town_id = @town_id,
            payment_method = @payment_method,
            notes = @notes,
            user_id = COALESCE(@user_id, user_id),
            updated_at = datetime('now')
      WHERE id = @id AND settlement_id IS NULL`
  ).run({ ...data, id });
}

function deleteEntry(id) {
  db.prepare('DELETE FROM entries WHERE id = ? AND settlement_id IS NULL').run(id);
}

/**
 * Suma y número de servicios de un trabajador en un periodo, y cuánto de eso
 * cae dentro de la retención (los servicios a partir de su fecha de arranque).
 */
function totalsFor({ userId, from, to, pendingOnly = false }) {
  const desde = retention.getRetention().desde;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(amount_cents), 0) AS total,
              COALESCE(SUM(CASE WHEN service_date >= @desde THEN 1 ELSE 0 END), 0) AS afectadoCount,
              COALESCE(SUM(CASE WHEN service_date >= @desde THEN amount_cents ELSE 0 END), 0) AS afectadoCents
         FROM entries
        WHERE user_id = @userId AND service_date >= @from AND service_date <= @to
          ${pendingOnly ? 'AND settlement_id IS NULL' : ''}`
    )
    .get({ userId, from, to, desde });
  return {
    count: row.count,
    totalCents: row.total,
    afectadoCount: row.afectadoCount,
    afectadoCents: row.afectadoCents,
  };
}

function listWorkers({ includeInactive = false } = {}) {
  return db
    .prepare(
      `SELECT * FROM users WHERE role = 'worker' ${includeInactive ? '' : 'AND active = 1'} ORDER BY name COLLATE NOCASE`
    )
    .all();
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function listTowns({ includeInactive = false } = {}) {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM entries e WHERE e.town_id = t.id) AS entry_count
         FROM towns t ${includeInactive ? '' : 'WHERE t.active = 1'}
        ORDER BY t.name COLLATE NOCASE`
    )
    .all();
}

/** Último pueblo usado por un trabajador, para dejarlo preseleccionado. */
function lastTownId(userId) {
  const row = db
    .prepare(
      `SELECT town_id FROM entries WHERE user_id = ? AND town_id IS NOT NULL ORDER BY id DESC LIMIT 1`
    )
    .get(userId);
  return row ? row.town_id : null;
}

/** Importes que más repite un trabajador, para ofrecérselos como botones. */
function commonAmounts(userId, limit = 4) {
  return db
    .prepare(
      `SELECT amount_cents, COUNT(*) AS n
         FROM entries WHERE user_id = ?
        GROUP BY amount_cents ORDER BY n DESC, amount_cents DESC LIMIT ?`
    )
    .all(userId, limit)
    .map((r) => ({
      value: (r.amount_cents / 100).toFixed(2).replace('.', ','),
      label: `${(r.amount_cents / 100).toFixed(2).replace('.', ',')} €`,
    }));
}

/**
 * Calcula la liquidación de cada trabajador en un periodo.
 * Devuelve una fila por trabajador con sus servicios, totales y comisión.
 */
/**
 * Recorta la lista de servicios para que lo que hay que pagar no pase de un tope.
 *
 * Se cogen los más antiguos primero, que es lo justo: primero se salda lo que
 * lleva más tiempo debiéndose. Y se prueba servicio a servicio en lugar de
 * repartir el total, porque con tramos la comisión no es proporcional a cada
 * servicio: la única manera de saber lo que se paga por un grupo es calcularlo.
 */
function trimToAmount(worker, entries, maxCents) {
  const antiguosPrimero = [...entries].sort(
    (a, b) => a.service_date.localeCompare(b.service_date) || a.id - b.id
  );

  const dentro = [];
  for (const e of antiguosPrimero) {
    dentro.push(e);
    if (commissionForEntries(worker, dentro).commissionCents > maxCents) {
      dentro.pop();
      break;
    }
  }
  return dentro;
}

/**
 * Traduce el corte "hasta el día X a las Y" a lo que entiende listEntries.
 *
 * El corte es un **momento**, no "la hora del último día del periodo": si estás
 * mirando agosto entero y cortas hoy a las 16:00, se liquida desde el 1 hasta
 * hoy a las 16:00, no hasta el 31 a las 16:00. Confundir las dos cosas era
 * justo lo que hacía que el recorte no sirviera para nada.
 */
function aplicaCorte({ from, to, corte }) {
  if (!corte || !corte.fecha) return { to, toTime: null };
  if (corte.fecha > to) return { to, toTime: null }; // el corte cae fuera: no recorta
  return { to: corte.fecha, toTime: corte.hora || null };
}

/**
 * Lo que hay que pagarle a cada trabajador en un periodo.
 *
 * Además del periodo se puede recortar de dos maneras, para poder liquidar sólo
 * una parte: `corte` ({ fecha, hora }) para hasta cuándo, y `maxCents` para un
 * tope de lo que se paga. Lo que quede fuera sigue pendiente para otro día.
 */
function settlementRows({
  from,
  to,
  corte = null,
  maxCents = null,
  pendingOnly = true,
  includeEmpty = false,
  userId = null,
  hastaHoy = false,
}) {
  const hasta = aplicaCorte({ from, to, corte });
  // Con un trabajador elegido se enseña sólo el suyo, y aunque no tenga nada
  // pendiente: hay que poder ver que ya está todo liquidado.
  const workers = userId
    ? [getUser(userId)].filter((u) => u && u.role === 'worker')
    : listWorkers({ includeInactive: true });
  const rows = [];

  const conLimites = hasta.to !== to || Boolean(hasta.toTime) || maxCents !== null;

  for (const worker of workers) {
    // Quien cobra del beneficio no tiene servicios: su fila va por días, y el
    // corte de la hora no le afecta (el beneficio se cuenta por días enteros).
    if (cobraDelBeneficio(worker)) {
      const calc = beneficioFor(worker, { from, to: hasta.to, pendingOnly, hastaHoy });
      if (calc.commissionCents === 0 && !includeEmpty && calc.beneficio.diasCount === 0) continue;
      rows.push({
        user: worker,
        entries: [],
        count: 0,
        // Su facturación es cero: lo que gana no sale de servicios suyos, así
        // que no puede sumar al total facturado del periodo.
        totalCents: 0,
        calc,
        fueraCount: 0,
      });
      continue;
    }

    const todos = listEntries({
      userId: worker.id,
      from,
      to: hasta.to,
      toTime: hasta.toTime,
      pendingOnly,
    });
    const entries = maxCents === null ? todos : trimToAmount(worker, todos, maxCents);
    if (entries.length === 0 && !includeEmpty) continue;

    // Cuántos se quedan fuera contando los dos recortes, el de la hora y el del
    // tope, para poder avisar de que eso sigue debiéndose.
    const sinRecortar = conLimites
      ? listEntries({ userId: worker.id, from, to, pendingOnly }).length
      : entries.length;

    const totalCents = entries.reduce((a, e) => a + e.amount_cents, 0);
    const calc = commissionForEntries(worker, entries);
    rows.push({
      user: worker,
      entries,
      count: entries.length,
      totalCents,
      calc,
      fueraCount: sinRecortar - entries.length,
    });
  }

  rows.sort((a, b) => b.calc.commissionCents - a.calc.commissionCents);
  return rows;
}

/** Cierra la liquidación de un trabajador: guarda el resumen y marca sus servicios como pagados. */
const closeSettlement = transaction(({ worker, from, to, corte = null, maxCents = null, note = '' }) => {
  const hasta = aplicaCorte({ from, to, corte });

  if (cobraDelBeneficio(worker)) return cierraBeneficio({ worker, from, to: hasta.to, note });

  // Se cuenta lo pendiente ANTES de marcar nada: después ya estaría cerrado y
  // saldría que no queda nada fuera.
  const pendientesAntes = listEntries({ userId: worker.id, from, to, pendingOnly: true }).length;

  const todos = listEntries({
    userId: worker.id,
    from,
    to: hasta.to,
    toTime: hasta.toTime,
    pendingOnly: true,
  });
  const entries = maxCents === null ? todos : trimToAmount(worker, todos, maxCents);
  if (entries.length === 0) return null;

  const totalCents = entries.reduce((a, e) => a + e.amount_cents, 0);
  const calc = commissionForEntries(worker, entries);

  const info = db
    .prepare(
      `INSERT INTO settlements (user_id, period_from, period_to, entry_count, total_cents, commission_cents, rule_snapshot, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      worker.id,
      from,
      // Se guarda hasta dónde se liquidó de verdad, no el periodo que se estaba
      // mirando: si cortaste hoy a las 16:00, el periodo cerrado acaba hoy.
      hasta.to,
      entries.length,
      totalCents,
      calc.commissionCents,
      JSON.stringify({
        commission_type: worker.commission_type,
        commission_percent: worker.commission_percent,
        fixed_cents: worker.fixed_cents,
        tiers_json: worker.tiers_json,
        tier_mode: worker.tier_mode,
        profit_company_percent: worker.profit_company_percent,
        label: calc.label,
        breakdown: calc.breakdown,
        // Se guarda lo retenido para que la liquidación cerrada se explique sola
        // aunque luego se cambie el porcentaje.
        retention: retention.getRetention(),
        retention_cents: calc.retentionCents,
      }),
      note
    );

  const settlementId = Number(info.lastInsertRowid);
  const mark = db.prepare('UPDATE entries SET settlement_id = ? WHERE id = ?');
  for (const e of entries) mark.run(settlementId, e.id);

  return {
    settlementId,
    entryCount: entries.length,
    commissionCents: calc.commissionCents,
    fueraCount: pendientesAntes - entries.length,
  };
});

/**
 * Cierra la liquidación de quien cobra del beneficio.
 *
 * No hay servicios que marcar: lo que se guarda son los **días** que se pagan,
 * y son esos días los que no se vuelven a contar. Se guardan del primero al
 * último de los que quedaban pendientes; si por medio hubiera algún día ya
 * pagado, no pasa nada: ya estaba cubierto por su liquidación de entonces.
 */
function cierraBeneficio({ worker, from, to, note }) {
  const calc = beneficioFor(worker, { from, to, pendingOnly: true });
  const { dias, gananciaCents } = calc.beneficio;
  if (dias.length === 0) return null;

  const info = db
    .prepare(
      `INSERT INTO settlements (user_id, period_from, period_to, entry_count, total_cents, commission_cents, rule_snapshot, note)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
    )
    .run(
      worker.id,
      dias[0],
      dias[dias.length - 1],
      gananciaCents,
      calc.commissionCents,
      JSON.stringify({
        commission_type: worker.commission_type,
        profit_company_percent: worker.profit_company_percent,
        label: calc.label,
        breakdown: calc.breakdown,
        beneficio: { ...calc.beneficio, dias: undefined, diasCount: dias.length },
        retention: retention.getRetention(),
        retention_cents: calc.retentionCents,
      }),
      note
    );

  return {
    settlementId: Number(info.lastInsertRowid),
    entryCount: 0,
    diasCount: dias.length,
    commissionCents: calc.commissionCents,
    fueraCount: 0,
  };
}

function listSettlements({ userId = null, limit = 50 } = {}) {
  // Sólo se pasan los parámetros que la consulta usa de verdad.
  const params = userId ? { userId, limit } : { limit };
  return db
    .prepare(
      `SELECT s.*, u.name AS worker_name
         FROM settlements s JOIN users u ON u.id = s.user_id
        ${userId ? 'WHERE s.user_id = @userId' : ''}
        ORDER BY s.created_at DESC, s.id DESC LIMIT @limit`
    )
    .all(params);
}

module.exports = {
  cobraDelBeneficio,
  listDays,
  teamBillingByHour,
  commissionForEntries,
  commissionFor,
  beneficioFor,
  diasPendientes,
  teamBillingByDay,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  totalsFor,
  listWorkers,
  getUser,
  listTowns,
  lastTownId,
  commonAmounts,
  settlementRows,
  closeSettlement,
  listSettlements,
};
