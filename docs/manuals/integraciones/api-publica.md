---
title: "API pública"
description: "Integra NexoOmni con tus propios sistemas: contactos, mensajes, conversaciones y plantillas, vía API REST."
section: "integraciones"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Una API REST documentada que permite a un sistema externo (tu sitio
web, tu ERP, una app propia) leer y escribir datos de tu cuenta de
NexoOmni: contactos, conversaciones, mensajes y plantillas.

## ¿Para quién es?

Uso técnico — la usan desarrolladores integrando NexoOmni con otro
sistema.

## Cómo se usa

1. Crea una [clave de API](./claves-api.md) con los permisos
   necesarios.
2. Consulta la referencia técnica completa en
   [docs/public-api.md](../../public-api.md) — incluye todos los
   endpoints, ejemplos de solicitud/respuesta, y los eventos
   disponibles para [webhooks](./webhooks-y-automatizacion-externa.md).

Algunas operaciones comunes:

- Crear o actualizar un contacto.
- Enviar una plantilla aprobada a un número.
- Leer los mensajes de una conversación.
- Asignar una conversación a un agente.

## Preguntas frecuentes

**¿Necesito saber programar para usar esto?**
Sí, es una integración técnica. Si solo quieres conectar herramientas
sin escribir código, usa
[n8n](./webhooks-y-automatizacion-externa.md) o el
[servidor MCP](./servidor-mcp.md) con un asistente de IA.

**¿Hay un límite de solicitudes por minuto?**
Sí, para proteger la estabilidad del servicio — ver el detalle exacto
en la referencia técnica.

## Ver también

- [Claves de API](./claves-api.md)
- [Webhooks y automatización externa](./webhooks-y-automatizacion-externa.md)
- [Servidor MCP](./servidor-mcp.md)
