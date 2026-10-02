# NexoOmni MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server for
**NexoOmni** — the WhatsApp CRM. It lets MCP clients (Claude Desktop,
Claude Code, Cursor, and others) drive your CRM in natural language:

> "How many conversations are still open?"
> "Find the contact for +1 415 555 0123 and show the last few messages."
> "Draft and send an order-update template to Jane."

It's a thin wrapper over NexoOmni's public [`/api/v1`](../docs/public-api.md)
REST API. All auth, scoping, and rate limiting are enforced by your
NexoOmni instance — this server just exposes the API as MCP tools.

> **Internal use only.** This package is `"private": true` in
> `package.json` and is not published to the public npm registry or the
> MCP registry — install it from this repository only (see below).

## Prerequisites

1. A running NexoOmni instance.
2. An API key: in the dashboard go to **Settings → API keys → New API
   key** and grant only the scopes you need. The key is shown once.

## Install & configure

The server reads two required environment variables and two optional
write guards:

| Variable                     | Required | Purpose                                                        |
| ----------------------------- | -------- | -------------------------------------------------------------- |
| `NEXOOMNI_BASE_URL`           | yes      | Your instance URL, e.g. `https://crm.example.com`              |
| `NEXOOMNI_API_KEY`            | yes      | An API key from the dashboard                                  |
| `NEXOOMNI_ENABLE_WRITES`      | no       | `true` to expose contact writes, message sending, conversation assignment, and internal notes |
| `NEXOOMNI_ENABLE_BROADCASTS`  | no       | `true` to expose mass broadcasts (needs `NEXOOMNI_ENABLE_WRITES`) |

### Claude Desktop / Claude Code / Cursor

Since this package isn't on npm, point the client at the built file
directly (run `npm install && npm run build` in this folder first):

```jsonc
{
  "mcpServers": {
    "nexoomni": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "NEXOOMNI_BASE_URL": "https://crm.example.com",
        "NEXOOMNI_API_KEY": "nexoomni_live_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

That configuration is **read-only** — the safe default. To let the
assistant change data or send messages, add the write guards:

```jsonc
"env": {
  "NEXOOMNI_BASE_URL": "https://crm.example.com",
  "NEXOOMNI_API_KEY": "nexoomni_live_xxxxxxxxxxxxxxxxxxxxxxxx",
  "NEXOOMNI_ENABLE_WRITES": "true",
  "NEXOOMNI_ENABLE_BROADCASTS": "true"
}
```

## Tools

Read tools are always available. Write and broadcast tools appear only
when their guard is set.

| Tool                 | Group     | Scope needed         | What it does                                    |
| -------------------- | --------- | -------------------- | ----------------------------------------------- |
| `whoami`             | read      | _(any valid key)_    | Show the account + scopes the key carries       |
| `list_contacts`      | read      | `contacts:read`      | List/search contacts (paginated)                |
| `get_contact`        | read      | `contacts:read`      | Read one contact                                |
| `list_conversations` | read      | `conversations:read` | List conversations, filter by status/contact    |
| `get_conversation`   | read      | `conversations:read` | Read one conversation                           |
| `list_conversation_notes` | read | `conversation-notes:read` | List private team notes on a conversation |
| `list_messages`      | read      | `messages:read`      | List a conversation's messages                  |
| `get_broadcast`      | read      | `broadcasts:send`    | Poll a broadcast's delivery status              |
| `list_team_members`  | read      | `conversations:assign` | List active members who can receive an assignment |
| `get_contact_memory` | read      | `contact-memory:read` | Read a contact's Nexo Memory (summary, risk, facts, tasks) |
| `list_pipelines`     | read      | `deals:read`          | List pipelines with their ordered stages |
| `list_deals`         | read      | `deals:read`          | List deals, filter by pipeline/stage/contact/status |
| `get_deal`           | read      | `deals:read`          | Read one deal |
| `list_appointments`  | read      | `appointments:read`   | List appointments in a date window |
| `get_appointment`    | read      | `appointments:read`   | Read one appointment |
| `get_availability`   | read      | `appointments:read`   | Find free time slots for a specialist or agent |
| `list_agendapro_bookings` | read | `agendapro:read`     | List AgendaPro bookings (independent of the Appointments module) |
| `get_agendapro_available_slots` | read | `agendapro:read` | Find free AgendaPro slots for a service/provider/location |
| `list_agendapro_catalog` | read  | `agendapro:read`     | List AgendaPro's locations, services, or providers |
| `send_message`       | write     | `messages:send`      | Send a WhatsApp message (text/template/media)   |
| `create_contact`     | write     | `contacts:write`     | Create (find-or-create) a contact               |
| `update_contact`     | write     | `contacts:write`     | Update a contact / replace its tags             |
| `assign_conversation` | write    | `conversations:assign` | Assign or unassign a conversation |
| `add_conversation_note` | write  | `conversation-notes:write` | Add a private team note (never sent to the customer) |
| `create_task`        | write     | `contact-memory:write` | Schedule a follow-up task for a contact |
| `update_task`        | write     | `contact-memory:write` | Update a task's status, description, or due date |
| `delete_task`        | write     | `contact-memory:write` | Permanently delete a task |
| `create_deal`        | write     | `deals:write`         | Create a deal in a pipeline |
| `update_deal`        | write     | `deals:write`         | Move a deal's stage, or update its value/status/notes |
| `create_appointment` | write     | `appointments:write`  | Schedule an appointment (checks for conflicts) |
| `update_appointment` | write     | `appointments:write`  | Reschedule, change status, or update an appointment |
| `create_agendapro_booking` | write | `agendapro:write`  | Create an AgendaPro booking for an existing contact |
| `send_broadcast`     | broadcast | `broadcasts:send`    | Launch a template broadcast (requires `confirm`)|

## Safety model

Sending WhatsApp messages through an LLM is a real-world side effect, so
the server layers three guards:

1. **Read-only by default.** Write and broadcast tools are not even
   registered — the model can't see them — unless you opt in via
   `NEXOOMNI_ENABLE_WRITES` / `NEXOOMNI_ENABLE_BROADCASTS`.
2. **API-key scopes.** Whatever the guards allow, your NexoOmni instance
   still enforces the key's scopes. A call without the right scope
   returns a clean `forbidden` error. Issue a read-only key for a
   read-only assistant.
3. **Explicit broadcast confirmation.** `send_broadcast` refuses to run
   unless called with `confirm: true`, and is marked `destructive` so
   compliant clients prompt the user first.

## Development

```bash
npm install
npm run build      # compile to dist/
npm run typecheck
npm start          # run the compiled server (needs the env vars)
```

Logs go to **stderr** — stdout is reserved for the MCP protocol.

## License

MIT — same as the rest of the repository.
