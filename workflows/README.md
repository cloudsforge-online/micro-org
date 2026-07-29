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

A repository calls them and holds no jobs of its own:

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
