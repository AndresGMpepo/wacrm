export const dynamic = 'force-dynamic';

/**
 * Unauthenticated liveness endpoint for Easypanel.
 *
 * It intentionally has no database or third-party dependency: a healthy
 * process must return 200 even while an external integration is unavailable.
 */
export function GET() {
  return Response.json(
    { status: 'ok' },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
