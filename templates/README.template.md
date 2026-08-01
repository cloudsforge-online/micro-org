# The README template

Every deployable in this estate documents itself to this shape. Twelve repositories had none at
all and were green in CI, because nothing asserted that a deployable explains itself — the same
omission as four frontends shipping with no favicon. `service-ci.yml` and `web-ci.yml` now fail a
repository with no README, one under 4 kB, or one that never says how to run it.

**That gate is a floor, not this template.** It cannot check whether a route table is complete or a
constraint is explained, because a checker cannot read meaning. This file is what "good" means; the
gate only catches "absent".

## The rules that make a README worth reading

1. **Cite the source. `path:line`, in backticks.** This estate has repeatedly shipped documents
   that described something other than reality — a manifest whose checksums predated the files it
   described, a "Reproduce:" line naming a validator that had never existed, an outbox comment
   promising a delivery that never happens, carried by eighteen repositories. **A claim nobody can
   check is worse than no claim**, because it is believed. Every factual statement about behaviour
   gets a citation.
2. **Read the source, never the last README.** Route tables are read out of `src/server.ts`, not
   inferred from the client or copied from a sibling. Seven clients in this estate were built
   against a surface somebody imagined; one made every on-chain escrow activation fail with a false
   diagnosis. A README written the same way is the same defect in prose.
3. **Say what it refuses.** Nearly every service here has a refusal at its centre — it holds no
   money, it stores no balance, it never sees a raw subject, it cannot mint its own first admin. The
   refusal is usually the most important sentence in the file, and it is the one a summary drops.
4. **Explain guarantees where they live.** This estate puts its invariants in the schema on purpose:
   a deferred constraint that refuses an unbalanced journal even to a caller holding a connection, a
   CHECK that refuses a fast hash, a generated column that removes a code path rather than guarding
   it, a partial unique index that makes a fork unrepresentable. Say **why it is there rather than
   in a handler** — that reasoning is the thing a reader cannot recover from the code.
5. **Record what is broken or absent.** A known gap with a pointer is documentation. A quiet
   omission is a trap for the next person.
6. **British spelling. No marketing.** Say the load-bearing thing, not the complete-sounding thing.
   Never "handles X" — say what it does and what happens when it cannot.

## The shape

Adapt it. A library has no routes; a frontend has no migrations. Drop what does not apply rather
than writing "N/A", and add what is specific to the thing.

---

```markdown
# micro-<name>

One paragraph: what this owns, in the estate's terms, and — in the same breath — **what it
deliberately does not**.

> The refusal, stated once, plainly. "This service holds no money: a treasury account is a
> `micro-ledger` account and a spend is a ledger entry. There is no balance column, and
> `migrations.test.ts` proves it by enumerating `information_schema.columns`."

## Routes

Read out of `src/server.ts`. Note operator-only and internal routes as such.

| Method | Path | Who | Idempotency-Key | What it does |
| --- | --- | --- | --- | --- |
| `GET` | `/things` | user or service | — | … (`src/server.ts:312`) |
| `POST` | `/things` | user | **required** | … (`src/server.ts:340`) |
| `POST` | `/internal/things/:id/x` | service only | required | … (`src/server.ts:501`) |

State which routes make **no** `authenticate()` call — a client that sends a token to one of those
gets a 403 it cannot diagnose, which is a defect this estate has actually shipped.

## Background work

Leased jobs only; there are no timers. For each: what it does, **what it is leased on**, and what
happens when two replicas run it.

| Job | Lease key | Cadence | Two replicas |
| --- | --- | --- | --- |
| `thing.sweep` | `thing:<id>` | 30s | one claims, the other finds nothing (`src/jobs.ts:88`) |

## The database

Tables, then — the important part — **the constraints that carry meaning**, each with why it is
in the schema rather than in a handler.

| Constraint | Refuses | Why here |
| --- | --- | --- |
| `entries_balanced` (deferred) | an unbalanced journal | it holds against a caller with a database connection, which a handler does not (`src/migrations.ts:324`) |

## Configuration

Every variable, its default, and what breaks if it is wrong. Cross-check `.env.example` against
`src/env.ts`; **if they disagree, fix the file and say so here.**

| Variable | Default | If wrong |
| --- | --- | --- |
| `X_DATABASE_URL` | — | the service refuses to start (`src/env.ts:41`) |

## What it talks to

For each upstream: the routes called with the line each was verified against, and **what happens
when it is unavailable** — fail-open or fail-closed, and why that choice was made.

| Upstream | Routes | When it is down |
| --- | --- | --- |
| `micro-ledger` | `POST /entries` (`ledger/src/server.ts:210`) | fail closed; a spend that cannot be recorded must not happen |

## Running it

Real commands, including the database the suite needs.

```bash
pnpm install
docker run -d --rm --name x-pg -e POSTGRES_USER=x -e POSTGRES_PASSWORD=x \
  -e POSTGRES_DB=x_test -p 55432:5432 postgres:17-alpine
X_TEST_DATABASE_URL=postgres://x:x@127.0.0.1:55432/x_test pnpm test
```

## Known gaps

What is missing, what is deliberately absent, and where it is recorded. Point at
`docs/ecosystem/18-build-status.md` §3.3 where the estate already tracks it.
```

---

## Where the good examples are

Read one before writing: `beacon`, `devplatform`, `admin-api`, `community`, `analytics`,
`foresight`. `lantern` and `emberkin` document neither routes nor configuration in a table and are
still good — which is why the CI gate does not require either. **Do not rewrite a good README to
match this shape.** Improve what is thin; leave what works.
