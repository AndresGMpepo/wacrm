---
title: "Claves de API"
description: "Genera una clave para conectar NexoOmni con tus propios sistemas o con herramientas externas, con permisos acotados."
section: "integraciones"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Una clave de API permite que un sistema externo (tu ERP, un sitio web,
una herramienta de automatización) lea o escriba datos de tu cuenta de
NexoOmni de forma segura, sin usar tu usuario y contraseña.

## ¿Para quién es?

Un administrador crea y revoca claves; quien las usa normalmente es un
desarrollador o una herramienta de integración (n8n, Zapier, etc.).

## Cómo se usa

1. Ve a **Configuración → API**.
2. Crea una clave nueva, ponle un nombre descriptivo (por ejemplo,
   "Integración con mi sitio web").
3. Elige exactamente qué permisos necesita (por ejemplo, solo leer
   contactos y enviar mensajes) — nunca des más permisos de los que la
   integración realmente necesita.
4. Copia la clave generada **en ese momento** — no se vuelve a mostrar
   completa después.
5. Si ya no se usa, revócala desde el mismo panel.

## Preguntas frecuentes

**¿Qué puedo hacer con una clave de API?**
Todo lo que cubre la [API pública](./api-publica.md): leer/crear
contactos, enviar mensajes y plantillas, leer conversaciones,
asignarlas, y más — según los permisos que le diste a esa clave
específica.

**¿Puedo tener varias claves con distintos permisos?**
Sí, y es lo recomendado — una clave por integración, cada una con
solo los permisos que esa integración necesita.

## Ver también

- [API pública](./api-publica.md)
- [Webhooks y automatización externa](./webhooks-y-automatizacion-externa.md)
- [Servidor MCP (conectar un asistente de IA externo)](./servidor-mcp.md)
