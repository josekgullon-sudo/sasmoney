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

  // La escalera del umbral: añadir y quitar tramos, igual que los de comisión.
  var umbralTramos = document.getElementById('umbral-tramos');
  if (umbralTramos) {
    var addUmbral = document.getElementById('add-umbral-tramo');
    if (addUmbral) {
      addUmbral.addEventListener('click', function () {
        var row = document.createElement('div');
        row.className = 'tier-row';
        row.innerHTML =
          '<div><label>Desde (€ por encima de gastos)</label><input type="text" name="tramo_desde" inputmode="decimal" placeholder="200"></div>' +
          '<div><label>Puntos de más</label><input type="text" name="tramo_puntos" inputmode="decimal" placeholder="5"></div>' +
          '<button type="button" class="btn ghost small" data-remove-tier>Quitar</button>';
        umbralTramos.appendChild(row);
      });
    }
    umbralTramos.addEventListener('click', function (ev) {
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

  // Reparto de ganancias: al escribir lo de la empresa se ve al momento lo que
  // le queda al trabajador. Los dos números a la vista, sin tener que restar.
  var profitInput = document.querySelector('[data-profit-input]');
  if (profitInput) {
    var empresaOut = document.querySelector('[data-profit-empresa]');
    var trabajadorOut = document.querySelector('[data-profit-trabajador]');
    var ejemploOut = document.querySelector('[data-profit-ejemplo]');
    profitInput.addEventListener('input', function () {
      var empresa = Number(String(profitInput.value).replace(',', '.'));
      if (!isFinite(empresa)) return;
      empresa = Math.min(100, Math.max(0, empresa));
      var suyo = Math.round((100 - empresa) * 100) / 100;
      if (empresaOut) empresaOut.textContent = String(empresa);
      if (trabajadorOut) trabajadorOut.textContent = String(suyo);
      // El ejemplo de abajo, con los números que se acaban de escribir.
      if (ejemploOut) ejemploOut.textContent = ((175 * suyo) / 100).toFixed(2).replace('.', ',') + ' €';
    });
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
   *
   * La celebración es **una sola**, la de antes de guardar. Repetirla también
   * al recargar la página se veía como si el efecto se hubiera disparado dos
   * veces, que es justo lo contrario de lo que se busca.
   */

  var CLAVE_SONIDO = 'sasmoney:sonido';

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

  /**
   * El "chin, chin" de la caja: dos notas de máquina recreativa, la segunda
   * más aguda y más larga, con el tintineo de la moneda cayendo en la bandeja.
   *
   * Son ondas cuadradas a propósito: es lo que le da ese aire de maquinita, y
   * es lo que se reconoce como "sonido de dinero" sin necesidad de explicarlo.
   */
  function chinChin() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return 0;

    var ctx = new Ctx();
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();

    // Un único mando de volumen para que las capas no se peleen ni saturen.
    var maestro = ctx.createGain();
    maestro.gain.value = 0.34;
    maestro.connect(ctx.destination);

    var t = ctx.currentTime;
    tintineo(ctx, maestro, t);
    nota(ctx, maestro, t + 0.015, 987.77, 0.1); //  chin  (si)
    nota(ctx, maestro, t + 0.105, 1318.51, 0.5); // chiin (mi, más arriba)

    setTimeout(function () {
      if (ctx.close) ctx.close();
    }, 1400);
    return 640; // lo que dura de principio a fin
  }

  /** Una nota de maquinita: la cuadrada manda y encima va un poco de brillo. */
  function nota(ctx, salida, cuando, hz, dura) {
    var capas = [
      { hz: hz, onda: 'square', vol: 0.5 },
      { hz: hz * 2, onda: 'square', vol: 0.14 },
      { hz: hz * 3.01, onda: 'sine', vol: 0.1 }, // desafinado, para que brille
    ];
    capas.forEach(function (capa) {
      var osc = ctx.createOscillator();
      var vol = ctx.createGain();
      osc.type = capa.onda;
      osc.frequency.value = capa.hz;
      vol.gain.setValueAtTime(0.0001, cuando);
      vol.gain.exponentialRampToValueAtTime(capa.vol, cuando + 0.005);
      vol.gain.setValueAtTime(capa.vol, cuando + dura * 0.4);
      vol.gain.exponentialRampToValueAtTime(0.0001, cuando + dura);
      osc.connect(vol);
      vol.connect(salida);
      osc.start(cuando);
      osc.stop(cuando + dura + 0.02);
    });
  }

  /** La moneda cayendo en la bandeja: un chispazo corto y agudo. */
  function tintineo(ctx, salida, cuando) {
    var muestras = Math.floor(ctx.sampleRate * 0.05);
    var buffer = ctx.createBuffer(1, muestras, ctx.sampleRate);
    var datos = buffer.getChannelData(0);
    for (var i = 0; i < muestras; i++) {
      datos[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / muestras, 3);
    }
    var fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    var filtro = ctx.createBiquadFilter();
    filtro.type = 'highpass';
    filtro.frequency.value = 3000;
    var vol = ctx.createGain();
    vol.gain.value = 0.5;
    fuente.connect(filtro);
    filtro.connect(vol);
    vol.connect(salida);
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
      // Corto y seguido: la página se recarga al guardar, así que la lluvia
      // tiene que dar tiempo a verse entera antes de ese momento.
      billete.style.animationDelay = (Math.random() * 0.18).toFixed(2) + 's';
      billete.style.animationDuration = (0.7 + Math.random() * 0.35).toFixed(2) + 's';
      billete.style.fontSize = (20 + Math.random() * 22).toFixed(0) + 'px';
      capa.appendChild(billete);
    }

    document.body.appendChild(capa);
    setTimeout(function () {
      capa.remove();
    }, 1600);
  }

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
