'use strict';

const { db, transaction } = require('./db');
const { calcCommission } = require('./commission');
const retention = require('./retention');

/**
 * Lo que hay que pagarle a un trabajador por unos servicios, ya con la
 * retención aplicada. Todo el mundo pasa por aquí para que no se le olvide a
 * nadie: si se calculara la comisión a pelo, se pagaría de más.
 */
function commissionForEntries(worker, entries) {
  return calcCommission(worker, {
    totalCents: entries.reduce((a, e) => a + e.amount_cents, 0),
    serviceCount: entries.length,
    retencion: retention.forEntries(worker, entries),
  });
}

/** Igual, pero partiendo de los totales de totalsFor en lugar de la lista. */
function commissionForTotals(worker, totals) {
  return calcCommission(worker, {
    totalCents: totals.totalCents,
    serviceCount: totals.count,
    retencion: retention.forTotals(worker, totals),
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

function listEntries({ userId = null, from = null, to = null, townId = null, pendingOnly = false } = {}) {
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
    where.push('e.service_date <= @to');
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
function settlementRows({ from, to, pendingOnly = true, includeEmpty = false, userId = null }) {
  // Con un trabajador elegido se enseña sólo el suyo, y aunque no tenga nada
  // pendiente: hay que poder ver que ya está todo liquidado.
  const workers = userId
    ? [getUser(userId)].filter((u) => u && u.role === 'worker')
    : listWorkers({ includeInactive: true });
  const rows = [];

  for (const worker of workers) {
    const entries = listEntries({ userId: worker.id, from, to, pendingOnly });
    if (entries.length === 0 && !includeEmpty) continue;

    const totalCents = entries.reduce((a, e) => a + e.amount_cents, 0);
    const calc = commissionForEntries(worker, entries);
    rows.push({ user: worker, entries, count: entries.length, totalCents, calc });
  }

  rows.sort((a, b) => b.calc.commissionCents - a.calc.commissionCents);
  return rows;
}

/** Cierra la liquidación de un trabajador: guarda el resumen y marca sus servicios como pagados. */
const closeSettlement = transaction(({ worker, from, to, note = '' }) => {
  const entries = listEntries({ userId: worker.id, from, to, pendingOnly: true });
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
      to,
      entries.length,
      totalCents,
      calc.commissionCents,
      JSON.stringify({
        commission_type: worker.commission_type,
        commission_percent: worker.commission_percent,
        fixed_cents: worker.fixed_cents,
        tiers_json: worker.tiers_json,
        tier_mode: worker.tier_mode,
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

  return { settlementId, entryCount: entries.length, commissionCents: calc.commissionCents };
});

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
  commissionForEntries,
  commissionForTotals,
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
