# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output,
runs as a non-root user) and a `docker-compose.yml` with a single
`app` service. Supabase is external — point the app at your hosted
(or self-hosted) Supabase project via env vars; no database container
is included.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   (publish it elsewhere with `HOST_PORT=8080` in `.env.local`).

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the server listens on _inside_ the container, and `env_file`
> would inject it there — leaving the app on a port the mapping and
> the healthcheck don't target. Compose pins it to 3000 for that
> reason.

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) is read at **runtime** from `.env.local` via
  `env_file` and is never baked into the image — safe to change with
  just a container restart.

## Easypanel: avoid secrets in Nixpacks images

If the build log contains `SecretsUsedInArgOrEnv` for server keys and
`NIXPACKS_PATH`, it may be using a **generated Nixpacks Dockerfile**
rather than the Dockerfile in this repository. The repository Dockerfile
does not declare server secrets as build arguments.

For this application, select the **Dockerfile** build method in your
Easypanel service and use the repository-root `Dockerfile` with the
repository root as its build context. Keep the service's domain, port
and runtime configuration unchanged. Exact menu labels can vary by
Easypanel version.

- Pass only the public `NEXT_PUBLIC_*` build arguments declared by that
  Dockerfile. Public Supabase project URL and anon/publishable key are
  expected in the browser bundle; a service-role key is not.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, provider API keys,
  OAuth client secrets, SMTP credentials and worker/webhook secrets in
  **runtime environment variables**, not build arguments or Dockerfile
  `ENV` instructions. Do not prefix them with `NEXT_PUBLIC_`.
- Do not put a filled-in `.env.local` in Git or the Docker build context.
- Redeploy a fresh image after changing the builder. Check the new logs
  and, privately, the image configuration/history to confirm that server
  secrets are absent. Do not paste image metadata or secret values into
  tickets or shared logs.

The warnings indicate a possible exposure path, not proof that someone
obtained the secrets. If the old image was accessible outside the
trusted deployment team, revoke/rotate the affected API keys, service
credentials and shared worker/webhook secrets, update runtime variables,
and stop using the old image. Review image-registry access and retained
build caches as well.

**Do not replace `ENCRYPTION_KEY` blindly:** existing encrypted
integration credentials depend on it. Plan a coordinated migration or
re-entry of those credentials before rotating that key, otherwise
existing connections can become unreadable.

`UndefinedVar NIXPACKS_PATH` concerns the generated build configuration;
it is not a confirmed vulnerability by itself. Switching to the
repository Dockerfile removes dependence on that generated variable.
If retaining Nixpacks, inspect its generated plan and configure its
supported runtime-only secret mechanism instead of ignoring the warnings.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## Notes

### Dependency security checks

Use `npm ci` for reproducible installs from the committed lockfile.
Check both production and development dependencies:

```bash
npm audit --omit=dev
npm audit
```

As of 2026-10-05, the patched lockfile passes the production audit with
**zero vulnerabilities**. The full audit still reports **nine high
alerts in development tools**, all rooted in
[`braces` GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The affected chain runs through `micromatch`/`fast-glob` into Next.js
linting and the shadcn CLI. `braces` has no patched npm release at the
time of this check. shadcn is now explicitly a development dependency;
existing application components do not import its CLI package.

Do not use `npm audit fix --force` to silence these remaining alerts:
the proposed downgrades change the lint/scaffolding stack and are not a
compatible security patch. Run those tools only on trusted projects and
patterns, and recheck for an upstream patch. Build containers still
install development tools, so a clean production audit does not make
the build environment vulnerability-free.

The Next.js and ESLint config versions are kept aligned. Nodemailer 10
bundles its TypeScript definitions; `@types/nodemailer` must not be
installed alongside it.

### Runtime operations

- Database migrations under `supabase/` are **not** run by the
  container — apply them with the Supabase CLI as described in the
  README.
- Nothing inside the container is scheduled. If you use automation
  Wait steps, flows, or outbound API/n8n webhooks, point an external scheduler at
  `GET /api/automations/cron` and `GET /api/flows/cron` on this
  deployment, sending the shared secret in the `x-cron-secret` header
  (`AUTOMATION_CRON_SECRET`, see `.env.local.example`). Both return
  503 until that variable is set. For webhook deliveries, POST once per minute
  to `/api/internal/webhook-delivery-worker` with header
  `x-webhook-delivery-worker-secret` set to
  `WEBHOOK_DELIVERY_WORKER_SECRET`. For the platform operator's optional
  message-retention purge, POST once a day to
  `/api/internal/message-retention` with header
  `x-retention-cron-secret` set to `MESSAGE_RETENTION_CRON_SECRET` (or run
  `scripts/run-message-retention-cron.mjs`, which needs `APP_URL` too) —
  it's a no-op until an operator sets a retention window on the Platform
  page.
