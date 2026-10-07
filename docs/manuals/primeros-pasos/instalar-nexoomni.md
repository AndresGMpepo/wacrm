---
title: "Instalar NexoOmni en el dispositivo"
description: "Instala NexoOmni como aplicación y activa alertas push para mensajes asignados."
section: "primeros-pasos"
role: ["agent", "supervisor", "admin", "owner"]
plan: ["basico"]
updated: "2026-10-06"
---

## ¿Qué es?

NexoOmni se puede instalar desde un navegador compatible para abrirse como
una aplicación independiente. También puedes activar notificaciones web
push para enterarte de mensajes nuevos asignados a ti cuando la aplicación
no está abierta.

## ¿Para quién es?

Para cualquier agente o administrador que use NexoOmni en un dispositivo
compatible. La instalación es opcional y no cambia las funciones de la
cuenta.

## Cómo instalar

1. Abre NexoOmni en un navegador compatible y conéctate a tu cuenta.
2. Si el navegador permite instalarla, selecciona **Instalar app** junto
   al teléfono de NexPhone en la barra superior y acepta la confirmación.
3. En iPhone o iPad, abre NexoOmni en Safari, toca **Compartir** y luego
   **Agregar a pantalla de inicio**.

La instalación y el modo sin conexión requieren HTTPS. `localhost` se
considera un contexto seguro para desarrollo. La pantalla sin conexión
solo avisa que no hay red; por privacidad, NexoOmni no guarda en caché
conversaciones, mensajes, páginas autenticadas ni llamadas a la API.
Cuando se activa una versión nueva, aparece un aviso para actualizar y
recargar la aplicación en un momento conveniente.

## Activar las notificaciones push

1. Ve a **Configuración**.
2. En el resumen, busca **Notificaciones en segundo plano** y selecciona
   **Activar notificaciones**.
3. Acepta el permiso del navegador cuando lo solicite.

La solicitud de permiso ocurre únicamente al pulsar el botón. Se envían
alertas por mensajes entrantes asignados a tu usuario; las conversaciones
sin asignar no generan una alerta push. Puedes desactivarlas desde el mismo
control en cualquier momento. En iPhone o iPad, primero agrega la aplicación
a la pantalla de inicio y luego activa las notificaciones desde ella.

## Avisos en escritorio y móvil

Los mensajes asignados generan un aviso del sistema, aunque NexoOmni esté
en segundo plano o una ventana quede detrás de otra aplicación. En
escritorio se solicita que el aviso permanezca hasta que lo atiendas;
el navegador puede no admitir esa opción. Al pulsar el aviso se abre el chat.

En móvil se solicita un aviso con sonido y vibración. En dispositivos
compatibles, el ícono de la aplicación instalada muestra el total de
mensajes sin leer de las conversaciones asignadas a ti, no el número de
notificaciones de la campana. El contador se actualiza al recibir push y
al leer o reasignar conversaciones con la aplicación abierta. No aparece
un contador nuevo en el ícono de escritorio. Algunos móviles solo muestran
un punto o no admiten contadores.

Un chat abierto en segundo plano no marca los mensajes como leídos:
debes volver a la aplicación y tener el chat visible y enfocado. Pulsar
un aviso no borra por sí solo los mensajes de otros chats.

El sonido, la vibración, los banners y la pantalla bloqueada dependen de
los ajustes del sistema. Permite **banners**, **sonidos** e **insignias**
para NexoOmni o el navegador y revisa los modos No molestar/Concentración.
En iPhone/iPad se requiere iOS/iPadOS 16.4 o posterior y la PWA instalada.
La aplicación no puede forzar un sonido personalizado ni saltarse el modo
silencioso o las restricciones de batería.

El envío push lo hace el servidor, no la pantalla de la aplicación.
El worker debe estar funcionando incluso con todos los dispositivos
cerrados. Como procesa la cola cada minuto y por lotes, los avisos no son
instantáneos y pueden demorarse más si hay mensajes pendientes. Si solo
ves el aviso dentro de la aplicación, comprobar permisos no basta:
revisa también las claves VAPID, la suscripción del dispositivo y el worker.

### Comprobar los avisos después de desplegar

1. Activa las notificaciones en cada dispositivo que uses.
2. En escritorio, cambia a otra aplicación; en móvil, deja NexoOmni en
   segundo plano y bloquea la pantalla.
3. Envía dos mensajes a una conversación asignada a ese agente.
4. Comprueba el aviso del sistema y, en móviles compatibles, el contador
   de mensajes sin leer (si no tenías otros, pasa a 1 y después a 2).
5. Abre ese chat: el contador debe bajar al leerlo; los pendientes de
   otras conversaciones asignadas siguen contando.

## Configuración del servidor

El administrador debe completar estos pasos antes de que los usuarios
puedan activar la función:

1. Aplicar la migración `140_web_push_notifications.sql`.
2. Generar un par de claves VAPID con
   `npx web-push generate-vapid-keys --json`.
3. Configurar `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`,
   `WEB_PUSH_VAPID_PRIVATE_KEY` y `WEB_PUSH_VAPID_SUBJECT` en el entorno
   del servidor. El asunto debe ser un correo `mailto:` o una URL de
   contacto. No publicar la clave privada.
4. Reconstruir y desplegar la aplicación después de cambiar la clave
   pública. En Easypanel/standalone, configura `APP_URL` y
   `AI_ANALYSIS_WORKER_SECRET` para que el worker existente procese la cola
   cada minuto; en Docker, programa una llamada autenticada a
   `/api/internal/ai-analysis-worker` cada minuto.

Las suscripciones se guardan por usuario y dispositivo; una suscripción
caducada se elimina al recibir el rechazo del proveedor push. La cola
reintenta errores temporales y registra los fallos definitivos en el log
del worker.

## Preguntas frecuentes

**¿Recibiré mensajes si no instalé la aplicación?**

Sí, si el navegador y el sistema operativo admiten Web Push, el permiso
está concedido y activaste las notificaciones. Instalar la PWA no es
requisito para suscribirse.

**¿Se guardan conversaciones para leerlas sin conexión?**

No. Solo se almacenan temporalmente archivos estáticos de la interfaz y
la página informativa sin conexión; los datos de clientes y mensajes no
se guardan en caché.

**¿Por qué no puedo activar los avisos?**

El navegador debe admitir Web Push, la aplicación debe estar servida por
HTTPS y el administrador debe configurar las claves VAPID y aplicar la
migración. Si el permiso quedó bloqueado, cámbialo desde los ajustes del
navegador.
