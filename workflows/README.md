# workflows/

The reusable workflows live in [`../.github/workflows/`](../.github/workflows/), not here.

That is not a preference. GitHub resolves `uses: <owner>/<repo>/.github/workflows/<file>@<ref>`
and only that path; a reusable workflow anywhere else in the repository cannot be called. Keeping
a second copy in this directory to match the brief's layout would create exactly the duplication
this repository exists to remove — two files, one of them authoritative, drifting from each other
the first time somebody edits the wrong one.

| Workflow | What it replaces |
| --- | --- |
| [`service-ci.yml`](../.github/workflows/service-ci.yml) | Eleven near-identical CI files, already drifted, plus the rules in `docs/ecosystem/03` §2 that repository walls used to enforce for free |
| [`web-ci.yml`](../.github/workflows/web-ci.yml) | The same for frontends, and the guard on runtime host resolution |
| [`publish.yml`](../.github/workflows/publish.yml) | The dead `NPM_TOKEN`, and with it every manual release ritual in the estate |
| [`contract-compat.yml`](../.github/workflows/contract-compat.yml) | Reviewing a contract diff by eye across repositories that cannot see each other |
| [`secret-hygiene.yml`](../.github/workflows/secret-hygiene.yml) | Checks that were in some of the eleven copies and not others |
| [`estate-ci.yml`](../.github/workflows/estate-ci.yml) | Nothing — it is the first job in the estate that has **every** repository checked out at once, and so the first that can see an invariant no single repository holds both halves of |
| [`cross-repo.yml`](../.github/workflows/cross-repo.yml) | The release cut, which was acting as the estate's cross-repository integration test — it caught two of the three breakages of 2026-08-09, attached to a version-string bump, hours late |

## `estate-ci.yml` and `cross-repo.yml` are the odd ones out, deliberately

The five workflows above answer "is **this** repository right", and a repository calls them. The
last two answer "do these repositories agree", and **no repository calls either** — they run on a
schedule, on demand, and (for `cross-repo.yml`) on a merge in any repository, in micro-org, and
block nothing outside micro-org.

That is a decision, not an oversight, and the whole argument is in the file's own header. The short
version: an estate-wide check that can turn a service's pull request red for a defect its author did
not cause and cannot fix is a check that gets switched off within a week, which is the failure mode
`micro-beacon` already writes down about its own release gate (`beacon/src/estate.ts`). So the
red lands in micro-org, and — because a nightly red that belongs to nobody is wallpaper — it also
opens an issue labelled `estate-invariant`, and closes it again when the sweep is green.

Its first check is the ledger account-type sweep in `micro-conformance`: two services naming one
`(subject, asset, purpose)` account key with two different `type`s means whichever posts second in
production has **every** entry refused, and no per-service suite can see it because each tests
against its own fake ledger. The scope-registry totality check and the topic-registry reconciliation
belong in the same job for the same reason, and are a step each rather than a new mechanism.

`cross-repo.yml` is the same shape and answers a different question: which repositories READ the one
that just merged, and do they still agree with it. The edges are derived from the estate on disk
every run rather than listed in a matrix — measured 2026-08-09, four files carry an explicit edge
table and thirty read a sibling, so a matrix built from the four would cover a twentieth of the
surface while looking complete. It runs when an upstream merges because `service-ci.yml` and
`web-ci.yml` send it one `repository_dispatch` from every caller's main build, which is why the
downstream side of micro-org#304 cost no per-repository file: a reusable workflow declares
`on: workflow_call` and nothing else, so a *receiver* in `service-ci.yml` was never possible — the
trigger belongs to the caller's own file, and there are fifty-five of those.

A repository calls the other five and holds no jobs of its own:

```yaml
jobs:
  ci:
    uses: cloudsforge-online/micro-org/.github/workflows/service-ci.yml@main
    with:
      service: ledger
      database-env-var: LEDGER_DATABASE_URL
      port: 4102
```

`database-env-var` is a **list**, whitespace- or comma-separated, because one deployable can be two
former services and a merged one owns the databases of both — `micro-lantern` declares
`LANTERN_DATABASE_URL ANALYTICS_DATABASE_URL` after the M1 merge. Every name gets its own CI
database and its own exported pair, and every name is treated as this service's OWN by the skip
scan: a suite gated on any of them skipping fails the build, while a suite wanting a database this
job does not provide is reported as a stand-down and stays green. Declaring nothing still means
`<SERVICE>_DATABASE_URL`, and an entry that does not end in `_DATABASE_URL` is refused.

`cfctl doctor` reports any repository that defines its own `runs-on:` as a bespoke CI file. The
target in `docs/ecosystem/03` §5 is zero of them. A repository that needs something these
workflows cannot express needs an **input added here**, not a copy.
