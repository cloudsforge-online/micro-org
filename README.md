# micro-org

The organisation machinery for the CloudsForge polyrepo: reusable workflows, the contract
compatibility checker, `cfctl`, the release manifests, the Renovate preset — and **the estate's
bug tracker**.

---

## Every defect is recorded here

**[`micro-org/issues`](https://github.com/cloudsforge-online/micro-org/issues) is the tracker for
the whole estate.** One central list, not issues scattered across sixty-nine repositories; each
issue names its owning repo in the body.

**File an issue when a defect is FOUND, not when it is fixed.** One opened and closed within the
hour is still the record that it existed — and that record is the point. In a single programme run
this estate found a chain that could not load its own data past two months, deposits that had never
once worked, and a custody master secret published in a public repository. All were reported in
conversation, fixed, and would have left no durable trace of what had been wrong or what was still
open.

Four rules, each of which exists because it was got wrong first:

1. **Lead with the user-visible symptom**, then the mechanism. Someone skimming should see what
   broke for a person, not an implementation detail.
2. **Cite `path:line`.** A tracker entry that is wrong is worse than none. Several long-standing
   "facts" in this estate turned out stale the moment somebody checked them.
3. **Keep the status current.** A list of everything ever wrong, with no state, is an archive
   rather than a tracker.
4. **Do not inflate.** Many defects here are caught before production, and more often by another
   check than by a user — say which. A tracker that makes a well-tested system look like a burning
   one misrepresents it just as badly as one that hides problems.

And when a defect existed because **a check could not fail** — a skip reported as a pass, a regex
matching nothing, a guard on a path nobody ran — say so. That pattern accounts for **twenty-two**
separate defects, rostered with citations in
[#38](https://github.com/cloudsforge-online/micro-org/issues/38), and it is more actionable than any
single entry on the list. This paragraph said "at least nine" for as long as the number was nine;
a count in prose is a claim, and claims here get re-checked.

### And the other half: no fix is complete until the issue is closed with the evidence

The rule above says when to *open*. This one says when you are *done*, and it is the half that keeps
being dropped:

> **A fix is not finished when the code is fixed. It is finished when an issue exists for it and is
> closed with the evidence.**

It applies to **documentation fixes**, to **one-line changes**, and to **defects found and fixed
inside a single working session** — those last especially, because they are the ones that feel too
small to be worth writing down and are therefore the ones with no record at all.

This exists because it was got wrong, at scale, on 2026-08-05. Sixty-odd repositories took a day of
fixes with almost no tracker entry behind them. The commits were there; the record of *what had been
wrong* was not. Reconstructing it afterwards cost more than filing would have, and cost accuracy
too — three claims in the reconstruction turned out to be overstated when checked against source,
including one that was going to be filed as "roughly 15 repositories" and is five.

Five things follow from it:

1. **Cite the fix commit in the issue, and close the issue in the same session.** A commit message
   is not a tracker entry: it says what was changed, and the useful record is what was *broken*. Nor
   is a closed issue with no SHA — "fixed" with nothing to check is a claim, and this estate has
   been wrong about its own state often enough that claims are not evidence.
2. **Say plainly when a fix is only partly landed**, and leave it open. Six issues here were closed
   carrying a `status:open` or `status:in-progress` label, so the list disagreed with itself about
   what was done. A status is a claim like any other and goes stale like any other.
3. **A documentation fix is a defect fix.** Prose that contradicts the code is a defect that has not
   caused an outage yet. `ui/packages/ui/src/surfaces.ts` described a hostname consolidation
   backwards; a bundle believed the comment, pointed at a hostname with no DNS record, and Forge
   Worlds served a page with no data on it. That comment was "documentation only" right up until it
   was not. Label it `documentation`, do not inflate it — and file it.
4. **Note when the OWNER found it by using the product**, rather than any test. That is not a
   confession, it is the most actionable fact in the entry: it says the gap is in what is checked,
   not in what was written. The Forge Worlds outage was found that way, with every check in front of
   it green, because they all asked whether the page answered and none asked whether the data
   arrived.
5. **A ticket about mainnet behaviour is closed by a MAINNET measurement, or it is not closed.**
   Not by a testnet measurement, not by a green CI run, not by a merged diff. Each of those is
   evidence about a different system from the one the ticket is about, and the estate has now closed
   tickets on all three:

   | closed on | what it proved | what was still true |
   | --- | --- | --- |
   | a **testnet** measurement ([#243](https://github.com/cloudsforge-online/micro-org/issues/243)) | testnet stopped mailing reserved domains | mainnet sent 1,535 more messages over six days and emptied a paid allowance, until a *provider dashboard* said so |
   | a **CI** run ([#392](https://github.com/cloudsforge-online/micro-org/issues/392)) | the alert file was correct and present in the container | the running Prometheus had never read it — rule files are not `file_sd` — and had been in that state for 22 hours |
   | a **re-verification sweep** | the sweep ran | it had run against the wrong network |
   | a **release manifest** ([#384](https://github.com/cloudsforge-online/micro-org/issues/384)) | every pin was valid: the images existed, the tags resolved, the digests were real, `--dry-run` was green | 45 of the 48 rows had been inherited unread from a file six days old, so the deploy rolled the estate back — the indexer by 87 commits — with every container healthy. Found five days later by reading `org.opencontainers.image.version` off the running containers |

   All four are one mistake: **an artefact was verified and a running system was not.** The
   repository was right in every case, and had been right for days. #384 is the sharpest of them,
   because there the artefact was not merely right — it was *provably* right, by three separate
   checks, and every one of those checks answers "is this pin valid" when the question that
   mattered was "is this pin newer than the one it replaces".

   So the evidence in the closing comment names the network, and it is read out of the **running
   containers and databases** rather than out of a compose file, a manifest or a checkout — the
   estate runs pinned release images, so a repository on the host and the process on the host are
   routinely different things (`micro-deploy`'s own release notes say so). Two practical
   consequences:

   - **Measure after the deploy, not after the merge.** A PR number is not a measurement. If the fix
     is merged and not yet deployed, say exactly that and leave the ticket open — rule 2.
   - **A fix that lands on both networks needs a measurement on both.** A mainnet prune proves
     nothing about testnet, in the same way and for the same reason.

The three paragraphs before this list are all reconstruction, and the table in rule 5 is three more.
**The point of this rule is that there should never be another one.**

---

**This repository is the Phase 2 gate.** AD-01 chose one repository per deployable — forty-six
repositories in 03 §1, **78 in `tools/registry.ts` today, 67 of them managed** — and stated the cost of that choice
plainly: a `@cloudsforge/contracts-*` minor bump
would otherwise be ~48 file edits, 24 manual publishes, and no CI anywhere able to test the
composed system. AD-02 and AD-03 are the machinery that pays that cost, and
[`docs/ecosystem/03-repository-responsibilities.md`](https://github.com/cloudsforge-online/micro-docs/blob/main/ecosystem/03-repository-responsibilities.md)
§5 is explicit about what happens if it is not working:

> **If this machinery is not working, no repository may be split.**

> **AD-01's "one repository per deployable" stopped being literally true in the merge waves, and
> the registry is where that is stated.** `deployableRepos()` returns **52**, `releasableRepos()`
> **30**, and the **22** rows between them are `absorbed(…)`: repositories whose code now runs as a
> module of another process — every one of them inside `agora`, which is 23 modules.
>
> An absorbed row is deliberately still deployable and deliberately not releasable. It keeps its
> Kubernetes `Service` resolving as an `ExternalName` alias to the absorber, so callers that address
> it by service name are unaffected; and `cfctl bump` skips it, `publish-image.yml` refuses it, and
> `cfctl release` writes no digest for it, so nothing builds an image nothing runs. That asymmetry
> IS the mechanism — it is what let twenty-two services merge without a coordinated edit across
> every caller.
>
> The estate is **17 application Deployments** as a result, from 72 running pods. What merged, what
> was refused and why is
> [`micro-deploy/docs/service-merge-plan.md`](https://github.com/cloudsforge-online/micro-deploy/blob/main/docs/service-merge-plan.md);
> **M5f** is the final audit.

## What is in here

| | |
| --- | --- |
| [`.github/workflows/`](.github/workflows/) | The five reusable workflows every repository calls. See [`workflows/README.md`](workflows/README.md) for why they live there and not in `workflows/`. |
| [`tools/compat.ts`](tools/compat.ts) | The contract compatibility checker. Fails on a removed field, a narrowed type or a renamed key; additive change passes. |
| [`tools/cfctl.ts`](tools/cfctl.ts) | `list`, `clone`, `pull`, `doctor`, `cross`, `release`, `new`. Replaces `scripts/clone-all.sh` and `scripts/pull-all.sh`. |
| [`tools/registry.ts`](tools/registry.ts) | The repository list. One copy. Two copies is one copy that is wrong. |
| [`releases/`](releases/) | Release manifests, and why a manifest replaces `CLOUDSFORGE_TAG`. **Read its naming section before cutting one:** a release is `<year>.<month>.<sequence>`, `2026.08.21` is the twenty-first release of August 2026 rather than 21 August, and a release name must never be sorted. |
| [`test/release-order.test.ts`](test/release-order.test.ts) | The guard that no release puts a service on an older image than the release before it. It exists because [#384](https://github.com/cloudsforge-online/micro-org/issues/384) deployed a manifest assembled by copy-and-edit whose 45 unedited rows were six days stale — valid, verifiable, and wrong. |
| [`templates/`](templates/) | What `cfctl new service` and `cfctl new web` instantiate. |
| [`renovate.json`](renovate.json) | The org-level preset. Grouped per contract package, auto-merged on green CI for `@cloudsforge/*`. |

```bash
pnpm install && pnpm check
node --import tsx tools/cfctl.ts list
node --import tsx tools/cfctl.ts doctor
```

**Before you merge something other repositories read**, ask who breaks:

```bash
node --import tsx tools/cfctl.ts cross --repo wallet
```

Several tests in this estate open a sibling checkout and assert the two repositories agree, and
nothing runs them when the sibling moves — so a correct upstream merge turns a downstream `main`
red without anyone touching it, and it is discovered by whatever unrelated PR opens next (micro-org#304).
`cfctl cross` finds those checks by reading what the files actually do, and runs them. `--list`
shows the edges without running anything.

## The three measured mitigations

Seventy-eight repositories — 67 of them managed — is a lot for one team. Three things make it survivable, and each is a
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
| 6 | Services storing `user_id` subscribe to `identity.user.deleted` | `deploy/scripts/check-erasure-register.py`, then `deploy/scripts/erasure-drill.sh`. See below |
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

**Rule 6 said "Beacon conformance (AD-04), not CI", and in practice that meant nobody checked
it.** The rule held for two services out of sixteen. Fourteen more stored a reference to a person
with no subscriber at all, and six had handler code no event could ever reach — so a deletion
request succeeded in `identity`, reported success to the user, and left their data across the
estate, with every individual component reporting itself healthy the whole time. A rule that lives
in a row of this table is enforced by whoever last read the table.

It is now two mechanisms reading one file, `deploy/erasure/register.psv`:

- **`deploy/scripts/check-erasure-register.py`** scans every service's schema for columns naming a
  person and fails on any service that is neither in the register nor exempt for a reason about
  the *data*. "Not done yet" is not a reason it accepts; that is what a tracker issue is for.
- **`deploy/scripts/erasure-drill.sh`** creates an account, gives it something to lose in every
  registered service, deletes it through the real route, and asserts per service that no column in
  that database still names them. The same file seeds the subscriptions at deploy, so a registered
  service cannot ship unsubscribed and a subscription that erases nothing fails rather than passing.

The drill exists because the alternative does not work. Every handler it caught being wrong had
passing unit tests: three services rejected every real deletion because their uuid pattern allowed
versions 1–5 while `identity` mints v7 — and their fixtures were v4, so both halves of each test
agreed with each other and neither agreed with the producer. That is not a gap a better unit test
closes. It is what "test the seam, not the mock" means when it is expensive.

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
