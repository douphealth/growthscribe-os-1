# Generating Supabase Types (`db:types`)

This project's database types live at:

```
src/integrations/supabase/types.ts
```

The file is **auto-generated from the live Postgres schema**. Never edit it
by hand — your changes will be overwritten the next time it is regenerated.

## TL;DR

```bash
# Regenerate from the live schema
bun run db:types

# Verify required tables / columns / enum values are present
bun run db:types:verify

# Full CI gate (verify + typecheck + lint + test + build)
bun run ci
```

## What the scripts do

| Script              | Command                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `db:types`          | `supabase gen types typescript --project-id $VITE_SUPABASE_PROJECT_ID > src/integrations/supabase/types.ts` |
| `db:types:verify`   | `node scripts/verify-supabase-types.mjs` — fails if required schema is missing from `types.ts`           |
| `check`             | `typecheck && lint && test && build`                                                                     |
| `ci`                | `db:types:verify && check`                                                                               |

## Required environment variables

`db:types` needs:

| Var                          | Where                          | Notes                                                  |
| ---------------------------- | ------------------------------ | ------------------------------------------------------ |
| `VITE_SUPABASE_PROJECT_ID`   | `.env` (local) or CI secrets   | Public project ref, e.g. `lsuddojjtsfbucrxpndc`        |
| Supabase CLI auth            | `supabase login` or `SUPABASE_ACCESS_TOKEN` | Needed for the CLI to call the management API |

No service role key, no database password, no `SUPABASE_SERVICE_ROLE_KEY`.
`db:types` only reads the public schema definition via the Supabase
management API — it does not touch row data.

### Local setup

1. Install the Supabase CLI: <https://supabase.com/docs/guides/cli>.
2. `supabase login` once (opens a browser, stores a token in `~/.supabase/`).
3. Confirm `VITE_SUPABASE_PROJECT_ID` is set in `.env`.
4. Run `bun run db:types`.

### CI setup

- Set `SUPABASE_ACCESS_TOKEN` as a CI secret (personal access token from
  the Supabase dashboard → Account → Access Tokens).
- Set `VITE_SUPABASE_PROJECT_ID` as a CI variable.
- Install the Supabase CLI in the job (`npm i -g supabase` or the official
  GitHub Action).
- Run `bun run ci` as the gate.

## Where types are used

- **Browser**: `src/integrations/supabase/client.ts` types every `supabase.from(...)` call.
- **Server**: `src/integrations/supabase/auth-middleware.ts` and `client.server.ts` use the same `Database` type.
- **App code**: `import type { Database } from "@/integrations/supabase/types";`

Because every Supabase client is generic over `Database`, drift between the
live schema and `types.ts` will surface as TypeScript errors during
`bun run typecheck` (and, by extension, `bun run check`).

## Resolving drift

"Drift" = the live database schema is newer than `types.ts`. Symptoms:

- `bun run db:types:verify` fails with `Missing column …` or `Missing enum value …`.
- `bun run typecheck` complains about unknown columns or enum values that
  exist in the database (e.g. `status: "sync_running"` is rejected).
- A new migration was merged but `types.ts` was not updated in the same PR.

### Fix in 4 steps

1. **Pull the latest `main`** so you have every migration locally.
2. **Run `bun run db:types`** to regenerate `types.ts` from the live schema.
3. **Run `bun run db:types:verify`** to confirm the required tables, columns,
   and enum values are present.
4. **Commit the regenerated `src/integrations/supabase/types.ts`** in the
   same PR as the migration that introduced the schema change.

### What `db:types:verify` enforces

The verification script (`scripts/verify-supabase-types.mjs`) is the single
source of truth for the schema contract the app depends on. It currently
requires:

- **Tables**: `wordpress_posts`, `background_jobs`, `integration_connections`,
  `organizations`, `organization_members`, `sites`.
- **Columns**: `featured_image_url`, `reading_time`, `items_processed`,
  `total_items`, `error_message`.
- **Enum values**: `sync_running`, `sync_failed`, `verifying`, `stale`,
  `completed`.

When you add a migration that introduces a new required column or enum
value the app code relies on, **also add it to that script**. That keeps
CI from drifting silently in the other direction (types regenerated but
app code expectations forgotten).

## Common mistakes

- **Editing `types.ts` by hand.** Always regenerate; never patch.
- **Regenerating without running migrations first.** If you regenerate
  against a Supabase project that hasn't received the latest migration,
  the new schema disappears from `types.ts`. Always `supabase db push`
  (or apply migrations through Lovable Cloud) before `db:types`.
- **Skipping commits.** A migration without an updated `types.ts` is a
  broken commit — the next contributor's `bun run check` will fail.
- **Using the service role key locally.** `db:types` does not need it.
  Keep `SUPABASE_SERVICE_ROLE_KEY` strictly server-side.

## Related files

- `package.json` — defines `db:types`, `db:types:verify`, `check`, `ci`.
- `scripts/verify-supabase-types.mjs` — schema contract checks.
- `supabase/migrations/` — source of truth for the database schema.
- `src/integrations/supabase/types.ts` — generated output (do not edit).