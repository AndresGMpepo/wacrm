---
title: "Plan de desarrollo para Punto Clínico"
description: "Roadmap técnico, funcional y operativo para cerrar los requisitos del proyecto con Yeastar, SBC, NexoOmni y analítica de IA."
---

# Plan de desarrollo para Punto Clínico

## Objetivo

Definir el conjunto de trabajos técnicos, de integración, de datos y de operación que faltan para cumplir con el 100% de los requisitos del cliente, priorizando los defectos críticos, la escalabilidad de transcripción y análisis, la trazabilidad de leads por canal, y la arquitectura de redundancia con Yeastar + SBC + NexoOmni.

Este plan asume la arquitectura real del proyecto:

- Telephony layer: Yeastar + SIP trunks + Convergia + SBC para redundancia y routing.
- NexoOmni como capa de contacto, omnicanal, IA, memoria, supervisión y UI.
- Meta/Facebook/Instagram como canales externos con dependencia de Meta y del proveedor de orquestación (Zernio o integración directa).
- El cliente será responsable del SLA de la telefonía y de la continuidad operativa del PBX/SBC; Meta y terceros quedan fuera del control directo del proveedor.

## 1. Requerimientos que hay que cerrar

### 1.1 Requisitos críticos del negocio

| Área | Requisito | Estado de cumplimiento | Responsable |
|---|---|---|---|
| Telefonía | PBX redundante y continuidad operativa | Parcial / requiere diseño final y validación de DR con SBC | Cliente + integrador |
| Telephony SLA | Dos carriers y failover por SBC | Requiere implementación y pruebas | Cliente + integrador |
| Omnicanal | WhatsApp + Messenger + Instagram + voz | Parcial, depende de canales y conector Meta | NexoOmni + Meta |
| AI de voz | Recepcionista IA + transferencias | Requiere trazabilidad de primera atención, contexto e historial | NexoOmni + Yeastar |
| Trascripción | 500–600 llamadas/día con análisis | Requiere esquema y pipeline escalable | NexoOmni |
| Atribución | Relación llamada/campaña/lead | No implementado del todo | NexoOmni + CRM |
| Meta | Comentarios en publicaciones vs mensajes de Messenger | Implementado; requiere activar `comment.received` o `feed` | Meta / Zernio / NexoOmni |
| Datos | Extensión + nombre de agente + origen + AI/humano | Implementado para datos publicados por Yeastar | NexoOmni |

### 1.2 Requisitos funcionales que no están resueltos

- Identificar si una llamada fue atendida primero por un agente de IA y luego por un humano.
- Mostrar en la pantalla de transcripciones el título correcto, sin “Panel de control”.
- Ver todas las transcripciones, no solo la última.
- Mostrar extensión, agente, canal, fuente, tarifa/campaña y resultados de análisis.
- Incluir transcripciones de extensiones que no se atienden en NexoOmni si Yeastar las genera.
- Diferenciar comentarios de publicaciones públicas vs mensajes privados de Messenger.
- Recuperar el nombre de la publicación/anuncio al que pertenece el comentario.
- Establecer trazabilidad de anuncios, publicaciones, campañas y conversiones offline.

## 2. Suposiciones de arquitectura

### Telefonía y continuidad

- Se usará Yeastar como PBX y conmutador principal.
- Se propone un diseño con dos PBXs en diferentes nubes o entornos, conectados a un SBC común.
- El SBC será el punto de decisión de routing y failover entre carriers, no el PBX.
- Se requieren dos DIDs públicos, uno por carrier, para rutas redundantes y failover manual/automático.
- La solución de alta disponibilidad nativa de Yeastar no reemplaza esta arquitectura, porque el escenario del cliente requiere separación de redes y entornos, no un cluster local.

### Meta y Zernio

- Zernio soporta oficialmente comentarios mediante el evento `comment.received`, separado del flujo de Messenger.
- NexoOmni conserva el ID, texto, imagen, permalink de la publicación y datos del anuncio que Zernio entregue.
- La conexión directa con Meta queda como complemento cuando no sea posible suscribir `comment.received`; Facebook requiere el campo `feed` y el permiso `pages_manage_metadata`.

## 3. Priorización recomendada

### P0 — Bloqueadores críticos (0–30 días)

1. Corregir bug de atribución de llamadas con atención IA/humano.
2. Corregir vista de transcripciones: título, listado completo, paginación, filtros y orden.
3. Enriquecer cada transcripción con: extensión, agente, origen, canal, primera atención y estado.
4. Asegurar que todos los tramos de la llamada tengan contexto y no queden como “tercera llamada sin contexto”.
5. Diseñar la estrategia de almacenamiento y carga para 500–600 llamadas/día.

### P1 — Requisitos del cliente y cumplimiento funcional (30–90 días)

1. Implementar trazabilidad por campaña/lead para llamadas entrantes y DNI.
2. Integrar metadata de Facebook comments/publications con diferenciación de Messenger vs comentario.
3. Diseñar el flujo para recuperar post/ad ID, página, campaña y publicación fuente.
4. Ajustar el modelo de análisis de IA para transcripción + sentimiento + calidad + Nexo Memory.
5. Preparar la validación final de SBC, failover y DIDs.

### P2 — Escalabilidad y crecimiento (90–180 días)

1. Añadir dashboard ejecutivo con SLA, volumen, IA y productividad.
2. Estructurar pipeline de análisis por lotes y almacenamiento frío para transcripciones.
3. Añadir filtros por extensión, empleado, campaña, anuncio y feria/agente.
4. Preparar crecimiento para nuevos canales, agentes virtuales y automatizaciones.
5. Añadir nuevos conectores y un sistema de observabilidad para Meta, Yeastar y servicios de IA.

## 4. Backlog técnico con alcance detallado

### 4.1 Atribución de llamadas y contexto de primera atención

#### Objetivo

Recrear la secuencia lógica de una llamada con la intención de saber quién la atendió primero, quién tomó el relevo y qué contexto conservó cada etapa.

#### Tareas

- Definir entidad `call_session` como registro principal de la llamada.
- Definir entidad `call_event` para registrar:
  - inicio de llamada
  - atención por IA
  - transferencia a humano
  - cuelgue
  - resolución final
- Definir `first_touch_source` y `first_touch_kind`:
  - `ai_agent`
  - `human_agent`
  - `queue`
  - `external_extension`
- Añadir `origin_channel`, `source_type`, `campaign_id`, `did_id`, `attachment_id`.
- En la UI, mostrar si la llamada fue:
  - atendida por IA y luego transferida
  - atendida por humano directo
  - atendida por extensión externa sin NexoOmni
- Asegurar que la pila de contexto se conserve aunque la llamada se muestre como “agente humano” final.

#### Criterios de aceptación

- Una llamada solo tiene una sesión principal.
- El primer agente atendiendo se conserva de forma inmutable.
- La historia de transferencias se ve en el detalle de la llamada.
- El primer accionista IA aparece aunque luego intervenga un agente humano.

### 4.2 Transcripciones masivas y vista de todas las llamadas

#### Objetivo

Resolver la limitación actual de una sola transcripción visible, y acelerar la escalabilidad del volumen a 500–600 llamadas/día.

#### Tareas

- Reemplazar el listado actual por un grid paginado con filtros por fecha, extensión, agente, canal y estado.
- Indexar por:
  - `call_started_at`
  - `extension_id`
  - `agent_id`
  - `source_channel`
  - `status`
  - `is_ai_first_touch`
- Añadir paginación server-side para evitar cargar todas las transcripciones en memoria.
- Añadir soporte de búsqueda por cliente, teléfono, nombre del contacto, agente y extensión.
- Crear un pipeline de importación desde Yeastar por lotes y con reintentos.
- Definir política de retención de transcripciones según volumen, SLA y coste.

#### Criterios de aceptación

- El usuario ve el listados completo y no solo la última transcripción.
- El listado es eficiente con 500–600 llamadas/día.
- El análisis no bloquea la UI ni afecta la calidad del servicio de telefonía.
- La transcripción incluye extensión y nombre del agente.

### 4.3 Modelo de datos para extensión, agente y llamadas externas

#### Objetivo

Incluir también llamadas que no se reciben en NexoOmni, pero sí en Yeastar y extensiones físicas o móviles.

#### Tareas

- Añadir tabla `extensions` con:
  - id
  - pbx_extension
  - device_type
  - user_id
  - agent_name
  - location
  - active
- Añadir `source_origin` para distinguir:
  - `yeastar_pbx`
  - `nexoomni_ai`
  - `softphone`
  - `mobile_app`
  - `physical_phone`
- Añadir `handled_in_nexoomni` booleano.
- Vincular cada transcripción a la extensión y, si aplica, al agente responsable.
- Generar una vista “todas las extensiones” para supervisión.

#### Criterios de aceptación

- Las llamadas atendidas fuera de NexoOmni aparecen en la bitácora si Yeastar las publica.
- El sistema muestra la extensión real y el nombre del agente o del usuario vinculado.
- La transcripción de extensiones externas no queda incompleta.

### 4.4 Meta / Facebook / comentarios de publicaciones

#### Objetivo

Separar comentarios de publicaciones públicas de mensajes de Messenger y recuperar el anuncio o publicación asociado.

#### Tareas

- Definir `social_channel` con valores como:
  - `facebook_comment`
  - `facebook_messenger`
  - `instagram_dm`
  - `instagram_comment`
- Añadir metadata de la publicación:
  - post_id
  - ad_id
  - campaign_id
  - page_id
  - page_name
  - publication_url
- Diferenciar `thread_type` y `message_context`.
- Crear un flujo para recuperar si la conversación viene de una publicación y no de un chat privado.
- Preparar integración directa con Meta para comentarios de anuncio/publicación o una capa híbrida con Zernio.

#### Criterios de aceptación

- El supervisor puede distinguir comentario de publicación vs mensaje de Messenger.
- La conversación muestra qué publicación o anuncio generó la interacción.
- El sistema conserva el contexto del anuncio y de la campaña asociada.

### 4.5 Integración de DNI / campañas / atribución offline

#### Objetivo

Correlacionar llamadas con campañas digitales y atribución final de conversión.

#### Tareas

- Diseñar flujo de Dynamic Number Insertion (DNI):
  - número público por campaña
  - número detectado en sitio
  - correlación con lead/campaña
- Añadir eventos de screen-pop con CRM y contexto del lead.
- Crear modelo de `call_attribution` con campos:
  - campaign_id
  - source_medium
  - ad_id
  - landing_page
  - did_used
  - lead_id
  - conversion_status
- Añadir retorno offline de conversión y cierre del ciclo.

#### Criterios de aceptación

- Cada llamada entrante puede asociarse con una campaña o landing page válida.
- El agente ve el contexto del lead antes o al atender.
- El cierre de la conversión se puede registrar en CRM.

## 5. Modelo de datos propuesto

### 5.1 Entidades clave

```text
call_session
  id
  started_at
  ended_at
  source_channel
  did_id
  campaign_id
  lead_id
  extension_id
  agent_id
  first_touch_kind
  first_touch_source
  handled_in_nexoomni
  status

call_event
  id
  call_session_id
  event_type
  occurred_at
  actor_type
  actor_id
  metadata_json

transcript_record
  id
  call_session_id
  extension_id
  agent_id
  transcript_text
  total_duration_seconds
  language
  imported_from
  imported_at
  status

transcript_analysis
  id
  transcript_record_id
  sentiment
  summary
  key_points
  follow_up_tasks
  quality_score
  analysis_model
  created_at

social_conversation
  id
  channel_type
  message_thread_id
  source_object_id
  post_id
  ad_id
  page_id
  campaign_id
  owner_account_id
  message_text
  created_at
```

### 5.2 Recomendación de índices

- `call_session(started_at)`
- `call_session(extension_id, started_at)`
- `call_session(campaign_id, started_at)`
- `transcript_record(call_session_id)`
- `transcript_record(extension_id, started_at)`
- `social_conversation(channel_type, source_object_id, created_at)`
- `social_conversation(post_id, campaign_id)`

## 6. Estimación de consumo de tokens y costo

### 6.1 Supuestos de tráfico

- 20,000 mensajes de WhatsApp al mes.
- Automatización estimada: 50% => 10,000 mensajes con IA.
- 15,000 minutos de llamadas al mes para transcripción/análisis.
- 10,000 minutos al mes para recepcionista virtual de voz IA.
- 500–600 llamadas/día en picos de operación.

### 6.2 Aprox. consumo de tokens para texto

Para 10,000 mensajes automatizados con IA:

- Supuesto conservador: 250–500 tokens por mensaje.
- Rango estimado: 2.5M–5.0M tokens/mes para texto.
- Si con algunas interacciones se usan más tokens por contexto o memoria, puede llegar a 5M–8M tokens/mes.

Costo estimado (modelo eficiente de texto):

- 2.5M–5M tokens/mes ≈ $10–40 USD/mes, dependiendo del modelo y del nivel de contexto.
- Rango realista con memoria y análisis: $20–80 USD/mes.

### 6.3 Aprox. consumo para voz y transcripción

Para 15,000 minutos de transcripción + análisis:

- La transcripción genera texto de una longitud muy variable. En términos prácticos, 15,000 minutos suelen producir 1.5M–3.0M palabras aprox., o 10M–25M tokens según el modelo y el formato de salida.
- El análisis de sentimiento, resumen y extracción de tareas puede requerir una segunda pasada por cada transcripción; esto puede duplicar parte del costo del texto.

Costo estimado:

- Para 15,000 minutos/mes, el rango realista es $150–600 USD/mes, dependiendo del tipo de modelo y del número de llamadas con análisis profundos.

### 6.4 Aprox. costo de la IA de voz

Para 10,000 minutos/mes de recepcionista de voz IA:

- El costo depende de si la voz se procesa con un motor de TTS/ASR/LLM en pipeline.
- Rango estimado: $200–800 USD/mes según modelo, latencia y número de turnos por conversación.

### 6.5 Costo total esperado por operación

Rango estimado mensual para el escenario definido:

- Texto + mensajes: $20–80 USD/mes
- Transcripción + análisis: $150–600 USD/mes
- Voz IA: $200–800 USD/mes
- Total estimado: $370–1,480 USD/mes

Esto es una estimación útil para la toma de decisiones, pero debe validarse con el proveedor final de IA una vez elegidos los modelos y la política de retención.

## 7. Recomendación de infraestructura

### 7.1 Actual infraestructura actual

La infraestructura existente parece suficiente para la primera fase, pero debe revisarse con rigor para las cargas de transcripción y análisis en volumen real.

Se recomienda:

- Separar base de datos y lectura-escritura de transcripciones/analíticas.
- Poner un pipeline asíncrono para transcripción + análisis.
- Añadir cola de trabajo (jobs queue) para no bloquear la UI ni la telefonía.
- Usar almacenamiento escalable para millones de tokens y transcripciones.
- Añadir observabilidad: latencia por pipeline, errores por provider, fallos de reintentos y consumo de tokens por canal.

### 7.2 Recomendaciones concretas

- Usar una capa de ingestión para transcripciones: `Yeastar -> queue -> normalization -> analysis -> storage -> UI`.
- Guardar tanto el texto original como el texto analizado para trazabilidad.
- Hacer análisis con una cola separada del procesamiento de llamadas en vivo.
- No se debe hacer análisis en el mismo hilo de la llamada ni sobre la misma tabla de la UI.

## 8. Dependencias y riesgos

### Riesgos clave

- Meta no expone la publicación realmente en todos los flujos; Zernio puede ocultar parte del contexto.
- La integración directa con Facebook/Meta requiere lectura y tratamiento del `post_id`, `ad_id` y `page_id` por separado.
- El mayor riesgo de la plataforma es la carga masiva de transcripciones y análisis, no el PBX en sí.
- La integración Yocto/Yeastar/SBC debe validarse en un piloto real para confirmar failover, bypass y calidad de audio.

### Dependencias externas

- Yeastar: PBX, notificaciones, transcripciones, OpenAPI, configuración de AI.
- Meta: publicación, comentarios y mensajes.
- Convergia / carrier: SIP y DID / routing.
- Supabase / infraestructura actual: base y servicios.
- Proveedores de IA: OpenAI, Claude o equivalente, con política de tokens, latencia y almacenamiento.

## 9. Documentación que debe existir

Para cumplir con la entrega, deben quedar documentados lo siguiente:

1. Arquitectura final de telefonía y SBC.
2. Modelo de failover y continuidad.
3. Diagrama de autenticación y metadatos de llamadas.
4. Esquema de datos para transcripciones y análisis.
5. Documentación de integración con Meta/Facebook y Cómo se identifica un comentario de publicación.
6. Proceso de retención y borrado de transcripciones.
7. Política de costos por token y por modelo de IA.
8. Manual de operación para supervisión y Soporte.

## 10. Siguiente paso real del proyecto

Se recomienda cerrar en dos hitos:

### Hito 1 — Corrección urgente (2–4 semanas)

- Arreglar bugs de transcripciones.
- Corregir la UI de la vista de llamadas.
- Añadir extensión, nombre de agente y origen.
- Definir el primer-touch AI vs humano.

### Hito 2 — Compliance funcional y trazabilidad (4–8 semanas)

- Implementar DNI y campaña por llamada.
- Diferenciar Messenger vs publicación.
- Añadir metadata de anuncio y publicación.
- Preparar los flujos de transcripción masiva.

### Hito 3 — Escalabilidad y operación (8–12 semanas)

- Aumentar capacidad de procesamiento asíncrono.
- Validar producción con 500–600 llamadas/día.
- Medir coste, latencia y rendimiento por canal.
- Preparar crecimiento hacia nuevas integraciones y canales.

## 11. Conclusión

El proyecto no requiere inventar una nueva plataforma desde cero: requiere cerrar la brecha entre la capa de contacto de NexoOmni y la infraestructura real de Yeastar, Meta y el SBC del cliente. La parte más delicada no es la telefonía en sí, sino la trazabilidad, la calidad del dato y la capacidad de procesar transcripciones y análisis a escala sin romper la operación del PBX.

La recomendación es seguir esta ruta:

1. cerrar los defectos críticos por entregable,
2. construir los modelos de datos y la trazabilidad de primera atención,
3. resolver Meta/Facebook con una estrategia realista y medible,
4. preparar el pipeline de transcripción para escala operativa,
5. validar failover y continuidad con el SBC antes de cierre comercial.

Si quieres, en el siguiente paso puedo convertir este documento en:

- un roadmap de sprints con fechas y responsables,
- una versión ejecutiva para presentación a dirección,
- o una backlog técnico listo para Jira/Linear con epics, story points y criterios de aceptación.
