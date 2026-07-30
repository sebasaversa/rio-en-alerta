# Río en Alerta

Panel web para monitorear la altura del río en San Fernando y configurar alertas locales de navegador.

## Uso

No requiere instalación. Para servirlo localmente:

```bash
python3 -m http.server 8080
```

Luego abrir `http://localhost:8080`.

## Datos

Consulta la Web API pública del Sistema de Información Hidrológica del INA (SIyAH):

- Estación San Fernando: `siteCode=52`.
- Altura hidrométrica: `varId=2`.
- Observaciones: recurso `datos`.
- Pronósticos: recurso `datosProno`.

La API usa URLs con `&` inmediatamente después del nombre del recurso, por ejemplo:

```text
https://alerta.ina.gob.ar/pub/datos/datos&timeStart=2026-07-29&timeEnd=2026-07-30&siteCode=52&varId=2&format=json
```

Los avisos se generan en el navegador y se vuelven a evaluar al actualizar el panel; no son notificaciones de servidor ni sustituyen los avisos oficiales.
