# Río en Alerta

Monitor web de la altura del Río Luján en San Fernando, con datos observados y
pronóstico del INA, alertas horarias por Telegram y administración privada de
suscriptores.

## Arquitectura

- GitHub Pages publica únicamente `index.html`, `admin.html` y los recursos
  seleccionados de `src/`.
- Firebase Functions ejecuta el webhook de Telegram, la revisión horaria y la
  retención de chats inactivos.
- Firestore guarda suscripciones, actividad, estado operativo y alertas
  enviadas.
- Firebase Authentication protege el panel administrativo.

## Desarrollo y validación

```bash
npm --prefix functions test
npm --prefix functions run check
git diff --check
```

Para servir la web localmente:

```bash
python3 -m http.server 8080
```

La publicación web se realiza automáticamente desde `main`. El workflow crea
un artefacto mínimo y no incluye `functions/`, reglas ni configuración backend.

La documentación funcional y operativa completa está en
`PLAN-IMPLEMENTACION.md`.

## Datos

La app consulta la API pública del Sistema de Información Hidrológica del INA
(SIyAH), usando `siteCode=52`, `varId=2` y el pronóstico calibrado de San
Fernando. Los valores son informativos y no sustituyen avisos oficiales.
