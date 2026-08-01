'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAdmin, hashPassword, destroyUserSessions } = require('../auth');
const repo = require('../repo');
const {
  calcCommission,
  parseAmountToCents,
  formatEuro,
  COMMISSION_TYPES,
} = require('../commission');
const { todayISO, currentMonth, monthRange, isValidDate, formatDate } = require('../util');
const expenses = require('../expenses');
const investment = require('../investment');
const cajaViews = require('../views/caja');
const views = require('../views/admin');
const { PAYMENT_METHODS, metodoLegible } = require('../views/worker');

const router = express.Router();
router.use(requireAdmin);

const METHODS = PAYMENT_METHODS.map(([v]) => v);

/* ------------------------------------------------------------------ Resumen */

router.get('/', (req, res) => {
  const month = validMonth(req.query.month);
  const { from, to } = monthRange(month);

  const base = repo.settlementRows({ from, to, pendingOnly: false }).map((r) => {
    const pending = repo.totalsFor({ userId: r.user.id, from, to, pendingOnly: true });
    const pendingCalc = calcCommission(r.user, {
      totalCents: pending.totalCents,
      serviceCount: pending.count,
    });
    return { ...r, pendingCommissionCents: pendingCalc.commissionCents };
  });

  const totals = base.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      totalCents: acc.totalCents + r.totalCents,
      commissionCents: acc.commissionCents + r.calc.commissionCents,
    }),
    { count: 0, totalCents: 0, commissionCents: 0 }
  );

  const gastosMes = expenses.monthExpenses(month, 'out');
  const ingresosMes = expenses.monthExpenses(month, 'in');
  const inversionCents = gastosMes.filter((g) => g.is_investment).reduce((a, g) => a + g.total_cents, 0);
  const otrosGastosCents = gastosMes.filter((g) => !g.is_investment).reduce((a, g) => a + g.total_cents, 0);

  const modo = investment.getMode();
  const rows = investment
    .split(inversionCents, base.sort((a, b) => b.totalCents - a.totalCents), modo)
    .map((r) => ({ ...r, repartoManual: modo === 'manual' }));

  const proximos = expenses.upcoming({ dias: 92, direction: 'out' });

  res.send(
    views.adminHome({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      month,
      rows,
      totals,
      pendingTotalCents: rows.reduce((a, r) => a + r.pendingCommissionCents, 0),
      inversionCents,
      otrosGastosCents,
      gastos: {
        totalCents: gastosMes.reduce((a, g) => a + g.total_cents, 0),
        pendientesCents: gastosMes.reduce((a, g) => a + g.pendiente_cents, 0),
        proximo: proximos[0] || null,
      },
      ingresos: { totalCents: ingresosMes.reduce((a, g) => a + g.total_cents, 0) },
    })
  );
});

// La rentabilidad ya vive dentro del resumen.
router.get('/rentabilidad', (req, res) => {
  const q = req.query.month ? `?month=${encodeURIComponent(String(req.query.month))}` : '';
  res.redirect(`/admin${q}`);
});

/* ------------------------------------------------------------- Liquidación */

/** Resuelve el periodo pedido: un mes completo o dos fechas sueltas. */
function resolvePeriod(query) {
  const monthParam = String(query.month || '');
  const fromParam = String(query.from || '');
  const toParam = String(query.to || '');

  if (!monthParam && isValidDate(fromParam) && isValidDate(toParam)) {
    return fromParam <= toParam
      ? { from: fromParam, to: toParam, month: '' }
      : { from: toParam, to: fromParam, month: '' };
  }
  const month = validMonth(monthParam);
  return { ...monthRange(month), month };
}

router.get('/liquidacion', (req, res) => {
  const { from, to, month } = resolvePeriod(req.query);
  const onlyPending = readOnlyPending(req.query);
  const workerId = req.query.worker ? Number(req.query.worker) : null;
  const worker = workerId ? repo.getUser(workerId) : null;
  const soloUno = Boolean(worker && worker.role === 'worker');

  const rows = repo.settlementRows({
    from,
    to,
    pendingOnly: onlyPending,
    userId: soloUno ? worker.id : null,
    // Con uno elegido se muestra siempre, para poder ver que ya está liquidado.
    includeEmpty: soloUno,
  });

  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      totalCents: acc.totalCents + r.totalCents,
      commissionCents: acc.commissionCents + r.calc.commissionCents,
      companyCents: acc.companyCents + r.calc.companyCents,
    }),
    { count: 0, totalCents: 0, commissionCents: 0, companyCents: 0 }
  );

  res.send(
    views.adminSettlement({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      from,
      to,
      month,
      onlyPending,
      rows,
      totals,
      workers: repo.listWorkers({ includeInactive: true }),
      workerId: soloUno ? worker.id : null,
      history: repo.listSettlements({ userId: soloUno ? worker.id : null, limit: 30 }),
    })
  );
});

router.post('/liquidacion/cerrar', (req, res) => {
  const worker = repo.getUser(Number(req.body.user_id));
  const from = String(req.body.from || '');
  const to = String(req.body.to || '');

  if (!worker || worker.role !== 'worker' || !isValidDate(from) || !isValidDate(to)) {
    res.flash('error', 'No he podido cerrar esa liquidación.');
    return res.redirect('/admin/liquidacion');
  }

  const result = repo.closeSettlement({ worker, from, to });
  if (!result) {
    res.flash('error', `${worker.name} no tiene nada pendiente en ese periodo.`);
  } else {
    res.flash(
      'ok',
      `Liquidación cerrada: ${worker.name}, ${result.entryCount} servicio(s), ${formatEuro(
        result.commissionCents
      )}.`
    );
  }
  res.redirect(`/admin/liquidacion?from=${from}&to=${to}&only_pending=1&worker=${worker.id}`);
});

router.get('/liquidacion.csv', (req, res) => {
  const { from, to } = resolvePeriod(req.query);
  const onlyPending = readOnlyPending(req.query);
  const workerId = req.query.worker ? Number(req.query.worker) : null;
  const rows = repo.settlementRows({ from, to, pendingOnly: onlyPending, userId: workerId });

  const lines = [['Trabajador', 'Servicios', 'Facturado', 'Regla', 'A pagar', 'Para la empresa']];
  for (const r of rows) {
    lines.push([
      r.user.name,
      r.count,
      euros(r.totalCents),
      r.calc.label,
      euros(r.calc.commissionCents),
      euros(r.calc.companyCents),
    ]);
  }
  sendCsv(res, `liquidacion_${from}_${to}.csv`, lines);
});

/* ------------------------------------------------------------ Trabajadores */

router.get('/trabajadores', (req, res) => {
  res.send(
    views.adminWorkers({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      workers: repo.listWorkers({ includeInactive: true }),
    })
  );
});

router.get('/trabajadores/nuevo', (req, res) => {
  res.send(
    views.adminWorkerForm({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      worker: null,
    })
  );
});

/** Lee la configuración de comisión que ha rellenado el jefe. */
function readCommission(body) {
  const commission_type = COMMISSION_TYPES.includes(body.commission_type)
    ? body.commission_type
    : 'percent';

  const percent = Math.min(100, Math.max(0, Number(String(body.commission_percent || '0').replace(',', '.')) || 0));
  const fixed_cents = parseAmountToCents(body.fixed_amount) || 0;

  const froms = [].concat(body.tier_from || []);
  const percents = [].concat(body.tier_percent || []);
  const tiers = [];
  for (let i = 0; i < Math.max(froms.length, percents.length); i++) {
    const min_cents = parseAmountToCents(froms[i]);
    const p = Number(String(percents[i] ?? '').replace(',', '.'));
    if (min_cents === null || !Number.isFinite(p)) continue;
    tiers.push({ min_cents, percent: Math.min(100, Math.max(0, p)) });
  }
  tiers.sort((a, b) => a.min_cents - b.min_cents);

  if (commission_type === 'tiers' && tiers.length === 0) {
    return { error: 'Añade al menos un tramo con su porcentaje.' };
  }

  return {
    data: {
      commission_type,
      commission_percent: percent,
      fixed_cents,
      tiers_json: JSON.stringify(tiers),
      tier_mode: body.tier_mode === 'progressive' ? 'progressive' : 'total',
    },
  };
}

router.post('/trabajadores', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !/^[a-z0-9._-]{3,}$/.test(username)) {
    res.flash('error', 'Revisa el nombre y el usuario (mínimo 3 caracteres, sin espacios).');
    return res.redirect('/admin/trabajadores/nuevo');
  }
  if (password.length < 6) {
    res.flash('error', 'La contraseña debe tener al menos 6 caracteres.');
    return res.redirect('/admin/trabajadores/nuevo');
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    res.flash('error', 'Ese usuario ya existe, elige otro.');
    return res.redirect('/admin/trabajadores/nuevo');
  }

  const { data, error } = readCommission(req.body);
  if (error) {
    res.flash('error', error);
    return res.redirect('/admin/trabajadores/nuevo');
  }

  db.prepare(
    `INSERT INTO users (username, name, password_hash, role, commission_type, commission_percent, fixed_cents, tiers_json, tier_mode)
     VALUES (@username, @name, @password_hash, 'worker', @commission_type, @commission_percent, @fixed_cents, @tiers_json, @tier_mode)`
  ).run({ username, name, password_hash: hashPassword(password), ...data });

  res.flash('ok', `${name} ya puede entrar con el usuario "${username}".`);
  res.redirect('/admin/trabajadores');
});

router.get('/trabajadores/:id', (req, res) => {
  const worker = repo.getUser(Number(req.params.id));
  if (!worker || worker.role !== 'worker') return res.status(404).send('Trabajador no encontrado.');
  res.send(
    views.adminWorkerForm({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      worker,
    })
  );
});

router.post('/trabajadores/:id', (req, res) => {
  const worker = repo.getUser(Number(req.params.id));
  if (!worker || worker.role !== 'worker') return res.status(404).send('Trabajador no encontrado.');

  const name = String(req.body.name || '').trim().slice(0, 80);
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !/^[a-z0-9._-]{3,}$/.test(username)) {
    res.flash('error', 'Revisa el nombre y el usuario.');
    return res.redirect(`/admin/trabajadores/${worker.id}`);
  }
  const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(username, worker.id);
  if (clash) {
    res.flash('error', 'Ese usuario ya está cogido.');
    return res.redirect(`/admin/trabajadores/${worker.id}`);
  }
  if (password && password.length < 6) {
    res.flash('error', 'La contraseña debe tener al menos 6 caracteres.');
    return res.redirect(`/admin/trabajadores/${worker.id}`);
  }

  const { data, error } = readCommission(req.body);
  if (error) {
    res.flash('error', error);
    return res.redirect(`/admin/trabajadores/${worker.id}`);
  }

  db.prepare(
    `UPDATE users SET name = @name, username = @username, active = @active,
            commission_type = @commission_type, commission_percent = @commission_percent,
            fixed_cents = @fixed_cents, tiers_json = @tiers_json, tier_mode = @tier_mode
      WHERE id = @id`
  ).run({ id: worker.id, name, username, active: req.body.active ? 1 : 0, ...data });

  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), worker.id);
    destroyUserSessions(worker.id);
  }

  res.flash('ok', 'Trabajador guardado.');
  res.redirect('/admin/trabajadores');
});

router.post('/trabajadores/:id/sesiones', (req, res) => {
  const worker = repo.getUser(Number(req.params.id));
  if (!worker || worker.role !== 'worker') return res.status(404).send('Trabajador no encontrado.');
  destroyUserSessions(worker.id);
  res.flash('ok', `Sesiones de ${worker.name} cerradas.`);
  res.redirect(`/admin/trabajadores/${worker.id}`);
});

/* ---------------------------------------------------------------- Servicios */

router.get('/servicios', (req, res) => {
  const month = validMonth(req.query.month);
  const { from, to } = monthRange(month);
  const worker = req.query.worker ? Number(req.query.worker) : null;

  const entries = repo.listEntries({ userId: worker || null, from, to });
  const qs = new URLSearchParams({
    month,
    ...(worker ? { worker: String(worker) } : {}),
  }).toString();

  res.send(
    views.adminEntries({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      entries,
      workers: repo.listWorkers({ includeInactive: true }),
      filters: { month, worker, qs },
      totalCents: entries.reduce((a, e) => a + e.amount_cents, 0),
      today: todayISO(),
    })
  );
});

router.get('/servicios.csv', (req, res) => {
  const month = validMonth(req.query.month);
  const { from, to } = monthRange(month);
  const entries = repo.listEntries({
    userId: req.query.worker ? Number(req.query.worker) : null,
    from,
    to,
  });

  const lines = [['Fecha', 'Trabajador', 'Cliente', 'Pago', 'Importe', 'Nota', 'Liquidado']];
  for (const e of entries) {
    lines.push([
      formatDate(e.service_date),
      e.worker_name,
      e.display_label,
      metodoLegible(e.payment_method),
      euros(e.amount_cents),
      e.notes,
      e.settlement_id ? 'Sí' : 'No',
    ]);
  }
  sendCsv(res, `servicios_${month}.csv`, lines);
});

router.post('/servicios', (req, res) => {
  const worker = repo.getUser(Number(req.body.user_id));
  if (!worker || worker.role !== 'worker') {
    res.flash('error', 'Elige un trabajador válido.');
    return res.redirect('/admin/servicios');
  }
  const { data, error } = readAdminEntryForm(req.body);
  if (error) {
    res.flash('error', error);
    return res.redirect('/admin/servicios');
  }

  repo.createEntry({ ...data, user_id: worker.id });
  res.flash('ok', `Apuntado ${formatEuro(data.amount_cents)} a ${worker.name}.`);
  res.redirect(`/admin/servicios?month=${data.service_date.slice(0, 7)}`);
});

router.get('/servicios/:id', (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado y no se puede modificar.');
    return res.redirect('/admin/servicios');
  }
  res.send(
    views.adminEntryForm({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      entry,
      workers: repo.listWorkers({ includeInactive: true }),
      today: todayISO(),
    })
  );
});

router.post('/servicios/:id', (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado y no se puede modificar.');
    return res.redirect('/admin/servicios');
  }

  const { data, error } = readAdminEntryForm(req.body);
  if (error) {
    res.flash('error', error);
    return res.redirect(`/admin/servicios/${entry.id}`);
  }

  const worker = repo.getUser(Number(req.body.user_id));
  repo.updateEntry(entry.id, {
    ...data,
    user_id: worker && worker.role === 'worker' ? worker.id : null,
  });
  res.flash('ok', 'Servicio actualizado.');
  res.redirect(`/admin/servicios?month=${data.service_date.slice(0, 7)}`);
});

router.post('/servicios/:id/borrar', (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado y no se puede borrar.');
    return res.redirect('/admin/servicios');
  }
  repo.deleteEntry(entry.id);
  res.flash('ok', 'Servicio borrado.');
  res.redirect('/admin/servicios');
});

/* -------------------------------------------------------------------- Caja */

/** Lee y valida el formulario de un gasto o ingreso. */
function readMovementForm(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return { error: 'Ponle un concepto.' };

  const amount_cents = parseAmountToCents(body.amount);
  if (amount_cents === null) return { error: 'Escribe un importe válido, por ejemplo 20 o 20,50.' };
  if (amount_cents === 0) return { error: 'El importe no puede ser 0 €.' };

  const kind = expenses.KINDS.includes(body.kind) ? body.kind : 'monthly';
  const anchor_date = String(body.anchor_date || '').trim();
  if (!isValidDate(anchor_date)) return { error: 'La fecha no es válida.' };

  return {
    data: {
      name,
      amount_cents,
      kind,
      anchor_date,
      notes: String(body.notes || '').trim().slice(0, 200),
      is_investment: body.is_investment ? 1 : 0,
    },
  };
}

router.get('/caja', (req, res) => {
  const month = validMonth(req.query.month);

  const conMes = (direction) => {
    const delMes = expenses.monthExpenses(month, direction);
    const porId = new Map(delMes.map((g) => [g.id, g]));
    return {
      delMes,
      todos: expenses.listExpenses({ direction }).map((g) => ({ ...g, esteMes: porId.get(g.id) || null })),
      proximos: expenses.upcoming({ dias: 92, direction }),
      totalCents: delMes.reduce((a, g) => a + g.total_cents, 0),
    };
  };

  const gastos = conMes('out');
  const ingresos = conMes('in');
  const inversionCents = gastos.delMes
    .filter((g) => g.is_investment)
    .reduce((a, g) => a + g.total_cents, 0);

  const { from, to } = monthRange(month);
  const servicios = repo.settlementRows({ from, to, pendingOnly: false });
  const facturadoCents = servicios.reduce((a, r) => a + r.totalCents, 0);
  const comisionesCents = servicios.reduce((a, r) => a + r.calc.commissionCents, 0);

  const editando = req.query.editar ? expenses.getExpense(Number(req.query.editar)) : null;

  res.send(
    cajaViews.adminCaja({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      month,
      hoy: todayISO(),
      gastos,
      ingresos,
      totales: {
        entraCents: facturadoCents + ingresos.totalCents,
        gastosCents: gastos.totalCents,
        inversionCents,
        quedaCents: facturadoCents + ingresos.totalCents - comisionesCents - gastos.totalCents,
      },
      editando,
      diasAjustados: editando ? expenses.listDayAmounts(editando.id, month) : [],
      workers: repo.listWorkers({ includeInactive: true }),
      reparto: investment.getMode(),
    })
  );
});

router.post('/caja', (req, res) => {
  const direction = req.body.direction === 'in' ? 'in' : 'out';
  const { data, error } = readMovementForm(req.body);
  if (error) {
    res.flash('error', error);
    return res.redirect('/admin/caja');
  }
  // Un ingreso nunca es "inversión": eso es cosa de los gastos.
  expenses.createExpense({ ...data, direction, is_investment: direction === 'in' ? 0 : data.is_investment });
  res.flash('ok', `"${data.name}" añadido.`);
  res.redirect('/admin/caja');
});

router.post('/caja/reparto', (req, res) => {
  investment.setMode(req.body.reparto);

  const ids = [].concat(req.body.worker_id || []);
  const shares = [].concat(req.body.share || []);
  investment.setShares(
    ids.map((id, i) => ({
      id: Number(id),
      share: Number(String(shares[i] ?? '0').replace(',', '.')),
    }))
  );

  res.flash(
    'ok',
    investment.getMode() === 'manual'
      ? 'Reparto guardado: la inversión se reparte con los porcentajes que has puesto.'
      : 'Reparto guardado: la inversión se reparte según lo que factura cada uno.'
  );
  res.redirect('/admin/caja');
});

router.post('/caja/:id', (req, res) => {
  const mov = expenses.getExpense(Number(req.params.id));
  if (!mov) return res.status(404).send('No encontrado.');

  const { data, error } = readMovementForm(req.body);
  if (error) {
    res.flash('error', error);
    return res.redirect(`/admin/caja?editar=${mov.id}`);
  }
  expenses.updateExpense(mov.id, {
    ...data,
    is_investment: mov.direction === 'in' ? 0 : data.is_investment,
    active: req.body.active ? 1 : 0,
  });
  res.flash('ok', 'Guardado.');
  res.redirect('/admin/caja');
});

/** Cambia (o devuelve al normal) el importe de un día suelto. */
router.post('/caja/:id/dia', (req, res) => {
  const mov = expenses.getExpense(Number(req.params.id));
  if (!mov) return res.status(404).send('No encontrado.');

  const month = validMonth(req.body.month);
  const day = String(req.body.day || '').trim();
  const volver = `/admin/caja?editar=${mov.id}&month=${month}`;

  if (!isValidDate(day)) {
    res.flash('error', 'La fecha no es válida.');
    return res.redirect(volver);
  }

  if (req.body.quitar) {
    expenses.setDayAmount(mov.id, day, null);
    res.flash('ok', `El ${formatDate(day)} vuelve al importe de siempre.`);
    return res.redirect(volver);
  }

  const amount_cents = parseAmountToCents(req.body.amount);
  if (amount_cents === null) {
    res.flash('error', 'Escribe un importe válido.');
    return res.redirect(volver);
  }

  expenses.setDayAmount(mov.id, day, amount_cents);
  res.flash('ok', `El ${formatDate(day)} queda en ${formatEuro(amount_cents)}.`);
  res.redirect(volver);
});

router.post('/caja/:id/borrar', (req, res) => {
  const mov = expenses.getExpense(Number(req.params.id));
  if (!mov) return res.status(404).send('No encontrado.');
  expenses.deleteExpense(mov.id);
  res.flash('ok', `"${mov.name}" borrado.`);
  res.redirect('/admin/caja');
});

// Las pantallas separadas de antes llevan a la nueva.
router.get(['/gastos', '/ingresos'], (req, res) => {
  const q = req.query.month ? `?month=${encodeURIComponent(String(req.query.month))}` : '';
  res.redirect(`/admin/caja${q}`);
});

/* ------------------------------------------------------------------ Ayudas */

function readAdminEntryForm(body) {
  const today = todayISO();
  const amount_cents = parseAmountToCents(body.amount);
  if (amount_cents === null || amount_cents === 0) return { error: 'Escribe un importe válido.' };

  let service_date = String(body.service_date || '').trim() || today;
  if (!isValidDate(service_date)) service_date = today;

  return {
    data: {
      amount_cents,
      service_date,
      town_id: null,
      client_label: String(body.client_label || '').trim().slice(0, 80),
      payment_method: METHODS.includes(body.payment_method) ? body.payment_method : 'efectivo',
      notes: String(body.notes || '').trim().slice(0, 200),
    },
  };
}

/**
 * La casilla "sólo lo pendiente" viaja junto a un campo oculto con valor 0,
 * así que puede llegar como '0', como '1' o como ['0','1']: manda el último.
 * Si no llega nada (primera visita), se cuenta sólo lo pendiente.
 */
function readOnlyPending(query) {
  const raw = query.only_pending;
  if (raw === undefined) return true;
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  return String(value) === '1';
}

function validMonth(value) {
  const m = String(value || '');
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : currentMonth();
}

/** Importe en formato español, listo para abrir el CSV con Excel. */
function euros(cents) {
  return (Math.round(cents) / 100).toFixed(2).replace('.', ',');
}

function sendCsv(res, filename, lines) {
  const body = lines
    .map((cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body); // BOM para que Excel respete los acentos.
}

module.exports = router;
