// ============================================================
// Registers every MCP tool this API key is allowed to see, given its
// granted scopes. Called once per request by the /api/mcp route
// (a fresh McpServer per request — see that file for why).
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadTools } from './read';
import { registerWriteTools } from './write';
import { registerBroadcastTools } from './broadcast';

export function registerMcpTools(server: McpServer, authHeader: string, scopes: string[]): void {
  registerReadTools(server, authHeader, scopes);
  registerWriteTools(server, authHeader, scopes);
  registerBroadcastTools(server, authHeader, scopes);
}
