#!/usr/bin/env bash
#
# Instala SasMoney en un servidor Linux con systemd.
#
# Lo hace todo dentro de sus propias carpetas y con su propio usuario:
#   /opt/sasmoney       la aplicación y, si hace falta, su propio Node
#   /var/lib/sasmoney   la base de datos y las copias de seguridad
#
# No instala ni actualiza nada del sistema, no toca puertos que ya estén en uso
# y no modifica ninguna configuración existente (Emby incluido).
#
# Uso:   sudo bash deploy/instalar.sh
#
set -euo pipefail

APP_USER=sasmoney
BASE=/opt/sasmoney
APP_DIR=$BASE/app
DATA_DIR=/var/lib/sasmoney
ENV_FILE=$BASE/sasmoney.env
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=13
NODE_VERSION=v24.10.0
REPO=https://github.com/josekgullon-sudo/sasmoney.git
BRANCH=${BRANCH:-claude/saas-clientes-pagos-muh221}

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$1"; }
warn() { printf '    \033[0;33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[0;31mError:\033[0m %s\n\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecútalo con sudo: sudo bash deploy/instalar.sh"
command -v systemctl >/dev/null || die "Este script necesita systemd (Ubuntu, Debian, Rocky...)."

# ---------------------------------------------------------------- 1. Puerto
say "Buscando un puerto libre"
PORT=${PORT:-4400}

# Se comprueba de dos maneras para no depender de que 'ss' esté instalado:
# primero mirando qué está a la escucha y, si no se puede, intentando conectar.
port_ocupado() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    if ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"; then
      return 0
    fi
  fi
  if (exec 3<>/dev/tcp/127.0.0.1/"$p") 2>/dev/null; then
    exec 3<&- 2>/dev/null || true
    return 0
  fi
  return 1
}

if port_ocupado "$PORT"; then
  warn "El puerto $PORT ya está ocupado por otro programa."
  for p in 4401 4402 4403 4404 4405; do
    if ! port_ocupado "$p"; then PORT=$p; break; fi
  done
  if port_ocupado "$PORT"; then
    die "No encuentro un puerto libre entre el 4400 y el 4405."
  fi
fi
ok "Usará el puerto $PORT (Emby usa el 8096, no se toca)"

# ------------------------------------------------------------- 2. Usuario
say "Preparando el usuario y las carpetas"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin "$APP_USER"
  ok "Usuario del sistema '$APP_USER' creado (sin acceso por consola)"
else
  ok "El usuario '$APP_USER' ya existía"
fi

mkdir -p "$BASE" "$DATA_DIR"
chown "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
ok "Datos en $DATA_DIR"

# ----------------------------------------------------------------- 3. Node
say "Comprobando Node.js"
node_sirve() {
  local bin=$1
  [ -x "$bin" ] || return 1
  local v major minor
  v=$("$bin" -v 2>/dev/null | tr -d 'v') || return 1
  major=${v%%.*}; minor=$(echo "$v" | cut -d. -f2)
  [ "$major" -gt "$NODE_MIN_MAJOR" ] && return 0
  [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ] && return 0
  return 1
}

SYSTEM_NODE=$(command -v node || true)
if [ -n "$SYSTEM_NODE" ] && node_sirve "$SYSTEM_NODE"; then
  ln -sfn "$SYSTEM_NODE" "$BASE/node"
  ok "Se usará el Node del sistema ($("$SYSTEM_NODE" -v)), sin tocarlo"
else
  if [ -n "$SYSTEM_NODE" ]; then
    warn "El Node del sistema ($("$SYSTEM_NODE" -v 2>/dev/null || echo '?')) es antiguo; NO se toca."
  fi
  if [ ! -x "$BASE/runtime/bin/node" ]; then
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64)  NARCH=x64 ;;
      aarch64) NARCH=arm64 ;;
      armv7l)  NARCH=armv7l ;;
      *) die "Arquitectura no reconocida: $ARCH. Instala Node 24 a mano y repite." ;;
    esac
    TARBALL="node-$NODE_VERSION-linux-$NARCH.tar.xz"
    say "Descargando Node $NODE_VERSION sólo para esta aplicación"
    mkdir -p "$BASE/runtime"
    tmp=$(mktemp -d)
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$tmp/node.tar.xz" \
      || die "No he podido descargar Node. ¿Tiene el servidor salida a internet?"
    tar -xJf "$tmp/node.tar.xz" -C "$tmp"
    cp -a "$tmp/node-$NODE_VERSION-linux-$NARCH/." "$BASE/runtime/"
    rm -rf "$tmp"
  fi
  ln -sfn "$BASE/runtime/bin/node" "$BASE/node"
  ok "Node propio en $BASE/runtime ($("$BASE/node" -v)) — el del sistema queda como estaba"
fi

# ------------------------------------------------------------ 4. Aplicación
say "Descargando la aplicación"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
  ok "Actualizada a la última versión"
else
  command -v git >/dev/null || die "Falta git. Instálalo con: apt install git"
  rm -rf "$APP_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
  ok "Descargada en $APP_DIR"
fi

say "Instalando las dependencias (Express y bcryptjs, no compila nada)"
NPM="$BASE/runtime/bin/npm"
[ -x "$NPM" ] || NPM=$(command -v npm || true)
[ -n "$NPM" ] || die "No encuentro npm."
(cd "$APP_DIR" && "$NPM" install --omit=dev --no-audit --no-fund --loglevel=error)
ok "Listas"

chown -R "$APP_USER:$APP_USER" "$BASE"

# ------------------------------------------------------- 5. Configuración
say "Escribiendo la configuración"
if [ ! -f "$ENV_FILE" ]; then
  ADMIN_PASSWORD=$(head -c 9 /dev/urandom | base64 | tr -d '+/=' | head -c 12)
  cat > "$ENV_FILE" <<EOF
# Configuración de SasMoney. Si cambias algo:  sudo systemctl restart sasmoney
NODE_ENV=production
PORT=$PORT
# Sólo escucha dentro del propio servidor; a internet la saca el proxy con HTTPS.
HOST=127.0.0.1
DATA_DIR=$DATA_DIR
TZ_APP=Europe/Madrid
COOKIE_SECURE=1
SESSION_DAYS=30
ADMIN_USER=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_NAME=Jefe
EOF
  NUEVA_INSTALACION=1
else
  # Se respeta la configuración que ya hubiera, sólo se ajusta el puerto si cambió.
  sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"
  NUEVA_INSTALACION=0
  ok "Se mantiene la configuración que ya tenías"
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ------------------------------------------------------------ 6. Servicio
say "Registrando el servicio para que arranque solo"
install -m 644 "$APP_DIR/deploy/sasmoney.service" /etc/systemd/system/sasmoney.service
install -m 644 "$APP_DIR/deploy/sasmoney-copia.service" /etc/systemd/system/sasmoney-copia.service
install -m 644 "$APP_DIR/deploy/sasmoney-copia.timer" /etc/systemd/system/sasmoney-copia.timer
install -m 755 "$APP_DIR/deploy/copia-seguridad.sh" "$BASE/copia-seguridad.sh"

systemctl daemon-reload
systemctl enable --quiet --now sasmoney.service
systemctl enable --quiet --now sasmoney-copia.timer
sleep 2

if ! systemctl is-active --quiet sasmoney.service; then
  echo
  journalctl -u sasmoney -n 20 --no-pager
  die "El servicio no ha arrancado. Arriba tienes el motivo."
fi
ok "Servicio activo y configurado para arrancar con el servidor"
ok "Copia de seguridad automática todas las noches"

# -------------------------------------------------------------- 7. Resumen
echo
printf '\033[1;32m────────────────────────────────────────────────\033[0m\n'
printf '  SasMoney funcionando\n'
printf '\033[1;32m────────────────────────────────────────────────\033[0m\n'
printf '  Dirección interna:  http://127.0.0.1:%s\n' "$PORT"
if [ "$NUEVA_INSTALACION" = "1" ]; then
  printf '  Usuario:            admin\n'
  printf '  Contraseña:         %s\n' "$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
  printf '\n  Apúntala. También está en %s\n' "$ENV_FILE"
fi
printf '\n  Siguiente paso: publicarla en internet con HTTPS.\n'
printf '  Mira DESPLIEGUE.md, apartado "Abrirla a internet".\n\n'
printf '  Ver el estado:   sudo systemctl status sasmoney\n'
printf '  Ver el registro: sudo journalctl -u sasmoney -f\n\n'
