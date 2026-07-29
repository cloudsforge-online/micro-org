# micro-__NAME__

One CloudsForge service. Owns exactly one database, reads no other, and is deployed on its own.

```bash
pnpm install
pnpm check                 # typecheck + tests
cp .env.example .env       # then fill __DB_ENV__
pnpm dev
```

## What CI enforces

`.github/workflows/ci.yml` calls the reusable workflows in `micro-org`. There are no jobs in this
repository, deliberately — eleven near-identical CI files is how the previous estate drifted. The
checks that will fail a build here are the rules in `docs/ecosystem/03-repository-responsibilities.md`
§2:

| Rule | Check |
| --- | --- |
| One database, no other | No connection string but `__DB_ENV__` appears in `src/` |
| No cross-service source imports | Only published `@cloudsforge/*` packages, no path escapes |
| `/livez`, `/readyz`, `/metrics` | All three are served |
| No `env_file` fan-out | No compose file hands this container the estate's `.env` |
| No `setInterval` doing domain work | Background work is a leased job |

## What to change first

1. `src/env.ts` — declare every variable, and only those.
2. `src/index.ts` — make `/readyz` probe the database and each declared upstream rather than
   reporting ready unconditionally.
3. Add migrations as versioned files run by a one-shot job under `pg_advisory_lock`, never from
   `index.ts` (AD-17).
4. Add an `outbox` table and write to it in the same transaction as any state change others care
   about (rule 5).
