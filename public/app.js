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

  /* ---------------------------------------------------- Chin-chin de la caja
   *
   * Al apuntar un cobro suena una caja registradora y caen billetes. Suena
   * tonto y es justo lo que hace que apetezca apuntar los cobros.
   *
   * El sonido se genera con el propio navegador (Web Audio), así que no hay
   * ningún fichero de audio que descargar. Y tiene que sonar **durante** el
   * toque del botón: los navegadores no dejan sonar nada que no venga de algo
   * que ha hecho la persona, así que se celebra primero y se envía después.
   */

  var CLAVE_SONIDO = 'sasmoney:sonido';
  var CLAVE_FIESTA = 'sasmoney:fiesta';

  /** Hace algo prescindible sin que un fallo suyo estropee lo importante. */
  function intenta(fn) {
    try {
      fn();
    } catch (e) {
      /* la fiesta es un extra: si no sale, el cobro se apunta igual */
    }
  }

  function guardado(clave, porDefecto) {
    try {
      var v = window.localStorage.getItem(clave);
      return v === null ? porDefecto : v;
    } catch (e) {
      return porDefecto;
    }
  }

  function conSonido() {
    return guardado(CLAVE_SONIDO, '1') !== '0';
  }

  function sinMovimiento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** El "chin, chin" de la caja: el cajón que se abre y dos campanillas. */
  function chinChin() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return 0;

    var ctx = new Ctx();
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    var t = ctx.currentTime;

    cajon(ctx, t);
    campanilla(ctx, t + 0.02, 1);
    campanilla(ctx, t + 0.15, 0.75);

    setTimeout(function () {
      if (ctx.close) ctx.close();
    }, 1500);
    return 750; // lo que dura, más o menos
  }

  /** Una campanilla: dos armónicos que se apagan enseguida. */
  function campanilla(ctx, cuando, fuerza) {
    [1318.5, 1975.5].forEach(function (hz, i) {
      var osc = ctx.createOscillator();
      var vol = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      vol.gain.setValueAtTime(0.0001, cuando);
      vol.gain.exponentialRampToValueAtTime((0.2 * fuerza) / (i + 1), cuando + 0.008);
      vol.gain.exponentialRampToValueAtTime(0.0001, cuando + 0.55);
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(cuando);
      osc.stop(cuando + 0.6);
    });
  }

  /** El golpe seco del cajón: un chasquido de ruido filtrado. */
  function cajon(ctx, cuando) {
    var muestras = Math.floor(ctx.sampleRate * 0.08);
    var buffer = ctx.createBuffer(1, muestras, ctx.sampleRate);
    var datos = buffer.getChannelData(0);
    for (var i = 0; i < muestras; i++) {
      datos[i] = (Math.random() * 2 - 1) * (1 - i / muestras);
    }
    var fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    var filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 1100;
    var vol = ctx.createGain();
    vol.gain.value = 0.3;
    fuente.connect(filtro);
    filtro.connect(vol);
    vol.connect(ctx.destination);
    fuente.start(cuando);
  }

  /** Billetes cayendo por la pantalla. */
  function lluviaDeBilletes() {
    if (sinMovimiento()) return;

    var capa = document.createElement('div');
    capa.className = 'lluvia';
    capa.setAttribute('aria-hidden', 'true');

    var caras = ['💶', '💵', '💰', '💸'];
    for (var i = 0; i < 18; i++) {
      var billete = document.createElement('span');
      billete.className = 'billete' + (i % 2 ? ' al-reves' : '');
      billete.textContent = caras[i % caras.length];
      billete.style.left = (Math.random() * 96).toFixed(1) + '%';
      billete.style.animationDelay = (Math.random() * 0.4).toFixed(2) + 's';
      billete.style.animationDuration = (1.1 + Math.random() * 0.6).toFixed(2) + 's';
      billete.style.fontSize = (20 + Math.random() * 22).toFixed(0) + 'px';
      capa.appendChild(billete);
    }

    document.body.appendChild(capa);
    setTimeout(function () {
      capa.remove();
    }, 2400);
  }

  // Los billetes siguen cayendo en la pantalla siguiente, para que la fiesta no
  // se corte en seco al recargar.
  intenta(function () {
    if (!window.sessionStorage.getItem(CLAVE_FIESTA)) return;
    window.sessionStorage.removeItem(CLAVE_FIESTA);
    lluviaDeBilletes();
  });

  document.querySelectorAll('form[data-celebrar]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (ev.defaultPrevented || form.dataset.celebrando) return;
      form.dataset.celebrando = '1';

      // Cada cosa por su lado: que falle el sonido no puede dejarnos sin
      // billetes, y que falle cualquiera de los dos no puede perder el cobro.
      var espera = 0;
      intenta(function () {
        lluviaDeBilletes();
      });
      intenta(function () {
        if (conSonido()) espera = chinChin();
      });
      intenta(function () {
        window.sessionStorage.setItem(CLAVE_FIESTA, '1');
      });
      if (!espera) return;

      // Se retiene el envío lo justo para que se oiga; el botón ya está en
      // "Guardando…", así que no hay manera de darle dos veces.
      ev.preventDefault();
      setTimeout(function () {
        form.submit();
      }, espera);
    });
  });

  // Interruptor del sonido, en "Mi cuenta".
  var interruptor = document.querySelector('[data-sonido]');
  if (interruptor) {
    interruptor.checked = conSonido();
    interruptor.addEventListener('change', function () {
      intenta(function () {
        window.localStorage.setItem(CLAVE_SONIDO, interruptor.checked ? '1' : '0');
      });
      // Se oye al encenderlo, para saber en qué te estás metiendo.
      if (interruptor.checked) intenta(chinChin);
    });
  }
})();
