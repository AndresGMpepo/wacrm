---
title: "Transcripción y análisis de llamadas"
description: "Recupera las transcripciones que publica Yeastar y conviértelas en contexto y pendientes de Nexo Memory."
section: "supervision-y-reportes"
role: ["supervisor", "admin", "owner"]
plan: ["premium"]
updated: "2026-10-05"
---

## ¿Qué es?

NexoOmni recupera las transcripciones que Yeastar publica para cada
tramo de llamada, incluidas las llamadas atendidas únicamente por su
recepcionista de IA. Con la IA de la cuenta configurada, genera resumen,
puntos clave, pendientes y sentimiento, y actualiza Nexo Memory del
cliente identificado por su teléfono.

NexoOmni no activa por sí solo la grabación o transcripción de todas
las llamadas: su disponibilidad depende de la configuración, versión
y permisos del PBX. El audio aparece solamente cuando está disponible.

## ¿Para quién es?

Supervisores, administradores y el propietario ven el listado
completo de llamadas de la cuenta.

## Cómo se usa

1. Ve a **Transcripciones de llamadas**.
2. Busca por contacto, o filtra por fecha.
3. Abre una llamada para ver: resumen, puntos clave, pendientes,
   transcripción completa y, cuando esté disponible, el audio original.
4. Revisa el estado del análisis. Una transcripción puede estar lista
   mientras todavía se genera su resumen o se actualiza Nexo Memory.

### Recuperar llamadas que ya aparecen en Yeastar

1. Pulsa **Sincronizar desde Yeastar**.
2. Opcionalmente escribe el teléfono internacional del cliente, incluido
   el código de país. Este filtro recupera llamadas **entrantes desde
   ese número**.
3. Se importan hasta 100 tramos por operación. Si quedan pendientes,
   vuelve a pulsar el botón para importar el siguiente lote, sin
   volver a importar los que ya tienen transcripción.
4. El análisis y la actualización de Nexo Memory se hacen en segundo
   plano. Recarga el listado después de unos minutos.

Si la exportación es demasiado grande, filtra por teléfono. Si una
operación falla, no se informa como una importación exitosa.

### Requisitos de configuración

Un administrador debe conectar OpenAPI de Yeastar y sus notificaciones
de fin de llamada (**30012**), y mantener activo el proceso periódico
de NexoOmni. La consulta de transcripciones utiliza OpenAPI v2.0;
en **P-Series Cloud Edition**, Yeastar documenta firmware
**84.23.0.83 o superior** para consultar el contexto de IA. Confirma
los requisitos de tu edición con Yeastar.

También debe configurarse la IA de la cuenta para generar el análisis.
La transcripción recuperada se conserva aunque el análisis falle y
se vuelva a intentar. Una llamada sin teléfono externo válido no puede
vincularse automáticamente a la memoria de un cliente.

## Preguntas frecuentes

**¿Se crean tareas automáticamente a partir de una llamada?**
Sí — si el cliente pidió que lo contactaran en una fecha/hora
concreta, se crea una tarea con recordatorio automáticamente (ver
[Tareas y recordatorios](../nexo-memory/tareas-y-recordatorios.md)).

**¿Cuánto tarda en aparecer la transcripción después de colgar?**
Normalmente unos minutos — depende de la duración de la llamada.
El proceso consulta las transcripciones publicadas por el PBX y
reintenta las que aún no están disponibles. Si faltan llamadas antiguas,
utiliza **Sincronizar desde Yeastar**.

**¿Una llamada antigua reemplaza el contexto más reciente del cliente?**
No: conserva sus hechos y pendientes en la memoria, usando la fecha
original de la llamada, sin reemplazar un resumen más reciente.

**¿Este listado proporciona el resumen antes de transferir al agente?**
No. No se ha confirmado que la API de transcripciones CDR entregue
el texto completo antes de colgar. El resumen de la misma llamada en
NexPhone se envía mediante una
[herramienta del recepcionista de IA](../telefonia/contexto-y-transferencias-ia.md)
antes de transferir.

## Ver también

- [Tareas y recordatorios](../nexo-memory/tareas-y-recordatorios.md)
- [Supervisión en vivo](./supervision-en-vivo.md)
