#!/usr/bin/env bash
#
# Copia de seguridad de la base de datos de SaaS TotalFlix.
#
# Para la aplicación un segundo, copia el fichero y la vuelve a arrancar: así la
# copia queda íntegra (copiada en caliente podría salir a medias). Guarda las 30
# últimas y borra las más viejas.
#
# A mano:      sudo /opt/sasmoney/copia-seguridad.sh
# Automática:  la lanza sola cada noche el temporizador sasmoney-copia.timer
#
set -euo pipefail

DATA_DIR=${DATA_DIR:-/var/lib/sasmoney}
DEST=${DEST:-$DATA_DIR/copias}
CONSERVAR=${CONSERVAR:-30}
DB=$DATA_DIR/sasmoney.db

[ -f "$DB" ] || { echo "No encuentro la base de datos en $DB"; exit 1; }

mkdir -p "$DEST"
DESTINO=$DEST/sasmoney_$(date +%Y-%m-%d_%H%M).tar.gz

# Se para el servicio sólo si estaba en marcha, y se vuelve a dejar como estaba.
ESTABA_ACTIVO=0
if systemctl is-active --quiet sasmoney.service 2>/dev/null; then
  ESTABA_ACTIVO=1
  systemctl stop sasmoney.service
fi

ficheros=(sasmoney.db)
[ -f "$DB-wal" ] && ficheros+=(sasmoney.db-wal)
[ -f "$DB-shm" ] && ficheros+=(sasmoney.db-shm)

# Pase lo que pase con la copia, la aplicación tiene que volver a arrancar.
set +e
tar -czf "$DESTINO" -C "$DATA_DIR" "${ficheros[@]}"
RESULTADO=$?
set -e

if [ "$ESTABA_ACTIVO" = "1" ]; then
  systemctl start sasmoney.service
fi

if [ "$RESULTADO" -ne 0 ]; then
  rm -f "$DESTINO"
  echo "La copia ha fallado (código $RESULTADO). La aplicación sigue funcionando."
  exit "$RESULTADO"
fi

chmod 600 "$DESTINO"

# Se borran las copias más antiguas de la cuenta.
sobrantes=$(ls -1t "$DEST"/sasmoney_*.tar.gz 2>/dev/null | tail -n +$((CONSERVAR + 1)) || true)
if [ -n "$sobrantes" ]; then
  echo "$sobrantes" | xargs -r rm -f
fi

echo "Copia guardada en $DESTINO ($(du -h "$DESTINO" | cut -f1))"
