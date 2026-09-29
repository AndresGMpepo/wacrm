---
title: "Chat web (Yeastar Live Chat)"
description: "Conecta el widget de chat en vivo de tu sitio web a la misma bandeja compartida de NexoOmni."
section: "canales"
role: ["admin", "owner"]
plan: ["premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Si ya tienes el widget de Live Chat de Yeastar instalado en tu sitio
web, puedes conectarlo a NexoOmni para que esas conversaciones lleguen
a la misma bandeja compartida que WhatsApp/Facebook/Instagram —
mismas reglas de asignación, alertas e IA.

## ¿Para quién es?

Un administrador hace la conexión una sola vez por cada widget/página.

## Cómo se usa

1. En tu panel de Yeastar: crea o identifica el canal de Live Chat
   para cada widget/página y copia su ID.
2. En Yeastar, ve a Integraciones → API y agrega un webhook POST para
   el evento **30031: New Message Notification**.
3. En NexoOmni, ve a **Configuración → Chat web** y registra el canal:
   nombre visible, ID del canal, y (opcional) la página donde vive el
   widget.
4. Pega la URL de webhook que genera NexoOmni de vuelta en Yeastar, y
   usa el mismo secreto en ambos sistemas.
5. Si este chat vive en un PBX distinto al de tu telefonía principal,
   indica su URL y credenciales OpenAPI en el mismo panel para poder
   responder desde ahí.

## Preguntas frecuentes

**¿Puedo tener varios widgets en distintas páginas?**
Sí, cada uno se registra como su propio canal, con su propia URL de
webhook — no se comparten entre sí.

**¿Cómo sé si la conexión está funcionando?**
El panel muestra el estado de cada canal: "Activo — recibe eventos de
Yeastar", o un aviso si falta el secreto del webhook o hubo un error
en el último evento recibido.

## Ver también

- [Bandeja de entrada compartida](../inbox/bandeja-compartida.md)
- [Extensiones de NexPhone por agente](../telefonia/extensiones-por-agente.md)
