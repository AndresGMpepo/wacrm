---
title: "NexPhone — llamadas desde NexoOmni"
description: "Haz y recibe llamadas telefónicas directamente desde el navegador, sin un teléfono físico aparte."
section: "telefonia"
role: ["agent", "supervisor", "admin", "owner"]
plan: ["premium"]
updated: "2026-10-06"
---

## ¿Qué es?

NexPhone es el softphone integrado de NexoOmni — te permite hacer y
recibir llamadas usando tu extensión de la centralita (PBX Yeastar)
directamente desde el navegador, sin instalar nada aparte.

## ¿Para quién es?

Cualquier agente con una extensión asignada. Un administrador conecta
la integración y asigna las extensiones (ver
[Extensiones de NexPhone por agente](./extensiones-por-agente.md)).

## Cómo se usa

1. El ícono de teléfono en la esquina superior aparece verde cuando
   NexPhone está conectado.
2. Marca un número o extensión y pulsa **Llamar**.
3. Para una llamada entrante, contesta o rechaza desde la ventana
   emergente.
4. Durante la llamada puedes silenciar el micrófono, transferir (ciega
   o atendida), activar video, o ver el historial de llamadas
   recientes.
5. Al colgar, NexPhone te pregunta si quieres **agendar un
   seguimiento** con ese número — un clic en "Mañana 9:00 am", "En 1
   hora" o una fecha personalizada.

En móvil, NexPhone se ajusta al ancho de la pantalla y puedes desplazar
su contenido verticalmente para acceder a todo el teclado, historial,
transferencias y seguimientos. La tarjeta de llamada entrante también
queda dentro de la pantalla. Esto no cambia las restricciones del
navegador sobre llamadas WebRTC en segundo plano.

## Contexto al contestar una llamada

Al contestar una llamada entrante en NexPhone se abre una ventana con:

- **Lo que explicó a la IA en esta llamada:** lo que el cliente acaba de explicar al recepcionista
  de IA, su necesidad y el siguiente paso, si el PBX envió ese contexto
  antes de transferir.
- **Historial:** un resumen breve de Nexo Memory; si todavía no existe,
  se utiliza el resumen de la última llamada analizada.
- **Pendientes:** hasta tres compromisos abiertos del contacto.

Puedes cerrar la ventana sin terminar la llamada y volver a abrirla con
**Contexto**. El historial no se presenta como si fuera lo que
el cliente acaba de decir. Si falta el contexto actual, la ventana lo
indica; si falla la consulta, muestra una opción para reintentar.

Para recibir el contexto del recepcionista durante esa misma llamada,
un administrador debe realizar la
[configuración de transferencias de IA](./contexto-y-transferencias-ia.md).
La transcripción completa se recupera después de colgar.

## Preguntas frecuentes

**¿Por qué dice "Registra tu extensión asignada"?**
Significa que aún no tienes una extensión configurada — pídesela a tu
administrador (ver
[Extensiones de NexPhone por agente](./extensiones-por-agente.md)).

**¿Puedo llamar directamente desde la ficha de un contacto?**
Sí, el botón de teléfono junto a cada número (incluidos los números
secundarios de un contacto fusionado) llama por NexPhone directamente.

## Ver también

- [Extensiones de NexPhone por agente](./extensiones-por-agente.md)
- [Supervisión en vivo](../supervision-y-reportes/supervision-en-vivo.md)
