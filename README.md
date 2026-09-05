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
   - Y al apuntarlo **suena el chin-chin de la caja y caen billetes por la pantalla**. Si no
     pega en ese momento, en *Mi cuenta* se le quita el sonido (los billetes se quedan).
3. En *Mis cuentas* tiene todo lo suyo en una sola pantalla: lo facturado, lo que lleva
   ganado, cómo sale esa cuenta, lo que aún le deben, la comparación con los meses
   anteriores, los servicios apuntados y las liquidaciones que ya le han pagado. Puede mirar
   el día de hoy, un mes o el trozo de tiempo que quiera.

### Para el jefe

Cinco pantallas, cada una con una pregunta clara:

- **Resumen** — *¿cómo va?* Lo que entra, lo que se llevan ellas, los gastos y lo que queda,
  con **las gráficas del periodo** (ver abajo).
  Y una fila por trabajador con lo que factura, su comisión, **su porcentaje de marketing** y
  lo que eso le cuesta, **lo que deja** y lo que le debes, con el botón de liquidar al lado.
  Mientras el mes está en marcha eliges si quieres verlo entero o sólo hasta hoy.
- **Liquidar** — *¿cuánto le pago a X?* Eliges una trabajadora o todas. Cuando le
  pagues, pulsas *Liquidado* y su cuenta de ese periodo vuelve a cero: esos servicios quedan
  cerrados y ya no se cuentan otra vez ni se pueden modificar. Y si sólo le pagas una parte,
  se puede recortar (ver abajo).
- **Caja** — *¿qué entra y qué sale por fuera de los servicios?* Gastos e ingresos, sueltos o
  recurrentes (**diarios**, mensuales, trimestrales o anuales), y el reparto de la inversión:
  la publicidad con el porcentaje que pongas a cada uno, y el resto de gastos a partes
  iguales. Los gastos diarios tienen **un calendario del mes** para apuntar lo que se gastó
  de verdad cada día.
- **Analíticas** — *¿por dónde va el negocio?* Las cifras del periodo con **cuánto han subido o
  bajado** respecto a otro trozo de tiempo, y el reparto por trabajador, por pueblo, por forma de
  pago, por importe y por hora. Ver abajo.
- **Servicios** — todos los cobros, con filtros y descarga en CSV.
- **Trabajadores** — altas, contraseñas, cuánto se lleva cada una, la retención y el umbral de
  gastos.

### El periodo: no sólo por meses

Todas las pantallas (las cinco del jefe y *Mis cuentas* de la trabajadora) miran **el trozo de
tiempo que tú elijas**, no sólo un mes:

- Los botones rápidos: **Hoy · Ayer · 7 días · 30 días · Este mes · Mes pasado**.
- Un **mes entero** cualquiera de los últimos trece.
- **Un día suelto**: pones esa fecha en *Desde* y dejas *Hasta* vacío.
- **Entre dos fechas** cualesquiera, aunque crucen de un mes a otro.

El periodo elegido te acompaña al saltar de una pantalla a otra, y va en la dirección web, así
que puedes guardar en favoritos "los últimos 7 días" o "el 14 de julio" y volver cuando quieras.

Debajo del título siempre pone en una frase qué estás mirando exactamente, para que no haya
duda entre "el mes entero" y "lo que llevas". Y mientras al periodo le queden días, dos botones
más dejan elegir entre **Todo el mes** y **Sólo hasta hoy**.

## Las gráficas

En el Resumen, debajo de las cifras, hay dos gráficas para ver de un vistazo **cuáles son los
mejores días**. Cada barra responde: al pasarle el ratón se ilumina y sale un cartelito con el
detalle del día; en el móvil, donde no hay ratón, el cartelito sale al tocarla. Cada barra es un
botón de verdad, así que también se llega con el tabulador y lo lee un lector de pantalla.

- **Día a día**: una barra por día con lo que facturó todo el equipo. La rayita naranja es lo que
  costó ese día; si la barra no llega, el día no cubrió gastos y se pinta en rojo. El mejor día
  sale más oscuro y con su nombre y su cifra debajo.
- **Por día de la semana**: la **media** de cada lunes, martes… del periodo. Es la media y no la
  suma a propósito: si en el periodo hay tres sábados y dos domingos, sumar engañaría.

Si estás mirando **un solo día**, en lugar de esas dos sale **hora a hora**, con la mejor hora.

Las barras son HTML normal, no un dibujo ni una librería: los números son texto de verdad, se
leen bien en cualquier móvil y la página no engorda nada.

## Analíticas

Una pantalla entera de números, con **comparación** contra otro trozo de tiempo: el periodo
anterior, el mes pasado, el año pasado o dos fechas que elijas. Cada cifra lleva debajo cuánto ha
subido o bajado, en verde o en rojo según convenga (en los gastos, subir es rojo).

- **Lo que ha pasado**: facturado, servicios, ticket medio, por día, días con trabajo.
- **Lo que deja**: gastos, comisiones, beneficio y margen, cuánto vuelve por cada euro de
  marketing y cuánto cuesta traer un cliente.
- **Día a día**, **por día de la semana** y **por hora del día**. En las dos últimas, comparando,
  cada columna lleva dos barras: el periodo y con el que comparas.
- **Repartos**: por trabajador, por pueblo, por forma de pago y por tramo de importe, cada uno con
  su porcentaje del total.
- **Clientes que repiten**, de los que tienen nombre apuntado.
- **Los últimos doce meses**, que no depende del periodo: es la foto larga.

## La retención

De cada servicio **a partir de una fecha** se le descuenta un porcentaje a lo que le tocaba
cobrar: si le tocaban 100 €, cobra 85 €. Lo retenido se queda en la empresa.

El porcentaje y la fecha los pones tú en **Trabajadores**; de fábrica viene el **15 % desde el
10 de agosto de 2026**, y con un 0 se desactiva.

Va por la **fecha del servicio**, no por cuándo lo liquides: los servicios anteriores se pagan
enteros aunque los pagues hoy, así que una liquidación que cruce la fecha sale bien sin
partirla a mano. Por ejemplo, con el 40 % de comisión y 500 € facturados —250 € del día 9 y
250 € del día 10—:

| | |
|---|---|
| 500,00 € × 40 % | 200,00 € |
| − Retención 15 % (servicios desde el 10/08/2026) | −15,00 € |
| **A pagar** | **185,00 €** |

Sólo se retienen los 100 € de comisión del día 10, no los 200 € enteros. Con la regla de
cantidad fija por servicio lo que cuenta son los servicios, no los euros: de 4 servicios a
15 €, si dos son posteriores a la fecha, se retiene el 15 % de esos 30 €.

Cambiar el porcentaje **no toca las liquidaciones ya cerradas**: cada una guarda lo que se
retuvo el día que se cerró.

## Liquidar sólo una parte

A veces no se paga todo de golpe. En *Liquidar*, dentro de **Liquidar sólo una parte**, hay dos
recortes que se pueden usar sueltos o juntos:

- **Liquidar todo hasta el día X a las Y** — un momento de corte. El día del corte **manda
  sobre el periodo de arriba**: aunque estés mirando agosto entero, si cortas hoy a las 16:00
  se liquida del 1 hasta hoy a las 16:00. La hora es opcional (vacía = ese día entero), y hay
  un botón de *Hasta ahora mismo* que pone el día y la hora de este momento.
- **Pagar como mucho** — un tope de lo que vas a pagar. Se cierran los servicios **más
  antiguos** que quepan dentro de ese tope, que es lo justo: primero se salda lo que lleva más
  tiempo debiéndose.

Lo que ves en pantalla antes de pulsar es exactamente lo que se va a cerrar, con un aviso de
cuántos servicios se quedan fuera. Puedes liquidar en varios trozos y las cuentas cuadran: tres
liquidaciones parciales de un día suman lo mismo que una sola del día entero.

Los recortes quedan anotados en la liquidación cerrada (*"hasta el 22/08/2026 a las 16:00"*,
*"tope de 60,00 €"*), y el periodo que se guarda es hasta donde se liquidó de verdad, no el que
estabas mirando.

Cada trozo se calcula con la regla completa del trabajador, no repartiendo un total: con
tramos, la comisión no es proporcional a cada servicio, así que la única manera de saber lo que
se paga por un grupo es calcularlo sobre ese grupo.

## Comisionar sólo por encima de los gastos

Se puede poner que **hasta que entre todos no se cubre lo que cuesta el día, nadie comisiona**.
A partir de ahí se comisiona sobre lo que pasa de los gastos, y cuanto más se genera, mejor
porcentaje. Se activa y se configura en **Trabajadores**.

La cuenta va **día a día**:

1. Lo que ha facturado el equipo ese día, menos lo que costó el día: eso es el **exceso**.
   Si sale negativo, ese día no comisiona nadie.
2. El exceso se reparte entre los trabajadores **según lo que ha facturado cada uno ese día**.
   El umbral se cubre entre todos, así que el exceso también se reparte entre todos.
3. A la parte de cada uno se le aplica **su porcentaje de siempre más los puntos del tramo**
   que alcance con esa parte.

La escalera es **una sola para todos y va en puntos**, no en porcentajes cerrados: así cada
trabajadora conserva su base. Con *desde 500 € → +10*, una que va al 40 % pasa al 50 % y otra
que va al 35 % pasa al 45 %. El tramo alcanzado se aplica a **todo** el exceso de ese día, no
sólo a la parte que asoma.

Un día con 150 € de gastos, el equipo factura 900 € (Anita 750 €, Milu 150 €) y la escalera es
*0 € → +0, 200 € → +5, 500 € → +10*:

| | Anita (40 %) | Milu (35 %) |
|---|---|---|
| Ha facturado | 750,00 € | 150,00 € |
| Su parte del exceso (750 € entre los dos) | 625,00 € | 125,00 € |
| Tramo que alcanza | +10 → **50 %** | +0 → **35 %** |
| **Se lleva** | **312,50 €** | **43,75 €** |

En la liquidación sale el desglose y una tabla **día a día** con lo que facturó el equipo, lo
que costó el día, la parte de cada uno y el porcentaje que le tocó, para poder comprobarlo.

Sólo se aplica a quien cobra **un porcentaje**. A los de tramos propios o cantidad fija por
servicio se les sigue pagando con su regla de siempre.

## Las cuatro formas de pagar a una trabajadora

Cada trabajadora tiene su propia regla y la cambias cuando quieras:

| Tipo | Qué hace | Ejemplo |
|---|---|---|
| **Un porcentaje** | Se lleva ese % de todo lo que factura | 40 % → factura 1.000 €, cobra 400 € |
| **Varios porcentajes por tramos** | El % sube según lo que facture | 0 € → 30 %, 2.000 € → 35 %, 4.000 € → 40 % |
| **Cantidad fija por servicio** | Cobra lo mismo por cada cliente | 15 € por cliente → 20 clientes, 300 € |
| **Un porcentaje del beneficio** | Cobra de lo que le queda limpio **a la empresa entera** | La empresa el 60 %, él el 40 % |

En los tramos puedes elegir cómo se aplican:

- **Sobre el total** (lo normal): si llega a 2.000 €, el 35 % se aplica a **todo**.
  Factura 3.400 € → 3.400 × 35 % = **1.190 €**.
- **Progresivo**: cada tramo cobra su % sólo sobre su parte.
  Factura 3.400 € → 2.000 × 30 % + 1.400 × 40 % = **1.160 €**.

Puedes poner tantos tramos como quieras, no sólo tres.

### Un porcentaje del beneficio de la empresa

Para quien no hace clientes pero se lleva parte del negocio. No comisiona: cobra un porcentaje de
lo que le queda **limpio a la empresa entera**.

```
  lo que factura el equipo
+ los otros ingresos de la caja
− todos los gastos (con su IVA, repartidos por días)
− lo que cobran las trabajadoras
─────────────────────────────────
= beneficio, que se parte entre la empresa y él
```

Un mes en el que el equipo factura 10.000 €, hay 3.000 € de gastos y las trabajadoras cobran
4.000 €: quedan 3.000 € de beneficio, la empresa se queda 1.800 € y él cobra 1.200 € (menos la
retención, que también se le aplica).

Tres cosas propias de esta regla:

- **Los días malos restan.** Aquí no se pone a cero el día que no cubre gastos como en el umbral:
  se suma el periodo entero, porque eso es lo que gana de verdad el negocio. Si el total sale en
  pérdidas no cobra nada, pero tampoco pone dinero.
- **Los días que aún no han pasado no cuentan.** No han podido facturar, pero sus gastos fijos ya
  están repartidos; contarlos daría pérdidas siempre. Se cuenta hasta hoy.
- **Al liquidarle se cierran días, no servicios** (no tiene). Los días ya pagados no vuelven a
  contar, así que puedes pagarle por semanas o por meses sin miedo a pagar dos veces lo mismo.

En el Resumen sale en su propio apartado, *Reparto del beneficio*, y lo que se lleva ya está
descontado de "Me queda".

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
- **Los gastos que se repiten se reparten por días.** Un alquiler de 500 € al mes no se gasta
  de golpe el día que se paga: cubre todo el mes. Así que si miras **un solo día** te tocan
  500/31 = **16,13 €**, no 500 € ni 0 €. Lo mismo con los trimestrales y los anuales, que se
  reparten entre los días de su trimestre o de su año. Los diarios ya van por días y los pagos
  sueltos son de un día concreto: esos no se reparten.
- **El reparto va por meses naturales**, no por la fecha en que lo diste de alta. Un gasto de
  200 € al mes apuntado el día 20 cuenta **200 € en ese mes**, no 200 × 12/31 con el resto
  cayendo en el mes siguiente: "doscientos euros al mes" son doscientos euros ese mes. Por eso
  el mes entero suma siempre el recibo exacto, sin céntimos perdidos por el redondeo.
- **Mientras el periodo está en marcha puedes verlo de dos maneras**, con un botón:
  *Todo el mes* (lo que va a costar, con los gastos que aún faltan por caer) o *Sólo hasta
  hoy* (lo que llevas gastado de verdad). Lo facturado siempre es lo que llevas: eso no se
  puede adivinar.
- **Un gasto diario cuenta tantas veces como días tenga el mes**: 20 €/día son 620 € en un
  mes de 31 días y 560 € en febrero. Si empieza a mitad de mes, sólo cuentan los días desde
  esa fecha.
- **Los importes se pueden apuntar sin IVA.** En cada gasto hay una casilla *El importe es sin
  IVA* con su porcentaje (21 % por defecto). El importe se guarda tal y como lo escribes —para
  poder seguir copiando la cifra que da la plataforma de anuncios— y el IVA se le suma al
  contarlo: 20 € al día con el 21 % cuentan como **24,20 €**, y el mes son 750,20 € en vez de
  620 €. En Caja se ve el desglose (*20,00 € + 21% IVA = 24,20 €*). Si el importe ya lleva el
  IVA dentro, se deja sin marcar.
- **El calendario del mes** (botón *Día a día* en Caja) es para cuando ese gasto no es igual
  todos los días, que es lo normal con la publicidad. Sale el mes entero como un calendario de
  pared, con una casilla por día y un solo botón de guardar:
  - Lo que **escribes** se queda marcado en verde y es lo que cuenta ese día (sin IVA, si el
    gasto está marcado como tal: arriba se ve el total con IVA).
  - Lo que **dejas en blanco** va al importe de siempre, que aparece en gris de fondo.
  - **Borrar** una casilla devuelve ese día a lo normal.

  Arriba se ve el total del mes al momento, y hay un botón para vaciar de golpe todo lo
  escrito a mano de ese mes.
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
- **El chin-chin de la caja no descarga nada**: son dos notas de maquinita (un si y un mi más
  arriba, en onda cuadrada) más el tintineo de la moneda, fabricadas por el propio navegador
  con Web Audio. No hay ningún fichero de audio de por medio. Tiene que sonar mientras se
  pulsa el botón —los navegadores no dejan sonar nada por su cuenta—, así que el cobro se
  envía seis décimas después, con el botón ya en "Guardando…". Si le quitas el sonido no hay
  ninguna espera. Y si el móvil pide menos animación, no caen billetes.
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
  commission.js      el motor de cálculo (porcentaje, tramos, fijo, beneficio)
  threshold.js       comisionar sólo por encima de los gastos del día
  profit.js          el que cobra un porcentaje del beneficio de la empresa
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
