---
title: "Crear una difusión"
description: "Envía una plantilla de WhatsApp a muchos contactos a la vez, de forma masiva y dentro de las reglas de Meta."
section: "difusiones"
role: ["agent", "supervisor", "admin", "owner"]
plan: ["basico", "crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Una difusión envía la misma plantilla aprobada de WhatsApp a un grupo
de contactos, en lotes con pausas automáticas para respetar los
límites de Meta y no arriesgar la calidad de tu número.

## ¿Para quién es?

Agentes y superiores pueden crear y enviar difusiones (no está
disponible para el rol Espectador).

## Cómo se usa

1. Ve a **Difusiones → Nueva difusión**.
2. **Plantilla**: elige una plantilla aprobada.
3. **Audiencia**: todos los contactos, por etiqueta, por campo
   personalizado, o subiendo un CSV con teléfonos. Ver
   [Audiencias y exclusiones](./audiencias-y-exclusiones.md).
4. **Personalizar**: mapea cada variable de la plantilla ({{1}}, {{2}}…)
   a un campo del contacto (nombre, teléfono) o a un texto fijo.
5. **Revisar y enviar**: ponle un nombre a la difusión y confírmala.

El envío corre en lotes con una pausa entre cada uno — con audiencias
grandes puede tardar varios minutos; no cierres la pestaña mientras se
envía.

## Preguntas frecuentes

**¿Puedo reenviar la misma plantilla al mismo contacto poco tiempo
después?**
Evítalo — Meta penaliza el reenvío repetido de la misma plantilla al
mismo número en poco tiempo.

**Se cerró la pestaña a la mitad del envío, ¿qué pasa?**
La difusión se recupera sola cuando ya no quedan destinatarios
pendientes; si quedó a medias, puedes usar el botón **Detener envío**
en el detalle de la difusión para cerrarla manualmente.

**¿Puedo ver quién respondió, quién leyó y quién no recibió el
mensaje?**
Sí, el detalle de cada difusión muestra entregados, leídos, respondidos
y fallidos por destinatario.

## Ver también

- [Audiencias y exclusiones](./audiencias-y-exclusiones.md)
- [Plantillas y botones](../inbox/plantillas-y-botones.md)
