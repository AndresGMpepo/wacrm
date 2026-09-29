---
title: "Conectar tu WhatsApp Business"
description: "Cómo vincular tu número de WhatsApp Business API a NexoOmni, de forma nativa o a través de un proveedor guiado."
section: "primeros-pasos"
role: ["admin", "owner"]
plan: ["basico", "crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

El primer paso para usar NexoOmni: conectar el número de WhatsApp de tu
negocio para que todos los mensajes entrantes lleguen a la Bandeja de
entrada compartida y puedas responder desde ahí con todo tu equipo.

## ¿Para quién es?

Solo un administrador o el propietario de la cuenta puede conectar o
editar esta integración.

## Cómo se usa

Hay dos caminos, según cómo tengas contratada tu API de WhatsApp:

### Opción A — Conexión nativa (token propio de Meta)

1. Ve a **Configuración → WhatsApp**.
2. Pega el **Access Token**, el **Phone Number ID** y el **WABA ID** que
   te dio Meta al crear tu app de WhatsApp Business.
3. Guarda. NexoOmni registra el webhook automáticamente.
4. Usa el botón **Probar conexión** para confirmar que el token es
   válido antes de recibir tráfico real.

### Opción B — Conexión guiada (sin tokens, vía proveedor)

1. Ve a **Configuración → Redes sociales**.
2. Elige **Conectar WhatsApp** y sigue el asistente — no necesitas
   copiar ningún token manualmente.
3. Autoriza el acceso a tu cuenta de WhatsApp Business cuando el
   navegador lo pida.

## Preguntas frecuentes

**¿Puedo tener más de un número de WhatsApp?**
La conexión nativa admite un número por cuenta. Para varios números o
para Facebook/Instagram en el mismo lugar, usa la conexión guiada
(Opción B), que sí permite múltiples canales conectados.

**¿Qué pasa si el token deja de funcionar?**
El botón "Probar conexión" en Configuración → WhatsApp te dice
exactamente qué falló (token corrupto, permisos, etc.) sin tener que
adivinar por qué dejaron de llegar mensajes o medios.

## Ver también

- [Conectar Facebook e Instagram](./conexion-facebook-instagram.md)
- [Bandeja de entrada compartida](../inbox/bandeja-compartida.md)
