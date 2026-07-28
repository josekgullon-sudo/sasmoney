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
const views = require('../views/admin');
const { PAYMENT_METHODS, metodoLegible } = require('../views/worker');

const router = express.Router();
router.use(requireAdmin);

const METHODS = PAYMENT_METHODS.map(([v]) => v);

/* ------------------------------------------------------------------ Resumen */

router.get('/', (req, res) => {
  const month = validMonth(req.query.month);
  const { from, to } = monthRange(month);

  const rows = repo.settlementRows({ from, to, pendingOnly: false }).map((r) => {
    const pending = repo.totalsFor({ userId: r.user.id, from, to, pendingOnly: true });
    const pendingCalc = calcCommission(r.user, {
      totalCents: pending.totalCents,
      serviceCount: pending.count,
    });
    return { ...r, pendingCommissionCents: pendingCalc.commissionCents };
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

  const delMes = expenses.monthExpenses(month, 'out');
  const hoy = todayISO();
  const proximos = expenses.upcoming({ dias: 92, direction: 'out' });
  const ingresosMes = expenses.monthExpenses(month, 'in');

  res.send(
    views.adminHome({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      month,
      rows: rows.sort((a, b) => b.totalCents - a.totalCents),
      totals,
      pendingTotalCents: rows.reduce((a, r) => a + r.pendingCommissionCents, 0),
      gastos: {
        delMes,
        totalCents: delMes.reduce((a, g) => a + g.amount_cents, 0),
        pendientesCents: delMes.filter((g) => g.fecha > hoy).reduce((a, g) => a + g.amount_cents, 0),
        proximo: proximos[0] || null,
      },
      ingresos: {
        delMes: ingresosMes,
        totalCents: ingresosMes.reduce((a, g) => a + g.amount_cents, 0),
      },
    })
  );
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

/* ------------------------------------------------------------------- Gastos */

/** Lee y valida el formulario de un gasto. */
function readExpenseForm(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return { error: 'Ponle un concepto al gasto.' };

  const amount_cents = parseAmountToCents(body.amount);
  if (amount_cents === null) return { error: 'Escribe un importe válido, por ejemplo 120 o 120,50.' };
  if (amount_cents === 0) return { error: 'El importe no puede ser 0 €.' };

  const kind = expenses.KINDS.includes(body.kind) ? body.kind : 'monthly';
  const anchor_date = String(body.anchor_date || '').trim();
  if (!isValidDate(anchor_date)) return { error: 'La fecha no es válida.' };

  return {
    data: { name, amount_cents, kind, anchor_date, notes: String(body.notes || '').trim().slice(0, 200) },
  };
}

/**
 * Gastos e ingresos comparten pantalla y rutas: sólo cambia la dirección del
 * dinero y las palabras. Así no hay dos copias de lo mismo que mantener.
 */
function montarMovimientos(direction) {
  // Ruta dentro del router, que ya cuelga de /admin.
  const ruta = direction === 'in' ? '/ingresos' : '/gastos';
  const url = `/admin${ruta}`;
  const palabra = direction === 'in' ? 'Ingreso' : 'Gasto';

  router.get(ruta, (req, res) => {
    const month = validMonth(req.query.month);
    const delMes = expenses.monthExpenses(month, direction);
    const proximos = expenses.upcoming({ dias: 92, direction });

    // A cada apunte se le calcula cuándo toca el siguiente.
    const todos = expenses.listExpenses({ direction }).map((g) => ({
      ...g,
      proximo: g.active ? expenses.nextDate(g) : null,
    }));

    // Sólo se abre para editar si es de esta pantalla: un gasto no se edita
    // desde ingresos ni al revés.
    const pedido = req.query.editar ? expenses.getExpense(Number(req.query.editar)) : null;
    const editar = pedido && pedido.direction === direction ? pedido : null;

    res.send(
      views.adminExpenses({
        user: req.user,
        flash: res.locals.flash,
        warning: res.locals.warning,
        month,
        direction,
        expenses: todos,
        delMes,
        totalMesCents: delMes.reduce((a, g) => a + g.amount_cents, 0),
        proximos,
        editando: editar,
        hoy: todayISO(),
      })
    );
  });

  router.post(ruta, (req, res) => {
    const { data, error } = readExpenseForm(req.body);
    if (error) {
      res.flash('error', error);
      return res.redirect(url);
    }
    expenses.createExpense({ ...data, direction });
    res.flash('ok', `${palabra} "${data.name}" añadido.`);
    res.redirect(url);
  });

  router.post(`${ruta}/:id`, (req, res) => {
    const mov = expenses.getExpense(Number(req.params.id));
    if (!mov || mov.direction !== direction) return res.status(404).send('No encontrado.');

    const { data, error } = readExpenseForm(req.body);
    if (error) {
      res.flash('error', error);
      return res.redirect(`${url}?editar=${mov.id}`);
    }
    expenses.updateExpense(mov.id, { ...data, active: req.body.active ? 1 : 0 });
    res.flash('ok', `${palabra} guardado.`);
    res.redirect(url);
  });

  router.post(`${ruta}/:id/borrar`, (req, res) => {
    const mov = expenses.getExpense(Number(req.params.id));
    if (!mov || mov.direction !== direction) return res.status(404).send('No encontrado.');
    expenses.deleteExpense(mov.id);
    res.flash('ok', `${palabra} "${mov.name}" borrado.`);
    res.redirect(url);
  });
}

montarMovimientos('out');
montarMovimientos('in');

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
