// ============================================================
// POST/GET/DELETE /api/mcp — Model Context Protocol over HTTP.
//
// Lets any MCP-compatible client (Claude, Cursor, remote connectors,
// n8n, etc.) connect directly to `https://<your-instance>/api/mcp`
// with a Bearer API key — no local process to install or compile.
// This is the network-reachable sibling of the standalone stdio
// server in `mcp-server/` (still useful for local dev / CLI tools
// that only support spawning a local process).
//
// Auth is the same API key used by the rest of `/api/v1`: this route
// authenticates once via `requireApiKey` (no fixed scope — a key with
// zero scopes still connects, same as `GET /api/v1/me`), then
// registers only the tools that key's scopes actually allow. Every
// tool call is then forwarded, in-process, to the matching `/api/v1`
// route handler (see `src/lib/mcp/bridge.ts`) — so authorization,
// rate limiting, and validation all run through the exact same code
// path as any other API-key integration.
//
// Stateless: a fresh McpServer + transport is built per HTTP request
// (`sessionIdGenerator` left unset). Tool registration only depends
// on the key's scopes, which are re-read fresh every request, so this
// is correct without needing any cross-request session state.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { requireApiKey } from '@/lib/auth/api-context';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import { registerMcpTools } from '@/lib/mcp/tools';

const MCP_SERVER_VERSION = '1.0.0';

async function handleMcpRequest(request: Request): Promise<Response> {
  try {
    const authHeader = request.headers.get('authorization') ?? '';
    const ctx = await requireApiKey(request);

    const server = new McpServer({ name: 'nexoomni-mcp', version: MCP_SERVER_VERSION });
    registerMcpTools(server, authHeader, ctx.scopes);

    // Stateless mode (no sessionIdGenerator) + plain JSON responses —
    // the simplest, most broadly-compatible mode for tool-calling
    // clients that don't need server-initiated push/streaming.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);

    return await transport.handleRequest(request);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
