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

Web Push is an exception to the usual `NEXT_PUBLIC_*` build-time rule:
`NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` is retrieved through the
authenticated subscription API at runtime. Configure it together with
`WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_VAPID_SUBJECT` in the runtime
environment, never as private build arguments. Re-enable device
subscriptions after rotating the VAPID key pair.

Generate the pair once with `npx web-push generate-vapid-keys` and set
`WEB_PUSH_VAPID_SUBJECT` to a contact such as `mailto:soporte@tu-dominio.com`.
If the logs show `[web-push] Delivery is blocked by missing or invalid VAPID
configuration`, these variables are absent from the running container.
Queued alerts older than 15 minutes are discarded (`last_error = 'expired'`),
so fixing the keys does not replay an old backlog.

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
- The Docker entrypoint uses `scripts/start-standalone.mjs`, the same
  launcher as the Nixpacks deployment. With `APP_URL` and
  `AI_ANALYSIS_WORKER_SECRET`, it runs the existing analysis/report
  worker every minute, including the Web Push queue. The launcher also
  runs flow cleanup, webhook delivery and retention when their respective
  secrets are configured. A missing secret is logged explicitly and
  leaves that worker disabled. Rebuild older Docker images to obtain
  this entrypoint; do not run an additional external scheduler for the
  same jobs.
- Automation **Wait** steps still need an external scheduler targeting
  `GET /api/automations/cron` with `x-cron-secret` set to
  `AUTOMATION_CRON_SECRET`; the launcher only schedules flow cleanup,
  not this automation endpoint.
- If you override the entrypoint to run `server.js` directly, arrange
  your own scheduler for the required workers. The existing scripts
  under `scripts/` provide the authenticated requests. The optional
  retention job remains a no-op until an operator sets a retention
  window on the Platform page.
