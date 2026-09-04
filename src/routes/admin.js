'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAdmin, hashPassword, destroyUserSessions } = require('../auth');
const repo = require('../repo');
const { parseAmountToCents, formatEuro, fmtPercent, COMMISSION_TYPES } = require('../commission');
const { todayISO, nowHM, isValidTime, isValidDate, formatDate, monthRange, monthLabel } = require('../util');
const { resolvePeriod, periodQuery, readVista, validMonth } = require('../period');
const expenses = require('../expenses');
const investment = require('../investment');
const retention = require('../retention');
const threshold = require('../threshold');
const cajaViews = require('../views/caja');
const calendarioViews = require('../views/calendario');
const views = require('../views/admin');
const { PAYMENT_METHODS, metodoLegible } = require('../views/worker');

const router = express.Router();
router.use(requireAdmin);

const METHODS = PAYMENT_METHODS.map(([v]) => v);

/* ------------------------------------------------------------------ Resumen */

router.get('/', (req, res) => {
  const periodo = resolvePeriod(req.query);
  const { from, to } = periodo;

  // Se incluyen todos los trabajadores en activo, hayan facturado o no: los
  // gastos generales se reparten entre todos y la cuenta tiene que cuadrar.
  const base = repo
    .settlementRows({ from, to, pendingOnly: false, includeEmpty: true })
    .filter((r) => r.user.active || r.count > 0)
    .map((r) => {
    const pendingCalc = repo.commissionFor({ userId: r.user.id, from, to, pendingOnly: true });
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

  const gastosMes = expenses.rangeSummary({ from, to, direction: 'out' });
  const ingresosMes = expenses.rangeSummary({ from, to, direction: 'in' });

  // Con el periodo aún en marcha se puede mirar de dos maneras: el periodo
  // entero (con lo que falta por caer) o sólo lo que ya ha corrido.
  const vista = readVista(req.query);
  const cifra = (x) => (vista === 'hastahoy' ? x.hastaHoyCents : x.totalCents);
  const inversionCents = cifra(gastosMes.inversion);
  const otrosGastosCents = cifra(gastosMes.otros);
  const gastosCents = cifra(gastosMes);
  const ingresosCents = cifra(ingresosMes);

  const ordenadas = base.sort((a, b) => b.totalCents - a.totalCents);

  // Cada trabajador carga con su porcentaje de la publicidad del periodo.
  const reparto = investment.split(inversionCents, ordenadas);

  // El resto de gastos (alquiler, gestoría...) va a partes iguales.
  const porIgual = investment.splitEqually(otrosGastosCents, ordenadas);

  const rows = reparto.rows.map((r) => {
    const generales = porIgual.get(r.user.id) || 0;
    return {
      ...r,
      gastosGeneralesCents: generales,
      gastosTotalesCents: r.inversionCents + generales,
      beneficioCents: r.beneficioCents - generales,
    };
  });

  const proximos = expenses.upcoming({ dias: 92, direction: 'out' });

  res.send(
    views.adminHome({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      periodo,
      vista,
      rows,
      totals,
      pendingTotalCents: rows.reduce((a, r) => a + r.pendingCommissionCents, 0),
      inversion: { ...gastosMes.inversion, cents: inversionCents },
      inversionSinAsignarCents: reparto.sinAsignarCents,
      otrosGastos: { ...gastosMes.otros, cents: otrosGastosCents },
      trabajadoresActivos: ordenadas.filter((r) => r.user.active).length,
      gastos: {
        cents: gastosCents,
        totalCents: gastosMes.totalCents,
        hastaHoyCents: gastosMes.hastaHoyCents,
        pendientesCents: gastosMes.pendienteCents,
        proximo: proximos[0] || null,
      },
      ingresos: { ...ingresosMes, cents: ingresosCents },
    })
  );
});

// La rentabilidad ya vive dentro del resumen.
router.get('/rentabilidad', (req, res) => {
  res.redirect(`/admin?${periodQuery(resolvePeriod(req.query))}`);
});

/* ------------------------------------------------------------- Liquidación */

router.get('/liquidacion', (req, res) => {
  const periodo = resolvePeriod(req.query);
  const { from, to } = periodo;
  const onlyPending = readOnlyPending(req.query);
  const limites = readLimites(req.query);
  const workerId = req.query.worker ? Number(req.query.worker) : null;
  const worker = workerId ? repo.getUser(workerId) : null;
  const soloUno = Boolean(worker && worker.role === 'worker');

  const rows = repo.settlementRows({
    from,
    to,
    ...limites,
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
      periodo,
      from,
      to,
      onlyPending,
      limites,
      hoy: todayISO(),
      ahora: nowHM(),
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
  const limites = readLimites(req.body);

  if (!worker || worker.role !== 'worker' || !isValidDate(from) || !isValidDate(to)) {
    res.flash('error', 'No he podido cerrar esa liquidación.');
    return res.redirect('/admin/liquidacion');
  }

  const result = repo.closeSettlement({ worker, from, to, ...limites, note: notaDe(limites) });
  if (!result) {
    res.flash(
      'error',
      limites.maxCents !== null
        ? `Con ese tope no cabe ni un servicio de ${worker.name}: sube el importe.`
        : `${worker.name} no tiene nada pendiente en ese periodo.`
    );
  } else {
    res.flash(
      'ok',
      `Liquidación cerrada: ${worker.name}, ${result.entryCount} servicio(s), ${formatEuro(
        result.commissionCents
      )}.` + (result.fueraCount > 0 ? ` Le quedan ${result.fueraCount} servicio(s) sin liquidar.` : '')
    );
  }

  const qs = new URLSearchParams({ from, to, only_pending: '1', worker: String(worker.id) });
  res.redirect(`/admin/liquidacion?${qs}`);
});

router.get('/liquidacion.csv', (req, res) => {
  const { from, to } = resolvePeriod(req.query);
  const onlyPending = readOnlyPending(req.query);
  const workerId = req.query.worker ? Number(req.query.worker) : null;
  const rows = repo.settlementRows({
    from,
    to,
    ...readLimites(req.query),
    pendingOnly: onlyPending,
    userId: workerId,
  });

  const lines = [
    ['Trabajador', 'Servicios', 'Facturado', 'Regla', 'Comisión', 'Retenido', 'A pagar', 'Para la empresa'],
  ];
  for (const r of rows) {
    lines.push([
      r.user.name,
      r.count,
      euros(r.totalCents),
      r.calc.label,
      euros(r.calc.grossCommissionCents),
      euros(r.calc.retentionCents),
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
      retencion: retention.getRetention(),
      umbral: threshold.getThreshold(),
    })
  );
});

/** Comisionar sólo por encima de los gastos del día, y con qué escalera. */
router.post('/umbral', (req, res) => {
  const desde = [].concat(req.body.tramo_desde || []);
  const puntos = [].concat(req.body.tramo_puntos || []);

  const tramos = [];
  for (let i = 0; i < Math.max(desde.length, puntos.length); i++) {
    const min_cents = parseAmountToCents(desde[i]);
    const p = Number(String(puntos[i] ?? '').replace(',', '.'));
    if (min_cents === null || !Number.isFinite(p)) continue;
    tramos.push({ min_cents, puntos: Math.max(0, p) });
  }

  const activo = Boolean(req.body.activo);
  threshold.setThreshold({ activo, tramos });

  const puesto = threshold.getThreshold();
  res.flash(
    'ok',
    activo
      ? `Guardado: se comisiona por encima de los gastos del día, con ${puesto.tramos.length} tramo(s).`
      : 'Guardado: se vuelve a comisionar sobre todo lo facturado, sin umbral.'
  );
  res.redirect('/admin/trabajadores');
});

/** La retención que se le quita a lo que cobran, y desde cuándo. */
router.post('/retencion', (req, res) => {
  const desde = String(req.body.desde || '').trim();
  if (!isValidDate(desde)) {
    res.flash('error', 'La fecha de la retención no es válida.');
    return res.redirect('/admin/trabajadores');
  }
  const percent = Number(String(req.body.percent || '').replace(',', '.'));
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    res.flash('error', 'El porcentaje de retención tiene que estar entre 0 y 100.');
    return res.redirect('/admin/trabajadores');
  }

  retention.setRetention({ percent, desde });
  const puesta = retention.getRetention();
  res.flash(
    'ok',
    puesta.percent > 0
      ? `Retención guardada: ${fmtPercent(puesta.percent)} de los servicios desde el ${formatDate(puesta.desde)}.`
      : 'Retención desactivada: los trabajadores cobran su comisión entera.'
  );
  res.redirect('/admin/trabajadores');
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
  const periodo = resolvePeriod(req.query);
  const worker = req.query.worker ? Number(req.query.worker) : null;

  const entries = repo.listEntries({ userId: worker || null, from: periodo.from, to: periodo.to });

  res.send(
    views.adminEntries({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      entries,
      workers: repo.listWorkers({ includeInactive: true }),
      periodo,
      filters: { worker, qs: periodQuery(periodo, { worker }) },
      totalCents: entries.reduce((a, e) => a + e.amount_cents, 0),
      today: todayISO(),
      ahora: nowHM(),
    })
  );
});

router.get('/servicios.csv', (req, res) => {
  const periodo = resolvePeriod(req.query);
  const { from, to } = periodo;
  const entries = repo.listEntries({
    userId: req.query.worker ? Number(req.query.worker) : null,
    from,
    to,
  });

  const lines = [['Fecha', 'Hora', 'Trabajador', 'Cliente', 'Pago', 'Importe', 'Nota', 'Liquidado']];
  for (const e of entries) {
    lines.push([
      formatDate(e.service_date),
      e.service_time || '',
      e.worker_name,
      e.display_label,
      metodoLegible(e.payment_method),
      euros(e.amount_cents),
      e.notes,
      e.settlement_id ? 'Sí' : 'No',
    ]);
  }
  sendCsv(res, `servicios_${from}_${to}.csv`, lines);
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
      ahora: nowHM(),
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

  // El IVA sólo cuenta si se marca que el importe va sin él.
  const vat = Number(String(body.vat_percent || '').replace(',', '.'));
  const vat_percent = body.sin_iva && Number.isFinite(vat) ? Math.min(100, Math.max(0, vat)) : 0;

  return {
    data: {
      name,
      amount_cents,
      vat_percent,
      kind,
      anchor_date,
      notes: String(body.notes || '').trim().slice(0, 200),
      is_investment: body.is_investment ? 1 : 0,
    },
  };
}

router.get('/caja', (req, res) => {
  const periodo = resolvePeriod(req.query);
  const { from, to } = periodo;

  const delPeriodo = (direction) => {
    const resumen = expenses.rangeSummary({ from, to, direction });
    const porId = new Map(resumen.rows.map((g) => [g.id, g]));
    return {
      ...resumen,
      delMes: resumen.rows,
      todos: expenses.listExpenses({ direction }).map((g) => ({ ...g, esteMes: porId.get(g.id) || null })),
      proximos: expenses.upcoming({ dias: 92, direction }),
    };
  };

  const gastos = delPeriodo('out');
  const ingresos = delPeriodo('in');

  const vista = readVista(req.query);
  const cifra = (x) => (vista === 'hastahoy' ? x.hastaHoyCents : x.totalCents);
  const gastosCents = cifra(gastos);
  const inversionCents = cifra(gastos.inversion);
  const otrosCents = cifra(gastos.otros);
  const ingresosCents = cifra(ingresos);

  const servicios = repo.settlementRows({ from, to, pendingOnly: false });
  const facturadoCents = servicios.reduce((a, r) => a + r.totalCents, 0);
  const comisionesCents = servicios.reduce((a, r) => a + r.calc.commissionCents, 0);

  const editando = req.query.editar ? expenses.getExpense(Number(req.query.editar)) : null;

  // Para el reparto hacen falta todos los trabajadores, hayan facturado o no.
  const workers = repo.listWorkers({ includeInactive: true });
  const porUsuario = new Map(servicios.map((r) => [r.user.id, r]));
  const filasReparto = workers.map(
    (w) => porUsuario.get(w.id) || { user: w, totalCents: 0, calc: { commissionCents: 0 } }
  );

  res.send(
    cajaViews.adminCaja({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      periodo,
      vista,
      hoy: todayISO(),
      gastos,
      ingresos,
      totales: {
        entraCents: facturadoCents + ingresosCents,
        gastosCents,
        gastosOtraVistaCents: vista === 'hastahoy' ? gastos.totalCents : gastos.hastaHoyCents,
        inversionCents,
        inversionOtraVistaCents:
          vista === 'hastahoy' ? gastos.inversion.totalCents : gastos.inversion.hastaHoyCents,
        quedaCents: facturadoCents + ingresosCents - comisionesCents - gastosCents,
      },
      editando,
      diasAjustados: editando ? expenses.listDayAmounts(editando.id, from, to) : [],
      workers,
      reparto: investment.split(inversionCents, filasReparto),
      otrosGastos: {
        totalCents: otrosCents,
        activos: workers.filter((w) => w.active).length,
        cadaUnoCents:
          workers.filter((w) => w.active).length > 0
            ? Math.round(otrosCents / workers.filter((w) => w.active).length)
            : 0,
      },
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
  const periodo = resolvePeriod(req.body);
  const volver = `/admin/caja?${periodQuery(periodo)}`;

  // El atajo rellena los porcentajes con lo que ha facturado cada uno.
  if (req.body.segun_facturacion) {
    const filas = repo.settlementRows({
      from: periodo.from,
      to: periodo.to,
      pendingOnly: false,
      includeEmpty: true,
    });
    investment.setShares(investment.sharesFromBilling(filas));
    res.flash('ok', `Porcentajes calculados con lo facturado ${periodo.label}. Cámbialos si quieres.`);
    return res.redirect(volver);
  }

  const ids = [].concat(req.body.worker_id || []);
  const shares = [].concat(req.body.share || []);
  investment.setShares(
    ids.map((id, i) => ({
      id: Number(id),
      share: Number(String(shares[i] ?? '0').replace(',', '.')),
    }))
  );

  res.flash('ok', 'Porcentajes guardados. Se aplican a partir de ahora en todos los meses.');
  res.redirect(volver);
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

/* ------------------------------------------- El mes día a día de un gasto diario */

router.get('/caja/:id/calendario', (req, res) => {
  const gasto = expenses.getExpense(Number(req.params.id));
  if (!gasto) return res.status(404).send('No encontrado.');
  if (gasto.kind !== 'daily') {
    res.flash('error', 'El calendario es para los gastos de todos los días.');
    return res.redirect('/admin/caja');
  }

  const month = validMonth(req.query.month);
  const { from, to } = monthRange(month);

  res.send(
    calendarioViews.adminCalendario({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      gasto,
      month,
      dias: expenses.rangeOccurrences(gasto, from, to),
      hoy: todayISO(),
      volverA: `/admin/caja?month=${month}`,
    })
  );
});

/**
 * Guarda el mes entero de golpe. Una casilla vacía significa "este día va al
 * importe de siempre", así que se le quita el ajuste en lugar de guardar un 0.
 */
router.post('/caja/:id/calendario', (req, res) => {
  const gasto = expenses.getExpense(Number(req.params.id));
  if (!gasto || gasto.kind !== 'daily') return res.status(404).send('No encontrado.');

  const month = validMonth(req.body.month);
  const { from, to } = monthRange(month);
  const volver = `/admin/caja/${gasto.id}/calendario?month=${month}`;

  if (req.body.vaciar) {
    const cuantos = expenses.clearDayAmounts(gasto.id, from, to);
    res.flash('ok', `Quitados ${cuantos} importe(s) de ${monthLabel(month)}.`);
    return res.redirect(volver);
  }

  const dias = [].concat(req.body.dia || []);
  const importes = [].concat(req.body.importe || []);

  let escritos = 0;
  let vaciados = 0;
  let malos = 0;

  expenses.saveDayAmounts(() => {
    dias.forEach((dia, i) => {
      if (!isValidDate(dia) || dia < from || dia > to) return;
      const texto = String(importes[i] ?? '').trim();

      if (texto === '') {
        if (expenses.setDayAmount(gasto.id, dia, null)) vaciados++;
        return;
      }
      const cents = parseAmountToCents(texto);
      if (cents === null) {
        malos++;
        return;
      }
      expenses.setDayAmount(gasto.id, dia, cents);
      escritos++;
    });
  });

  const partes = [];
  if (escritos) partes.push(`${escritos} día(s) con su importe`);
  if (vaciados) partes.push(`${vaciados} devuelto(s) al de siempre`);
  res.flash(
    malos ? 'error' : 'ok',
    (partes.length ? `${monthLabel(month)}: ${partes.join(', ')}.` : 'No había nada que cambiar.') +
      (malos ? ` ${malos} casilla(s) no eran un importe válido y se han dejado como estaban.` : '')
  );
  res.redirect(volver);
});

/** Cambia (o devuelve al normal) el importe de un día suelto. */
router.post('/caja/:id/dia', (req, res) => {
  const mov = expenses.getExpense(Number(req.params.id));
  if (!mov) return res.status(404).send('No encontrado.');

  const day = String(req.body.day || '').trim();
  const volver = `/admin/caja?${periodQuery(resolvePeriod(req.body), { editar: mov.id })}`;

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
  res.redirect(`/admin/caja?${periodQuery(resolvePeriod(req.query))}`);
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
      service_time: isValidTime(body.service_time) ? body.service_time : nowHM(),
      town_id: null,
      client_label: String(body.client_label || '').trim().slice(0, 80),
      payment_method: METHODS.includes(body.payment_method) ? body.payment_method : 'efectivo',
      notes: String(body.notes || '').trim().slice(0, 200),
    },
  };
}

/**
 * Los dos recortes de la liquidación: hasta qué momento (día y, si se quiere,
 * hora) y cuánto como mucho. Los dos son opcionales; lo que no venga o no valga
 * se ignora. Una hora suelta sin fecha no significa nada, así que se descarta.
 */
function readLimites(source) {
  const fecha = String(source.hasta_fecha || '').trim();
  const hora = String(source.hasta_hora || '').trim();
  const tope = String(source.max || '').trim();
  const maxCents = tope ? parseAmountToCents(tope) : null;

  return {
    corte: isValidDate(fecha) ? { fecha, hora: isValidTime(hora) ? hora : null } : null,
    maxCents: maxCents !== null && maxCents >= 0 ? maxCents : null,
  };
}

/** Deja escrito en la liquidación con qué recortes se cerró. */
function notaDe({ corte, maxCents }) {
  const partes = [];
  if (corte) {
    partes.push(`hasta el ${formatDate(corte.fecha)}${corte.hora ? ` a las ${corte.hora}` : ''}`);
  }
  if (maxCents !== null) partes.push(`tope de ${formatEuro(maxCents)}`);
  return partes.join(', ');
}

/** El corte puesto en dirección web, para no perderlo al recargar. */
function corteQuery(limites) {
  const q = {};
  if (limites.corte) {
    q.hasta_fecha = limites.corte.fecha;
    if (limites.corte.hora) q.hasta_hora = limites.corte.hora;
  }
  if (limites.maxCents !== null) q.max = (limites.maxCents / 100).toFixed(2);
  return q;
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
