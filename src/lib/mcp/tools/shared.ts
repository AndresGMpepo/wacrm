// ============================================================
// Shared helpers for the in-app MCP tool handlers — mirrors
// mcp-server/src/tools/shared.ts, adapted for RouteApiError instead
// of a real HTTP client's error type.
// ============================================================

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RouteApiError } from '../bridge';

export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/** Wrap a tool handler so a `RouteApiError` becomes a clean, model-readable error result. */
export function handle<A>(
  fn: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof RouteApiError) {
        return errorResult(`NexoOmni API error [${err.code}]: ${err.message}`);
      }
      return errorResult(`Unexpected error: ${(err as Error).message}`);
    }
  };
}
