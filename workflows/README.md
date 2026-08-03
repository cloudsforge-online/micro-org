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

## `estate-ci.yml` is the odd one out, deliberately

The five workflows above answer "is **this** repository right", and a repository calls them. The
sixth answers "do these repositories agree", and **no repository calls it** — it runs on a schedule
and on demand, in micro-org, and blocks nothing outside micro-org.

That is a decision, not an oversight, and the whole argument is in the file's own header. The short
version: an estate-wide check that can turn a service's pull request red for a defect its author did
not cause and cannot fix is a check that gets switched off within a week, which is the failure mode
`micro-beacon` already writes down about its own release gate (`beacon/src/estate.ts:15`). So the
red lands in micro-org, and — because a nightly red that belongs to nobody is wallpaper — it also
opens an issue labelled `estate-invariant`, and closes it again when the sweep is green.

Its first check is the ledger account-type sweep in `micro-conformance`: two services naming one
`(subject, asset, purpose)` account key with two different `type`s means whichever posts second in
production has **every** entry refused, and no per-service suite can see it because each tests
against its own fake ledger. The scope-registry totality check and the topic-registry reconciliation
belong in the same job for the same reason, and are a step each rather than a new mechanism.

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

`cfctl doctor` reports any repository that defines its own `runs-on:` as a bespoke CI file. The
target in `docs/ecosystem/03` §5 is zero of them. A repository that needs something these
workflows cannot express needs an **input added here**, not a copy.
