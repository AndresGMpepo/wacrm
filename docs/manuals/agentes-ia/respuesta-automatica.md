---
title: "Respuesta automática con IA"
description: "Configura al agente de IA para que responda solo en WhatsApp, con las reglas y el tono que definas."
section: "agentes-ia"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-10-02"
---

## ¿Qué es?

Un agente de IA que puede responder automáticamente a tus clientes por
WhatsApp, usando el tono, las reglas y la base de conocimiento que tú
definas — y que sabe transferir la conversación a un humano cuando
corresponde.

## ¿Para quién es?

Un administrador lo configura una vez; a partir de ahí funciona solo
(o como asistente de redacción para los agentes, según cómo lo
actives).

## Cómo se usa

1. Ve a **Agentes IA → Configuración**.
2. Elige el proveedor y modelo de IA, y pega tu clave de API.
3. Define el tono, las instrucciones y en qué canales debe responder.
4. Dentro del mismo texto de instrucciones puedes usar dos variables
   que NexoOmni reemplaza automáticamente antes de cada respuesta:
   - `{{current_datetime}}` — la fecha y hora actuales, en la zona
     horaria que definas justo debajo del cuadro de texto.
   - `{{active_promotions}}` — la lista de promociones vigentes *hoy*,
     administradas en **Agentes IA → Configuración → "Promociones
     vigentes"** (cada una con fecha de inicio y fin; se activan y
     desactivan solas, sin que tengas que tocar el texto del agente
     cada mes).
5. Define cuándo debe transferir a un humano (por ejemplo, si el
   cliente pide hablar con una persona, o si la IA detecta que no sabe
   la respuesta).
6. Prueba las respuestas en **Agentes IA → Playground** antes de
   activarlo con clientes reales.

## Preguntas frecuentes

**Escribí `{{current_datetime}}` en el prompt pero el agente no sabe
qué día es — ¿por qué?**
Antes de esta función, cualquier variable que escribieras se enviaba
tal cual al modelo (como texto literal) — nunca se reemplazaba por un
valor real. Ahora sí: si tu agente sigue sin saber la fecha, revisa que
hayas escrito la variable exactamente como `{{current_datetime}}` (sin
espacios ni mayúsculas distintas).

**¿Puedo tener varias promociones vigentes al mismo tiempo?**
Sí — `{{active_promotions}}` incluye todas las que cubran la fecha de
hoy, no solo una.

**¿Responde en Facebook e Instagram también?**
Hoy la respuesta automática solo corre sobre conversaciones de
WhatsApp — es una limitación conocida, no algo que falte activar.

**¿Puedo ver cuánto está costando el uso de IA?**
Sí, en **Agentes IA → Uso** se muestra el consumo por modo (respuesta
automática, análisis, redacción asistida) y periodo.

**¿La IA puede escribir el mensaje pero dejar que yo lo revise antes
de enviarlo?**
Sí — desde el compositor del Inbox, el botón de redacción con IA
sugiere una respuesta que puedes editar antes de enviar, sin que se
envíe sola.

## Ver también

- [Base de conocimiento](./base-de-conocimiento.md)
- [Panel de Nexo Memory](../nexo-memory/panel-de-memoria.md)
