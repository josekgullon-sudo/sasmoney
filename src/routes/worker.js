'use strict';

const express = require('express');
const { requireLogin } = require('../auth');
const repo = require('../repo');
const { calcCommission, parseAmountToCents, formatEuro } = require('../commission');
const { todayISO, currentMonth, monthRange, isValidDate } = require('../util');
const views = require('../views/worker');
const { PAYMENT_METHODS } = require('../views/worker');

const router = express.Router();
const METHODS = PAYMENT_METHODS.map(([v]) => v);

/** Lee y valida los campos del formulario de servicio. */
function readEntryForm(body, { today }) {
  const amount_cents = parseAmountToCents(body.amount);
  if (amount_cents === null) return { error: 'Escribe un importe válido, por ejemplo 45 o 45,50.' };
  if (amount_cents === 0) return { error: 'El importe no puede ser 0 €.' };
  if (amount_cents > 100000000) return { error: 'Ese importe es demasiado grande.' };

  let service_date = String(body.service_date || '').trim() || today;
  if (!isValidDate(service_date)) service_date = today;
  if (service_date > today) service_date = today;

  const town_id = body.town_id ? Number(body.town_id) : null;
  const payment_method = METHODS.includes(body.payment_method) ? body.payment_method : 'efectivo';

  return {
    data: {
      amount_cents,
      service_date,
      town_id: Number.isInteger(town_id) && town_id > 0 ? town_id : null,
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
  const calc = calcCommission(req.user, {
    totalCents: monthTotals.totalCents,
    serviceCount: monthTotals.count,
  });

  res.send(
    views.workerHome({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      towns: repo.listTowns(),
      lastTownId: repo.lastTownId(req.user.id),
      today,
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

  const { data, error } = readEntryForm(req.body, { today: todayISO() });
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
    return res.redirect('/mis-servicios');
  }

  res.send(
    views.workerEditEntry({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      entry,
      towns: repo.listTowns(),
      today: todayISO(),
    })
  );
});

router.post('/servicios/:id', requireLogin, (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry || entry.user_id !== req.user.id) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado y no se puede tocar.');
    return res.redirect('/mis-servicios');
  }

  const { data, error } = readEntryForm(req.body, { today: todayISO() });
  if (error) {
    res.flash('error', error);
    return res.redirect(`/servicios/${entry.id}/editar`);
  }

  repo.updateEntry(entry.id, { ...data, user_id: null });
  res.flash('ok', 'Servicio actualizado.');
  res.redirect('/mis-servicios');
});

router.post('/servicios/:id/borrar', requireLogin, (req, res) => {
  const entry = repo.getEntry(Number(req.params.id));
  if (!entry || entry.user_id !== req.user.id) return res.status(404).send('Servicio no encontrado.');
  if (entry.settlement_id) {
    res.flash('error', 'Ese servicio ya está liquidado y no se puede borrar.');
    return res.redirect('/mis-servicios');
  }

  repo.deleteEntry(entry.id);
  res.flash('ok', 'Servicio borrado.');
  res.redirect('/mis-servicios');
});

router.get('/mis-servicios', requireLogin, (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin/servicios');

  const month = String(req.query.month || currentMonth());
  const { from, to } = monthRange(month);
  const entries = repo.listEntries({ userId: req.user.id, from, to });
  const totalCents = entries.reduce((a, e) => a + e.amount_cents, 0);
  const calc = calcCommission(req.user, { totalCents, serviceCount: entries.length });

  res.send(
    views.workerEntries({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      month: from.slice(0, 7),
      entries,
      totalCents,
      commissionCents: calc.commissionCents,
    })
  );
});

router.get('/mis-ganancias', requireLogin, (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin/liquidacion');

  const month = String(req.query.month || currentMonth());
  const { from, to } = monthRange(month);

  const all = repo.totalsFor({ userId: req.user.id, from, to });
  const pending = repo.totalsFor({ userId: req.user.id, from, to, pendingOnly: true });
  const calc = calcCommission(req.user, { totalCents: all.totalCents, serviceCount: all.count });
  const pendingCalc = calcCommission(req.user, {
    totalCents: pending.totalCents,
    serviceCount: pending.count,
  });

  res.send(
    views.workerEarnings({
      user: req.user,
      flash: res.locals.flash,
      warning: res.locals.warning,
      month: from.slice(0, 7),
      totalCents: all.totalCents,
      count: all.count,
      calc,
      pendingCents: pendingCalc.commissionCents,
      settlements: repo.listSettlements({ userId: req.user.id, limit: 24 }),
    })
  );
});

module.exports = router;
