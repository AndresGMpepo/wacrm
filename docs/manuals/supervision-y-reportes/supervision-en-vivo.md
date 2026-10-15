---
title: "Supervisión en vivo"
description: "Ve qué agentes están conectados, escucha llamadas activas y atiende conversaciones críticas en tiempo real."
section: "supervision-y-reportes"
role: ["supervisor", "admin", "owner"]
plan: ["premium"]
updated: "2026-10-14"
---

## ¿Qué es?

Un panel en tiempo real para quien supervisa al equipo: presencia de
agentes, llamadas activas del conmutador, conversaciones marcadas como
críticas por la IA, y la bitácora de quién atendió a quién.

## ¿Para quién es?

Supervisores, administradores y el propietario.

## Cómo se usa

1. Ve a **Supervisión**.
2. **Agentes en vivo**: quién está conectado, en llamada o inactivo.
3. **Llamadas activas**: puedes "escuchar" (modo silencioso) o
   "susurrar" a una llamada en curso de un agente, sin que el cliente
   se entere.
4. **Conversaciones críticas**: chats donde la IA detectó sentimiento
   muy negativo; puedes "tomarla" para intervenir tú directamente.
5. **Bitácora de trazabilidad**: historial de asignaciones,
   transferencias y llamadas, con el agente responsable de cada una.
6. **Desempeño por agente**: mensajes enviados, conversaciones
   cerradas, transferencias, llamadas y citas por agente, en el rango
   de fechas que elijas — exportable a CSV.

## Preguntas frecuentes

**¿El cliente se entera si estoy escuchando la llamada?**
No, el modo "escuchar" es completamente silencioso; "susurrar" solo lo
escucha el agente, nunca el cliente.

**Un agente ya colgó o se desconectó, pero sigue marcado "En llamada"
¿qué hago?**
Pulsa **Actualizar**: el panel de agentes vuelve a consultar
directamente el estado de llamadas de Yeastar (no solo el último
evento guardado), así que corrige sola una llamada que quedó marcada
activa porque el PBX nunca envió el aviso final de fin de llamada.
Esto requiere tener configurado el **Client ID/Secret OpenAPI** en
Configuración → Telefonía → Supervisión de llamadas Yeastar; sin esas
credenciales, el panel solo puede mostrar el último evento recibido.

**¿Quién puede ver esta sección?**
Antes solo administradores/propietario; ahora también el rol
Supervisor, con las mismas capacidades completas.

## Ver también

- [Reportes ejecutivos](./reportes-ejecutivos.md)
- [Miembros del equipo y roles](../primeros-pasos/invitar-miembros.md)
