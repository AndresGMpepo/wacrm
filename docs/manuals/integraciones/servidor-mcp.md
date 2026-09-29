---
title: "Servidor MCP — conecta un asistente de IA externo"
description: "Consulta y opera tu CRM en lenguaje natural desde Claude, Cursor u otro asistente compatible con MCP."
section: "integraciones"
role: ["admin", "owner"]
plan: ["premium"]
updated: "2026-09-28"
---

## ¿Qué es?

MCP (Model Context Protocol) es un estándar que permite a asistentes de
IA como Claude Desktop o Cursor conectarse directamente a tus datos.
Con el servidor MCP de NexoOmni, puedes preguntarle a tu asistente de
IA cosas como:

> "¿Cuántas conversaciones siguen abiertas hoy?"
> "Muéstrame los últimos 5 mensajes con el +52 55 1234 5678."
> "Envía la plantilla de confirmación a ese contacto."

Es una capa fina sobre la misma [API pública](./api-publica.md) — todo
queda igual de protegido y con los mismos permisos que le diste a tu
clave de API.

## ¿Para quién es?

Uso técnico — normalmente lo configura un administrador o un
desarrollador para uso interno del equipo, no para clientes finales.

## Cómo se usa

1. Crea una clave de API en **Configuración → API** — dale solo los
   permisos de lectura si tu asistente solo va a consultar, no a
   modificar datos.
2. Agrega el servidor a la configuración de tu asistente de IA
   (ver la guía técnica completa en [docs/mcp.md](../../mcp.md) para
   el paso a paso exacto por cliente).
3. Por defecto el modo es de solo lectura — el asistente puede
   consultar pero no puede enviar mensajes ni modificar datos, a menos
   que lo actives explícitamente.

## Preguntas frecuentes

**¿Es seguro darle acceso a un asistente de IA externo?**
Solo tiene acceso a lo que le permite la clave de API que le diste —
igual que cualquier otra integración. Empieza siempre en modo
solo-lectura.

**¿Puede enviar mensajes a mis clientes por sí solo?**
Solo si activas explícitamente el modo de escritura y tu clave de API
tiene el permiso de enviar mensajes — no ocurre por accidente.

## Ver también

- [Claves de API](./claves-api.md)
- [API pública](./api-publica.md)
