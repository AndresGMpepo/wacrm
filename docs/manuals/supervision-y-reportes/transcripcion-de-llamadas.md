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
y permisos del PBX. En este momento esta pantalla **no reproduce ni
importa grabaciones**; el audio permanece en el PBX y no se copia al
almacenamiento de NexoOmni. Para escuchar una grabación, consúltala
directamente en Yeastar.

Los tramos CDR vacíos que no tienen transcripción, resumen ni agente
identificado se omiten para evitar mostrar filas intermedias confusas.
El estado del análisis no provoca recargas automáticas. Pulsa
**Actualizar** cuando quieras consultar los cambios. Si ya hay un resumen
o Nexo Memory actualizado, no se muestra un aviso de análisis pendiente
aunque el estado interno de la llamada todavía no se haya sincronizado.

## ¿Para quién es?

Supervisores, administradores y el propietario ven el listado
completo de llamadas de la cuenta.

## Cómo se usa

1. Ve a **Transcripciones de llamadas**.
2. Busca por contacto, o filtra por fecha.
3. Abre una llamada para ver: resumen, puntos clave, pendientes,
   transcripción completa.
4. Revisa quién atendió: NexoOmni identifica al **Recepcionista de IA**
   cuando la transcripción proviene del contexto de IA de Yeastar. Para
   las demás extensiones, muestra al agente asignado o el número de
   extensión si aún no está vinculado a un usuario.
5. Revisa el estado del análisis. Una transcripción puede estar lista
   mientras todavía se genera su resumen o se actualiza Nexo Memory.

### Recuperar llamadas que ya aparecen en Yeastar

1. Pulsa **Importar desde Yeastar**. Esto solicita la exportación de
   transcripciones de IA de Yeastar; no es una prueba de estado en vivo
   de la conexión y tampoco elimina las llamadas ya guardadas.
2. Opcionalmente escribe el teléfono internacional del cliente, incluido
   el código de país. Este filtro recupera llamadas **entrantes desde
   ese número**.
3. Se importan hasta 100 tramos por operación. Si quedan pendientes,
   vuelve a pulsar el botón para importar el siguiente lote, sin
   volver a importar los que ya tienen transcripción.
4. Si una llamada ya estaba guardada con una transcripción más corta,
   NexoOmni la complementa cuando la exportación final de Yeastar trae
   más texto y vuelve a procesar su resumen y Nexo Memory.
5. Si Yeastar entrega una fecha en el formato configurado en el PBX
   (mes/día/año de 24 horas o año/mes/día de 12 horas), NexoOmni la
   convierte a la zona horaria del PBX. Si el formato no se reconoce,
   conserva la transcripción sin inventarle fecha. Al volver a importar,
   también completa las fechas que faltaban en llamadas ya guardadas.
6. Si Yeastar no incluye transcripciones nuevas, NexoOmni lo indica
   por separado: las llamadas anteriores siguen visibles y el PBX
   puede no haber publicado aún la nueva transcripción. Vuelve a
   intentarlo unos minutos después.
7. El análisis y la actualización de Nexo Memory se hacen en segundo
   plano. Recarga el listado después de unos minutos.

Si la exportación es demasiado grande, filtra por teléfono. Si la
exportación falla, el mensaje identifica si Yeastar rechazó la consulta,
si no estuvo accesible la descarga o si NexoOmni no pudo guardar los
datos; las transcripciones anteriores se conservan.

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
utiliza **Importar desde Yeastar**.

**¿Una llamada antigua reemplaza el contexto más reciente del cliente?**
No: conserva sus hechos y pendientes en la memoria, usando la fecha
original de la llamada, sin reemplazar un resumen más reciente.

**¿Este listado proporciona el resumen antes de transferir al agente?**
No. No se ha confirmado que la API de transcripciones CDR entregue
el texto completo antes de colgar. El resumen de la misma llamada en
NexPhone se envía mediante una
[herramienta del recepcionista de IA](../telefonia/contexto-y-transferencias-ia.md)
antes de transferir.

**¿Por qué la transcripción de una llamada de IA aparece corta?**
Yeastar puede publicar primero una transcripción parcial y completar
la exportación después. Pulsa **Importar desde Yeastar** de nuevo cuando
haya terminado; NexoOmni reemplaza una transcripción con una versión
más larga del mismo tramo y regenera el análisis. Si el PBX aún entrega
el mismo texto corto, NexoOmni no puede recuperar palabras que no estén
en la exportación.

## Ver también

- [Tareas y recordatorios](../nexo-memory/tareas-y-recordatorios.md)
- [Supervisión en vivo](./supervision-en-vivo.md)
