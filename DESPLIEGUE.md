# Subir SasMoney a tu servidor

Guía para dejarla funcionando en un servidor Linux **sin tocar nada de lo que ya
tienes instalado** (Emby incluido).

## Por qué no molesta a Emby

| | Emby | SasMoney |
|---|---|---|
| Puerto | 8096 (y 8920) | 4400 |
| Usuario del sistema | el suyo | `sasmoney`, creado aparte y sin acceso por consola |
| Carpetas | las suyas | `/opt/sasmoney` y `/var/lib/sasmoney` |
| Base de datos | la suya | un fichero propio |

El instalador además:

- **Comprueba que el puerto esté libre** antes de usarlo, y coge otro si no lo está.
- **No instala ni actualiza el Node.js del sistema.** Si el que hay sirve, lo aprovecha
  tal cual; si es antiguo, se descarga uno *sólo para esta aplicación* dentro de
  `/opt/sasmoney/runtime`. Lo que ya tengas instalado se queda exactamente igual.
- Arranca el servicio con permisos recortados: sólo puede escribir en su carpeta de datos.
  Aunque quisiera, no podría tocar los ficheros de Emby.

---

## Paso 1: instalar

Entra en el servidor por SSH y ejecuta:

```bash
git clone -b claude/saas-clientes-pagos-muh221 https://github.com/josekgullon-sudo/sasmoney.git /tmp/sasmoney
sudo bash /tmp/sasmoney/deploy/instalar.sh
```

Tarda menos de un minuto. Al terminar te enseña el usuario y **una contraseña
aleatoria** para entrar. Apúntala (también queda guardada en
`/opt/sasmoney/sasmoney.env`).

A partir de ahí la aplicación:

- arranca sola cuando se enciende el servidor,
- se reinicia sola si se cayera,
- hace una copia de seguridad todas las noches a las 4:30.

De momento sólo responde dentro del propio servidor (`127.0.0.1:4400`). Eso es a
propósito: no queda expuesta a internet hasta que tú lo decidas en el paso 2.

> **Ojo con `127.0.0.1`:** esa dirección significa *"este mismo ordenador"*. Si la
> escribes en el navegador de tu portátil, el navegador la busca **en tu portátil**, no
> en el servidor, y sale `ERR_CONNECTION_REFUSED`. Es normal y no significa que la
> instalación haya fallado.
>
> Para verla desde tu ordenador **antes** de montar el dominio, abre un túnel por SSH:
>
> ```bash
> ssh -L 4400:127.0.0.1:4400 usuario@ip-de-tu-servidor
> ```
>
> Deja esa ventana abierta y entonces sí, abre <http://127.0.0.1:4400> en tu navegador:
> ahora el 4400 de tu ordenador sale por el túnel hasta el del servidor. Al cerrar la
> ventana de SSH se acaba el túnel.
>
> Para comprobar desde el propio servidor que está funcionando:
> `curl -I http://127.0.0.1:4400/login` debe responder `HTTP/1.1 200 OK`.

## Paso 2 (rápido): entrar por IP, sin dominio

Igual que se entra a Emby: `http://LA-IP-DE-TU-SERVIDOR:4400`. Es lo más rápido
para empezar hoy mismo, pero **sin candado**: las contraseñas y los importes viajan
a la vista de cualquiera que comparta el wifi con tus trabajadoras. Vale para probar
y para ir apuntando desde el local; para el uso diario por la calle, pásate al
apartado siguiente en cuanto puedas.

Hay que cambiar dos cosas en `/opt/sasmoney/sasmoney.env`:

```bash
sudo sed -i 's/^HOST=.*/HOST=0.0.0.0/' /opt/sasmoney/sasmoney.env
sudo sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=0/' /opt/sasmoney/sasmoney.env
sudo systemctl restart sasmoney
```

- `HOST=0.0.0.0` la saca del "sólo dentro del servidor" a toda la red.
- `COOKIE_SECURE=0` es **imprescindible**: con el valor 1 el navegador sólo guarda la
  sesión si hay HTTPS, así que por `http://` no podrías ni entrar.

Si el servidor tiene cortafuegos, abre el puerto (esto no afecta a Emby):

```bash
sudo ufw status                 # ¿está activo?
sudo ufw allow 4400/tcp         # sólo si lo está
```

Y comprueba también el panel de tu proveedor (Hetzner, OVH, Contabo…), que suele
traer su propio cortafuegos aparte.

> Cuando montes el HTTPS del apartado siguiente, deja otra vez `HOST=127.0.0.1` y
> `COOKIE_SECURE=1`, y cierra el 4400 con `sudo ufw delete allow 4400/tcp`.

### ¿HTTPS sin comprar dominio?

Se puede, y es casi el mismo trabajo: servicios como `nip.io` convierten tu IP en un
nombre gratis. Si tu IP es 163.172.109.52, el nombre `sasmoney.163.172.109.52.nip.io`
ya apunta a ella sin que tengas que registrar ni configurar nada, y Let's Encrypt
emite certificado para él. Sigue el apartado siguiente usando ese nombre en lugar de
un dominio propio.

## Paso 3: abrirla a internet con HTTPS

Tus trabajadoras necesitan entrar desde el móvil por la calle, así que hace falta
un dominio y un candado (HTTPS). **No abras el puerto 4400 en el router**: sin
HTTPS las contraseñas viajarían a la vista.

Necesitas un nombre, por ejemplo `sasmoney.tudominio.com`, apuntando a la IP de tu
servidor. Si ya entras a Emby desde fuera con un dominio, usa un subdominio de ese
mismo.

Elige **una** de estas tres opciones.

### Opción A: ya tienes Nginx (lo más habitual si accedes a Emby desde fuera)

Añades un fichero nuevo, sin tocar el de Emby:

```bash
sudo cp /opt/sasmoney/app/deploy/nginx.ejemplo.conf /etc/nginx/sites-available/sasmoney
sudo nano /etc/nginx/sites-available/sasmoney     # cambia el dominio y, si acaso, el puerto
sudo ln -s /etc/nginx/sites-available/sasmoney /etc/nginx/sites-enabled/
sudo nginx -t                                     # comprueba que no hay errores
sudo systemctl reload nginx
sudo certbot --nginx -d sasmoney.tudominio.com    # pone el candado, gratis
```

`nginx -t` es la red de seguridad: si algo estuviera mal, avisa **antes** de recargar,
así que Emby no se queda sin servicio en ningún momento.

### Opción B: no tienes ningún proxy todavía

Caddy es lo más sencillo: pone y renueva el certificado él solo.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo nano /etc/caddy/Caddyfile     # pega el contenido de deploy/Caddyfile.ejemplo
sudo systemctl reload caddy
```

Necesita los puertos 80 y 443 libres y abiertos en el router.

> Antes de instalar Caddy, comprueba que no haya ya algo usando esos puertos:
> `sudo ss -lntp | grep -E ':80 |:443 '`. Si sale algo, estás en el caso de la opción A.

### Opción C: sin abrir ningún puerto del router (Cloudflare Tunnel)

Si prefieres no tocar el router, o tu operador no te deja, Cloudflare hace de puente.
Es gratis y necesita que el dominio esté en Cloudflare.

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb
sudo cloudflared tunnel login
sudo cloudflared tunnel create sasmoney
sudo cloudflared tunnel route dns sasmoney sasmoney.tudominio.com
```

Y en `/etc/cloudflared/config.yml`:

```yaml
tunnel: sasmoney
credentials-file: /root/.cloudflared/sasmoney.json
ingress:
  - hostname: sasmoney.tudominio.com
    service: http://127.0.0.1:4400
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
```

## Paso 3: comprobar y asegurar

1. Entra desde el móvil (con datos, no con el wifi de casa) en
   `https://sasmoney.tudominio.com`. Debe salir el candado.
2. Entra con `admin` y la contraseña que te dio el instalador.
3. **Cámbiala** en *Mi cuenta*. La banda amarilla desaparece cuando lo hagas.
4. Da de alta a tus trabajadoras en *Trabajadores* y pásales su usuario y contraseña.
5. Diles que abran la web en el móvil y le den a *Compartir → Añadir a pantalla de
   inicio*: les queda como si fuera una aplicación.

---

## El día a día

```bash
sudo systemctl status sasmoney      # ¿está funcionando?
sudo systemctl restart sasmoney     # reiniciarla
sudo journalctl -u sasmoney -f      # ver qué está pasando (Ctrl+C para salir)
```

### Actualizarla

**No tienes que hacer nada: se actualiza sola cada noche a las 5:00.**

Antes de tocar nada hace una copia de seguridad, se trae la versión nueva y comprueba
que la aplicación responde. **Si no respondiera, vuelve sola a la versión anterior** y te
la deja funcionando; nunca te quedas con la aplicación caída por una actualización.

```bash
sudo systemctl list-timers sasmoney-actualizar   # cuándo toca la siguiente
sudo journalctl -u sasmoney-actualizar -n 30     # qué pasó en las últimas
sudo /opt/sasmoney/actualizar.sh                 # actualizar ahora mismo
```

Si prefieres actualizar tú a mano y que no se toque nada por su cuenta:

```bash
sudo systemctl disable --now sasmoney-actualizar.timer
```

Y para volver a activarla:

```bash
sudo systemctl enable --now sasmoney-actualizar.timer
```

Como último recurso, el instalador también sirve para actualizar (siempre desde una
copia recién descargada, nunca desde `/opt/sasmoney/app`):

```bash
sudo rm -rf /tmp/sasmoney
git clone -b claude/saas-clientes-pagos-muh221 https://github.com/josekgullon-sudo/sasmoney.git /tmp/sasmoney
sudo bash /tmp/sasmoney/deploy/instalar.sh
```

### Copias de seguridad

Se hace una sola cada noche en `/var/lib/sasmoney/copias` (se guardan las 30 últimas).

```bash
sudo /opt/sasmoney/copia-seguridad.sh          # hacer una ahora mismo
ls -lh /var/lib/sasmoney/copias                # ver las que hay
sudo systemctl list-timers sasmoney-copia      # cuándo toca la siguiente
```

> Están en el mismo servidor: si se estropea el disco, se pierden con él.
> Bájate una de vez en cuando a tu ordenador:
> `scp usuario@tuservidor:/var/lib/sasmoney/copias/sasmoney_*.tar.gz .`

### Recuperar una copia

```bash
sudo systemctl stop sasmoney
sudo tar -xzf /var/lib/sasmoney/copias/sasmoney_2026-07-28_0430.tar.gz -C /var/lib/sasmoney
sudo chown -R sasmoney:sasmoney /var/lib/sasmoney
sudo systemctl start sasmoney
```

### Desinstalarla del todo

Quita sólo lo suyo (servicio, temporizador, `/opt/sasmoney`, su usuario y su fichero
de nginx si lo hubiera) y deja intacto el resto del servidor:

```bash
sudo rm -rf /tmp/sasmoney
git clone -b claude/saas-clientes-pagos-muh221 https://github.com/josekgullon-sudo/sasmoney.git /tmp/sasmoney
sudo bash /tmp/sasmoney/deploy/desinstalar.sh
```

**Los datos se conservan** en `/var/lib/sasmoney`, por si te los quieres llevar a otro
servidor. Para borrarlos también, añade `--con-datos`:

```bash
sudo bash /tmp/sasmoney/deploy/desinstalar.sh --con-datos
```

Si la instalaste en el servidor equivocado y ya habías apuntado cosas, llévate los datos
antes de borrar nada. Desde tu ordenador:

```bash
# 1. Traer la base de datos del servidor equivocado
scp root@SERVIDOR-VIEJO:/var/lib/sasmoney/sasmoney.db .

# 2. Instalarla en el servidor bueno y pararla un momento
ssh root@SERVIDOR-BUENO 'systemctl stop sasmoney'

# 3. Subir la base de datos y dejarla en su sitio
scp sasmoney.db root@SERVIDOR-BUENO:/var/lib/sasmoney/sasmoney.db
ssh root@SERVIDOR-BUENO 'chown sasmoney:sasmoney /var/lib/sasmoney/sasmoney.db && systemctl start sasmoney'
```

---

## Si algo va mal

| Qué ves | Qué pasa |
|---|---|
| `Job for sasmoney.service failed` | Mira el motivo con `sudo journalctl -u sasmoney -n 30` |
| El navegador no carga nada | Comprueba el proxy: `sudo systemctl status nginx` (o `caddy`) |
| `502 Bad Gateway` | La aplicación está parada: `sudo systemctl restart sasmoney` |
| Sale sin candado o da error de certificado | El certificado no se emitió: repite `sudo certbot --nginx -d tu.dominio` |
| El instalador dice que el puerto está ocupado | Ya cogió otro automáticamente; míralo en `/opt/sasmoney/sasmoney.env` y ajústalo en el proxy |
| **He actualizado y la web se ve igual** | Reinicia con `sudo systemctl restart sasmoney` y recarga el navegador con Ctrl+F5 (Cmd+Shift+R en Mac) |

Para saber qué versión está corriendo de verdad:

```bash
sudo git -C /opt/sasmoney/app log -1 --format='%h %cd %s' --date=short
systemctl show -p ActiveEnterTimestamp --value sasmoney
```

La segunda línea dice desde cuándo está en marcha el proceso: si es anterior a tu
última actualización, es que no se reinició.

Para saber si el problema es de la aplicación o del proxy, prueba desde el propio
servidor:

```bash
curl -I http://127.0.0.1:4400/login
```

Si responde `HTTP/1.1 200 OK`, la aplicación está bien y el problema está en el
proxy o en el dominio.
