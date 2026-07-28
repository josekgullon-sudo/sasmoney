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

## Paso 2: abrirla a internet con HTTPS

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

Siempre con una copia recién descargada, **nunca** con la que hay en
`/opt/sasmoney/app`: si el instalador que tienes instalado tuviera un fallo,
no podría arreglarse a sí mismo.

```bash
sudo rm -rf /tmp/sasmoney
git clone -b claude/saas-clientes-pagos-muh221 https://github.com/josekgullon-sudo/sasmoney.git /tmp/sasmoney
sudo bash /tmp/sasmoney/deploy/instalar.sh
```

El mismo script sirve para instalar y para actualizar: se trae la última versión,
**mantiene tu puerto, tu configuración y tus datos** y reinicia el servicio.

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

Sin rastro y sin rozar nada más:

```bash
sudo systemctl disable --now sasmoney.service sasmoney-copia.timer
sudo rm /etc/systemd/system/sasmoney*.service /etc/systemd/system/sasmoney*.timer
sudo systemctl daemon-reload
sudo rm -rf /opt/sasmoney
sudo userdel sasmoney
# Los datos se quedan por si acaso; bórralos tú cuando estés seguro:
# sudo rm -rf /var/lib/sasmoney
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

Para saber si el problema es de la aplicación o del proxy, prueba desde el propio
servidor:

```bash
curl -I http://127.0.0.1:4400/login
```

Si responde `HTTP/1.1 200 OK`, la aplicación está bien y el problema está en el
proxy o en el dominio.
