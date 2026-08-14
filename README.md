# Río en Alerta

Monitor web de la altura del Río Luján en San Fernando, con datos observados y
pronóstico del INA, alertas horarias por Telegram y administración privada de
suscriptores.

## Arquitectura

- GitHub Pages publica la web pública y una redirección desde `admin.html`.
- Firebase Hosting publica únicamente el panel administrativo y sus recursos
  en `https://rio-en-alerta-sanfernando.firebaseapp.com/admin.html`.
- Firebase Functions ejecuta el webhook de Telegram, la revisión horaria, el
  resumen opcional de las 08:00, el cálculo diario de velocidad y la retención
  de chats inactivos.
- El cliente Telegram reintenta errores `429`, `5xx` y fallos de red con
  `retry_after`, backoff exponencial y un presupuesto de espera acotado.
- El bot ofrece altura actual, máximo personal, pronóstico diario con
  mínima/máxima, historial de `24h`, `7d` o `30d`, resumen diario opcional y
  preferencias individuales mediante `/avisos`.
- Los avisos automáticos distinguen altura máxima, crecida rápida, bajante
  rápida y recuperación. Los tres tipos nuevos son opt-in para usuarios
  existentes; la alerta por altura conserva su configuración actual.
- La web compara en un mismo gráfico las mediciones observadas de San Fernando,
  Tigre, Dique Luján y San Isidro, sin utilizar las estaciones comparativas
  para el pronóstico de San Fernando.
- El gráfico histórico admite zoom horizontal con botones, rueda del mouse,
  teclado o gesto de pellizcar, y desplazamiento por arrastre.
- El indicador de subida o bajada rápida usa percentiles direccionales del
  historial de San Fernando y se identifica expresamente como una estimación
  estadística propia, separada de los niveles oficiales. La tarjeta de tendencia
  muestra tanto la velocidad actual como las velocidades estadísticas de alerta
  para ascensos y descensos.
- Firestore guarda suscripciones, actividad, estado operativo y alertas
  enviadas. Una máquina de estados procesa cada medición del INA una sola vez,
  evita repetir una condición y aplica 10 cm de histéresis a la recuperación.
- Firebase Authentication protege el panel administrativo.

## Desarrollo y validación

```bash
npm --prefix functions run test:all
npm --prefix functions run check
git diff --check
```

`test:all` ejecuta las pruebas unitarias y de integracion y levanta de forma
temporal el emulador oficial de Firestore.

Las pruebas de contrato usan extractos JSON versionados de respuestas reales
del INA para detectar cambios incompatibles en observaciones o pronóstico.

Para servir la web localmente:

```bash
python3 -m http.server 8080
```

La publicación pública se realiza automáticamente desde `main`. El workflow
crea un artefacto mínimo y no incluye `functions/`, reglas ni configuración
backend. El panel se despliega desde `firebase-dist/`, que contiene solamente
`admin.html` y los cuatro recursos de frontend que necesita.

Cada pull request a `main` ejecuta la suite completa con el emulador de
Firestore y verifica el contenido permitido del artefacto antes del merge.

La documentación funcional y operativa completa está en
`PLAN-IMPLEMENTACION.md`.

## Datos

La app consulta la API pública del Sistema de Información Hidrológica del INA
(SIyAH), usando `siteCode=52`, `varId=2` y el pronóstico calibrado de San
Fernando. El historial web permite consultar `24h`, `7d`, `30d`, `3 meses`,
`6 meses` o `12 meses`. Para 24 horas se grafican las mediciones individuales;
para rangos más largos se muestran promedios diarios de las cuatro estaciones,
calculados en la zona horaria de Argentina. El CSV conserva todas las
mediciones originales de San Fernando del rango seleccionado. Las estaciones
comparativas nunca alimentan el pronóstico. Los valores son informativos y no
sustituyen avisos oficiales.
