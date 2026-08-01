#!/usr/bin/env bash
#
# Actualiza SaaS TotalFlix a la última versión, sola y sin riesgo.
#
# Lo que hace, por orden:
#   1. Mira si hay algo nuevo. Si no, no toca nada y termina.
#   2. Hace una copia de seguridad de la base de datos.
#   3. Se trae la versión nueva y reinicia.
#   4. Comprueba que la aplicación responde.
#   5. Si NO responde, vuelve sola a la versión anterior y la deja funcionando.
#
# La lanza cada noche el temporizador sasmoney-actualizar.timer.
# A mano:  sudo /opt/sasmoney/actualizar.sh
#
set -euo pipefail

BASE=/opt/sasmoney
APP_DIR=$BASE/app
ENV_FILE=$BASE/sasmoney.env
BRANCH=${BRANCH:-claude/saas-clientes-pagos-muh221}

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M')" "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Ejecútalo con sudo."; exit 1; }
[ -d "$APP_DIR/.git" ] || { log "No encuentro la instalación en $APP_DIR."; exit 1; }

# Dos actualizaciones a la vez harían un destrozo; sólo se deja pasar a una.
exec 9>/var/lock/sasmoney-actualizar.lock
if ! flock -n 9; then
  log "Ya hay otra actualización en marcha. Lo dejo."
  exit 0
fi

gitapp() { git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }

# ------------------------------------------------------------ ¿Hay algo nuevo?
gitapp fetch --quiet origin "$BRANCH" || { log "No he podido conectar con GitHub. Lo intento mañana."; exit 0; }

ACTUAL=$(gitapp rev-parse HEAD)
NUEVA=$(gitapp rev-parse "origin/$BRANCH")

if [ "$ACTUAL" = "$NUEVA" ]; then
  log "Ya está en la última versión (${ACTUAL:0:7}). No hago nada."
  exit 0
fi

log "Hay versión nueva: ${ACTUAL:0:7} -> ${NUEVA:0:7}"

# --------------------------------------------------- Copia antes de tocar nada
if [ -x "$BASE/copia-seguridad.sh" ]; then
  log "Copia de seguridad previa..."
  "$BASE/copia-seguridad.sh" >/dev/null 2>&1 || log "Aviso: la copia ha fallado, sigo igualmente."
fi

# ------------------------------------------------------------ Poner la versión
# Ningún paso de aquí puede cortar el script: si algo falla, tiene que llegarse
# igualmente a la comprobación de más abajo, que es la que decide si hay que
# volver atrás. Por eso cada paso avisa en lugar de abortar.
aplicar() {
  local commit=$1

  if ! gitapp reset --hard --quiet "$commit"; then
    log "Aviso: no he podido cambiar el código a ${commit:0:7}."
    return 1
  fi
  chown -R root:root "$APP_DIR" || true
  chmod -R a+rX "$APP_DIR" || true

  local npm_bin="$BASE/runtime/bin/npm"
  [ -x "$npm_bin" ] || npm_bin=$(command -v npm || true)
  if [ -n "$npm_bin" ]; then
    if ! (cd "$APP_DIR" && "$npm_bin" install --omit=dev --no-audit --no-fund --loglevel=error) >/dev/null 2>&1; then
      log "Aviso: la instalación de dependencias ha fallado."
    fi
  fi

  systemctl restart sasmoney.service || log "Aviso: el reinicio ha dado error."
  return 0
}

# --------------------------------------------------------- ¿Responde de verdad?
responde() {
  local port
  port=$(sed -n 's/^PORT=\([0-9]\{1,\}\).*/\1/p' "$ENV_FILE" | head -1)
  port=${port:-4400}

  # Se le dan hasta 20 segundos para arrancar.
  for _ in $(seq 1 10); do
    # Sin -S: durante los reintentos los fallos son normales y no hay que gritarlos.
    if curl -fs -o /dev/null --max-time 3 "http://127.0.0.1:$port/login"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

aplicar "$NUEVA" || true

if responde; then
  log "Actualizada a ${NUEVA:0:7} y funcionando."
  exit 0
fi

# ------------------------------------------------------------- Marcha atrás
log "La versión nueva NO responde. Vuelvo a ${ACTUAL:0:7}."
aplicar "$ACTUAL" || true

if responde; then
  log "Vuelta atrás hecha: sigues con la versión de antes, funcionando."
else
  log "ATENCIÓN: tampoco responde la versión anterior. Mira: journalctl -u sasmoney -n 50"
fi
exit 1
