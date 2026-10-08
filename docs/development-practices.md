# Guía de buenas prácticas de desarrollo — NexoOmni

Este documento define **cómo se construye software en este repositorio**,
tanto si lo hace un desarrollador junior solo, como si trabaja apoyado de
un asistente de IA (Copilot, Claude, etc.). El objetivo es que el
producto siga siendo escalable, auditable y fácil de mantener a medida
que el equipo y el negocio crecen — no depender de que "solo la IA
entienda el código".

> Para poner en marcha el proyecto localmente, ver [CONTRIBUTING.md](../CONTRIBUTING.md)
> y [docs/README.md](./README.md). Este documento es sobre **cómo
> escribir cambios**, no sobre cómo instalar el entorno.

## 1. Principios generales

1. **El código es la documentación viva.** Los comentarios explican el
   *por qué*, nunca el *qué* (el código ya dice el qué). Si una decisión
   no es obvia mirando el código, se deja un comentario de una línea
   explicando la razón — no un párrafo.
2. **Nunca se adivina el comportamiento de un servicio externo.** Antes
   de integrar o "arreglar" algo que depende de Meta, Zernio, Yeastar,
   Supabase, etc., se revisa la documentación oficial o se reproduce el
   problema. Un cambio especulativo que "podría" arreglar algo pero no
   está confirmado es peor que no tocar nada — puede introducir un bug
   nuevo con apariencia de fix.
3. **Todo cambio de esquema es una migración numerada**, nunca un ALTER
   TABLE manual en producción. Ver sección 3.
4. **Cada endpoint que toque datos de una cuenta pasa por
   `requireRole()` / `requireEntitlement()`** (`src/lib/auth/account.ts`,
   `src/lib/account/entitlements.ts`) — nunca se confía en un chequeo
   solo del lado del cliente. El cliente decide qué *mostrar*; el
   servidor decide qué *permitir*.
5. **RLS (Row Level Security) es la última línea de defensa**, no la
   primera. Todo API route valida el rol correcto en TypeScript; la
   política RLS de la tabla debe permitir exactamente lo mismo — si un
   camino en TypeScript se abre a un rol, pero la tabla RLS lo sigue
   bloqueando, el usuario verá resultados vacíos sin error (silencioso,
   difícil de depurar). Ver el ejemplo real en
   `telephony_user_configs` (nota en `/memories/repo/architecture-notes.md`
   de este mismo repositorio, o el historial de commits del rol
   "supervisor").

## 2. Roles y permisos (`src/lib/auth/roles.ts`)

Los roles son un **ranking numérico**, no una lista de strings sueltos:

```
owner (5) > admin (4) > supervisor (3) > agent (2) > viewer (1)
```

- Nunca comparar `role === 'admin'` directamente en un chequeo de "¿tiene
  suficiente permiso?" — usar `hasMinRole(role, 'admin')` o
  `requireRole('admin')`. Esto permite insertar un rol nuevo en el medio
  (como se hizo con `supervisor`) sin tener que tocar cada chequeo
  existente.
- Toda capacidad transversal (¿puede enviar mensajes?, ¿puede editar
  configuración?) vive como un predicado con nombre en `roles.ts`
  (`canManageMembers`, `canEditSettings`, …), nunca repetida inline en
  componentes.
- Si se agrega un rol nuevo al enum `account_role_enum`, el compilador
  de TypeScript es tu red de seguridad: cualquier
  `Record<AccountRole, X>` sin la nueva clave falla el build
  (`npx tsc --noEmit`). Ejecutar ese comando SIEMPRE después de tocar
  `AccountRole` — así se encuentran todos los mapas exhaustivos que
  faltan actualizar (chips de rol, íconos, traducciones, etc.).

## 3. Migraciones de base de datos (`supabase/migrations/`)

- Un archivo por cambio, numerado secuencialmente
  (`126_task_reminders.sql`, `127_contact_alternate_phones.sql`, …).
  Nunca se edita una migración ya aplicada en producción — se crea una
  nueva que corrige o extiende.
- Si el cambio agrega un valor a un `ENUM` de Postgres (`ALTER TYPE …
  ADD VALUE`), **va en su propio archivo**, separado de cualquier
  sentencia que use ese valor nuevo — Postgres no permite usar un valor
  de enum recién agregado en la misma transacción en la que se agregó.
- Toda tabla nueva con datos de cuenta lleva `ENABLE ROW LEVEL SECURITY`
  + al menos una política. Si una tabla se deja sin política a
  propósito (por ejemplo, "solo el service role puede tocarla"), se deja
  un comentario explicando por qué — de otro modo, el próximo
  desarrollador (humano o IA) asumirá que fue un olvido.
- Antes de escribir una migración que modifica una función existente
  (`CREATE OR REPLACE FUNCTION`), se busca la definición MÁS RECIENTE de
  esa función en todo el historial de migraciones — no la original. Un
  `CREATE OR REPLACE` basado en una versión vieja **revierte** cualquier
  fix posterior.

## 4. Convenciones de código

- **Next.js App Router + Server Components por defecto.** Un componente
  solo es `'use client'` cuando de verdad necesita estado, efectos o
  eventos del navegador.
- **Un solo cliente de Supabase por contexto**: `createClient()`
  (browser, RLS-scoped) en componentes cliente,
  `requireRole()`/`requireEntitlement()` (server, RLS-scoped ligado al
  usuario) en rutas API, y el cliente `service_role` (`createAdminClient`
  con `SUPABASE_SERVICE_ROLE_KEY`) SOLO cuando una tabla no tiene
  política RLS accesible desde el navegador (por ejemplo,
  `telephony_user_configs`) o cuando la operación es de un cron/worker
  interno. Nunca se expone la service role key al cliente.
- **i18n**: todo string visible al usuario final va en
  `messages/{es,en,ko}.json` bajo la clave de su namespace — nunca hay
  texto hardcodeado en un componente de producción (excepción documentada:
  módulos nuevos "estilo Nexo Memory" que deliberadamente usan español
  plano sin next-intl, ver comentarios en `nexo-memory-panel.tsx`).
  Español es el idioma principal del negocio; inglés y coreano se
  mantienen sincronizados.
- **Errores de cara al usuario**: nunca se filtra el mensaje crudo de un
  error de base de datos o de una API externa al usuario final.
  `toErrorResponse()` (`src/lib/auth/account.ts`) colapsa cualquier error
  no clasificado a "Internal server error" — los mensajes que SÍ deben
  llegar al usuario se lanzan como `Error('texto en español, claro y
  seguro')` explícitamente.
- **Tareas periódicas (cron)**: todas viven en un único worker HTTP
  interno (`/api/internal/ai-analysis-worker`), protegido por un secreto
  compartido (`AI_ANALYSIS_WORKER_SECRET`), invocado cada 20 segundos por
  `scripts/run-ai-analysis-worker.mjs`. Un cron nuevo se agrega como una
  función más dentro de ese mismo worker (ver `sendTaskReminders()`,
  `markOverdueCommitments()`, `processCallFollowUps()` como ejemplos) —
  no se crean workers HTTP nuevos salvo que el volumen realmente lo
  justifique.
- **Avisos de mensaje entrante (push / escritorio)**: la regla de
  elegibilidad vive en TRES lugares que deben coincidir —
  `enqueue_assigned_message_web_push()` (migración 144),
  `processWebPushOutbox()` (`src/lib/notifications/web-push.ts`) y la
  alerta de escritorio (`incoming-message-alert.tsx`): conversación
  asignada → solo el asignado; sin asignar → todos los notificados. En
  octubre 2026 el worker seguía exigiendo "asignado a mí" y descartaba en
  silencio (como `sent`) todos los push de Facebook/Instagram, que casi
  siempre llegan sin asignar.
- **Zernio Facebook/Instagram — recibos**: Meta informa entregado/leído
  como *marca de agua*; Zernio solo nombra un mensaje, así que el webhook
  promueve también los salientes anteriores (`promoteOutboundWatermark`,
  solo FB/IG). Instagram NO emite `message.delivered` (tabla de eventos
  de docs.zernio.com) — ✓ pasa directo a leído. Un mensaje entrante del
  cliente en FB/IG también promueve a `read` lo saliente anterior, y si
  el evento de estado llega antes de que send/route.ts guarde la fila se
  reintenta la búsqueda una vez (2.5 s). La marca de agua es el MÁS
  TARDÍO entre el mensaje que nombra Zernio y `statusAt` (+5 s de margen,
  porque nuestro `created_at` se sella después de la respuesta de
  Zernio): Zernio puede nombrar un mensaje anterior al último leído
  (observado en producción: de dos respuestas solo la primera pasaba a
  azul).
- **Push inmediato**: el webhook de Zernio llama `processWebPushOutbox`
  dentro de `after()` tras guardar un entrante; el tick de 20 s del
  worker queda como red de seguridad. El claim por fila es atómico.
- **Inbox móvil — botón atrás**: `router.replace` es asíncrono; mientras
  la URL aún trae `?c=<id>`, la sincronización de deep-link reabría el
  chat. `closingDeepLinkRef` en `inbox/page.tsx` lo evita — no quitarlo.
- **Zernio — contexto de publicación**: `metadata.storyReply`,
  `isStoryMention`, `referral` (no-ADS), `noRenderableContent` y
  `attachments[].originalType` se guardan en `messages.post_context`
  (migración 145, `src/lib/zernio/post-context.ts`). Las URLs del CDN de
  Meta caducan: el bubble usa el proxy `/api/omnichannel/zernio/media/`
  para todos los canales `zernio_*`.

## 5. Trabajando con IA en este repositorio

1. **Toda sesión de IA debe leer el código actual antes de proponer un
   cambio** — nunca asumir cómo se ve una función por su nombre. Este
   repositorio tiene patrones no obvios (roles por rango, RLS sin
   política en tablas service-role-only, migraciones que redefinen
   funciones anteriores) que solo se descubren leyendo.
2. **Un cambio de IA nunca se "auto-aprueba"**: siempre se corre
   `npx tsc --noEmit` y `npm run lint` antes de dar por terminada una
   tarea. Ambos comandos son gratis y detectan la mayoría de los errores
   de integración entre archivos que un LLM puede introducir al tocar
   un tipo exhaustivo o una firma de función usada en varios lugares.
3. **Cambios grandes se dividen en PRs pequeños cuando es posible.** Si
   una sola sesión de IA produce un cambio muy grande (como agregar un
   rol nuevo), se documenta la decisión de diseño completa en un solo
   lugar (ver `/memories/repo/` de este repo si usas Copilot, o un
   comentario largo al inicio de la migración/archivo principal) para
   que el próximo desarrollador entienda el "por qué" sin tener que
   releer 20 archivos.
4. **Nunca se le pide a la IA "arregla esto" sobre una integración
   externa sin evidencia reproducible.** Ver el ejemplo real de los
   botones de plantillas de Zernio: se investigó el código, se confirmó
   qué SÍ está bien, y se documentó explícitamente que la causa raíz no
   pudo confirmarse sin acceso a los logs/soporte de Zernio — en vez de
   adivinar un fix que podría romper el envío de mensajes.
5. **La IA no reemplaza revisión humana en:** cambios de RLS/seguridad,
   cambios de precios o de planes comerciales, migraciones que tocan
   datos de producción existentes, y cualquier cambio a la lógica de
   facturación (`account_subscriptions`, `entitlements.ts`).

## 6. Testing

- `npm run test` (Vitest) para lógica pura — parsers, validadores,
  cálculos (ver `src/lib/broadcast-status.test.ts`,
  `src/lib/currency.test.ts`, `src/i18n/messages.test.ts` como ejemplos).
- No hay suite de integración contra Supabase real en CI todavía — los
  cambios de RLS/migraciones se validan manualmente contra una base de
  datos de desarrollo antes de aplicarse a producción. Si el equipo
  crece, este es el primer hueco a cerrar (ver sección 7 del roadmap de
  escalabilidad más abajo).

## 7. Roadmap técnico sugerido para escalar

Estas son mejoras identificadas durante el desarrollo de este producto
que valen la pena priorizar a medida que el equipo de ingeniería crezca:

- **Entorno de staging con Supabase separado** — hoy las migraciones se
  validan manualmente; un staging real evita que un `ALTER TYPE`/RLS
  nuevo se pruebe por primera vez en producción.
- **Tests de integración de RLS**: un pequeño suite que, por cada tabla
  nueva, verifique automáticamente "un agente NO puede leer esto" /
  "un supervisor SÍ puede" — hoy esa verificación es 100% manual y
  depende de que quien escribe la migración se acuerde de probarla.
- **Extraer `entitlements.ts` a una tabla de features versionada** en
  vez de un objeto TypeScript hardcodeado (`PLAN_FEATURES`) — así un
  cambio de plan comercial no requiere un deploy de código (ver sección
  de paquetes en el resumen de negocio).
- **Definir manuales por funcionalidad de forma continua** — ver
  `docs/manuals/README.md` para el formato acordado.
