# Runbook de migración a producción — NexoOmni

Este documento prepara la migración desde el VPS de desarrollo al VPS
productivo. No borres, muevas ni reutilices volúmenes del origen hasta que la
validación y el período de observación hayan terminado.

## Principios de corte

1. **Primero restaurar y verificar; después cambiar tráfico.** Un respaldo no
   es válido hasta que se ha restaurado en un entorno aislado.
2. **La base de datos, Storage y secretos son una unidad.** Restaurar sólo
   PostgreSQL deja conversaciones con archivos, tokens cifrados o medios
   incompletos.
3. **Los webhooks cambian al final.** Meta y Yeastar deben continuar enviando
   al origen hasta que NexoOmni productivo esté validado.
4. **El origen permanece disponible y en sólo lectura operacional** durante al
   menos siete días después del corte.

## Inventario obligatorio

Antes de elegir una ventana de corte, registra dónde vive cada elemento y qué
respaldo lo protege:

| Elemento | Debe incluir | Verificación |
| --- | --- | --- |
| PostgreSQL de Supabase | Todas las bases y esquemas, incluidos `auth`, `storage` y `public` | Conteo de cuentas, miembros, conversaciones y mensajes coincide |
| Archivos de Storage | Objetos de los buckets `chat-media`, `flow-media` y cualquier bucket adicional | Conteo de objetos y descarga de una imagen/audio de prueba |
| Configuración Supabase | Compose, variables, secretos de JWT, claves de cifrado, configuración de Auth/SMTP y Realtime | Servicios arrancan sin crear una base vacía |
| WACRM / NexoOmni | Commit o imagen exacta, variables de entorno y configuración de EasyPanel | `/api/health` y `/api/health/ready` devuelven `200` |
| Integraciones externas | Meta, Yeastar, OpenAI y dominios | Webhook de prueba, mensaje entrante/saliente y análisis IA |
| Uptime Kuma | Su volumen de datos y credenciales administrativas | Monitores y alertas conservados o recreados y probados |

No copies secretos a este archivo, al repositorio ni a capturas. Conserva una
lista cifrada fuera del VPS con los nombres de variables y su origen.

## Fase A — respaldo verificable en desarrollo

1. Programa una ventana sin despliegues ni cambios de esquema.
2. Genera un respaldo consistente de PostgreSQL desde el contenedor o servicio
   de base de datos de Supabase. Incluye roles/esquemas requeridos por tu
   instalación self-hosted.
3. Respalda el volumen o directorio de Storage como archivos, conservando su
   estructura y fechas. No es suficiente exportar solamente filas de la tabla
   `storage.objects`.
4. Exporta las variables de entorno desde EasyPanel a un gestor seguro de
   secretos, sin publicar sus valores. Incluye la configuración de Auth,
   Realtime, Storage, SMTP, Meta, Yeastar, IA, cifrado, workers y salud.
5. Guarda los respaldos **fuera del VPS de desarrollo**: almacenamiento de
   objetos cifrado o un segundo servidor en otra ubicación.
6. Restaura una copia en un proyecto temporal aislado y comprueba el inventario
   de la tabla anterior. Documenta fecha, tamaño, duración y resultado.

No avances a producción hasta lograr una restauración correcta.

## Fase B — preparar el VPS productivo

1. Actualiza el sistema, crea acceso administrativo con llave SSH y desactiva
   el acceso por contraseña si la operación lo permite.
2. Instala EasyPanel y crea un proyecto nuevo llamado `nexoomni-prod`.
3. Despliega Supabase en este proyecto con **volúmenes nuevos y vacíos**.
   Nunca conectes el volumen de desarrollo a ambos servidores.
4. Restaura PostgreSQL y Storage desde el respaldo verificado.
5. Configura dominios de preproducción privados, por ejemplo
   `staging.nexoomni.tu-dominio`, para comprobar la aplicación antes del
   cambio público.
6. Despliega la misma revisión de NexoOmni que se validó en desarrollo. Las
   variables `NEXT_PUBLIC_*` deben corresponder al Supabase productivo antes
   de construir la imagen.
7. Configura `HEALTHCHECK_SECRET` y valida `/api/health/ready` con el header
   privado.

## Fase C — prueba funcional antes del corte

Completa y registra estas pruebas en el entorno productivo:

- Inicio de sesión de un usuario de prueba.
- Aislamiento de dos cuentas distintas.
- Mensaje WhatsApp entrante y respuesta saliente.
- Chat web Yeastar: texto, imagen, respuesta y cierre de sesión.
- Softphone Yeastar: conexión y llamada de prueba, si el plan lo incluye.
- Análisis IA manual y automático, sin enviar borradores automáticamente.
- Alertas del navegador, Uptime Kuma y monitoreo de disponibilidad.
- Descarga de un archivo restaurado desde Storage.

Un fallo bloquea el corte: se corrige y se repite la prueba afectada.

## Fase D — ventana de corte

1. Comunica una ventana de mantenimiento y congela cambios de aplicación,
   migraciones y configuraciones comerciales.
2. Toma un respaldo final de PostgreSQL y Storage del origen.
3. Restaura el diferencial o el respaldo final en producción y vuelve a
   comprobar los conteos críticos.
4. Activa los monitores de producción en Uptime Kuma y verifica alertas.
5. Cambia las URL de webhook de Meta y Yeastar al dominio productivo. Envía un
   evento/mensaje de prueba por cada integración.
6. Cambia DNS o proxy público a producción sólo cuando los pasos anteriores
   estén en verde.
7. Monitorea activamente durante las primeras dos horas.

## Reversión

Vuelve temporalmente al origen únicamente si hay pérdida de mensajes, errores
de autenticación generalizados, datos faltantes o un fallo de seguridad. Para
revertir:

1. Cambia DNS/proxy y las URL de webhook al origen.
2. Publica el incidente y preserva logs, identificadores de mensajes y hora de
   inicio.
3. No intentes copiar cambios de producción de vuelta al origen durante la
   emergencia; primero detén el flujo, investiga y define una reconciliación
   controlada.

## Criterio de cierre

La migración se declara cerrada después de siete días sin incidentes críticos,
con respaldos automáticos funcionando y una restauración de prueba completada
en producción. Sólo entonces se programa el retiro del entorno de desarrollo.
