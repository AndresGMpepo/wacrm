# Public API (`/api/v1`)

The public API lets you drive your NexoOmni instance from your own
scripts and automations — send messages, manage contacts, launch
broadcasts — without going through the dashboard UI.

> **Status:** stable. Authentication, scopes, rate limiting, the
> messages / contacts / conversations / broadcasts endpoints, and
> outbound event [webhooks](#webhooks) all ship now.

## Authentication

Every request authenticates with an **API key**, sent as a bearer
token:

```
Authorization: Bearer nexoomni_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are **account-scoped**: a key acts on exactly one account, the
one it was created in. There is no cross-account access.

### Creating a key

In the dashboard: **Settings → API keys → New API key**. Only
**admins and owners** can create keys.

1. Give the key a name (after the integration that will use it).
2. Grant the **scopes** it needs — nothing more (see below).
3. Copy the key. **The full key is shown exactly once.** NexoOmni
   stores only a SHA-256 hash, so it can never be shown again. If you
   lose it, revoke it and create a new one.

### Revoking a key

**Settings → API keys → Revoke.** Revocation is effective on the
key's next request. Revoked keys stay in the list as an audit trail.

## Scopes

A key can do only what its scopes allow — independent of who created
it. Grant the minimum.

| Scope                | Allows                                   |
| -------------------- | ---------------------------------------- |
| `messages:send`      | Send WhatsApp messages                   |
| `messages:read`      | Read messages and delivery status        |
| `contacts:read`      | List and read contacts                   |
| `contacts:write`     | Create and update contacts               |
| `conversations:read` | List and read conversations              |
| `conversations:assign` | Assign or unassign a conversation to an active team member |
| `conversation-notes:read` | Read private team notes on a conversation |
| `conversation-notes:write` | Create a private team note on a conversation |
| `contact-memory:read` | Read a contact's Nexo Memory (summary, risk, facts, tasks) |
| `contact-memory:write` | Create, update, or delete a contact's follow-up tasks |
| `call-context:write` | Save an AI receptionist's verified live-call handoff |
| `deals:read`         | List and read pipelines and deals        |
| `deals:write`        | Create and update deals (including moving stage or status) |
| `appointments:read`  | List and read appointments               |
| `appointments:write` | Create and update appointments            |
| `agendapro:read`     | List AgendaPro bookings, services, providers, locations, and available slots |
| `agendapro:write`    | Create AgendaPro bookings                |
| `broadcasts:send`    | Launch broadcast campaigns               |
| `webhooks:manage`    | Register and manage outbound webhooks    |

A key with **no scopes** still authenticates and can call
`GET /api/v1/me` — useful for verifying a key works.

## Response envelope

Every response uses one of two shapes:

```jsonc
// success
{ "data": { /* ... */ } }

// failure
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }
```

Branch on `error.code` (stable); `error.message` is for humans and
may be reworded.

| Status | `code`         | Meaning                                          |
| ------ | -------------- | ------------------------------------------------ |
| 401    | `unauthorized` | Missing / malformed / unknown / revoked / expired key |
| 403    | `forbidden`    | Valid key, but missing the required scope        |
| 429    | `rate_limited` | Per-key rate limit exceeded                      |
| 400    | `bad_request`  | Malformed input                                  |
| 404    | `not_found`    | No such resource                                 |
| 500    | `internal`     | Server error                                     |

## Rate limits

Requests are limited **per key**: **120 requests per minute**. On a
`429`, these headers tell you when to retry:

- `Retry-After` — seconds until the window resets
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

> The limiter is in-memory and **per process**. A single-instance
> deploy (the common case for a self-hosted fork) is fine as-is. If
> you scale to multiple instances, swap the limiter for a shared
> store (Redis/Upstash) — see the note at the top of
> `src/lib/rate-limit.ts`. The limit is otherwise unenforced across
> instances.

## Endpoints

### `POST /api/v1/telephony/handoff`

Scope: `call-context:write`. Requires the account's Yeastar telephony
entitlement. An AI receptionist calls this **before transferring** to a
NexPhone agent. The account is taken exclusively from the API key.

Body:

```json
{
  "ai_extension": "7000",
  "summary": "Customer needs to reschedule tomorrow's appointment to the afternoon.",
  "customer_need": "Reschedule tomorrow's therapy.",
  "next_action": "Check available afternoon appointments."
}
```

`summary` is required, nonempty, at most 800 characters. Optional
`customer_need` and `next_action` allow at most 400 characters each.
At least one identifier must be supplied: `ai_extension` (at most 20
characters), `customer_phone` (international number), or `call_id`
(actual PBX call ID, at most 120 characters).

The server queries Yeastar's documented `call/query` API using the
account's OpenAPI credentials and requires exactly one active inbound
call and caller. If several calls use the AI extension simultaneously,
supply the verified caller phone or actual PBX call ID too. Never
generate an identifier or guess an undocumented Yeastar variable.
Ambiguous or unmatched calls return `400 bad_request` without saving.

Success (200):

```json
{"data":{"saved":true,"call_id":"verified-pbx-call-id"}}
```

The answering agent sees this handoff separately from historical Nexo
Memory. This is a summary, not the full CDR transcript; transcription
ingestion and memory analysis happen asynchronously after call end.
Configure static bearer/content-type headers in the Yeastar custom
HTTP tool. See the [setup manual](./manuals/telefonia/contexto-y-transferencias-ia.md).

Deployment prerequisite: apply
[migration 139](../supabase/migrations/139_yeastar_voice_context.sql)
before deploying this endpoint. Run the existing minute-level
`scripts/run-ai-analysis-worker.mjs` cron with `APP_URL` and
`AI_ANALYSIS_WORKER_SECRET` to process call transcripts and Nexo Memory;
the former transcription-retry endpoint remains a protected compatibility
wrapper, but the cron no longer needs to invoke it separately.

### `GET /api/v1/me`

Returns the account a key is bound to and the scopes it carries.
Requires only a valid key (no scope). Use it to verify a key works
and to discover its scopes.

```bash
curl https://your-crm.example.com/api/v1/me \
  -H "Authorization: Bearer nexoomni_live_xxx"```

```json
{
  "data": {
    "account": { "id": "…", "name": "Acme Inc" },
    "key": { "id": "…", "scopes": ["messages:send"] }
  }
}
```

### `POST /api/v1/messages`

Send a WhatsApp message to a phone number. Scope: `messages:send`. You
pass an **E.164 number**, not an internal id — the endpoint
finds-or-creates the contact + conversation, then sends.

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer nexoomni_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi 👋" }'
```

`type` is `text` (default), `template`, or a media kind (`image` /
`video` / `document` / `audio`). Media needs `media_url` (and optional
`filename`); `text` doubles as the caption. `template` needs a
`template` object:

```jsonc
{
  "to": "+14155550123",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en_US",
    "params": ["A123"]        // positional body vars, or a structured object
  },
  "reply_to_message_id": "<uuid>"   // optional; must be in the same conversation
}
```

Response (201):

```json
{
  "data": {
    "message_id": "…",
    "whatsapp_message_id": "wamid.…",
    "conversation_id": "…",
    "contact_id": "…",
    "contact_created": true
  }
}
```

Domain error codes beyond the table above: `whatsapp_not_configured`
(400), `meta_error` (502 — the request reached Meta and it rejected the
send), `template_malformed` (500).

### `GET /api/v1/contacts`

List contacts, newest first. Scope: `contacts:read`. Paginated (see
[Pagination](#pagination)). Optional filters: `?search=` (matches name
or phone) and `?tag=<tagId>`.

```json
{
  "data": [
    {
      "id": "…", "phone": "+14155550123", "name": "Jane Doe",
      "email": null, "company": "Acme", "avatar_url": null,
      "tags": [{ "id": "…", "name": "vip", "color": "#3b82f6" }],
      "created_at": "…", "updated_at": "…"
    }
  ],
  "meta": { "next_cursor": "…" }
}
```

### `POST /api/v1/contacts`

Create a contact. Scope: `contacts:write`. `phone` (E.164) is required;
`name`, `email`, `company`, and `tags` (an array of tag names, created
if missing) are optional. **Find-or-create by phone:** an existing
match returns `200` with the existing contact; a new contact returns
`201`. The response body is the serialized contact (same shape as the
list rows above).

### `GET` / `PATCH /api/v1/contacts/{id}`

Read or update one contact. Scopes: `contacts:read` / `contacts:write`.
`PATCH` updates only the fields you send (`name`, `email`, `company`);
pass `tags` (an array of tag names) to replace the contact's tags. A
contact in another account returns `404`.

### `GET /api/v1/contacts/{id}/memory`

Reads a contact's Nexo Memory: the consolidated summary/stage/
sentiment/risk/opportunity analysis, its dated timeline events, active
facts (interests/objections/attributes), and commitments/tasks
(pending and past). Scope: `contact-memory:read`. This is read-only —
the memory itself is only ever written by NexoOmni's own AI analysis
worker or a dashboard admin, never through the public API.

```json
{
  "data": {
    "memory": {
      "current_summary": "Interested in the annual plan, waiting on a quote.",
      "current_stage": "negotiation",
      "sentiment": "positive",
      "sentiment_score": 78,
      "risk_level": "low",
      "opportunity_score": 82,
      "next_best_action": "Send the annual-plan quote before Friday.",
      "updated_at": "…"
    },
    "events": [{ "id": "…", "event_type": "fact", "summary": "…", "importance": "normal", "confidence": 0.8, "event_date": "…" }],
    "facts": [{ "id": "…", "category": "interest", "fact": "…", "confidence": 0.75, "status": "active" }],
    "commitments": [{ "id": "…", "description": "…", "owner": "agent", "due_date": "…", "due_at": null, "status": "pending", "created_at": "…" }]
  }
}
```

### `POST /api/v1/contacts/{id}/tasks`

Schedule a follow-up task for a contact. Scope: `contact-memory:write`.
`description` (1–300 chars) and `due_at` (ISO 8601 date-time) are
required; `owner` is `agent` (default) or `customer`. Triggers the same
"10 minutes before" reminder the dashboard's own task scheduler uses.

```json
{ "description": "Send the annual-plan quote", "due_at": "2026-10-01T15:00:00-06:00" }
```

### `PATCH` / `DELETE /api/v1/contacts/{id}/tasks/{taskId}`

Update or delete a follow-up task. Scope: `contact-memory:write`.
`PATCH` updates only the fields you send (`status`, `description`,
`due_at`); changing `due_at` re-arms the reminder for the new time. A
task in another account (or contact) returns `404`.

### `GET /api/v1/pipelines`

List every pipeline in the account with its ordered stages. Scope:
`deals:read`. Not paginated — pipelines and stages are small enough
per account to return in one call.

```json
{
  "data": [
    {
      "id": "…", "name": "Pipeline comercial", "created_at": "…",
      "stages": [{ "id": "…", "name": "Nuevo", "color": "#3b82f6", "position": 0 }]
    }
  ]
}
```

### `GET /api/v1/deals`

List deals (sales opportunities), newest first. Scope: `deals:read`.
Paginated. Optional filters: `?pipeline_id=`, `?stage_id=`,
`?contact_id=`, `?status=` (`open` / `won` / `lost`). Each deal embeds
its contact and stage.

### `POST /api/v1/deals`

Create a deal. Scope: `deals:write`. `title`, `pipeline_id`, and
`stage_id` are required (`stage_id` must belong to `pipeline_id`);
`contact_id`, `value`, `currency`, `notes`, and `expected_close_date`
are optional.

```json
{ "title": "Acme Inc — annual plan", "pipeline_id": "…", "stage_id": "…", "contact_id": "…", "value": 1200 }
```

### `GET` / `PATCH /api/v1/deals/{id}`

Read or update one deal. Scopes: `deals:read` / `deals:write`.
`PATCH` updates only the fields you send — moving `stage_id` (e.g.
across the pipeline board) is just another field update, validated to
belong to the deal's own pipeline. A deal in another account returns
`404`.

### `GET /api/v1/appointments`

List appointments in a date window, ordered by start time. Scope:
`appointments:read`. Optional filters: `?from=`/`?to=` (ISO, default
7 days ago .. 30 days ahead), `?status=` (`scheduled` / `confirmed` /
`completed` / `cancelled` / `no_show`), `?contact_id=`,
`?specialist_id=`. Each appointment embeds its contact.

### `POST /api/v1/appointments`

Schedule an appointment. Scope: `appointments:write`. `title`,
`starts_at`, and `ends_at` (ISO 8601) are required; `contact_id`,
`assigned_agent_id` (defaults to the account owner),
`specialist_id`, `timezone`, and `notes` are optional. Rejects the
request with `409` if the slot conflicts with an existing booking for
the same specialist (or the same agent, when no specialist is set) —
the identical conflict check the dashboard's own booking flow uses.
Syncs to Google Calendar automatically when the account has a
connection configured.

```json
{ "title": "Consulta — Jane Doe", "starts_at": "2026-10-01T15:00:00-06:00", "ends_at": "2026-10-01T15:30:00-06:00", "contact_id": "…" }
```

### `GET` / `PATCH /api/v1/appointments/{id}`

Read or update one appointment. Scopes: `appointments:read` /
`appointments:write`. `PATCH` updates only the fields you send;
changing `starts_at`/`ends_at` re-runs the same conflict check as
creation (never against the appointment's own current booking).
Setting `status` to `completed`, `no_show`, or `cancelled` records the
matching Nexo Memory event on the contact (and, for `no_show` /
`cancelled`, a follow-up task) — the same behavior the dashboard
triggers. An appointment in another account returns `404`.

### `GET /api/v1/appointments/availability`

Find free time slots for a specialist or an agent. Scope:
`appointments:read`. Honors working hours, holidays, buffer time,
existing bookings, and Google Calendar busy time — the identical logic
the dashboard's own booking picker uses. Query: `specialist_id` OR
`agent_id`, `from`/`to` (ISO, default now .. 7 days ahead, max 60-day
range), `duration` (minutes, default 30).

```json
{
  "data": {
    "slots": [{ "start": "2026-10-01T15:00:00.000Z", "end": "2026-10-01T15:30:00.000Z" }],
    "duration_minutes": 30,
    "has_schedule": true
  }
}
```

### `GET /api/v1/agendapro/bookings`

List bookings (reservas) from the connected AgendaPro account —
independent of the `appointments` endpoints above (AgendaPro is a
separate, optional integration; see Settings → AgendaPro). Scope:
`agendapro:read`. Fetched live through to AgendaPro's own API, not
paginated by this server. Optional filters: `?range_from=`/
`?range_to=` (`YYYY-MM-DD`), `?location_id=`, `?service_id=`,
`?provider_id=`, `?contact_id=` (resolved to its linked AgendaPro
client, if any), `?page=`.

### `POST /api/v1/agendapro/bookings`

Create an AgendaPro booking. Scope: `agendapro:write`. Requires
`contact_id` (an existing NexoOmni contact — its name/phone/email are
used to find-or-create the matching AgendaPro client), `service_id`,
`provider_id`, `start`, `end` (ISO 8601); `price` is optional. Returns
`400` if the slot is no longer available — call
`GET /api/v1/agendapro/available-slots` first.

```json
{ "contact_id": "…", "service_id": 12, "provider_id": 4, "start": "2026-10-01T15:00:00-06:00", "end": "2026-10-01T15:30:00-06:00" }
```

### `GET /api/v1/agendapro/available-slots`

Find free time slots for an AgendaPro service. Scope:
`agendapro:read`. Query: `service_id`, `date` (`YYYY-MM-DD`), and
either `provider_id` or `location_id`.

### `GET /api/v1/agendapro/catalog`

List AgendaPro's locations, services, or service providers. Scope:
`agendapro:read`. Query: `?resource=locations` / `services` /
`providers`.

### `GET /api/v1/conversations`

List conversations, newest first. Scope: `conversations:read`.
Paginated. Optional filters: `?status=` (`open` / `pending` / `closed`)
and `?contact_id=`. Each conversation embeds its contact + tags.



### `GET /api/v1/conversations/{id}`

Read one conversation. Scope: `conversations:read`. `404` if it belongs
to another account.

### `GET /api/v1/conversations/{id}/messages`

List a conversation's messages, newest first. Scope: `messages:read`.
Paginated. Each message includes its `direction` (`inbound` /
`outbound`), `status` (delivery state), `whatsapp_message_id`, and
`content_*`. The conversation is verified to belong to your account
first (`404` otherwise).

### `PATCH /api/v1/conversations/{id}/assignment`

Assigns a conversation to an active member of the same account. Scope:
`conversations:assign`. This never sends a customer message and does not change
the conversation status. Send `null` to remove the current assignment.

```json
{ "assigned_agent_id": "<team-member-user-id>" }
```

### `GET` / `POST /api/v1/conversations/{id}/internal-notes`

Lists or creates private notes for the NexoOmni team on a
conversation. Scopes: `conversation-notes:read` / `conversation-notes:write`.
Notes are never delivered through WhatsApp, Yeastar, Meta, or web
chat. `GET` is keyset-paginated, newest first.

```json
{ "body": "n8n: create a follow-up task before Friday." }
```

### `GET /api/v1/team-members`

Lists active team members that can receive an assignment. Scope:
`conversations:assign`. It returns only `user_id`, `full_name`, and `role`,
so an automation can select an explicit supervisor without receiving customer
or login data.

```json
{
  "data": [
    { "user_id": "…", "full_name": "Supervisor", "role": "admin" }
  ]
}
```

### `POST /api/v1/broadcasts`

Launch a template broadcast to a list of recipients. Scope:
`broadcasts:send`. The broadcast + its recipient rows are persisted
immediately and the sends fan out in the background, so the call
returns fast — poll `GET /api/v1/broadcasts/{id}` for progress.

```bash
curl -X POST https://your-crm.example.com/api/v1/broadcasts \
  -H "Authorization: Bearer nexoomni_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "July promo",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

Recipients are capped at **1000 per request** — split larger sends.
Invalid phone numbers are dropped and counted as `rejected`. Response
(202):

```json
{
  "data": {
    "broadcast_id": "…",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}
```

### `GET /api/v1/broadcasts/{id}`

Broadcast status + counts. Scope: `broadcasts:send`. `status` moves
`sending` → `sent`; `delivered_count` / `read_count` keep climbing as
Meta delivery webhooks arrive. `404` for another account's broadcast.

## Pagination

Every list endpoint pages the same way. Request a page size with
`?limit=` (default 50, max 100) and read the next page with the opaque
`meta.next_cursor` from the previous response:

```
GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }

GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // last page
```

Cursors are keyset-based (stable under concurrent inserts). Pass the
cursor back verbatim — don't parse it. `next_cursor: null` means the
last page.

## Webhooks

Rather than polling, register an endpoint and NexoOmni will POST to it when
things happen in your account. **Migration required:** apply
`supabase/migrations/028_webhook_endpoints.sql`.

### Events

| Event                    | Fires when                                        |
| ------------------------ | ------------------------------------------------- |
| `message.received`       | An inbound message arrives from a contact         |
| `message.status_updated` | A message you sent changed delivery status        |
| `conversation.created`   | A new conversation is opened for a contact        |
| `ai.analysis.completed`  | A conversation analysis finished                  |
| `ai.critical_detected`   | Negative sentiment needs supervisor attention     |

### Managing endpoints

All under scope `webhooks:manage`.

- `POST /api/v1/webhooks` — register `{ "url": "https://…", "events": ["message.received"] }`. `url` must be `https://`. **The response includes `secret` exactly once** — store it to verify signatures; NexoOmni keeps only an encrypted copy.
- `GET /api/v1/webhooks` — list your endpoints (never returns the secret).
- `GET /api/v1/webhooks/{id}` — read one.
- `PATCH /api/v1/webhooks/{id}` — update `url`, `events`, or `is_active` (re-enabling clears the failure counter).
- `DELETE /api/v1/webhooks/{id}` — remove one.

```bash
curl -X POST https://your-crm.example.com/api/v1/webhooks \
  -H "Authorization: Bearer nexoomni_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/hooks/nexoomni", "events": ["message.received"] }'
# → 201 { "data": { "id": "…", "url": "…", "events": [...], "secret": "whsec_…" } }
```

### Delivery payload

Every delivery is a POST with this envelope; `id` is a unique per-
delivery uuid you can dedupe on, and `data` varies by `event`:

```json
{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* per-event, see below */ }
}
```

`data` by event:

```jsonc
// message.received
{ "conversation_id": "…", "contact_id": "…", "whatsapp_message_id": "wamid.…", "content_type": "text", "text": "Hi 👋" }
// conversation.created
{ "conversation_id": "…", "contact_id": "…" }
// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered" }
```

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, and `X-Wacrm-Signature`.

### Verifying the signature

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 =
HMAC-SHA256(secret, "${t}.${rawBody}")`. Recompute it over the **raw
request body** and compare in constant time; reject if `t` is more than
a few minutes old (replay protection).

```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
```

### Delivery semantics

Delivery is **best-effort**: a single attempt per event with a short
timeout, and **redirects are not followed**. `message.status_updated`
covers messages NexoOmni stores (inbox + API sends), not broadcast-only
sends, and — because providers re-send and re-order status callbacks —
the same status may arrive more than once or out of order; **dedupe on
`id` and don't assume ordering**. Each consecutive failure increments
`failure_count`; after enough consecutive failures the endpoint is
auto-disabled (`is_active: false`) — re-enable it with `PATCH` (which
resets the counter). Durable retry-with-backoff (a delivery queue) is a
future enhancement; today, treat missed deliveries as possible and
reconcile with the read endpoints when it matters.

**Target restrictions (SSRF).** The `url` must be `https://` and must
resolve to a public address — requests to `localhost`, private/RFC1918
ranges, link-local (incl. cloud metadata `169.254.169.254`), and similar
internal targets are refused at delivery time.

## Roadmap

The public API now covers messaging, contacts, conversations,
broadcasts, and outbound webhooks — the full scope of
[#245](https://github.com/ArnasDon/wacrm/issues/245). Future ideas
(deals/pipelines, templates, flows, a delivery queue for webhooks) are
not yet scheduled.
