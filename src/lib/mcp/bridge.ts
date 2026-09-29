// ============================================================
// In-process bridge from an MCP tool call to an existing
// `/api/v1/*` route handler.
//
// The HTTP MCP endpoint (`src/app/api/mcp/route.ts`) runs inside the
// same Next.js process as the public API, so instead of re-implementing
// each tool's business logic (or looping back over a real network
// socket to itself), we call the route handler's exported GET/POST/
// PATCH function directly with a synthetic `Request`. This is the
// single source of truth: auth, scope checks, rate limiting, and
// validation all still happen exactly once, inside `requireApiKey`
// and the route body — a future fix to `/api/v1` automatically applies
// here too. (The standalone stdio MCP server in `mcp-server/` is a
// separate OS process with no access to this code, so it still talks
// over real HTTP — see mcp-server/src/client.ts.)
// ============================================================

type PlainRouteHandler = (req: Request) => Promise<Response>;
type DynamicRouteHandler<P extends Record<string, string>> = (
  req: Request,
  ctx: { params: Promise<P> },
) => Promise<Response>;

export class RouteApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RouteApiError';
    this.status = status;
    this.code = code;
  }
}

interface CallRouteOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface RouteEnvelope<T> {
  data: T;
  meta?: { next_cursor: string | null };
}

/** Invoke a route handler (no dynamic params) in-process and unwrap its envelope. */
export async function callRoute<T>(
  handler: PlainRouteHandler,
  path: string,
  authHeader: string,
  options?: CallRouteOptions,
): Promise<RouteEnvelope<T>>;
/** Invoke a `[id]/route.ts`-style handler in-process and unwrap its envelope. */
export async function callRoute<T, P extends Record<string, string>>(
  handler: DynamicRouteHandler<P>,
  path: string,
  authHeader: string,
  options: CallRouteOptions & { params: P },
): Promise<RouteEnvelope<T>>;
export async function callRoute<T, P extends Record<string, string>>(
  handler: PlainRouteHandler | DynamicRouteHandler<P>,
  path: string,
  authHeader: string,
  options: (CallRouteOptions & { params?: P }) = {},
): Promise<RouteEnvelope<T>> {
  const url = new URL(`http://internal${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { authorization: authHeader };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const request = new Request(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const response = options.params
    ? await (handler as DynamicRouteHandler<P>)(request, { params: Promise.resolve(options.params) })
    : await (handler as PlainRouteHandler)(request);

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { data?: T; error?: { code?: string; message?: string } }) : null;

  if (!response.ok) {
    const code = payload?.error?.code ?? 'internal';
    const message = payload?.error?.message ?? `Request failed with status ${response.status}`;
    throw new RouteApiError(response.status, code, message);
  }

  return payload as RouteEnvelope<T>;
}
