# Plan tecnico de implementacion de Rio en Alerta

Documento vivo para construir, verificar y evolucionar una aplicacion de
monitoreo hidrometrico del Rio Lujan en San Fernando, con consulta de datos del
INA, historial, pronosticos y alertas por Telegram.

El documento define alcance, contratos de datos, arquitectura, seguridad,
operacion, pruebas y criterios de publicacion. Las decisiones que afecten
costos, privacidad o semantica de las alertas deben quedar registradas aqui.

## Identidad del producto

- Nombre: **Rio en Alerta**.
- Estacion principal: **San Fernando**.
- Curso de agua: **Rio Lujan**.
- Repositorio: `sebasaversa/rio-en-alerta`.
- Sitio publicado: `https://sebasaversa.github.io/rio-en-alerta/`.
- Bot: `@TigreRioEnAlertaSF_bot`.
- Proyecto Firebase: `rio-en-alerta-sanfernando`.
- Region de Firestore: `southamerica-east1`.
- Runtime recomendado: Node.js 22.

La app es informativa. No reemplaza los avisos de Prefectura, Defensa Civil,
INA ni otras autoridades competentes.

## Objetivo

Permitir que una persona pueda:

- consultar la altura actual del Rio Lujan en San Fernando;
- ver historial por hora, dia, semana o mes;
- consultar el pronostico de los proximos dias;
- recibir alertas por Telegram cuando la altura alcance su maximo configurado;
- consultar o cambiar su configuracion desde el bot;
- ver el nombre de la estacion, la fecha de medicion y la fuente;
- administrar el registro tecnico de chats suscriptos sin exponerlo publicamente.

## Estado

- `[x]` Completado
- `[~]` En curso
- `[ ]` Pendiente
- `[!]` Bloqueado o requiere una decision

Estado de referencia: 14 de agosto de 2026.

- `[x]` Repositorio publico y GitHub Pages configurados.
- `[x]` Proyecto Firebase separado del proyecto de padel.
- `[x]` Firestore creado en `southamerica-east1`.
- `[x]` Reglas de Firestore desplegadas para aislar documentos por usuario.
- `[x]` Consulta de datos observados del INA para `siteCode=52`, `varId=2`.
- `[x]` Consulta de pronostico calibrado de San Fernando.
- `[x]` Historial web con seleccion de 24 horas, 7 dias y 30 dias.
- `[x]` Historial ordenado de mas antiguo a mas reciente.
- `[x]` Descarga CSV del historial completo para el rango seleccionado.
- `[x]` Vista movil optimizada.
- `[x]` Seccion de alertas web eliminada; las alertas se gestionan por Telegram.
- `[x]` Bot Telegram creado, secreto `TELEGRAM_BOT_TOKEN` guardado y webhook
  configurado.
- `[x]` Funcion programada `checkRiver` desplegada para revisar cada hora.
- `[x]` `telegramWebhook` consolidada, desplegada y verificada con comandos
  reales contra el chat administrador.
- `[x]` `lastActiveAt` desplegado y verificado en los logs estructurados de cada
  comando procesado.
- `[x]` Botones, menu y comandos de pronostico/historial desplegados y
  verificados.
- `[x]` `/pronostico` resume minima y maxima diaria de los valores publicados
  por el INA, sin presentar una banda estadistica no documentada.
- `[x]` `/historial` acepta `24h`, `7d` y `30d`; los rangos de varios dias se
  resumen por minima y maxima diaria.
- `[x]` Fixtures versionados de observaciones y pronostico reales del INA
  protegen el contrato externo en la suite automatizada.
- `[x]` Vista privada publicada en Firebase Hosting, Google Sign-In habilitado,
  cuenta propietaria autorizada y acceso interactivo validado.
- `[x]` Visualizacion de `lastActiveAt` publicada en la vista administrativa.
- `[x]` Workflow publica solo el artefacto web permitido y termino en `success`.
- `[x]` Las pull requests a `main` ejecutan pruebas del bot, integracion con el
  emulador de Firestore, validacion sintactica e inspeccion del artefacto web
  antes de poder fusionarse.
- `[x]` Firebase Hosting adoptado para el panel administrativo; la web publica
  permanece en GitHub Pages.
- `[x]` Cliente Telegram con reintentos acotados para `429`, `5xx` y fallos de
  red, respetando `retry_after` y sin reintentar errores permanentes.
- `[x]` Pruebas de integracion del bot y adaptador Firestore ejecutadas contra
  el emulador oficial.

## Estrategia de hosting y migracion

### Decision vigente

Se mantiene una arquitectura hibrida:

- **GitHub Pages** aloja la web publica estatica.
- **Firebase Hosting** aloja `admin.html` en el mismo dominio que el auxiliar
  de Firebase Authentication y evita que el acceso dependa de ventanas
  emergentes o almacenamiento de terceros.
- **GitHub** conserva el codigo fuente, historial, tags y automatizacion de
  despliegues.
- **Firebase** aloja Functions, Firestore, Secret Manager y Scheduler.

La web publica no necesita renderizado del servidor, rutas privadas ni un
dominio propio. El panel autenticado si se sirve desde
`https://rio-en-alerta-sanfernando.firebaseapp.com/admin.html`; la copia de
`admin.html` publicada por Pages redirige a esa URL. El repositorio y el
workflow de GitHub siguen siendo la fuente de verdad para el frontend.
El despliegue de Hosting se construye en `firebase-dist/` e incluye solamente
`admin.html` y los estilos y modulos que necesita el panel; no publica Functions
ni el resto del repositorio.

### Criterios para reconsiderar la migracion

Se analizara Firebase Hosting cuando se cumpla al menos uno de estos casos:

- se agregue un panel administrativo autenticado;
- se necesiten rewrites entre rutas web y Functions;
- se configure un dominio propio para web y backend;
- se requieran canales de preview y entornos separados;
- el despliegue unificado de frontend y backend reduzca errores operativos.

Migrar el hosting no implica abandonar GitHub. El repositorio seguira siendo
la fuente de verdad y podra desplegar a Firebase mediante GitHub Actions.

### Riesgo a resolver antes de cualquier hosting nuevo

El workflow de Pages debe publicar solo un directorio de artefactos publicos
(`dist/` o `site/`). No se debe desplegar el repositorio completo si eso puede
incluir `functions/`, archivos de configuracion u otros recursos internos.
La misma regla aplicaria a Firebase Hosting. La migracion se considera
aceptada solo cuando una inspeccion del artefacto confirme que no contiene
secretos ni codigo backend innecesario.

## Roadmap ejecutable

### Fase 1 — Estabilizacion de Telegram

1. Consolidar una unica implementacion de `telegramWebhook`.
2. Corregir y probar la semantica de `/estado`, `/maximo` y `/ayuda`.
3. Registrar `lastActiveAt` para cada comando valido y actualizar identidad sin
   duplicar documentos.
4. Verificar `checkRiver` cada hora, ventana anti-duplicado y errores de INA o
   Telegram.
5. Desplegar Functions, probar el bot desde un chat real y crear un tag de
   version solamente despues de esa verificacion.

**Aceptacion:** `/estado` muestra la altura actual; `/maximo` sin argumento
muestra el maximo guardado; `/maximo X` lo valida y persiste; `/ayuda` lista
todos los comandos; una interaccion modifica `lastActiveAt`; y una alerta no
se duplica dentro de la ventana configurada.

### Fase 2 — Observabilidad y administracion

1. Definir retencion de chats inactivos y documentar el tratamiento de datos.
2. Agregar logs estructurados de consulta INA, chats procesados, alertas,
   errores y ultima ejecucion exitosa.
3. Crear una vista privada protegida por Firebase Authentication para consultar
   cantidad de usuarios, fecha de alta, ultima actividad, estado y maximo.
4. Mantener `telegramChats` fuera de la web publica y sin reglas de lectura
   anonima.

**Aceptacion:** un administrador autenticado puede ver actividad agregada sin
   exponer chat IDs ni datos personales públicamente, y cada fallo operativo
   queda diagnosticable desde Firebase.

### Fase 3 — Publicacion segura del frontend

1. Crear `site/` o `dist/` con los archivos que realmente necesita la web.
2. Cambiar el workflow de GitHub Pages para publicar exclusivamente ese
   directorio.
3. Auditar el contenido generado y confirmar que no aparecen Functions,
   secretos ni datos de Firestore.
4. Conservar GitHub Pages como hosting principal y generar un tag de release.

**Aceptacion:** la URL publica funciona igual en escritorio y celular, el
   artefacto no contiene backend y el workflow termina en `success`.

### Fase 4 — Evaluacion de Firebase Hosting

1. Medir si el panel privado, las rutas protegidas o el dominio propio
   justifican el cambio.
2. Configurar un sitio Firebase separado o un canal de preview, sin cortar
   GitHub Pages.
3. Probar reglas, rewrites, cache, dominio y rollback.
4. Cambiar el destino principal solo con una URL verificada y un procedimiento
   de vuelta a GitHub Pages.

**Aceptacion:** ambos destinos sirven el mismo artefacto, el nuevo hosting no
   expone archivos internos y existe rollback documentado.

## Fuente de datos y contratos externos

### API del INA

La Web API del Sistema de Informacion Hidrologica de la Cuenca del Plata
expone estaciones, variables, series, datos observados y pronosticos en JSON,
CSV, XML y GeoJSON. La documentacion oficial describe recursos para listar
estaciones y variables y consultar series temporales. La API tambien ofrece una
variante WaterOneFlow/WaterML 1.1 para interoperabilidad hidrologica.

Base actual:

```text
https://alerta.ina.gob.ar/pub/datos
```

Estacion principal:

```text
siteCode=52
nombre=San Fernando
rio=LUJAN
varId=2
unidad=metros
```

Consulta observada:

```text
/datos&timeStart=YYYY-MM-DD&timeEnd=YYYY-MM-DD&siteCode=52&varId=2&format=json
```

Consulta de pronostico calibrado:

```text
/datosProno&timeStart=YYYY-MM-DD&timeEnd=YYYY-MM-DD&seriesId=26202&calId=432&siteCode=52&varId=2&all=false&format=json
```

La API actualmente se consume con `&` despues del nombre del recurso. Este
detalle debe quedar encapsulado en un cliente y cubierto por una prueba para
evitar que una futura migracion de endpoint rompa toda la app.

### Telegram Bot API

El bot debe usar un webhook HTTPS de Firebase y nunca exponer su token en el
cliente. Telegram requiere que el usuario inicie el bot antes de recibir
mensajes privados.

Comandos del producto:

```text
/start       Suscribirse y mostrar la ayuda.
/estado      Consultar la altura actual del rio.
/maximo      Mostrar la altura maxima configurada.
/maximo 2.50 Cambiar la altura maxima configurada.
/pronostico  Mostrar minima y maxima previstas por dia.
/historial 24h Mostrar las ultimas mediciones de 24 horas.
/historial 7d  Resumir minima y maxima de los ultimos 7 dias.
/historial 30d Resumir minima y maxima de los ultimos 30 dias.
/pausar      Pausar las alertas automaticas.
/activar     Reactivar las alertas automaticas.
/ayuda       Mostrar nuevamente todos los comandos.
```

La semantica debe ser estricta:

- `/maximo` sin argumento solo lee la configuracion y nunca escribe `0` ni
  otro valor por defecto.
- `/maximo X` acepta valores mayores que cero y hasta seis metros.
- `/estado` consulta el ultimo valor observado y responde con nombre del rio,
  estacion, altura y, cuando sea posible, fecha de la medicion.
- `/pronostico` agrupa por dia todos los valores que publica el endpoint
  calibrado del INA y muestra el menor y el mayor. No los denomina intervalo de
  confianza porque el contrato publico consultado no identifica esa semantica.
- `/historial` sin argumento equivale a `24h`; solo acepta `24h`, `7d` o `30d`.
- Los alias viejos no deben mantenerse silenciosamente si generan confusion;
  si se conserva compatibilidad con `/umbral`, debe responderse indicando que
  el comando vigente es `/maximo`.

## Alcance y entregas

### MVP publicado

- pagina responsive en espanol;
- indicador de conexion y boton de actualizacion;
- tarjeta de altura actual;
- tendencia respecto de la lectura anterior;
- pronostico de cinco dias;
- historial graficado y resumido;
- fuentes y enlaces oficiales;
- despliegue automatico en GitHub Pages.

### MVP Telegram

- alta con `/start`;
- almacenamiento del chat en `telegramChats`;
- altura maxima individual por chat;
- `/estado`, `/maximo` y `/ayuda`;
- consulta horaria del INA mediante `checkRiver`;
- alerta con pausa anti-duplicado de seis horas;
- webhook Firebase protegido por secreto.

### Entrega complementaria de Telegram

- `[x]` botones inline para nivel, maximo, pronostico, historial y ayuda;
- `[x]` respuesta con fecha/hora y zona horaria de Argentina;
- `[x]` `/pronostico` con maxima y minima previstas;
- `[x]` `/historial 24h`, `/historial 7d` y `/historial 30d`;
- `[x]` configuracion de pausa de alertas por usuario;
- `[x]` confirmacion explicita al activar/desactivar alertas;
- `[x]` tests de contrato contra respuestas reales guardadas como fixtures.

### V1: monitoreo avanzado

- `[!]` comparacion entre San Fernando, Tigre, Dique Lujan, Guazucito y otras
  estaciones disponibles;
- `[!]` deteccion de subidas o bajadas rapidas, no solo cruce de umbral;
- `[!]` alertas diferenciadas para crecida, bajante y recuperacion;
- `[!]` resumen diario opcional por Telegram;
- `[x]` exportacion CSV del historial;
- `[!]` grafico con umbrales oficiales de alerta y evacuacion;
- `[x]` vista privada de administracion de usuarios y actividad;
- `[x]` registro de cada alerta enviada, error y reintento.

Los puntos marcados con `[!]` requieren definir estaciones, velocidades de
cambio, horarios o fuentes oficiales antes de implementar una semantica que
pueda interpretarse como alerta de seguridad.

### Fuera de alcance inicial

- WhatsApp automatizado sin un proveedor y modelo comercial aprobado;
- correo electronico masivo sin dominio verificado;
- prediccion propia distinta del pronostico oficial del INA;
- recomendaciones de evacuacion generadas automaticamente;
- publicar nombres, usuarios o chat IDs de Telegram en la web publica;
- guardar tokens de Telegram en el frontend o en el repositorio.

## Modelo de datos

### `telegramChats/{chatId}`

```text
chatId: number
firstName: string|null
lastName: string|null
username: string|null
threshold: number
active: boolean
joinedAt: timestamp
lastActiveAt: timestamp
lastSent: timestamp|number|null
```

`chatId` es el identificador tecnico del chat y debe tratarse como dato
personal. `username` puede ser nulo o cambiar. `joinedAt` solo se establece en
el primer `/start`; `lastActiveAt` se actualiza en cada comando recibido.

### Registro de actividad

Cada actualizacion entrante valida primero el chat y registra actividad. No se
deben guardar textos arbitrarios completos salvo que exista una necesidad
operativa documentada. Para auditoria basta con comando normalizado, timestamp,
resultado y version de la funcion.

### Historial observado

La app no debe inventar una frecuencia. Cada punto conserva:

```text
observedAt: timestamp
valueMeters: number
stationCode: 52
stationName: San Fernando
river: LUJAN
source: INA
```

Si el INA devuelve el mismo valor en dos consultas, se evita presentarlo como
una medicion nueva salvo que haya cambiado `observedAt`.

## Arquitectura

```text
INA API
  ├─ datos observados ───────────────┐
  └─ datosProno ─────────────────────┤
                                     ├─ Web GitHub Pages
                                     ├─ Panel Firebase Hosting + Auth
                                     └─ Cloud Functions
                                          ├─ telegramWebhook
                                          ├─ checkRiver cada 60 min
                                          └─ Firestore telegramChats
```

### Frontend

- HTML/CSS/JavaScript modular sin dependencia de build obligatoria.
- El cliente consulta datos publicos del INA.
- No contiene secretos ni permisos administrativos.
- La seccion de alertas web se mantiene eliminada; Telegram es el canal de
  alertas vigente.

### Backend

- Firebase Cloud Functions v2, Node.js 22.
- `telegramWebhook`: normaliza comandos, registra actividad y responde.
- `checkRiver`: consulta INA, carga chats activos, evalua cada maxima y envia
  alertas idempotentes.
- Secretos gestionados con Firebase Secret Manager.
- Firestore como registro de suscripciones y configuracion.

## Seguridad y privacidad

1. **Secretos fuera del cliente.** `TELEGRAM_BOT_TOKEN` solo se inyecta en
   funciones desplegadas.
2. **Coleccion no publica.** `telegramChats` no se renderiza ni se sirve desde
   GitHub Pages.
3. **Minimo necesario.** Guardar nombre, usuario y fechas solo para operar el
   servicio; no almacenar historiales de mensajes completos.
4. **Validacion de entrada.** Rechazar maximos no numericos, menores o iguales
   a cero y mayores que seis metros.
5. **Idempotencia.** El mismo update o reintento no debe duplicar suscripciones
   ni enviar alertas repetidas.
6. **Anti-spam.** Respetar una ventana de seis horas por chat, registrar el
   envio y manejar errores 429 de Telegram con backoff.
7. **Acceso administrativo.** La consulta de usuarios debe requerir una
   identidad Firebase autorizada y nunca quedar abierta por una URL publica.
8. **Retencion.** Eliminar chats y eventos de alertas sin actividad o con una
   antiguedad mayor a 12 meses; una nueva interaccion vuelve a registrar el chat.

### Decisiones aprobadas el 13 de agosto de 2026

- retencion automatica de chats sin actividad durante 12 meses;
- panel web privado mediante Firebase Authentication y autorizacion individual;
- las alertas se disparan solo por mediciones observadas, nunca solo por el
  pronostico;
- Telegram ofrece botones y comandos para estado, maximo, pronostico, historial
  y ayuda;
- GitHub Pages se mantiene como hosting publico y Firebase Hosting se usa solo
  para el panel autenticado, donde evita depender de ventanas emergentes.

## Contratos de comandos

### `/start`

Efectos:

- crea o reactiva el documento;
- conserva la maxima anterior si ya existia;
- actualiza identidad de Telegram;
- establece `joinedAt` solo si falta;
- actualiza `lastActiveAt`;
- devuelve bienvenida completa y enlace web.

### `/maximo`

- sin argumento: lectura pura de `threshold`;
- con argumento: escritura validada y confirmacion;
- error: instrucciones de formato sin modificar el valor anterior.

### `/estado`

Consulta INA en tiempo real y devuelve:

```text
🌊 Rio Lujan — San Fernando
Altura actual: 0,95 m
Medicion: 13/08/2026 14:00 ART
```

### `/pronostico`

Consulta el endpoint calibrado del INA y muestra hasta cinco dias. Para cada
fecha informa el menor y el mayor de todos los valores publicados. El
pronostico es informativo y nunca dispara una alerta automatica.

### `/historial`

- sin argumento o con `24h`: devuelve las ultimas ocho mediciones disponibles;
- con `7d` o `30d`: devuelve minima y maxima observadas para cada dia;
- con otro argumento: no consulta el INA y muestra los rangos validos.

### Alerta automatica

```text
⚠️ Rio en Alerta
Rio Lujan — San Fernando: 3,10 m
Tu altura maxima: 3,00 m
Medicion consultada: 13/08/2026 15:00 ART
```

## Pruebas y verificacion

### Pruebas unitarias

- normalizacion de respuestas INA;
- orden temporal de observaciones;
- conversion de coma decimal a punto;
- validacion de `/maximo`;
- `/maximo` sin argumento no modifica Firestore;
- `/estado` no modifica la configuracion;
- primera alta conserva defaults y datos de identidad;
- reintento de `/start` es idempotente;
- `lastActiveAt` se actualiza en todos los comandos;
- ventana anti-duplicado de seis horas;
- error de INA no genera alerta falsa.
- respuestas reales guardadas del INA mantienen los campos y agrupaciones
  esperados para observaciones y pronostico.

### Pruebas de integracion

- webhook recibe `/start` y escribe Firestore;
- `/maximo 3.00` persiste 3.00;
- `/maximo` devuelve 3.00 sin cambiarlo;
- `/estado` responde con el ultimo dato del INA;
- `checkRiver` envia solo a chats activos que superan su maxima;
- dos chats con maximos distintos reciben decisiones independientes;
- los errores de Telegram no rompen el procesamiento de los demas chats.
- `/pronostico` muestra rangos diarios y `/historial` transmite al cliente INA
  la cantidad de dias solicitada.

La suite automatizada integra el mismo nucleo que usan las Functions con un
repositorio controlado, y ejecuta por separado el adaptador de persistencia
contra el emulador oficial de Firestore. Tambien cubre botones inline, errores
del INA, `429` con `retry_after`, errores `5xx`, fallos de red, respuestas
invalidas y errores `4xx` no reintentables.

### Verificacion de despliegue

Antes de marcar una entrega como publicada:

```bash
git diff --check
npx firebase-tools functions:list --project rio-en-alerta-sanfernando
gh run list --repo sebasaversa/rio-en-alerta --limit 1
```

El check `Validate pull request` debe terminar en `success` antes del merge. La
funcion debe figurar `ACTIVE`, el workflow de Pages debe terminar en `success`
y el bot debe responder `/ayuda`, `/estado` y `/maximo` desde un chat real.

## Operacion y costos

- Firestore y Firebase Authentication tienen cuotas sin costo, sujetas a los
  limites vigentes del proyecto.
- `checkRiver` y Cloud Scheduler requieren Blaze; el uso debe monitorearse con
  presupuesto y alertas de facturacion.
- Una ejecucion por hora equivale aproximadamente a 24 ejecuciones diarias.
- Cada ejecucion debe hacer una sola consulta INA y reutilizar el resultado para
  todos los chats.
- Registrar latencia, cantidad de chats procesados, mensajes enviados, errores y
  ultimo exito de consulta.
- Telegram realiza hasta tres intentos dentro de un presupuesto total de espera
  de 30 segundos. Un `retry_after` mayor se registra y se difiere a la proxima
  ejecucion para no agotar el tiempo de la Function.

## Decisiones pendientes

- `[x]` `/estado` incluye timestamp de medicion cuando el INA lo informa.
- `[x]` Retencion de usuarios inactivos definida en 12 meses.
- `[x]` Panel de usuarios definido como pantalla Firebase protegida.
- `[!]` Definir estaciones adicionales para comparar.
- `[x]` El pronostico no dispara alertas; solo lo hace la medicion observada.
- `[x]` Botones y `setMyCommands` desplegados y verificados con `/start`.

## Puesta en marcha del panel administrativo

El panel esta publicado en
`https://rio-en-alerta-sanfernando.firebaseapp.com/admin.html`, pero Firestore
solo entrega datos a UIDs presentes en `adminUsers/{uid}` con `active: true`.
El primer acceso se realiza con Google mediante redireccion de pagina completa.
La cuenta propietaria `sebastianaversa@gmail.com` ya fue vinculada y autorizada.
Las altas administrativas se hacen desde un entorno confiable; nunca desde el
navegador ni mediante reglas de autoasignacion.

El 14 de agosto de 2026 se valido el recorrido real: seleccion de la cuenta,
consentimiento Google, retorno a Firebase, autorizacion Firestore y carga de las
metricas y la tabla de usuarios.

## Historial de entregas

- `2e8842d`: primera version publica de la app y Pages.
- `d71cd46`: Firestore y persistencia Firebase.
- `c2b48bb`: historial de alturas.
- `d35ac7b`: mejora de lectura del historial.
- `65f8993`: seccion de alertas web ocultada.
- `fbfd3c1`: seccion de alertas web eliminada definitivamente.
- `a487f5c`: bot estabilizado, actividad, retencion, panel privado y publicacion
  segura de Pages.
- `v1.1.0`: entrega verificada de Telegram y administracion privada.
- `v1.1.1`: login administrativo, pruebas de integracion y reintentos de
  Telegram verificados antes de ampliar los comandos de consulta.
- `v1.2.0`: historial por rango, pronostico diario con minima/maxima y fixtures
  del contrato real del INA.

Este archivo debe actualizarse cada vez que cambien los comandos, los campos de
Firestore, la fuente de datos, la frecuencia de consulta, las reglas o el
proceso de despliegue.
