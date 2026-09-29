---
title: "Webhooks y automatización externa (n8n)"
description: "Recibe un aviso automático en tu propio sistema cada vez que pasa algo en NexoOmni — un mensaje entrante, una alerta crítica, etc."
section: "integraciones"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Un webhook es lo contrario a la API: en vez de que tú preguntes a
NexoOmni, es NexoOmni quien te avisa automáticamente a tu sistema
cuando ocurre algo — por ejemplo, cuando la IA detecta sentimiento
negativo, o llega un mensaje nuevo.

## ¿Para quién es?

Un administrador o un desarrollador que integre NexoOmni con otro
sistema (n8n, Zapier, un CRM externo, etc.).

## Cómo se usa

### Con n8n (sin escribir código)

1. Ve a **Configuración → API**, sección de integraciones n8n.
2. Pega la URL de tu webhook de n8n.
3. Elige qué eventos quieres recibir (por ejemplo,
   `ai.critical_detected` para avisar a un supervisor, crear una
   tarea, o escalar un caso).

### Webhook genérico (para desarrolladores)

Se crea vía la [API pública](./api-publica.md)
(`POST /api/v1/webhooks`), indicando la URL de tu sistema y un secreto
para verificar que la notificación viene realmente de NexoOmni.

## Preguntas frecuentes

**¿Un webhook puede responder automáticamente al cliente?**
No — un webhook solo notifica; nunca responde por sí mismo al cliente
en tu nombre. Para eso existen las
[Automatizaciones](../automatizaciones-y-flujos/automatizaciones.md) y
los [Flujos](../automatizaciones-y-flujos/flujos.md).

**¿Qué pasa si mi sistema no responde a tiempo?**
NexoOmni reintenta la entrega automáticamente durante un tiempo antes
de marcarla como fallida.

## Ver también

- [API pública](./api-publica.md)
- [Claves de API](./claves-api.md)
