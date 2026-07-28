#!/usr/bin/env bash
#
# Desinstala SaaS TotalFlix de un servidor.
#
# Quita únicamente lo que puso el instalador:
#   el servicio, su temporizador de copias, /opt/sasmoney, el usuario del
#   sistema y, si lo hubiera, SU fichero de nginx. No toca ninguna otra
#   configuración del servidor (Emby, otros sitios de nginx, el Node del
#   sistema...).
#
# Por defecto CONSERVA los datos en /var/lib/sasmoney, por si quieres
# llevártelos a otro servidor. Para borrarlos también:
#
#   sudo bash desinstalar.sh --con-datos
#
set -euo pipefail

BASE=/opt/sasmoney
DATA_DIR=/var/lib/sasmoney
BORRAR_DATOS=0
[ "${1:-}" = "--con-datos" ] && BORRAR_DATOS=1

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$1"; }
warn() { printf '    \033[0;33m!\033[0m %s\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Ejecútalo con sudo."; exit 1; }

say "Parando el servicio"
for unidad in sasmoney.service sasmoney-copia.timer sasmoney-copia.service; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$unidad" || [ -e "/etc/systemd/system/$unidad" ]; then
    systemctl disable --quiet --now "$unidad" 2>/dev/null || true
    ok "$unidad parada y desactivada"
  fi
done

say "Quitando los ficheros del servicio"
rm -f /etc/systemd/system/sasmoney.service \
      /etc/systemd/system/sasmoney-copia.service \
      /etc/systemd/system/sasmoney-copia.timer
# Los fallos de systemd no deben cortar la desinstalación a medias: lo que
# queda por hacer (borrar carpetas, usuario, nginx) hay que hacerlo igualmente.
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed 2>/dev/null || true
ok "Ficheros de systemd eliminados"

say "Revisando nginx"
QUITADO_NGINX=0
for f in /etc/nginx/sites-enabled/sasmoney /etc/nginx/sites-available/sasmoney /etc/nginx/conf.d/sasmoney.conf; do
  if [ -e "$f" ]; then
    rm -f "$f"
    ok "Eliminado $f"
    QUITADO_NGINX=1
  fi
done
if [ "$QUITADO_NGINX" = "1" ] && command -v nginx >/dev/null 2>&1; then
  # Sólo se recarga si la configuración que queda es válida: así, si hubiera
  # algún otro problema previo, nginx sigue sirviendo lo que ya servía.
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx 2>/dev/null || true
    ok "Nginx recargado sin el sitio de la aplicación"
  else
    warn "La configuración de nginx tiene errores AJENOS a esto; no lo he recargado."
    warn "Míralo con: sudo nginx -t"
  fi
else
  ok "Nginx no tenía ningún sitio de esta aplicación"
fi

say "Quitando la aplicación"
rm -rf "$BASE"
ok "Carpeta $BASE eliminada"

if id -u sasmoney >/dev/null 2>&1; then
  userdel sasmoney 2>/dev/null || true
  ok "Usuario del sistema 'sasmoney' eliminado"
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  for p in 4400 4401 4402 4403 4404 4405; do
    if ufw status 2>/dev/null | grep -q "^$p/tcp"; then
      ufw --force delete allow "$p/tcp" >/dev/null 2>&1 || true
      ok "Regla del cortafuegos para el puerto $p eliminada"
    fi
  done
fi

say "Datos"
if [ "$BORRAR_DATOS" = "1" ]; then
  rm -rf "$DATA_DIR"
  ok "Datos y copias de seguridad eliminados de $DATA_DIR"
else
  if [ -d "$DATA_DIR" ]; then
    warn "Los datos SIGUEN en $DATA_DIR ($(du -sh "$DATA_DIR" 2>/dev/null | cut -f1))"
    printf '      Para llevártelos a otro servidor, desde tu ordenador:\n'
    printf '        scp -r root@ESTE-SERVIDOR:%s/sasmoney.db .\n' "$DATA_DIR"
    printf '      Para borrarlos:  sudo rm -rf %s\n' "$DATA_DIR"
  else
    ok "No había datos que conservar"
  fi
fi

echo
printf '\033[1;32m────────────────────────────────────────────────\033[0m\n'
printf '  Desinstalada. El resto del servidor queda intacto.\n'
printf '\033[1;32m────────────────────────────────────────────────\033[0m\n\n'

if command -v certbot >/dev/null 2>&1; then
  printf '  Si le pusiste certificado a un dominio sólo para esto, míralo con:\n'
  printf '    sudo certbot certificates\n'
  printf '  y bórralo con:  sudo certbot delete --cert-name NOMBRE\n\n'
fi
