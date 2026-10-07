---
title: "Bandeja de entrada compartida"
description: "Atiende WhatsApp, Facebook, Instagram y Chat web desde una sola vista, en equipo."
section: "inbox"
role: ["agent", "supervisor", "admin", "owner"]
plan: ["basico", "crecimiento", "premium"]
updated: "2026-10-07"
---

## ¿Qué es?

El Inbox es donde tu equipo atiende todas las conversaciones de todos
los canales conectados (WhatsApp, Facebook, Instagram, Chat web),
ordenadas por la más reciente arriba — igual para agentes, supervisores
y administradores.

## ¿Para quién es?

Cualquier persona con acceso al día a día de atención al cliente.

## Cómo se usa

1. Elige el filtro **Mías**, **Sin asignar** o **Todas** (agentes solo
   ven las suyas + sin asignar; supervisores/administradores ven todo).
2. Filtra por canal, etiqueta, empresa o campaña de difusión desde la
   barra superior si necesitas encontrar algo específico.
3. Al responder, un chat que recibe un mensaje nuevo sube
   automáticamente al principio de la lista.
4. El panel derecho de cada conversación muestra: teléfono(s) del
   contacto, memoria de Nexo Memory, etiquetas, tratos abiertos,
   tareas pendientes, notas internas del equipo y notas del contacto.
5. "Tomar conversación" se usa para autoasignarte un chat sin dueño.

## Nexo Memory y datos del cliente en móvil

Abre una conversación y pulsa **Nexo Memory y cliente**, debajo del
encabezado. Se abre un panel desplazable con la misma información de
escritorio: memoria, historial, compromisos, teléfonos, etiquetas,
tratos, tareas y notas. Cierra el panel para volver a escribir en el chat.
El aviso de notas internas también abre este panel en móvil.

## Contexto del anuncio en Facebook/Instagram

Si un cliente te escribe después de hacer clic en un anuncio de
"Enviar mensaje" (Click-to-Messenger), verás un aviso arriba de la
conversación: **"Esto es una respuesta a un anuncio"**. Pulsa **Ver
detalles** para ver el título y la imagen del anuncio — así sabes de
qué producto o promoción pregunta el cliente sin tener que
adivinarlo. El aviso solo aparece si el administrador validó la
conexión de Facebook después de esta actualización (Configuración →
Redes sociales → **Validar conexión**), para que Meta empiece a
enviar ese dato.

## Confirmación de leído en Facebook/Instagram

Los mensajes que envías por Facebook Messenger e Instagram ahora
muestran las mismas marcas que WhatsApp: una palomita (✓) cuando se
envió, dos palomitas grises (✓✓) cuando el cliente lo recibió, y dos
palomitas azules (✓✓) cuando el cliente ya lo leyó. Esto también
requiere haber validado la conexión después de esta actualización
(Configuración → Redes sociales → **Validar conexión**).

## "Escribiendo…" y "Visto" hacia el cliente (Facebook/Instagram)

Igual que en la app de Meta, el cliente ve el indicador de
"escribiendo…" mientras redactas tu respuesta, y "Visto" en cuanto
abres la conversación. Es puramente informativo para el cliente — no
necesitas hacer nada, ocurre solo.

## Respuestas enviadas desde Meta directamente

Si un agente responde un mensaje de Facebook/Instagram desde la
aplicación o bandeja de Meta en vez de desde NexoOmni (por ejemplo,
mientras resuelve un problema de conexión), ese mensaje ahora también
aparece aquí, con una etiqueta **"Meta"** junto a la hora, para que el
equipo sepa que no se envió desde la plataforma. Así las dos vistas de
la conversación no quedan desincronizadas.

## Mensajes editados por el cliente (Facebook Messenger)

Si el cliente edita un mensaje que ya te envió, el texto se actualiza
en el hilo y se marca con **(editado)**. Solo Messenger permite esto
(no Instagram), y el cliente puede editar un mensaje hasta 5 veces.

Todo lo anterior funciona igual si tu Facebook/Instagram está conectado
directo o a través de un proveedor conectado como Zernio. La única
diferencia: si usas un proveedor conectado, pide a quien administra esa
cuenta que su webhook tenga suscrito el evento de "mensaje editado"
(además del de "mensaje recibido", que ya suele estar activo) para que
la marca (editado) funcione.

## Preguntas frecuentes

**¿Por qué un chat no sube al tope aunque el cliente respondió?**
Si eso pasa, actualiza la página — es un caso raro de desconexión de
tiempo real, no algo que deba pasar normalmente.

**¿Puedo ver de qué número me escribió el cliente si tiene dos
WhatsApp?**
Sí — si el contacto tiene más de un número registrado (ver
[Fusionar contactos duplicados](../contactos/fusionar-contactos.md)),
cada mensaje muestra debajo "Vía [número]" para que sepas cuál usó.

**¿Por qué en WhatsApp no puedo escribir después de 24 horas, pero en
Facebook/Instagram sí?**
Son reglas distintas de Meta. WhatsApp exige una plantilla aprobada
pasadas las 24 horas, sin excepción — por eso el cuadro de texto se
bloquea ahí. En Facebook/Instagram, un agente humano sí puede
responder más tarde (igual que desde la app de Meta); si el mensaje
de verdad queda fuera de la ventana permitida, Meta lo rechaza y verás
un aviso claro al intentar enviarlo.

**¿La confirmación de leído funciona igual en Instagram que en
Facebook?**
En Facebook Messenger verás los tres estados (enviado, entregado,
leído). En Instagram, Meta no siempre distingue "entregado" de
"leído" — es posible que el mensaje salte directo a leído sin pasar
por el estado intermedio.

## Ver también

- [Plantillas y botones](./plantillas-y-botones.md)
- [Notas internas del equipo](./notas-internas.md)
- [Reacciones y respuestas citadas](./reacciones-y-respuestas.md)
- [Fusionar contactos duplicados](../contactos/fusionar-contactos.md)
