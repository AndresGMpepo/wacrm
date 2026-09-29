# Manuales de NexoOmni — formato para el sitio de documentación

Esta carpeta contiene un manual por cada funcionalidad del producto, en
Markdown con metadatos al inicio (front matter). Está pensada para
alimentar directamente un generador de sitios estático (Docusaurus,
Nextra, Mintlify, VitePress, etc.) sin tener que reescribir el
contenido — cada archivo `.md` es una página.

## Estructura de carpetas

```
docs/manuals/
  README.md                 ← este archivo (índice y convención)
  _plantilla.md              ← copiar este archivo para un manual nuevo
  primeros-pasos/
    conexion-whatsapp.md
    conexion-facebook-instagram.md
    invitar-miembros.md
  inbox/
    bandeja-compartida.md
    plantillas-y-botones.md
    notas-internas.md
    reacciones-y-respuestas.md
  contactos/
    fusionar-contactos.md
    etiquetas-y-campos.md
    importar-csv.md
  difusiones/
    crear-una-difusion.md
    audiencias-y-exclusiones.md
  pipelines-y-citas/
    pipeline-de-ventas.md
    agenda-de-citas.md
  nexo-memory/
    tareas-y-recordatorios.md
    seguimientos-nexo.md
    panel-de-memoria.md
  telefonia/
    nexphone-softphone.md
    extensiones-por-agente.md
  supervision-y-reportes/
    supervision-en-vivo.md
    reportes-ejecutivos.md
    transcripcion-de-llamadas.md
  automatizaciones-y-flujos/
    automatizaciones.md
    flujos.md
  agentes-ia/
    respuesta-automatica.md
    base-de-conocimiento.md
  canales/
    chat-web.md
  integraciones/
    claves-api.md
    webhooks-y-automatizacion-externa.md
    servidor-mcp.md
    api-publica.md
  notificaciones/
    notificaciones.md
  changelog/
    2026-09.md               ← un archivo por mes, mejoras + bugs resueltos
```

Cada carpeta = una sección del menú del sitio de documentación. El
nombre de archivo (sin `.md`) se vuelve la URL (`/manuales/inbox/
plantillas-y-botones`).

## Catálogo — qué existe en NexoOmni y qué manual lo cubre

Esta tabla es la fuente de verdad de "todo lo que hay que documentar".
Actualízala cada vez que se agregue una funcionalidad nueva o se
escriba un manual pendiente — la regla en [AGENTS.md](../../AGENTS.md)
("todo feature nuevo lleva su manual") depende de que esta lista esté
al día.

| Funcionalidad | Manual | Estado |
|---|---|---|
| Conectar WhatsApp (nativo o guiado) | [primeros-pasos/conexion-whatsapp.md](./primeros-pasos/conexion-whatsapp.md) | ✅ |
| Conectar Facebook / Instagram | [primeros-pasos/conexion-facebook-instagram.md](./primeros-pasos/conexion-facebook-instagram.md) | ✅ |
| Miembros del equipo y roles (owner/admin/supervisor/agent/viewer) | [primeros-pasos/invitar-miembros.md](./primeros-pasos/invitar-miembros.md) | ✅ |
| Bandeja de entrada compartida (WhatsApp/FB/IG/Chat web) | [inbox/bandeja-compartida.md](./inbox/bandeja-compartida.md) | ✅ |
| Plantillas de mensaje y botones | [inbox/plantillas-y-botones.md](./inbox/plantillas-y-botones.md) | ✅ |
| Notas internas del equipo (por conversación) | [inbox/notas-internas.md](./inbox/notas-internas.md) | ✅ |
| Reacciones y respuestas citadas | [inbox/reacciones-y-respuestas.md](./inbox/reacciones-y-respuestas.md) | ✅ |
| Fusionar contactos duplicados (incl. multi-número) | [contactos/fusionar-contactos.md](./contactos/fusionar-contactos.md) | ✅ |
| Etiquetas y campos personalizados | [contactos/etiquetas-y-campos.md](./contactos/etiquetas-y-campos.md) | ✅ |
| Importar contactos por CSV | [contactos/importar-csv.md](./contactos/importar-csv.md) | ✅ |
| Crear una difusión | [difusiones/crear-una-difusion.md](./difusiones/crear-una-difusion.md) | ✅ |
| Audiencias y exclusiones | [difusiones/audiencias-y-exclusiones.md](./difusiones/audiencias-y-exclusiones.md) | ✅ |
| Pipeline de ventas (tratos) | [pipelines-y-citas/pipeline-de-ventas.md](./pipelines-y-citas/pipeline-de-ventas.md) | ✅ |
| Agenda de citas + especialistas + Google Calendar | [pipelines-y-citas/agenda-de-citas.md](./pipelines-y-citas/agenda-de-citas.md) | ✅ |
| Tareas y recordatorios (10 min antes) | [nexo-memory/tareas-y-recordatorios.md](./nexo-memory/tareas-y-recordatorios.md) | ✅ |
| Seguimientos Nexo (cola unificada de pendientes) | [nexo-memory/seguimientos-nexo.md](./nexo-memory/seguimientos-nexo.md) | ✅ |
| Panel de Nexo Memory (resumen, riesgo, oportunidad, hechos, línea de tiempo) | [nexo-memory/panel-de-memoria.md](./nexo-memory/panel-de-memoria.md) | ✅ |
| NexPhone (softphone) | [telefonia/nexphone-softphone.md](./telefonia/nexphone-softphone.md) | ✅ |
| Extensiones de NexPhone por agente | [telefonia/extensiones-por-agente.md](./telefonia/extensiones-por-agente.md) | ✅ |
| Supervisión en vivo (agentes, llamadas, intervenciones) | [supervision-y-reportes/supervision-en-vivo.md](./supervision-y-reportes/supervision-en-vivo.md) | ✅ |
| Reportes ejecutivos + reportes programados | [supervision-y-reportes/reportes-ejecutivos.md](./supervision-y-reportes/reportes-ejecutivos.md) | ✅ |
| Transcripción y análisis de llamadas | [supervision-y-reportes/transcripcion-de-llamadas.md](./supervision-y-reportes/transcripcion-de-llamadas.md) | ✅ |
| Automatizaciones (palabra clave → acción) | [automatizaciones-y-flujos/automatizaciones.md](./automatizaciones-y-flujos/automatizaciones.md) | ✅ |
| Flujos (editor visual multi-paso) | [automatizaciones-y-flujos/flujos.md](./automatizaciones-y-flujos/flujos.md) | ✅ |
| Respuesta automática con IA | [agentes-ia/respuesta-automatica.md](./agentes-ia/respuesta-automatica.md) | ✅ |
| Base de conocimiento de la IA | [agentes-ia/base-de-conocimiento.md](./agentes-ia/base-de-conocimiento.md) | ✅ |
| Chat web (Yeastar Live Chat) — conexión del widget | [canales/chat-web.md](./canales/chat-web.md) | ✅ |
| Claves de API | [integraciones/claves-api.md](./integraciones/claves-api.md) | ✅ |
| Webhooks salientes + integración n8n | [integraciones/webhooks-y-automatizacion-externa.md](./integraciones/webhooks-y-automatizacion-externa.md) | ✅ |
| Servidor MCP (conectar un asistente de IA externo) | [integraciones/servidor-mcp.md](./integraciones/servidor-mcp.md) | ✅ |
| API pública v1 | [integraciones/api-publica.md](./integraciones/api-publica.md) | ✅ (enlaza a [../public-api.md](../public-api.md) para la referencia técnica completa) |
| Notificaciones | [notificaciones/notificaciones.md](./notificaciones/notificaciones.md) | ✅ |
| Panel de plataforma (solo operador NexoOmni, no clientes) | — | Fuera de alcance de este catálogo — es interno, no se documenta como manual de cliente |

Sin pendientes conocidos a la fecha (2026-09-28) — si agregas una
funcionalidad nueva, agrega su fila aquí en el mismo cambio (regla 7 de
[AGENTS.md](../../AGENTS.md)).

## Front matter obligatorio

Todo manual empieza con este bloque (YAML), que el generador de sitio
usa para el menú, el buscador y el SEO:

```yaml
---
title: "Título corto y claro"
description: "Una frase para el buscador y las tarjetas de resumen."
section: "inbox"          # coincide con la carpeta
role: ["agent", "admin"]   # qué roles ven/usan esta funcionalidad
plan: ["basico", "crecimiento", "premium"]   # en qué paquete está incluida
updated: "2026-09-28"
---
```

El campo `plan` es clave: permite generar automáticamente un aviso
("Esta funcionalidad está disponible desde el paquete Crecimiento") sin
mantenerlo a mano en cada página.

## Estructura del cuerpo (recomendada, no obligatoria)

1. **¿Qué es?** — 2-3 líneas, sin jerga técnica.
2. **¿Para quién es?** — qué rol la usa en el día a día.
3. **Cómo se usa** — pasos numerados, con capturas de pantalla cuando
   ayude (guardarlas en `docs/manuals/_assets/<seccion>/`).
4. **Preguntas frecuentes** — 2-4 preguntas reales de soporte.
5. **Ver también** — enlaces a manuales relacionados.

## Registro de mejoras y bugs (changelog de cara al cliente)

`docs/manuals/changelog/AAAA-MM.md`: un archivo por mes. Cada entrada:

```markdown
### 2026-09-28 — Recordatorios de tareas
Ahora puedes agendar una tarea de seguimiento (con recordatorio 10
minutos antes) directamente desde Seguimientos o justo al colgar una
llamada. [Ver manual](/manuales/nexo-memory/tareas-y-recordatorios)

### 2026-09-28 — Corrección: al fusionar contactos ya no se pierde el
número secundario
```

Esto es DISTINTO del `CHANGELOG.md` técnico de la raíz del repo (ese es
para desarrolladores/commits); este changelog es redactado en lenguaje
de cliente final, sin detalles de implementación.

## Cómo priorizar qué manual escribir primero

1. Todo lo que ya usa un agente día a día (Inbox, Contactos, Difusiones).
2. Todo lo nuevo que se entrega a un cliente (usar este mismo formato
   como parte de la definición de "terminado" de una funcionalidad —
   una funcionalidad no está lista para producción hasta que tiene su
   manual).
3. Los bugs resueltos que un cliente reportó — se documentan en el
   changelog aunque no tengan manual propio.
