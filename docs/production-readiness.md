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

## Entrega durable de webhooks

Los eventos de API y n8n se guardan primero en una cola de base de datos y
después se entregan con hasta tres intentos y espera exponencial. Configura:

```text
WEBHOOK_DELIVERY_WORKER_SECRET=una-cadena-aleatoria-distinta-de-al-menos-32-caracteres
```

Con `APP_URL` y ese secreto, el inicio standalone ejecuta el worker cada
minuto. Los trabajos agotados quedan como `dead_letter` en
`webhook_delivery_jobs` para investigarlos sin perder su estado de entrega.

## Uptime Kuma en Easypanel

Despliega Uptime Kuma como un servicio independiente de `app_wacrm`; no debe
formar parte del contenedor de WACRM ni compartir su volumen. La imagen
recomendada es:

```text
louislam/uptime-kuma:2
```

En Easypanel crea un servicio **App** con esa imagen, expón el puerto interno
`3001`, asigna un subdominio administrativo (por ejemplo,
`status-admin.tu-dominio.com`) y crea un volumen local persistente:

```text
/app/data
```

En el primer ingreso crea la cuenta administradora de Kuma, configura 2FA y
una notificación de Telegram o correo. El volumen debe ser local del servidor:
Uptime Kuma utiliza SQLite y requiere bloqueos POSIX confiables.

### Monitores iniciales

Configura estos monitores HTTP(S) con intervalo de 60 segundos, reintento tras
2 fallos y alerta de recuperación:

| Nombre | URL | Código esperado | Configuración adicional |
| --- | --- | --- | --- |
| WACRM - aplicación | `https://wacrm.aurionova.com/api/health` | `200` | Ninguna |
| WACRM - base y Storage | `https://wacrm.aurionova.com/api/health/ready` | `200` | Header `x-healthcheck-secret` con el valor privado |
| Supabase API | `https://supabase-api.aurionova.com/rest/v1/` | `401` o `200` | El objetivo es confirmar que el proxy/API responde; no uses una llave en el monitor |
| Dominio WACRM | `https://wacrm.aurionova.com/login` | `200` | Activa la comprobación de vencimiento TLS |

No publiques la pantalla de Kuma ni sus monitores internos como una página de
estado pública. Para el lanzamiento productivo, agrega después un monitor
externo independiente: un monitor que vive en el mismo VPS no puede avisar si
ese VPS o su red completa dejan de responder.
