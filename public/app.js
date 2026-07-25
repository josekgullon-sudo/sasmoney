/* Pequeñas ayudas de interfaz. Nada de dependencias externas. */
(function () {
  'use strict';

  // Botones de importe rápido: rellenan el campo del importe de un toque.
  document.querySelectorAll('[data-amount]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var form = chip.closest('form');
      var input = form && form.querySelector('[data-amount-input]');
      if (!input) return;
      input.value = chip.getAttribute('data-amount');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      form.querySelectorAll('[data-amount]').forEach(function (c) { c.classList.remove('is-on'); });
      chip.classList.add('is-on');
    });
  });

  // Si se escribe a mano, se apaga el resaltado de los botones rápidos.
  document.querySelectorAll('[data-amount-input]').forEach(function (input) {
    input.addEventListener('input', function () {
      var form = input.closest('form');
      if (!form) return;
      form.querySelectorAll('[data-amount]').forEach(function (c) {
        if (c.getAttribute('data-amount') !== input.value) c.classList.remove('is-on');
      });
    });
  });

  // Confirmación antes de borrar o de cerrar una liquidación.
  document.querySelectorAll('[data-confirm]').forEach(function (el) {
    el.addEventListener('click', function (ev) {
      if (!window.confirm(el.getAttribute('data-confirm'))) ev.preventDefault();
    });
  });

  // Evita el doble envío al guardar un servicio con conexión lenta.
  document.querySelectorAll('form[data-once]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('button[type="submit"], button:not([type])');
      if (btn) {
        setTimeout(function () {
          btn.disabled = true;
          btn.textContent = 'Guardando…';
        }, 0);
      }
    });
  });

  // Tramos de comisión: añadir y quitar filas en la ficha del trabajador.
  var tiers = document.getElementById('tiers');
  if (tiers) {
    var addBtn = document.getElementById('add-tier');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var row = document.createElement('div');
        row.className = 'tier-row';
        row.innerHTML =
          '<div><label>Desde (€ facturados)</label><input type="text" name="tier_from" inputmode="decimal" placeholder="0"></div>' +
          '<div><label>Porcentaje</label><input type="text" name="tier_percent" inputmode="decimal" placeholder="30"></div>' +
          '<button type="button" class="btn ghost small" data-remove-tier>Quitar</button>';
        tiers.appendChild(row);
      });
    }
    tiers.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-remove-tier]');
      if (btn) btn.closest('.tier-row').remove();
    });
  }

  // Muestra u oculta los campos según el tipo de comisión elegido.
  var typeSelect = document.querySelector('[data-commission-type]');
  if (typeSelect) {
    var sync = function () {
      document.querySelectorAll('[data-when-type]').forEach(function (block) {
        block.hidden = block.getAttribute('data-when-type') !== typeSelect.value;
      });
    };
    typeSelect.addEventListener('change', sync);
    sync();
  }

  // Al abrir la pantalla de alta, el cursor va directo al importe.
  var focusTarget = document.querySelector('[data-autofocus]');
  if (focusTarget && !('ontouchstart' in window)) focusTarget.focus();
})();
