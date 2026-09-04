'use strict';

const express = require('express');
const { requireLogin } = require('../auth');
const repo = require('../repo');
const { parseAmountToCents, formatEuro } = require('../commission');
const { todayISO, nowHM, isValidTime, currentMonth, monthRange, recentMonths, isValidDate } = require('../util');
const { resolvePeriod, periodQuery } = require('../period');
const views = require('../views/worker');
const { PAYMENT_METHODS } = require('../views/worker');

const router = express.Router();
const METHODS = PAYMENT_METHODS.map(([v]) => v);

/** Lee y valida los campos del formulario de servicio. */
function readEntryForm(body, { today, ahora }) {
  const amount_cents = parseAmountToCents(body.amount);
  if (amount_cents === null) return { error: 'Escribe un importe válido, por ejemplo 45 o 45,50.' };
  if (amount_cents === 0) return { error: 'El importe no puede ser 0 €.' };
  if (amount_cents > 100000000) return { error: 'Ese importe es demasiado grande.' };

  let service_date = String(body.service_date || '').trim() || today;
  if (!isValidDate(service_date)) service_date = today;
  if (service_date > today) service_date = today;

  const payment_method = METHODS.includes(body.payment_method) ? body.payment_method : 'efectivo';

  // La hora se pone sola; si viene una escrita a mano y es válida, se respeta.
  const service_time = isValidTime(body.service_time) ? body.service_time : ahora;

  return {
    data: {
      amount_cents,
      service_date,
      service_time,
      town_id: null,
      client_label: String(body.client_label || '').trim().slice(0, 80),
      payment_method,
      notes: String(body.notes || '').trim().slice(0, 200),
    },
  };
}

router.get('/', requireLogin, (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin');

  const today = todayISO();
  const month = currentMonth();
  const { from, to } = monthRange(month);

  const todayEntries = repo.listEntries({ userId: req.user.id, from: today, to: today });
  const monthTotals = repo.totalsFor({ userId: req.user.id, from, to });
  const calc = repo.commissionFor({ userId: req.user.id, from, to });

  res.send(
    views.workerHome({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      today,
      ahora: nowHM(),
      month,
      suggestions: repo.commonAmounts(req.user.id),
      todayEntries,
      todayCents: todayEntries.reduce((a, e) => a + e.amount_cents, 0),
      monthCents: monthTotals.totalCents,
      monthCount: monthTotals.count,
      monthCommissionCents: calc.commissionCents,
    })
  );
});

router.post('/servicios', requireLogin, (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin/servicios');

  const { data, error } = readEntryForm(req.body, { today: todayISO(), ahora: nowHM() });
  if (error) {
    res.flash('error', error);
    return res.redirect('/');
  }

  repo.createEntry({ ...data, user_id: req.user.id });
  res.flash('ok', `Apuntado ${formatEuro(data.amount_cents)}. ¡Sigue así!`);
  res.redirect('/');
});

router.get('/servicios/:id/editar', requireLogin, (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry || entry.user_id !== req.user.id) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado: habla con el jefe si hay que corregirlo.');
    return res.redirect('/mis-cuentas');
  }

  res.send(
    views.workerEditEntry({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      entry,
      today: todayISO(),
      ahora: nowHM(),
    })
  );
});

router.post('/servicios/:id', requireLogin, (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry || entry.user_id !== req.user.id) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado y no se puede tocar.');
    return res.redirect('/mis-cuentas');
  }

  const { data, error } = readEntryForm(req.body, { today: todayISO(), ahora: nowHM() });
  if (error) {
    res.flash('error', error);
    return res.redirect(`/servicios/${entry.id}/editar`);
  }

  repo.updateEntry(entry.id, { ...data, user_id: null });
  res.flash('ok', 'Servicio actualizado.');
  res.redirect('/mis-cuentas');
});

router.post('/servicios/:id/borrar', requireLogin, (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry || entry.user_id !== req.user.id) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado y no se puede borrar.');
    return res.redirect('/mis-cuentas');
  }

  repo.deleteEntry(entry.id);
  res.flash('ok', 'Servicio borrado.');
  res.redirect('/mis-cuentas');
});

router.get('/mis-cuentas', requireLogin, (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin/liquidacion');

  const periodo = resolvePeriod(req.query);
  const { from, to } = periodo;

  const entries = repo.listEntries({ userId: req.user.id, from, to });
  const totalCents = entries.reduce((a, e) => a + e.amount_cents, 0);
  const calc = repo.commissionForEntries(req.user, entries);

  const pendingCalc = repo.commissionFor({ userId: req.user.id, from, to, pendingOnly: true });

  // Los últimos seis meses, para poder compararse consigo misma.
  const historial = recentMonths(6).map((m) => {
    const r = monthRange(m);
    const t = repo.totalsFor({ userId: req.user.id, from: r.from, to: r.to });
    const c = repo.commissionFor({ userId: req.user.id, from: r.from, to: r.to });
    return { month: m, count: t.count, totalCents: t.totalCents, commissionCents: c.commissionCents };
  });

  res.send(
    views.workerAccount({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      periodo,
      entries,
      totalCents,
      calc,
      pendingCents: pendingCalc.commissionCents,
      settlements: repo.listSettlements({ userId: req.user.id, limit: 24 }),
      historial,
    })
  );
});

// Las direcciones antiguas siguen funcionando, por si alguien las tenía guardadas.
router.get(['/mis-servicios', '/mis-ganancias'], requireLogin, (req, res) => {
  res.redirect(`/mis-cuentas?${periodQuery(resolvePeriod(req.query))}`);
});

module.exports = router;
