---
title: "Reportes ejecutivos"
description: "El panorama completo del negocio: conversaciones, ventas, difusiones, citas, llamadas y salud del equipo, en un rango de fechas."
section: "supervision-y-reportes"
role: ["supervisor", "admin", "owner"]
plan: ["premium"]
updated: "2026-10-14"
---

## ¿Qué es?

Un reporte consolidado con todo lo que un dueño de negocio quiere ver:
volumen de conversaciones por canal, sentimiento de clientes, tratos
ganados/perdidos, resultado de difusiones, ocupación de citas (agenda
interna, Google Calendar o AgendaPro), llamadas telefónicas y su
sentimiento, y un resumen de Nexo Memory (riesgo, oportunidad,
compromisos vencidos).

## ¿Para quién es?

Supervisores, administradores y el propietario.

## Cómo se usa

1. Ve a **Reportes**.
2. Elige el rango (7/30/90 días).
3. Revisa las secciones: Operación, Comercial, Campañas, Citas,
   AgendaPro, Llamadas (incluye una gráfica de sentimiento), Nexo
   Business Memory.
4. Pide el **Dictamen de IA** — un resumen ejecutivo en lenguaje
   humano de ese periodo, generado por la IA a partir de los mismos
   datos, incluidas citas y llamadas cuando hay suficientes datos.
   Los "Indicadores a vigilar" siempre se explican en lenguaje de
   negocio, nunca como nombres de variables o campos técnicos.
5. Programa un envío automático por correo (diario/semanal/mensual)
   desde **Reportes programados**.

## Secciones del reporte

- **Citas**: usa la agenda interna de NexoOmni, incluidas las citas
  sincronizadas desde Google Calendar (mismo módulo, misma tabla).
  Confirmación, cancelación, no-show, ocupación y conversión desde
  conversación.
- **AgendaPro**: si la cuenta tiene conectado AgendaPro (módulo
  independiente de la agenda interna), muestra reservas confirmadas,
  atendidas, no-show y canceladas por separado.
- **Llamadas**: volumen, duración promedio y sentimiento de las
  llamadas con transcripción de Yeastar en el periodo (ver
  [Transcripción y análisis de llamadas](./transcripcion-de-llamadas.md)).
  Incluye llamadas atendidas fuera de NexoOmni — por ejemplo una
  sucursal o un agente en el softphone Linkus — siempre que su
  extensión pertenezca al rango configurado para esta cuenta en un
  PBX compartido.

## Preguntas frecuentes

**¿Qué significa "conversión desde chat" en Citas?**
Es una aproximación: si el contacto de una cita tiene alguna
conversación registrada, se cuenta como "originada en chat" — no es
una atribución exacta de causa-efecto.

**¿Por qué no veo la sección de Citas, AgendaPro o Llamadas?**
Cada sección solo aparece si hay datos en el periodo seleccionado:
citas registradas, reservas de AgendaPro, o llamadas transcritas.

**¿Puedo exportar el reporte?**
Sí, en CSV/Excel/PDF (impresión) desde el mismo panel. La exportación
incluye todas las secciones visibles, más el Dictamen de IA si ya lo
generaste.

## Ver también

- [Supervisión en vivo](./supervision-en-vivo.md)
- [Transcripción y análisis de llamadas](./transcripcion-de-llamadas.md)
- [Pipeline de ventas](../pipelines-y-citas/pipeline-de-ventas.md)
