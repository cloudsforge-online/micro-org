# micro-org

The organisation machinery for the CloudsForge polyrepo: reusable workflows, the contract
compatibility checker, `cfctl`, the release manifests and the Renovate preset.

**This repository is the Phase 2 gate.** AD-01 chose one repository per deployable — forty-six
repositories in 03 §1, seventy in the organisation today — and stated the cost of that choice
plainly: a `@cloudsforge/contracts-*` minor bump
would otherwise be ~48 file edits, 24 manual publishes, and no CI anywhere able to test the
composed system. AD-02 and AD-03 are the machinery that pays that cost, and
[`docs/ecosystem/03-repository-responsibilities.md`](https://github.com/cloudsforge-online/micro-docs/blob/main/ecosystem/03-repository-responsibilities.md)
§5 is explicit about what happens if it is not working:

> **If this machinery is not working, no repository may be split.**

## What is in here

| | |
| --- | --- |
| [`.github/workflows/`](.github/workflows/) | The five reusable workflows every repository calls. See [`workflows/README.md`](workflows/README.md) for why they live there and not in `workflows/`. |
| [`tools/compat.ts`](tools/compat.ts) | The contract compatibility checker. Fails on a removed field, a narrowed type or a renamed key; additive change passes. |
| [`tools/cfctl.ts`](tools/cfctl.ts) | `list`, `clone`, `pull`, `doctor`, `release`, `new`. Replaces `scripts/clone-all.sh` and `scripts/pull-all.sh`. |
| [`tools/registry.ts`](tools/registry.ts) | The repository list. One copy. Two copies is one copy that is wrong. |
| [`releases/`](releases/) | Release manifests, and why a manifest replaces `CLOUDSFORGE_TAG`. |
| [`templates/`](templates/) | What `cfctl new service` and `cfctl new web` instantiate. |
| [`renovate.json`](renovate.json) | The org-level preset. Grouped per contract package, auto-merged on green CI for `@cloudsforge/*`. |

```bash
pnpm install && pnpm check
node --import tsx tools/cfctl.ts list
node --import tsx tools/cfctl.ts doctor
```

## The three measured mitigations

Forty-six repositories is a lot for one team. Three things make it survivable, and each is a
**number**, not an intention. They are reviewed at **every phase gate**, and they are the early
warning that the repository decision is costing more than it returns. If any one of them is not
being met, the topology should be revisited rather than endured.

| Mitigation | Measured by | Target | Where it is measured |
| --- | --- | --- | --- |
| **Renovate auto-merges contract bumps org-wide** | Time from a contract publish to the last consumer being on it | **Under 24 hours, unattended.** Over a week means the topology is failing | Publish timestamp in GitHub Packages against the merge time of the last Renovate PR for that version |
| **Reusable workflows** | Number of repositories with a bespoke CI file | **Zero** | `cfctl doctor` — a workflow that declares its own `runs-on:` is reported as a failure |
| **`cfctl` + templates** | Time to stand up a new service that passes CI and appears in Beacon | **Under an hour** | `cfctl new service <name>` to a green run and a Beacon target |

Two of these are self-checking: `cfctl doctor` counts bespoke CI files directly, and
`cfctl new service` is either an hour or it is not. The first needs recording at each gate — the
publish time and the last merge time — because it is the one that degrades quietly. A contract
that takes a week to propagate does not fail anything; it just means consumers are on different
versions, which is the state AD-02 exists to prevent, arrived at slowly.

## The rules CI enforces

The ten rules in `03` §2 replace the boundaries repository walls used to enforce for free. Eight
of them are checked mechanically by `service-ci.yml`; the other two cannot be, and saying which
is more useful than pretending otherwise.

| # | Rule | Checked by |
| --- | --- | --- |
| 1 | One database, no other | `service-ci.yml` — greps for any connection variable but the declared one, and for hard-coded DSNs |
| 2 | No cross-service source imports | `service-ci.yml` — path escapes, sibling checkout imports, and `@cloudsforge/*` against the published list |
| 3 | Every cross-service call is HTTP with a scoped service token | **Not mechanically checkable.** See below |
| 4 | `/livez`, `/readyz`, `/metrics` | `service-ci.yml` |
| 5 | State changes write an outbox row in the same transaction | **Partially.** See below |
| 6 | Services storing `user_id` subscribe to `identity.user.deleted` | Beacon conformance (AD-04), not CI |
| 7 | Migrations are versioned files under an advisory lock | Template shape; a lint is possible and is not written yet |
| 8 | No `setInterval` doing domain work | `service-ci.yml`, with a documented per-line escape hatch |
| 9 | Secrets are per-service; no `env_file` fan-out | `service-ci.yml` |
| 10 | Contracts evolve additively | `contract-compat.yml` + `tools/compat.ts` |

**Rule 3 cannot be checked by grep.** Whether a call carries a *scoped* token, rather than a
shared bearer secret, is a property of what the token contains at runtime, and the call looks
identical either way at the call site. It is enforced instead by removing the shared secrets —
`PAY_SERVICE_TOKEN` and `KEYVAULT_SERVICE_TOKEN` are retired in AD-17 — so that there is no
shared secret left to send. That is a migration, not a check.

**Rule 5 is only partially checkable.** CI can see whether an `outbox` table exists and whether
the service ever writes to it. It cannot see whether *this particular* state change wrote one,
because "others care about it" is a product judgement. The mechanical half belongs in the
template; the rest is Beacon: a consumer-driven expectation that an event arrives is a test that
fails when the outbox row was not written.

## What this repository is not

- **It is not a place for product code.** `stack` already learned that lesson: Lantern and Beacon
  living in the deployment repository is how they ended up outside the workspace, consuming zero
  shared packages and duplicating the design tokens by hand.
- **It never touches `repos/`.** The existing estate is read-only for this programme and keeps
  running as the rollback target. `cfctl list` shows `hearth`, `asset-forge` and `stack` as
  unmanaged rather than omitting them, because an exclusion that is written down is a decision
  and one that is not is the bug `pull-all.sh` had with `crucible`.
- **It does not create repositories.** `cfctl new` writes a directory. Pushing it is a separate,
  deliberate act by a person.

## Conventions

TypeScript ESM, Node ≥22, `.ts` relative imports, `node:test`, no framework. Comments explain
**why** — a comment restating the code is a comment that will be wrong after the next edit and
will be believed anyway.

---

## Provenance

The code in this repository was written by **Claude Opus 5** and **Claude Fable 5**, under
human direction and review.
