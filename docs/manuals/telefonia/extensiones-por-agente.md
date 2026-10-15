---
title: "Extensiones de NexPhone por agente"
description: "Cómo un administrador asigna la extensión telefónica de cada agente, sin repetir credenciales del PBX."
section: "telefonia"
role: ["admin", "owner"]
plan: ["premium"]
updated: "2026-10-14"
---

## ¿Qué es?

Cada agente necesita una extensión propia de la centralita (PBX) para
usar NexPhone. Este manual es sobre cómo un administrador la asigna,
sin que cada agente tenga que configurar nada técnico.

## ¿Para quién es?

Solo administradores/propietario.

## Cómo se usa

### Primera vez (una sola vez por cuenta)

1. Ve a **Configuración → Telefonía**.
2. Ingresa la **URL del PBX**, el **Access ID** y el **Access Key**
   que te dio tu proveedor Yeastar.

### Por cada agente

1. Ve a **Configuración → Miembros**.
2. En la fila del agente, escribe su número de extensión en el campo
   **Ext.** — no necesitas repetir la URL ni las credenciales, ya
   quedaron guardadas en el paso anterior.
3. El campo solo aparece si tu plan incluye telefonía.

## Preguntas frecuentes

**¿Un agente puede cambiar su propia extensión?**
También puede hacerlo él mismo desde **Configuración → Telefonía**, si
prefieres que sea autogestionado — ambos caminos escriben al mismo
lugar.

**¿Qué pasa si asigno una extensión antes de configurar el PBX de la
cuenta?**
El sistema te avisa que primero hay que configurar la integración
Yeastar (URL, Access ID, Access Key) antes de poder asignar
extensiones.

**Un mismo PBX da servicio a varios clientes de NexoOmni, cada uno con
su propio rango de extensiones — ¿cómo evito que se mezclen sus
llamadas?**
En **Configuración → Telefonía → Supervisión de llamadas Yeastar**,
escribe el **rango de extensiones de esta cuenta** (por ejemplo
`1000-1120`, o varios rangos/extensiones sueltas separados por comas:
`1000-1120,1200`). NexoOmni ignorará cualquier llamada o transcripción
de una extensión fuera de ese rango, aunque llegue al mismo webhook o
a la misma exportación de Yeastar — incluidas las de agentes que no
usan NexoOmni. Deja el campo vacío si este PBX pertenece solo a esta
cuenta (comportamiento por defecto, sin restricción).

## Ver también

- [NexPhone — llamadas desde NexoOmni](./nexphone-softphone.md)
- [Miembros del equipo y roles](../primeros-pasos/invitar-miembros.md)
