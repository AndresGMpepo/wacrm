---
title: "Conectar Facebook e Instagram"
description: "Recibe y responde mensajes y comentarios de Facebook e Instagram desde la misma bandeja compartida."
section: "primeros-pasos"
role: ["admin", "owner"]
plan: ["basico", "crecimiento", "premium"]
updated: "2026-10-14"
---

## ¿Qué es?

Conecta tu página de Facebook y tu cuenta de Instagram para que los
mensajes directos y los comentarios públicos lleguen a la misma
Bandeja de entrada que usas para WhatsApp — un solo lugar para todo.

## ¿Para quién es?

Administradores/propietario configuran la conexión una sola vez; los
agentes solo ven y responden desde el Inbox una vez conectado.

## Cómo se usa

1. Ve a **Configuración → Redes sociales**.
2. Elige **Conectar Facebook** o **Conectar Instagram**.
3. Inicia sesión con la cuenta que administra tu página/perfil de
   negocio cuando el navegador lo pida.
4. Confirma los permisos solicitados (mensajes, comentarios).

Una vez conectado, los mensajes nuevos aparecen en el Inbox marcados
con el ícono del canal correspondiente, igual que los de WhatsApp.

Si tu página ya estaba conectada antes de esta actualización, vuelve a
**Configuración → Redes sociales → Validar conexión** una vez — así
Meta empieza a enviarnos el contexto del anuncio (ver más abajo) para
las conversaciones nuevas.

## Contexto del anuncio

Cuando un cliente te escribe desde un anuncio de "Enviar mensaje"
(Click-to-Messenger), el Inbox muestra un aviso con el anuncio de
origen — igual que en la app de Meta — para que sepas de qué
producto o promoción pregunta antes de responder. Ver
[Bandeja de entrada compartida](../inbox/bandeja-compartida.md).

## Preguntas frecuentes

**¿Los comentarios públicos también llegan aquí?**
Sí — un comentario en una publicación de Facebook o Instagram genera
una conversación independiente de Messenger. El encabezado indica que
es un comentario público y muestra el texto, imagen y enlace de la
publicación cuando el proveedor los entrega.

Si usas la conexión guiada por Zernio, su webhook debe incluir el evento
oficial **`comment.received`**, además de **`message.received`**. No es
necesario abandonar Zernio ni configurar Meta manualmente para obtener
esta trazabilidad. Si el evento no puede habilitarse en esa cuenta, se
puede usar la conexión Meta nativa como complemento para comentarios.

En una conexión Meta nativa de Facebook, pulsa **Validar conexión** para
suscribir también el campo `feed`; Meta exige el permiso
`pages_manage_metadata`. Si el token no tiene ese permiso, Messenger
puede seguir funcionando aunque los comentarios queden pendientes.

**¿Puedo identificar al mismo cliente si me escribe por WhatsApp y por
Instagram?**
No automáticamente — Facebook/Instagram no comparten el teléfono del
cliente con nosotros, así que cada canal crea su propio contacto. Si
reconoces que es la misma persona, puedes fusionarlos manualmente — ver
[Fusionar contactos duplicados](../contactos/fusionar-contactos.md).

## Ver también

- [Conectar tu WhatsApp Business](./conexion-whatsapp.md)
- [Bandeja de entrada compartida](../inbox/bandeja-compartida.md)
