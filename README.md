# SaaS TotalFlix

Aplicación web para que tus trabajadoras apunten los clientes que hacen y lo que cobran,
y para que tú, como jefe, veas de un botón **cuánto le tienes que pagar a cada una**.

Pensada para usarse desde el móvil: apuntar un cobro son dos toques.

---

## Cómo funciona

### Para la trabajadora

1. Entra con su usuario y su contraseña.
2. Escribe **el importe** y pulsa *Apuntar cobro*. Ya está.
   - Los importes que más repite salen como botones, para no escribir.
   - El nombre del cliente es **opcional**: si lo deja vacío se numera solo
     (*Cliente 1*, *Cliente 2*…). Si quiere, puede poner un nombre o un mote.
   - **La fecha y la hora se ponen solas** con el momento en que lo apunta. Están en
     *Más detalles* por si hay que corregirlas, junto con el método de pago y las notas.
3. En *Mis cuentas* tiene todo lo suyo en una sola pantalla: lo facturado, lo que lleva
   ganado, cómo sale esa cuenta, lo que aún le deben, la comparación con los meses
   anteriores, los servicios apuntados y las liquidaciones que ya le han pagado. Puede mirar
   el día de hoy, un mes o el trozo de tiempo que quiera.

### Para el jefe

Cinco pantallas, cada una con una pregunta clara:

- **Resumen** — *¿cómo va?* Todo va **hasta hoy**: lo que entra, lo que se llevan ellas, los
  gastos y lo que queda. Y una fila por trabajador con lo que factura, su comisión, **su
  porcentaje de marketing** y lo que eso le cuesta, **lo que deja** y lo que le debes, con el
  botón de liquidar al lado. Al lado de cada cifra tienes la previsión de cómo acabaría el
  periodo si no entrara nada más.
- **Liquidar** — *¿cuánto le pago a X?* Eliges una trabajadora o todas. Cuando le
  pagues, pulsas *Liquidado* y su cuenta de ese periodo vuelve a cero: esos servicios quedan
  cerrados y ya no se cuentan otra vez ni se pueden modificar.
- **Caja** — *¿qué entra y qué sale por fuera de los servicios?* Gastos e ingresos, sueltos o
  recurrentes (**diarios**, mensuales, trimestrales o anuales), y el reparto de la inversión:
  la publicidad con el porcentaje que pongas a cada uno, y el resto de gastos a partes
  iguales.
- **Servicios** — todos los cobros, con filtros y descarga en CSV.
- **Trabajadores** — altas, contraseñas y cuánto se lleva cada una.

### El periodo: no sólo por meses

Todas las pantallas (las cinco del jefe y *Mis cuentas* de la trabajadora) miran **el trozo de
tiempo que tú elijas**, no sólo un mes:

- Los botones rápidos: **Hoy · Ayer · 7 días · 30 días · Este mes · Mes pasado**.
- Un **mes entero** cualquiera de los últimos trece.
- **Un día suelto**: pones esa fecha en *Desde* y dejas *Hasta* vacío.
- **Entre dos fechas** cualesquiera, aunque crucen de un mes a otro.

El periodo elegido te acompaña al saltar de una pantalla a otra, y va en la dirección web, así
que puedes guardar en favoritos "los últimos 7 días" o "el 14 de julio" y volver cuando quieras.

Debajo del título siempre pone en una frase qué estás mirando exactamente — *"Van 2 de los 31
días de agosto 2026: todo lo que ves es lo acumulado desde el día 1"* — para que no haya duda
entre "el mes hasta hoy" y "sólo hoy".

## Las tres formas de pagar a una trabajadora

Cada trabajadora tiene su propia regla y la cambias cuando quieras:

| Tipo | Qué hace | Ejemplo |
|---|---|---|
| **Un porcentaje** | Se lleva ese % de todo lo que factura | 40 % → factura 1.000 €, cobra 400 € |
| **Varios porcentajes por tramos** | El % sube según lo que facture | 0 € → 30 %, 2.000 € → 35 %, 4.000 € → 40 % |
| **Cantidad fija por servicio** | Cobra lo mismo por cada cliente | 15 € por cliente → 20 clientes, 300 € |

En los tramos puedes elegir cómo se aplican:

- **Sobre el total** (lo normal): si llega a 2.000 €, el 35 % se aplica a **todo**.
  Factura 3.400 € → 3.400 × 35 % = **1.190 €**.
- **Progresivo**: cada tramo cobra su % sólo sobre su parte.
  Factura 3.400 € → 2.000 × 30 % + 1.400 × 40 % = **1.160 €**.

Puedes poner tantos tramos como quieras, no sólo tres.

---

## Ponerla en marcha

Hace falta Node.js 24 (recomendado) o cualquier versión desde la 22.13.
No compila nada: SQLite viene dentro de Node, así que `npm install` tarda segundos.

```bash
npm install
npm start
```

Abre <http://localhost:4400>. La primera vez se crea el usuario administrador y la
contraseña se imprime en la consola (por defecto `admin` / `cambiar123`).
**Cámbiala nada más entrar**: la aplicación te avisa con una banda amarilla hasta que lo hagas.

### Configuración

Todo es opcional; si no pones nada, funciona con los valores por defecto.
Puedes crear un fichero `.env` (mira `.env.example`) o poner las variables en tu servidor.

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto donde escucha | `4400` |
| `DATA_DIR` | Carpeta donde se guarda la base de datos | `./data` |
| `DB_FILE` | Ruta completa del fichero de base de datos | `<DATA_DIR>/sasmoney.db` |
| `ADMIN_USER` | Usuario del jefe (sólo al crear la base de datos) | `admin` |
| `ADMIN_PASSWORD` | Su contraseña (sólo al crear la base de datos) | `cambiar123` |
| `TZ_APP` | Zona horaria del negocio | `Europe/Madrid` |
| `COOKIE_SECURE` | Pon `1` cuando la sirvas por HTTPS | apagado |
| `SESSION_DAYS` | Días que dura la sesión sin volver a entrar | `30` |
| `BRAND` | Nombre que se ve en la aplicación | `SaaS TotalFlix` |
| `HOST` | Interfaz donde escucha (`127.0.0.1` si hay un proxy delante) | `0.0.0.0` |
| `LOGIN_MAX_FALLOS` | Intentos de entrada fallidos antes de bloquear | `8` |
| `LOGIN_BLOQUEO_MIN` | Minutos que dura el bloqueo | `15` |

### Subirla a un servidor

**→ [DESPLIEGUE.md](DESPLIEGUE.md) tiene la guía paso a paso** para dejarla funcionando
en un servidor Linux con HTTPS, arranque automático y copias de seguridad, sin tocar nada
de lo que ya haya instalado en esa máquina. Resumen:

```bash
sudo rm -rf /tmp/sasmoney
git clone -b claude/saas-clientes-pagos-muh221 https://github.com/josekgullon-sudo/sasmoney.git /tmp/sasmoney
sudo bash /tmp/sasmoney/deploy/instalar.sh
```

Después de eso **se actualiza sola cada noche**: hace copia de seguridad, se trae la
versión nueva y comprueba que responde; si no respondiera, vuelve sola a la anterior.
Se puede desactivar con `sudo systemctl disable --now sasmoney-actualizar.timer`.

A mano, en cualquier otro sitio (Railway, Render, Fly.io…):

1. Monta un disco persistente y apunta `DATA_DIR` a él (por ejemplo `/data`).
2. Pon `COOKIE_SECURE=1` y `ADMIN_PASSWORD` con una contraseña tuya.
3. Si delante hay un proxy con HTTPS, añade `HOST=127.0.0.1` para que la aplicación no
   quede accesible por otro camino.
4. Arranca con `npm start`.

Con Docker:

```bash
docker build -t sasmoney .
docker run -p 4400:4400 -v sasmoney-data:/data \
  -e DATA_DIR=/data -e COOKIE_SECURE=1 -e ADMIN_PASSWORD='tu-contraseña' sasmoney
```

> **Copias de seguridad**: guarda de vez en cuando el contenido de `DATA_DIR`.
> Ahí está todo.

---

## Si algo no arranca

- **`npm install` se queda parado varios minutos.** No debería pasar: las dos únicas
  dependencias (Express y bcryptjs) son JavaScript puro y no compilan nada. Si se queda
  quieto, corta con `Ctrl+C`, borra la carpeta `node_modules` y vuelve a intentarlo.
- **`Cannot find module 'express'`.** El `npm install` no llegó a terminar. Repítelo y
  espera a que devuelva el símbolo del sistema antes de lanzar `npm start`.
- **`Could not find a production build in the '.next' directory`.** Ese error es de otro
  proyecto: estás lanzando el comando desde otra carpeta. Comprueba con `pwd` que estás
  dentro de `sasmoney`.
- **Dice que tu Node no trae SQLite incorporado.** Instala Node 24 desde
  <https://nodejs.org> y repite `npm start`.
- **El puerto está ocupado.** Arranca en otro con `PORT=5555 npm start`.

## Detalles que conviene saber

- **No hay nada que compilar ni ninguna base de datos que instalar.** SQLite viene
  incorporado en Node (`node:sqlite`), así que la aplicación son dos dependencias y ya.
- **El dinero se guarda en céntimos** (números enteros), así que las cuentas no arrastran
  errores de decimales.
- **Un servicio liquidado se bloquea**: ni la trabajadora ni tú podéis editarlo o borrarlo.
  Es lo que hace que la cifra que ya pagaste no cambie por detrás.
- **La comisión nunca supera lo facturado.** Si una regla de cantidad fija diera más que la
  caja del periodo, se limita al total y se avisa en el desglose.
- **Los gastos e ingresos recurrentes no se guardan repetidos**: se guarda la primera fecha
  y las siguientes se calculan, así que nunca se acaban ni hay que renovarlos.
- **La caja del mes** es lo facturado, menos las comisiones, más los otros ingresos, menos
  los gastos.
- **Las cuentas van hasta hoy**, no hasta el final del periodo. El día 2 del mes, de una
  publicidad de 20 €/día se han gastado 40 €, no 620 €: enseñar el mes entero desde el día 1
  hace parecer que la empresa está en números rojos cuando no lo está. La previsión de cómo
  acabaría se ve al lado, en gris, para saber por dónde van los tiros.
- **Un gasto diario cuenta tantas veces como días tenga el mes**: 20 €/día son 620 € en un
  mes de 31 días y 560 € en febrero. Si empieza a mitad de mes, sólo cuentan los días desde
  esa fecha. Y se puede **cambiar el importe de un día suelto** sin tocar los demás, para los
  días en que se invierte más o menos.
- **La inversión la repartes tú**: en Caja le pones a cada trabajador su porcentaje fijo
  (60 %, 30 %…) y se aplica tal cual, mes tras mes, hasta que lo cambies. Ese porcentaje y
  los euros que lleva gastados hasta hoy salen en su fila del Resumen. El porcentaje que
  escribes es el que se usa: si suman 90, el 10 % restante **queda sin asignar** y lo paga la
  empresa, sin cargarlo a nadie. Hay un botón que rellena los porcentajes con lo que ha
  facturado cada uno, por si quieres partir de ahí, pero es sólo un atajo.
- **El resto de gastos** (alquiler, gestoría, gasolina…) se divide **a partes iguales** entre
  los trabajadores en activo, sin nada que configurar: con dos son la mitad cada uno, y si
  entra un tercero pasan a un tercio automáticamente. Quien está de baja en la aplicación no
  carga con nada.
- **Cada trabajadora sólo ve lo suyo.** El acceso a la parte del jefe está cerrado por rol.
- **Las contraseñas no se pueden probar a lo bruto**: tras 8 fallos seguidos, esa
  combinación de usuario y origen queda bloqueada 15 minutos.
- Al cambiarle la contraseña a alguien, sus sesiones abiertas se cierran solas.

## Desarrollo

```bash
npm run dev     # arranca recargando al guardar
npm test        # tests del motor de cálculo de comisiones
```

Estructura:

```
src/
  server.js          arranque, cookies, sesiones y seguridad básica
  db.js              esquema SQLite (node:sqlite) y creación del administrador
  commission.js      el motor de cálculo (porcentaje, tramos, fijo)
  repo.js            consultas: servicios, totales, liquidaciones
  util.js            fechas, zona horaria, marca y escapado de HTML
  period.js          qué trozo de tiempo se mira: un día, un mes o dos fechas
  expenses.js        gastos e ingresos, y cálculo de los que se repiten
  throttle.js        freno contra los intentos de entrada a lo bruto
  routes/            auth.js · worker.js · admin.js
  views/             HTML de cada pantalla
public/              estilos y un poco de JavaScript de interfaz
test/                tests del motor de cálculo
```
