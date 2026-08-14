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
- ver historial por hora o por promedios diarios de hasta 12 meses;
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
- `[x]` Historial web con seleccion de 24 horas, 7 dias, 30 dias, 3 meses,
  6 meses y 12 meses.
- `[x]` Historial ordenado de mas antiguo a mas reciente.
- `[x]` Descarga CSV del historial completo para el rango seleccionado.
- `[x]` Grafico historico comparativo de San Fernando, Tigre, Dique Lujan y
  San Isidro; las tres estaciones adicionales son solo observadas y no se usan
  en el pronostico.
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
- `[x]` Visualizacion de `lastActiveAt` y preferencias de avisos en la vista
  administrativa.
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
- `[x]` Comparacion observada de Tigre, Dique Lujan y San Isidro, sin usar esas
  estaciones para el pronostico.
- `[x]` Indicador estadistico de velocidad por percentil 90 para San Fernando.
- `[x]` Tarjeta de tendencia con velocidad actual y velocidades estadisticas de
  alerta para subida y bajada rapida, expresadas en m/h y cm/h.
- `[x]` Resumen diario opcional por Telegram a las 08:00 ART.
- `[x]` Grafico historico con niveles oficiales de alerta y evacuacion.

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

Estaciones comparativas observadas:

```text
siteCode=49  Tigre         Rio Lujan
siteCode=50  Dique Lujan   Rio Lujan
siteCode=53  San Isidro    Rio de la Plata
varId=2      Altura en metros
```

Estas estaciones se consultan exclusivamente mediante `datos`. No alimentan
`datosProno`, no corrigen el pronostico de San Fernando y no disparan alertas.

### Indicador estadistico de velocidad

El indicador es una estimacion propia de Rio en Alerta, no una alerta oficial
del INA. Una vez al dia se descargan hasta 365 dias observados de San Fernando
(`siteCode=52`, `varId=2`). Se conservan los timestamps originales, se
normalizan fechas, se descartan alturas fuera del rango fisico operativo de
-5 a 10 m, se deduplican timestamps y se ordenan de antiguo a reciente.
La descarga anual dispone de hasta 120 segundos dentro de una Function con
limite total de 180 segundos; las consultas ordinarias mantienen un timeout de
15 segundos para fallar rapido sin bloquear la interfaz ni el bot.

Para cada par consecutivo valido:

```text
horas = (timestamp_actual - timestamp_anterior) / 3.600.000
variacion_m = altura_actual - altura_anterior
velocidad_m_h = variacion_m / horas
```

Se excluyen fechas o alturas invalidas, tiempos no positivos, intervalos
mayores a seis horas, alturas fisicamente invalidas y la misma observacion
recibida en revisiones sucesivas. Los ascensos y descensos se procesan por
separado: `p90Ascenso` usa velocidades positivas y `p90Descenso` el valor
absoluto de las negativas. El percentil se interpola linealmente en la posicion
`(n - 1) * 0,90`. Por definicion, el percentil 90 delimita el 10 % de las
variaciones historicas mas rapidas de cada direccion.

La clasificacion actual usa las dos ultimas mediciones distintas:

- velocidad mayor o igual a `p90Ascenso`: **Subida rapida**;
- velocidad negativa cuyo valor absoluto sea mayor o igual a `p90Descenso`:
  **Bajada rapida**;
- otros valores: **Ascenso normal**, **Descenso normal** o **Sin cambios**.

Se exigen 90 dias de cobertura, 100 intervalos validos y dos lecturas recientes
distintas. Si falta alguna condicion, la interfaz muestra “Datos insuficientes
para calcular la velocidad” y no usa un umbral de respaldo.

Los niveles oficiales permanecen independientes de este calculo: San Fernando
tiene 3,00 m para alerta y 3,50 m para evacuacion. Un nivel alto por si solo no
produce una clasificacion de subida rapida.

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
/resumen     Mostrar el estado del resumen diario de las 08:00.
/resumen activar Activar el resumen diario.
/resumen pausar  Pausar el resumen diario.
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
- alerta por altura con maquina de estados e histeresis de 10 cm;
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

- `[x]` comparacion observada entre San Fernando, Tigre, Dique Lujan y San
  Isidro, sin incorporarlas al pronostico;
- `[x]` deteccion estadistica de subidas o bajadas rapidas por percentil 90;
- `[x]` alertas diferenciadas para crecida, bajante y recuperacion;
- `[x]` resumen diario opcional por Telegram a las 08:00 ART;
- `[x]` exportacion CSV del historial;
- `[x]` grafico con niveles oficiales de alerta a 3,00 m y evacuacion a 3,50 m;
- `[x]` vista privada de administracion de usuarios y actividad;
- `[x]` registro de cada alerta enviada, error y reintento.

Las alertas estadisticas se identifican como una estimacion de Rio en Alerta y
no se presentan como alertas oficiales del INA.

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
alertPreferences.height: boolean
alertPreferences.rapidRise: boolean
alertPreferences.rapidFall: boolean
alertPreferences.recovery: boolean
alertState.heightCondition: "unknown"|"above"|"below"
alertState.velocityCondition: "normal"|"rapid-rise"|"rapid-fall"
alertState.lastObservationAt: string|null
dailySummary: boolean
active: boolean
joinedAt: timestamp
lastActiveAt: timestamp
lastSent: timestamp|number|null
```

`chatId` es el identificador tecnico del chat y debe tratarse como dato
personal. `username` puede ser nulo o cambiar. `joinedAt` solo se establece en
el primer `/start`; `lastActiveAt` se actualiza en cada comando recibido.

Para conservar el contrato de usuarios existentes, `height` queda activo por
defecto y `rapidRise`, `rapidFall` y `recovery` comienzan pausados hasta que el
usuario los habilita mediante `/avisos`. La configuracion y el estado se
mantienen separados: cambiar una preferencia no borra el ultimo estado medido.

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

La web ofrece rangos de 24 horas, 7 dias, 30 dias, 3 meses, 6 meses y 12 meses.
En 24 horas grafica cada medicion valida. En los rangos de varios dias agrupa
por fecha calendario de Argentina y calcula la media aritmetica de las
mediciones del dia por estacion:

```text
promedioDiario = suma(alturasValidasDelDia) / cantidadMedicionesValidasDelDia
```

El grafico usa una escala temporal y vertical comun para comparar San Fernando,
Tigre, Dique Lujan y San Isidro. Estas tres estaciones adicionales son
exclusivamente observadas: no modifican el nivel actual, la tendencia, las
alertas ni el pronostico de San Fernando. La descarga CSV conserva las
mediciones originales, sin promediar, y corresponde solo a San Fernando.

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
- `checkRiver`: consulta INA, reclama atomicamente cada timestamp observado,
  carga chats activos, evalua la maquina de estados por usuario y envia alertas
  idempotentes.
- `calculateVelocityStats`: recalcula diariamente percentiles sobre 365 dias y
  guarda el resultado en `publicData/velocity`.
- `publicRiverStatus`: publica solo el indicador agregado y calcula la
  variacion reciente con el cache diario, sin descargar 365 dias por visita.
- `sendDailySummary`: envia a las 08:00 ART solo a chats que lo activaron.
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
6. **Anti-spam.** Procesar cada timestamp INA una vez, notificar solo al entrar
   en un estado rapido nuevo, rearmarlo despues de una medicion normal y usar
   10 cm de histeresis para rearmar la alerta por altura. Registrar cada envio
   y manejar errores 429 de Telegram con backoff.
7. **Acceso administrativo.** La consulta de usuarios debe requerir una
   identidad Firebase autorizada y nunca quedar abierta por una URL publica.
8. **Retencion.** Eliminar chats y eventos de alertas sin actividad o con una
   antiguedad mayor a 12 meses; una nueva interaccion vuelve a registrar el chat.

### `publicData/velocity`

```text
statistics.p90Ascent: number|null
statistics.p90Descent: number|null
statistics.validIntervalCount: number
statistics.ascentCount: number
statistics.descentCount: number
statistics.coverageDays: number
statistics.periodStart: string|null
statistics.periodEnd: string|null
statistics.maxIntervalHours: 6
statistics.sufficient: boolean
current.observedAt: string|null
current.previousObservedAt: string|null
current.change: number|null
current.hours: number|null
current.speedMetersPerHour: number|null
current.speedCentimetersPerHour: number|null
current.code: string
calculatedAt: timestamp
updatedAt: timestamp
```

### Decisiones aprobadas el 13 de agosto de 2026

- retencion automatica de chats sin actividad durante 12 meses;
- panel web privado mediante Firebase Authentication y autorizacion individual;
- las alertas se disparan solo por mediciones observadas, nunca solo por el
  pronostico;
- Telegram ofrece botones y comandos para estado, maximo, pronostico, historial
  avisos y ayuda;
- cada usuario elige por separado altura maxima, crecida rapida, bajante rapida
  y recuperacion mediante `/avisos` y botones inline;
- crecida rapida se dispara al alcanzar `p90Ascenso` sin depender de la altura;
  bajante rapida usa `p90Descenso`; recuperacion requiere bajar al menos 0,10 m
  por debajo de la altura personal;
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

### `/avisos`

- sin argumento: muestra las cuatro preferencias individuales y sus botones;
- cada boton alterna solo `height`, `rapidRise`, `rapidFall` o `recovery`;
- `/pausar` y `/activar` siguen funcionando como interruptor general;
- los usuarios existentes conservan activa la alerta por altura y deben optar
  explicitamente por los tres avisos nuevos.

### Alerta automatica

```text
⚠️ Rio en Alerta
Rio Lujan — San Fernando: 3,10 m
Medicion: 13/08/2026 15:00 ART

Alcanzo tu altura seleccionada de 3,00 m.
```

La misma notificacion puede agrupar varios eventos de una medicion. Crecida y
bajante incluyen velocidad actual y p90 direccional. Recuperacion se envia solo
si el estado anterior estaba por encima de la altura personal y la nueva
medicion es menor o igual a `threshold - 0,10 m`.

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
- idempotencia por timestamp INA y transiciones de estado sin repeticiones;
- error de INA no genera alerta falsa;
- velocidad con intervalos irregulares y conversion entre m/h y cm/h;
- percentil 90 con interpolacion lineal y ascensos/descensos separados;
- deduplicacion, orden temporal, intervalos invalidos o excesivos;
- historial insuficiente, igualdad exacta al percentil y ausencia de una nueva
  medicion;
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
- `/avisos` persiste preferencias independientes y procesa callbacks inline;
- crecida y bajante rapidas se envian una sola vez por entrada al estado;
- una medicion normal rearma la condicion estadistica;
- recuperacion respeta la histeresis exacta de 10 cm y rearma altura;
- `/pronostico` muestra rangos diarios y `/historial` transmite al cliente INA
  la cantidad de dias solicitada;
- activacion y pausa de `/resumen`, envio unico por fecha y persistencia de los
  percentiles y la ultima deteccion en Firestore.

La suite automatizada integra el mismo nucleo que usan las Functions con un
repositorio controlado, y ejecuta por separado el adaptador de persistencia
contra el emulador oficial de Firestore. Tambien cubre botones inline, errores
del INA, `429` con `retry_after`, errores `5xx`, fallos de red, respuestas
invalidas y errores `4xx` no reintentables.

### Validacion estadistica con datos reales del INA

Validacion realizada el 14 de agosto de 2026 sobre el rango
14/08/2025 00:45 a 13/08/2026 23:45 de San Fernando:

```text
observaciones normalizadas: 8617
intervalos validos: 8612
cobertura: 364,96 dias
ascensos: 3115
descensos: 5314
p90Ascenso: 0,33 m/h (33 cm/h)
p90Descenso: 0,16 m/h (16 cm/h)
```

La cantidad, cobertura y frecuencia son estadisticamente razonables frente a
los minimos aprobados de 90 dias y 100 intervalos. La comparacion manual de las
ultimas ocho transiciones produjo velocidades entre -0,10 y +0,21 m/h; todas
quedaron correctamente clasificadas como ascenso o descenso normal frente a
los percentiles anteriores. La ultima transicion fue 1,25 m a 1,16 m en una
hora: -0,09 m/h (-9 cm/h), **Descenso normal**.

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
- `[x]` Estaciones adicionales: Tigre, Dique Lujan y San Isidro, solo datos
  observados.
- `[x]` Resumen diario opcional definido a las 08:00 ART.
- `[x]` Niveles oficiales de San Fernando: alerta 3,00 m y evacuacion 3,50 m.
- `[x]` Velocidad rapida definida con p90 direccional sobre hasta 365 dias.
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
- `v1.3.0`: exportacion CSV y CI protegido con pruebas de integracion.
- `v1.4.0`: percentiles de velocidad, estaciones comparativas, resumen diario y
  cache estadistico desplegados.
- `v1.5.0`: historial web de hasta 12 meses, grafico multestacion, velocidades
  estadisticas visibles y avisos Telegram configurables con maquina de estados.

Este archivo debe actualizarse cada vez que cambien los comandos, los campos de
Firestore, la fuente de datos, la frecuencia de consulta, las reglas o el
proceso de despliegue.
