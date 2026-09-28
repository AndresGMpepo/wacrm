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
  contactos/
    fusionar-contactos.md
    etiquetas-y-campos.md
  difusiones/
    crear-una-difusion.md
    audiencias-y-exclusiones.md
  pipelines-y-citas/
    pipeline-de-ventas.md
    agenda-de-citas.md
  nexo-memory/
    tareas-y-recordatorios.md
    seguimientos-nexo.md
  telefonia/
    nexphone-softphone.md
    extensiones-por-agente.md
  supervision-y-reportes/
    supervision-en-vivo.md
    reportes-ejecutivos.md
  changelog/
    2026-09.md               ← un archivo por mes, mejoras + bugs resueltos
```

Cada carpeta = una sección del menú del sitio de documentación. El
nombre de archivo (sin `.md`) se vuelve la URL (`/manuales/inbox/
plantillas-y-botones`).

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
