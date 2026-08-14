# Río en Alerta

Monitor web de la altura del Río Luján en San Fernando, con datos observados y
pronóstico del INA, alertas horarias por Telegram y administración privada de
suscriptores.

## Arquitectura

- GitHub Pages publica la web pública y una redirección desde `admin.html`.
- Firebase Hosting publica únicamente el panel administrativo y sus recursos
  en `https://rio-en-alerta-sanfernando.firebaseapp.com/admin.html`.
- Firebase Functions ejecuta el webhook de Telegram, la revisión horaria y la
  retención de chats inactivos.
- El cliente Telegram reintenta errores `429`, `5xx` y fallos de red con
  `retry_after`, backoff exponencial y un presupuesto de espera acotado.
- El bot ofrece altura actual, máximo personal, pronóstico diario con
  mínima/máxima e historial de `24h`, `7d` o `30d`.
- Firestore guarda suscripciones, actividad, estado operativo y alertas
  enviadas.
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
Fernando. Los valores son informativos y no sustituyen avisos oficiales.
