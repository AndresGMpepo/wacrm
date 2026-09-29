---
title: "Servidor MCP — conecta un asistente de IA externo"
description: "Consulta y opera tu CRM en lenguaje natural desde Claude, Cursor u otro asistente compatible con MCP."
section: "integraciones"
role: ["admin", "owner"]
plan: ["premium"]
updated: "2026-09-29"
---

## ¿Qué es?

MCP (Model Context Protocol) es un estándar que permite a asistentes de
IA como Claude Desktop o Cursor conectarse directamente a tus datos.
Con el servidor MCP de NexoOmni, puedes preguntarle a tu asistente de
IA cosas como:

> "¿Cuántas conversaciones siguen abiertas hoy?"
> "Muéstrame los últimos 5 mensajes con el +52 55 1234 5678."
> "¿Qué sabemos de este cliente? revisa Nexo Memory."
> "Envía la plantilla de confirmación a ese contacto."

Es una capa fina sobre la misma [API pública](./api-publica.md) — todo
queda igual de protegido y con los mismos permisos que le diste a tu
clave de API.

## ¿Para quién es?

Uso técnico — normalmente lo configura un administrador o un
desarrollador para uso interno del equipo, no para clientes finales.

## Cómo se usa (opción recomendada — sin instalar nada)

Tu instancia de NexoOmni ya tiene el servidor MCP integrado — no hay
que instalar ni compilar nada, ni tocar el servidor donde vive tu
aplicación.

1. Ve a **Configuración → API** — ahí encontrarás una tarjeta
   "Servidor MCP" con la URL y una configuración lista para copiar.
2. Crea una clave de API con solo los permisos de lectura si tu
   asistente solo va a consultar, no a modificar datos.
3. Pega la URL (y la clave) en la configuración de tu asistente de IA.
4. Las herramientas que ve el asistente dependen **únicamente de los
   permisos de esa clave** — los mismos que ya administras en
   Configuración → API. Revocar la clave corta el acceso al instante.

## Alternativa técnica: proceso local (stdio)

Para clientes que solo admiten ejecutar un programa local (no una URL),
existe una versión que se compila y ejecuta en tu propia computadora —
pide a tu equipo técnico que la prepare siguiendo la guía completa en
[docs/mcp.md](../../mcp.md). Por defecto el modo es de solo lectura —
el asistente puede consultar (incluidos contactos, conversaciones,
mensajes, el equipo y la memoria/Nexo Memory de un contacto) pero no
puede enviar mensajes, asignar conversaciones, dejar notas ni modificar
datos, a menos que lo actives explícitamente.

## Preguntas frecuentes

**¿Es seguro darle acceso a un asistente de IA externo?**
Solo tiene acceso a lo que le permite la clave de API que le diste —
igual que cualquier otra integración. Empieza siempre en modo
solo-lectura.

**¿Puede enviar mensajes a mis clientes por sí solo?**
Solo si le das una clave con permiso de enviar mensajes (u activas el
modo de escritura en la versión local) — no ocurre por accidente.

## Ver también

- [Claves de API](./claves-api.md)
- [API pública](./api-publica.md)
