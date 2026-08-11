# Monitoreo de disponibilidad de WACRM

WACRM expone dos comprobaciones distintas. Mantenerlas separadas ayuda a saber
si falló la aplicación o una dependencia.

| Ruta | Uso | Resultado esperado |
| --- | --- | --- |
| `/api/health` | Liveness: el proceso web responde. | HTTP `200` |
| `/api/health/ready` | Readiness: WACRM puede consultar Postgres y Storage de Supabase. | HTTP `200` cuando ambos están disponibles; `503` si alguno falla. |

## Configuración segura

1. En **Easypanel → app_wacrm → Entorno**, agrega una variable privada:

   ```text
   HEALTHCHECK_SECRET=una-cadena-aleatoria-larga-de-al-menos-32-caracteres
   ```

2. Implementa de nuevo WACRM. Esta variable pertenece únicamente al servicio
   WACRM: no la agregues a variables `NEXT_PUBLIC_*`, al repositorio, ni a
   enlaces con parámetros.

3. En Uptime Kuma crea dos monitores HTTP(S), con intervalo de 60 segundos:

   - **WACRM web**: `https://TU-DOMINIO/api/health`, espera código `200`.
   - **WACRM dependencias**: `https://TU-DOMINIO/api/health/ready`, espera
     código `200` y agrega el encabezado personalizado:

     ```text
     x-healthcheck-secret: el-mismo-valor-de-HEALTHCHECK_SECRET
     ```

No uses el secreto como parte de la URL. La ruta privada responde `404` si el
encabezado no coincide, y no revela la causa del fallo a usuarios no
autorizados.

## Cómo interpretar una alerta

- Falla `WACRM web`: revisa el despliegue, los logs y la salud del contenedor
  `app_wacrm` en Easypanel.
- Funciona `WACRM web` pero falla `dependencias`: revisa primero el contenedor
  de Supabase, PostgreSQL, Realtime y Storage; después su red y sus volúmenes.
- Ambas rutas funcionan, pero un canal falla: revisa el conector específico
  (Meta, Yeastar, IA) y su bitácora antes de reiniciar servicios.

## Operación actual del worker de IA

El inicio de WACRM ya ejecuta el worker de análisis configurado por
`APP_URL` y `AI_ANALYSIS_WORKER_SECRET`. No ejecutes una segunda copia del
mismo bucle en Scripts de Easypanel; duplicarlo puede procesar trabajos dos
veces. Al separar producción, el worker se moverá a un servicio dedicado.
