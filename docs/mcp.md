# MCP server

NexoOmni ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so you can drive your CRM from AI assistants — Claude Desktop,
Claude Code, Cursor, and any other MCP client — in natural language:

> "How many conversations are still open today?"
> "Show the last five messages with +1 415 555 0123."
> "Send the `order_update` template to that contact."

# MCP server

NexoOmni exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server so you can drive your CRM from AI assistants — Claude Desktop,
Claude Code, Cursor, ChatGPT connectors, and any other MCP client — in
natural language:

> "How many conversations are still open today?"
> "Show the last five messages with +1 415 555 0123."
> "What do we know about this customer? Check Nexo Memory."
> "Send the `order_update` template to that contact."

There are **two ways to connect**, both backed by the exact same
[public API](./public-api.md), authentication, and API-key scopes —
pick whichever fits the client you're using.

## Option A — HTTP (recommended, nothing to install)

Every NexoOmni instance already exposes `POST/GET/DELETE /api/mcp` —
an MCP server running inside the app itself, right next to `/api/v1`.
No separate process, no Docker container, no compiling: any MCP
client that supports a remote/HTTP server just needs a URL and an API
key.

1. Create an API key: **Settings → API keys** (there's a ready-to-copy
   URL + config snippet right there, under "Servidor MCP"). Grant only
   the scopes the assistant needs — a read-only assistant only needs
   the `*:read` scopes, e.g. `contacts:read`, `conversations:read`,
   `messages:read`, `contact-memory:read`.
2. Point your MCP client at:

   ```
   https://<your-instance>/api/mcp
   ```

   with header `Authorization: Bearer nexoomni_live_xxxxxxxxxxxxxxxxxxxxxxxx`.
   For clients that take a JSON config instead of a URL+header field
   (e.g. Claude Desktop's custom connectors):

   ```jsonc
   {
     "mcpServers": {
       "nexoomni": {
         "url": "https://<your-instance>/api/mcp",
         "headers": { "Authorization": "Bearer nexoomni_live_xxxxxxxxxxxxxxxxxxxxxxxx" }
       }
     }
   }
   ```

There is no separate read/write toggle for this option — the tools
available are determined **entirely by the API key's own scopes** (the
same scopes you already manage in Settings). A key with only
`contacts:read` will simply never see a tool that can send a message
or change data; revoking the key immediately cuts off access.

## Option B — local process (stdio)

For MCP clients that only support spawning a local command (some CLI
tools, some older client versions), use the standalone server in
[`mcp-server/`](../mcp-server). It's **internal use only** — not
published to npm or the public MCP registry (`package.json` has
`"private": true`) — you build it locally and point your client at the
compiled file.

1. Create an API key as above.
2. Build the server: `cd mcp-server && npm install && npm run build`.
3. Add the server to your MCP client config:

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

That's **read-only** — the safe default. To let the assistant change
data or send messages, add `"NEXOOMNI_ENABLE_WRITES": "true"` (and
`"NEXOOMNI_ENABLE_BROADCASTS": "true"` for mass sends) to `env`. Unlike
Option A, this env-var gate is per-installation, not per-key — plan
accordingly if several people share one compiled copy.

## What it exposes

- **Reads (always on):** `whoami`, contacts (list/get), conversations
  (list/get), messages (list), broadcast status, team members, contact
  Nexo Memory (summary/risk/facts/tasks), pipelines and deals
  (list/get), appointments (list/get).
- **Writes (opt-in):** send a message, create/update a contact, assign
  a conversation, add an internal note, create/update/delete a
  follow-up task, create/update a deal, create/update an appointment.
- **Broadcasts (opt-in):** launch a template broadcast — requires an
  explicit `confirm` and is marked destructive.

## Safety

Because sending WhatsApp messages is a real side effect, both options
are **read-only until you opt in** — Option A via the API key's own
scopes, Option B via its env-var gate — layered on top of the same
server-side scope enforcement every `/api/v1` call already has. Give
an assistant a read-only key and it physically cannot send anything.
See the [server README](../mcp-server/README.md) for Option B's full
tool list.

