<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Development rules (mandatory, not optional)

Full guide: [docs/development-practices.md](docs/development-practices.md). These are the non-negotiable parts — read the full guide before any change that touches auth, roles, migrations, or an external integration.

1. **Roles are ranked, never string-compared.** Use `hasMinRole()`/`requireRole()`/`requireEntitlement()` (`src/lib/auth/roles.ts`, `src/lib/auth/account.ts`, `src/lib/account/entitlements.ts`). Never write `role === 'admin'` as a permission check.
2. **Schema changes are a new numbered file in `supabase/migrations/`.** Never edit an already-applied migration. Before `CREATE OR REPLACE FUNCTION`, find that function's MOST RECENT definition across all migrations — replacing an old one silently reverts later fixes. A new `ALTER TYPE ... ADD VALUE` goes in its own migration file, never in the same file that uses the new value.
3. **After any change, run `npx tsc --noEmit` and `npm run lint`.** Both must be clean before the task is done. This is the primary safety net for exhaustive `Record<AccountRole, X>` / `Record<NotificationType, X>`-style maps.
4. **Never guess at an external API's (Meta, Zernio, Yeastar, Supabase) undocumented behavior.** If it can't be confirmed from docs or reproduced, say so explicitly instead of shipping a speculative fix — see the Zernio template-buttons investigation in `/memories/repo/architecture-notes.md` for the expected standard of evidence.
5. **RLS is the last line of defense, not the first.** Every route that reads/writes account data must ALSO have a matching RLS policy — a route-level check that passes while the table's RLS still blocks it fails silently (empty results, no error). Check both ends.
6. **User-facing strings live in `messages/{es,en,ko}.json`.** No hardcoded text in production components (the few pre-existing exceptions, e.g. Nexo Memory's plain-Spanish panels, are documented inline where they occur — don't extend that exception to new code without asking).
7. **Every new user-facing feature ships with a manual.** Add or update a page under `docs/manuals/` (see `docs/manuals/README.md` for the format) as part of the same change — a feature isn't "done" until it has one. Log the change in `docs/manuals/changelog/<YYYY-MM>.md` too, in plain customer language (not the technical git changelog).
8. **Record non-obvious decisions where the next session will find them.** For Copilot sessions specifically, that means `/memories/repo/` — architecture notes, gotchas (e.g. tables with RLS enabled but zero policies), and anything a future change could silently regress.
