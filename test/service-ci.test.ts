/**
 * The reusable service workflow, checked against the estate it is reusable for.
 *
 * Three defects were found in this file at once, and all three shared a cause: it had never been
 * run. Every service repository declared a call to it, no repository had yet pushed, and so a
 * workflow that could not have worked for any of them sat looking authoritative.
 *
 *   1. No Postgres service container existed at all, in an estate whose fifteen services all test
 *      against a real database on purpose — deferred constraints, `FOR UPDATE SKIP LOCKED` leases
 *      and advisory locks are the assertions most worth having, and not one of them survives a
 *      fake.
 *   2. The suites SKIP rather than fail when their DSN is absent, so the consequence was not a red
 *      pipeline. It was a green one that had executed none of those assertions.
 *   3. Rule 1 compared against the declared variable by exact string, so `<SERVICE>_TEST_DATABASE_URL`
 *      — which every `testsupport.ts` reads by construction — counted as another service's
 *      database. The rule rejected all fifteen services it exists to protect.
 *
 * These tests read the YAML as text rather than parsing it, because the thing being asserted is
 * the shell and the expressions, and a parser would give back the same strings anyway.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../.github/workflows/service-ci.yml', import.meta.url)),
  'utf8',
)

test('the test job gets a Postgres service container', () => {
  assert.match(WORKFLOW, /services:\s*\n\s*postgres:/)
  assert.match(WORKFLOW, /image: \$\{\{ inputs\.postgres && format\('postgres:\{0\}'/)
})

test('the CI database is named so the suites will accept it', () => {
  // Every testsupport.ts refuses a DSN whose database name does not match /test/i, as a guard
  // against a truncating suite pointed at something real. A database called `ci` is refused, and
  // the refusal is a silent skip.
  const dbName = /POSTGRES_DB: (\S+)/.exec(WORKFLOW)?.[1]
  assert.ok(dbName, 'the service container must name its database')
  assert.match(dbName, /test/i, 'a name without "test" is rejected by every suite in the estate')

  const dsn = /CI_DSN: (\S+)/.exec(WORKFLOW)?.[1]
  assert.ok(dsn, 'the test step must define the DSN it exports')
  assert.match(dsn, /test/i)
  assert.ok(dsn.endsWith(dbName), `the DSN (${dsn}) must point at the container's database`)
})

/**
 * The Test step's export block, lifted out of the workflow and RUN — not a second copy of it, and
 * for the same reason as the skip scan below.
 *
 * This used to be three regexes matching `export "$want=$CI_DSN"` and `export "$test_var=$CI_DSN"`.
 * micro-org#519 turned the block into a LOOP over a declared list, so those names no longer exist
 * and the assertions went red — while saying nothing at all about whether the property they are
 * about still held. A text pin cannot: what matters is not which shell variables the loop uses, it
 * is that each declared name comes out of it with BOTH halves pointing at the SAME database.
 */
const EXPORT_BLOCK = (() => {
  const fromMarker = "          test_vars=''\n"
  const toMarker = '            export DATABASE_URL="$CI_DSN"\n          fi'
  const from = WORKFLOW.indexOf(fromMarker)
  const to = WORKFLOW.indexOf(toMarker)
  assert.ok(from > 0 && to > from, "the Test step's export block has moved or been renamed in service-ci.yml")
  // Dedented to column zero. The block is a YAML scalar, so it carries the file's indentation.
  return WORKFLOW.slice(from, to + toMarker.length)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n')
})()

/**
 * A `psql` that does nothing, first on the PATH of every lifted block below.
 *
 * The block creates one database per declared name. Whether that CREATE succeeds decides nothing
 * these tests assert — the workflow swallows its outcome — but running the real client would let a
 * developer who happens to have a local Postgres answering to ci/ci acquire a handful of
 * `ci_*_test` databases for running the suite. A test may read the estate; it may not change it.
 */
const NO_PSQL = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'no-psql-'))
  writeFileSync(join(dir, 'psql'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  return dir
})()

/** Run the real export block and report what it left in the environment. */
function exported(
  service: string,
  declared: string,
  needsDb = true,
): { testVars: string[]; env: Record<string, string> } {
  const res = spawnSync(
    'bash',
    [
      '-c',
      `set -uo pipefail\n${EXPORT_BLOCK}\n` +
        `printf 'VARS<%s>\\n' "$test_vars"\n` +
        `env | grep -E '_DATABASE_URL=' | sort || true`,
    ],
    {
      encoding: 'utf8',
      // A DELIBERATELY EMPTY ENVIRONMENT except for what the step declares. Inheriting the
      // developer's would let a stray FOO_DATABASE_URL in their shell be read back as something
      // this block exported, which is the shape of a test that passes without exercising anything.
      env: {
        PATH: `${NO_PSQL}:${process.env['PATH'] ?? ''}`,
        SERVICE: service,
        DECLARED: declared,
        NEEDS_DB: String(needsDb),
        CI_DSN: 'postgres://ci:ci@127.0.0.1:5432/ci_test',
      },
    },
  )
  assert.equal(res.status, 0, `the export block itself failed to run: ${res.stderr}`)
  const vars = /VARS<([^>]*)>/.exec(res.stdout)
  assert.ok(vars, `the export block produced no verdict: ${res.stdout} ${res.stderr}`)
  const env: Record<string, string> = {}
  for (const line of res.stdout.split('\n')) {
    const kv = /^([A-Z][A-Z0-9_]*_DATABASE_URL)=(.*)$/.exec(line)
    if (kv?.[1]) env[kv[1]] = kv[2] ?? ''
  }
  return { testVars: (vars[1] ?? '').split(' ').filter((name) => name !== ''), env }
}

test('both the runtime and the test variable are exported, because they are read by different code', () => {
  // Migration helpers read <SERVICE>_DATABASE_URL; testsupport.ts reads <SERVICE>_TEST_DATABASE_URL.
  // Exporting only one leaves half the suite unable to open a connection — and exporting them at
  // DIFFERENT DSNs is that same defect wearing a disguise, because the half that migrates and the
  // half that queries would then be looking at two databases.
  const one = exported('ledger', '')
  assert.deepEqual(one.testVars, ['LEDGER_TEST_DATABASE_URL'], 'the suite variable is the declared one with _TEST_ in it')
  assert.ok(one.env['LEDGER_DATABASE_URL'], 'the migration helpers\' variable must be exported')
  assert.equal(
    one.env['LEDGER_DATABASE_URL'],
    one.env['LEDGER_TEST_DATABASE_URL'],
    'both halves must name ONE database, or the migration and the queries diverge',
  )
  assert.match(
    one.env['LEDGER_TEST_DATABASE_URL'] ?? '',
    /test/i,
    'every testsupport.ts refuses a DSN whose database name does not match /test/i, and the refusal is a silent skip',
  )

  // A hyphenated service still derives the underscored name when it declares nothing.
  assert.deepEqual(exported('hub-api', '').testVars, ['HUB_API_TEST_DATABASE_URL'])

  // #519: a merged deployable owns the databases of the services it absorbed. Every declared name
  // gets both halves, and its OWN database — two names sharing one would have each suite
  // truncating the other's identically-named tables, which presents as a flake.
  const merged = exported('lantern', 'LANTERN_DATABASE_URL, ANALYTICS_DATABASE_URL')
  assert.deepEqual(merged.testVars, ['LANTERN_TEST_DATABASE_URL', 'ANALYTICS_TEST_DATABASE_URL'])
  for (const prefix of ['LANTERN', 'ANALYTICS']) {
    assert.equal(
      merged.env[`${prefix}_DATABASE_URL`],
      merged.env[`${prefix}_TEST_DATABASE_URL`],
      `${prefix}'s two halves must name one database`,
    )
    assert.match(merged.env[`${prefix}_DATABASE_URL`] ?? '', /test/i)
  }
  assert.notEqual(
    merged.env['LANTERN_DATABASE_URL'],
    merged.env['ANALYTICS_DATABASE_URL'],
    'one database PER declared name: `lantern.events` and `analytics.events` both exist',
  )

  // A service with no database exports nothing, and hands the skip scan an empty list rather than
  // an unset variable — which under this step's `set -u` would abort the whole step.
  assert.deepEqual(exported('ledger', '', false).testVars, [])
  assert.deepEqual(exported('ledger', '', false).env, {})
})

/**
 * The skip scan's own shell, lifted out of the workflow and run — not a second copy of it.
 *
 * It used to be asserted as a literal grep, which is the weakest thing a test can do to a rule:
 * it pinned the pattern and said nothing about what the pattern decides. The pattern was wrong,
 * and the test could not have noticed, because the test WAS the pattern.
 */
const SKIP_SCAN = (() => {
  const from = WORKFLOW.indexOf('            reported=$(grep')
  const marker = `            done < <(printf '%s\\n' "$reported")`
  const to = WORKFLOW.indexOf(marker)
  assert.ok(from > 0 && to > from, 'the skip scan has moved or been renamed in service-ci.yml')
  // Dedented to column zero. The block is a YAML scalar, so it carries the file's indentation.
  return WORKFLOW.slice(from, to + marker.length)
    .split('\n')
    .map((line) => line.replace(/^ {12}/, ''))
    .join('\n')
})()

/**
 * Run the real classification over one captured run, and say what it decided.
 *
 * `blind` is the fatal case — a database this job DID provide was absent and nothing ran.
 * `standdown` is the cross-service case — a tier needing a database this job does not provide.
 *
 * `exports` is what the export block above put in `test_vars`: the list of every variable this job
 * exported, which is what "own" means. It is a LIST since micro-org#519, and that plurality is the
 * whole asymmetry — a merged service declaring two databases had every suite gated on the SECOND
 * one filed as a stand-down and went green having run none of them.
 */
function classify(exports: readonly string[], output: string): { blind: string; standdown: string } {
  const dir = mkdtempSync(join(tmpdir(), 'skipscan-'))
  const file = join(dir, 'test-output.txt')
  writeFileSync(file, output)
  // The scan reads the path the workflow tees to. Substituting it is the only edit made to the
  // lifted shell, and it is asserted rather than assumed: grading the wrong file would silently
  // classify an empty run as clean and pass every case below.
  const script = SKIP_SCAN.replaceAll('/tmp/test-output.txt', file)
  assert.ok(script.includes(file), 'the lifted scan no longer reads /tmp/test-output.txt')
  // The name this harness fills in has to be the name the scan reads. `set -u` already turns a
  // mismatch into a non-zero exit rather than a wrong verdict, but it says so as `unbound
  // variable`, which reads as a broken test rather than as the workflow having been renamed.
  assert.match(
    script,
    /for tv in \$test_vars; do/,
    'the scan no longer judges a skip against the LIST of exported variables',
  )
  const res = spawnSync(
    'bash',
    [
      '-c',
      `set -uo pipefail\ntest_vars="${exports.join(' ')}"\n${script}\n` +
        `printf 'BLIND<%s>STANDDOWN<%s>' "$blind" "$standdown"`,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(res.status, 0, `the scan itself failed to run: ${res.stderr}`)
  const parsed = /BLIND<([\s\S]*)>STANDDOWN<([\s\S]*)>/.exec(res.stdout)
  assert.ok(parsed, `the scan produced no verdict: ${res.stdout} ${res.stderr}`)
  return { blind: parsed[1] ?? '', standdown: parsed[2] ?? '' }
}

/** micro-lantern after the M1 merge: one deployable, two former services, two databases. */
const MERGED = ['LANTERN_TEST_DATABASE_URL', 'ANALYTICS_TEST_DATABASE_URL']

test('a skipped database suite fails the build rather than passing quietly', () => {
  // This is the whole point. A green run that skipped its database tests is worse than a red one,
  // because it is believed.
  assert.match(WORKFLOW, /database-backed tests SKIPPED/)

  // The disaster, in both the phrasings the estate's suites actually produce.
  const named = classify(['LEDGER_TEST_DATABASE_URL'], '↷ balances # set LEDGER_TEST_DATABASE_URL (name must contain "test")\n')
  assert.match(named.blind, /LEDGER_TEST_DATABASE_URL/, "the service's own DSN missing must be fatal")
  assert.equal(named.standdown, '')

  const unnamed = classify(['CUSTODY_TEST_DATABASE_URL'], 'database tests are disabled\n')
  assert.match(unnamed.blind, /disabled/, 'a skip naming no variable at all must be fatal')

  // A clean run is neither.
  const clean = classify(['LEDGER_TEST_DATABASE_URL'], 'ℹ tests 195\nℹ pass 195\n')
  assert.equal(clean.blind, '')
  assert.equal(clean.standdown, '')

  // ── THE CASE micro-org#519 EXISTS FOR ────────────────────────────────────────────────────────
  //
  // A merged deployable declares two databases and this job provides both. The scan used to judge
  // a skip against the ONE variable it exported, so a suite gated on the SECOND one skipping was
  // filed as "a cross-service tier stood down" — a notice, and green. The build would pass having
  // run none of the absorbed service's suites: the exact false green this block was written to end,
  // reintroduced by the merge it has to survive.
  //
  // Every declared name must be fatal, not just the first, so both positions are exercised. A test
  // that only checked the first would pass on the defective workflow.
  for (const own of MERGED) {
    const missed = classify(MERGED, `↷ rollups # set ${own} (name must contain "test")\n`)
    assert.match(missed.blind, new RegExp(own), `${own} is a database this job PROVIDES; skipping it must be fatal`)
    assert.equal(missed.standdown, '', `${own} is not a foreign tier standing down`)
  }

  // Both own names in one sentence is the same disaster, not an excuse.
  const bothOwn = classify(
    MERGED,
    '↷ events # set LANTERN_TEST_DATABASE_URL and ANALYTICS_TEST_DATABASE_URL (both names must contain "test")\n',
  )
  assert.match(bothOwn.blind, /LANTERN_TEST_DATABASE_URL/)
  assert.equal(bothOwn.standdown, '')
})

test('a cross-service tier standing down is reported, not failed and not swallowed', () => {
  // `[A-Z_]*TEST_DATABASE_URL` matched ANY service's variable, so micro-ledger went red on a run
  // where 191 of 195 tests passed, none failed, and every case needing ledger's own database ran
  // against the real Postgres this workflow provides. What stood down was four cases wanting a
  // micro-indexer database as well — a second database no single-service job can offer.
  const ledger = classify(
    ['LEDGER_TEST_DATABASE_URL'],
    '↷ backing # set INDEXER_TEST_DATABASE_URL (name must contain "test") with a micro-indexer checkout beside this one\n',
  )
  assert.equal(ledger.blind, '', 'a tier wanting another service\'s database is not this service failing')
  assert.match(ledger.standdown, /INDEXER_TEST_DATABASE_URL/, 'and it must still be visible in the log')

  // micro-indexer's message names BOTH variables in one sentence. That is a stand-down too: this
  // job exports the own half itself, so the own half cannot be why anything skipped.
  const indexer = classify(
    ['INDEXER_TEST_DATABASE_URL'],
    '↷ chain backing # set INDEXER_TEST_DATABASE_URL and LEDGER_TEST_DATABASE_URL (both names must contain "test")\n',
  )
  assert.equal(indexer.blind, '')
  assert.match(indexer.standdown, /LEDGER_TEST_DATABASE_URL/)

  // Both at once must still be fatal. This is the line between precision and weakening: the
  // stand-down must not become an excuse that swallows a real blind run happening beside it.
  const both = classify(
    ['LEDGER_TEST_DATABASE_URL'],
    '↷ a # set INDEXER_TEST_DATABASE_URL (name must contain "test")\n↷ b # set LEDGER_TEST_DATABASE_URL (name must contain "test")\n',
  )
  assert.match(both.blind, /LEDGER_TEST_DATABASE_URL/, 'a real skip beside a stand-down is still a red build')
  assert.match(both.standdown, /INDEXER_TEST_DATABASE_URL/)

  // ── THE OTHER HALF OF #519's ASYMMETRY ───────────────────────────────────────────────────────
  //
  // Widening "own" to a list must not widen it to everything. A merged service still cannot supply
  // a THIRD service's database, so that tier still stands down — a notice, and green.
  const foreign = classify(
    MERGED,
    '↷ backing # set INDEXER_TEST_DATABASE_URL (name must contain "test") with a micro-indexer checkout beside this one\n',
  )
  assert.equal(foreign.blind, '', 'a merged service still does not own micro-indexer\'s database')
  assert.match(foreign.standdown, /INDEXER_TEST_DATABASE_URL/)

  // And the two verdicts still separate cleanly when both happen in one run: the absorbed
  // service's own skip is fatal, the foreign tier's is a notice, and neither hides the other.
  const mixed = classify(
    MERGED,
    '↷ a # set INDEXER_TEST_DATABASE_URL (name must contain "test")\n↷ b # set ANALYTICS_TEST_DATABASE_URL (name must contain "test")\n',
  )
  assert.match(mixed.blind, /ANALYTICS_TEST_DATABASE_URL/, 'the absorbed service skipping is still a red build')
  assert.doesNotMatch(mixed.blind, /INDEXER_TEST_DATABASE_URL/)
  assert.match(mixed.standdown, /INDEXER_TEST_DATABASE_URL/)
  assert.doesNotMatch(mixed.standdown, /ANALYTICS_TEST_DATABASE_URL/)
})

/* ------------------------------ the sibling runtime ------------------------------- */

/** The build job, sliced out so its checkout layout can be asserted. */
const BUILD_JOB = WORKFLOW.slice(WORKFLOW.indexOf('\n  build:'), WORKFLOW.indexOf('\n  rules:'))

test('the build job checks out the runtime and contracts as siblings, because link: needs them', () => {
  // @cloudsforge/* is resolved by link:../runtime/packages/*, not a registry — the npm scope
  // @cloudsforge does not match the org cloudsforge-online, so GitHub Packages cannot host it, and
  // a link: with no sibling on disk installs as a dangling symlink that resolves to nothing. That
  // is why Install passed and Typecheck could not find one @cloudsforge module. The fix is the
  // sibling layout the bespoke workflows used.
  assert.match(BUILD_JOB, /repository: cloudsforge-online\/micro-runtime/)
  assert.match(BUILD_JOB, /repository: cloudsforge-online\/micro-contracts/)
  assert.match(BUILD_JOB, /with: \{ path: service \}/)
})

test('the siblings are installed before the service, and the service steps run in its subdir', () => {
  // link: resolves to a sibling's OWN node_modules, so the sibling must be installed first.
  assert.match(BUILD_JOB, /pnpm --dir runtime install --frozen-lockfile/)
  assert.match(BUILD_JOB, /working-directory: service/)
})

test('the private sibling repos are reached with a token that falls back to the job token', () => {
  assert.match(WORKFLOW, /secrets:\s*\n\s*estate_token:/)
  assert.match(WORKFLOW, /token: \$\{\{ secrets\.estate_token \|\| github\.token \}\}/)
})

/* ------------------------------ the image smoke test ------------------------------- */

/** The image job, sliced out so its shell can be asserted the same way the test job's is. */
const IMAGE_JOB = WORKFLOW.slice(WORKFLOW.indexOf('\n  image:'))

test('the image smoke test gives a DB-backed service the database it refuses to start without', () => {
  // The ninth defect, and the same cause as the eight before it: the job had never run. It started
  // the image against a DSN pointing at 127.0.0.1:5432 under bridge networking — where nothing
  // listens, because that address is the container itself and no Postgres was started for the job —
  // and waited for a /livez that a service which asserts its schema at boot could never serve. The
  // fix is the same Postgres the test job gets, reached over host networking.
  assert.match(IMAGE_JOB, /services:\s*\n\s*postgres:/, 'the image job must run a Postgres container')
  assert.match(IMAGE_JOB, /POSTGRES_DB: ci_test/, 'the database name must satisfy the /test/i guard')
  assert.match(IMAGE_JOB, /--network host/, 'the container must reach the runner\'s Postgres service')
})

test('the image is migrated by its own one-shot migrator before /livez is polled', () => {
  // A service asserts its schema and refuses to serve below it, so the smoke test must migrate first
  // — and it does so IN the image, which ships no package manager, hence a bare interpreter line.
  assert.match(IMAGE_JOB, /docker run --rm --network host[^\n]*\$MIGRATE/, 'the migrator must run in the image')
  assert.match(WORKFLOW, /migrate-command:/)
  assert.match(WORKFLOW, /default: node --import tsx src\/migrator\.ts/)
})

test('the image build gets the runtime and contracts as named build contexts', () => {
  // The Dockerfiles resolve their link: deps with COPY --from=runtimepkgs; without the context the
  // build fails at the first COPY — the image half of the link:-has-no-sibling defect.
  assert.match(IMAGE_JOB, /build-contexts:/)
  assert.match(IMAGE_JOB, /runtimepkgs=\$\{\{ github\.workspace \}\}\/runtime-ctx/)
  assert.match(IMAGE_JOB, /repository: cloudsforge-online\/micro-runtime/)
})

test('the service\'s declared configuration reaches the smoke container', () => {
  // env.ts validates configuration at import and exits on a missing variable, so a database alone
  // is not enough to boot; the caller passes the rest through smoke-env, one -e per line.
  assert.match(WORKFLOW, /smoke-env:/)
  assert.match(IMAGE_JOB, /while IFS= read -r line; do/)
  assert.match(IMAGE_JOB, /env_args\+=\(-e "\$line"\)/)
})

test('the poll stops early once the container has exited rather than waiting the full window', () => {
  // A container that crashed on its config will never answer; the old loop slept the whole thirty
  // seconds regardless, turning a fast failure into a slow one with no extra signal.
  //
  // ASKED OF DOCKER RATHER THAN GREPPED OUT OF A PIPE. This asserted the pipe version until it went
  // red, because service-ci.yml replaced it and this line was not moved with it. The pipe is a
  // SIGPIPE race under `set -uo pipefail`: `grep -q` exits the instant it matches, the writer gets
  // EPIPE, pipefail makes the pipeline non-zero, the loop breaks, and the step reports "the image
  // never answered /livez" about a container that was answering. It is in the reusable workflow
  // every service calls, so it reads as flaky infrastructure rather than one fixable line.
  //
  // The old shape is asserted ABSENT as well as the new one present: a test that only looks for the
  // replacement would pass on a file that reintroduced the race somewhere else in the same job.
  assert.match(IMAGE_JOB, /\[ -n "\$\(docker ps --quiet --filter "name=\^\$\{name\}\$"\)" \] \|\| break/)
  // Comments out first. The workflow QUOTES the old pipe in the paragraph explaining why it is
  // gone, and a guard that fires on the prose describing the fix is the failure mode six other
  // guards in this estate have already had.
  const code = IMAGE_JOB.split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
  assert.doesNotMatch(code, /docker ps[^\n]*\|[^|\n]*grep/)
})

test('a service with no database keeps the bridge-network path and needs no migrate', () => {
  // postgres:false must not drag in host networking or a migrate step it has no use for.
  assert.match(IMAGE_JOB, /if \[ "\$NEEDS_DB" = "true" \]; then/)
  assert.match(IMAGE_JOB, /net=\(-p "127\.0\.0\.1:\$\{PORT\}:\$\{PORT\}"\)/)
})

/* ------------------------------ rule 1 ------------------------------- */

/**
 * Rule 1's comparison, lifted out of the workflow so it can be exercised directly. Kept in step
 * with the shell by the test below, which fails if the workflow's expression drifts from this one.
 *
 * An ALTERNATION over every prefix the service declares, since micro-org#519: one deployable can be
 * two former services, and a merged one owns the databases of both. What the rule FORBIDS has not
 * moved — the namespace it allows has.
 */
const ALLOWED = (prefixes: readonly string[]) =>
  new RegExp(`^(${prefixes.join('|')})_(TEST_)?(DATABASE_URL|DB_URL|POSTGRES_URL)$`)

/** What a service name derives to when it declares nothing: `hub-api` → `HUB_API`. */
const prefixOf = (service: string) => service.toUpperCase().replace(/-/g, '_')

const rejected = (service: string, read: readonly string[]) =>
  read.filter((v) => !ALLOWED([prefixOf(service)]).test(v))

/** The same judgement for a service that declares its databases explicitly. */
const rejectedDeclaring = (prefixes: readonly string[], read: readonly string[]) =>
  read.filter((v) => !ALLOWED(prefixes).test(v))

test('a service reading its own database and its own test database passes', () => {
  assert.deepEqual(rejected('ledger', ['LEDGER_DATABASE_URL', 'LEDGER_TEST_DATABASE_URL']), [])
})

test('every built service in the estate passes rule 1', () => {
  // The regression in full: before the prefix fix, each of these was rejected for reading its own
  // test database, so the rule would have failed the entire estate.
  for (const s of [
    'identity', 'ledger', 'custody', 'wallet', 'settlement', 'indexer', 'pricing', 'billing',
    'policy', 'activity', 'notify', 'mint', 'worlds', 'studio', 'trade', 'market',
  ]) {
    const own = s.toUpperCase()
    assert.deepEqual(
      rejected(s, [`${own}_DATABASE_URL`, `${own}_TEST_DATABASE_URL`]),
      [],
      `${s} reads only its own database and must pass`,
    )
  }
})

test('a hyphenated service name resolves to the underscored prefix', () => {
  assert.deepEqual(rejected('hub-api', ['HUB_API_DATABASE_URL', 'HUB_API_TEST_DATABASE_URL']), [])
})

test('reading ANOTHER service\'s database is still rejected — the rule keeps its teeth', () => {
  assert.deepEqual(rejected('wallet', ['WALLET_DATABASE_URL', 'LEDGER_DATABASE_URL']), [
    'LEDGER_DATABASE_URL',
  ])
  // Including another service's *test* database, which is not a loophole the prefix fix opens.
  assert.deepEqual(rejected('wallet', ['LEDGER_TEST_DATABASE_URL']), ['LEDGER_TEST_DATABASE_URL'])
})

test('a merged service reads every database it declares, and still no others', () => {
  // micro-org#519: micro-lantern declares LANTERN_DATABASE_URL and ANALYTICS_DATABASE_URL after the
  // M1 merge, and both are its own. Before the alternation, the second was another service's
  // database as far as this rule could tell.
  assert.deepEqual(
    rejectedDeclaring(
      ['LANTERN', 'ANALYTICS'],
      [
        'LANTERN_DATABASE_URL',
        'LANTERN_TEST_DATABASE_URL',
        'ANALYTICS_DATABASE_URL',
        'ANALYTICS_TEST_DATABASE_URL',
      ],
    ),
    [],
  )
  // The teeth, which are the half worth guarding: widening the namespace to a list must not widen
  // it to a PREFIX SEARCH. A third service's database is still rejected, and so is a name that
  // merely begins with a declared one — `ANALYTICS_ARCHIVE_DATABASE_URL` is a different database.
  assert.deepEqual(
    rejectedDeclaring(['LANTERN', 'ANALYTICS'], ['CUSTODY_DATABASE_URL', 'ANALYTICS_ARCHIVE_DATABASE_URL']),
    ['CUSTODY_DATABASE_URL', 'ANALYTICS_ARCHIVE_DATABASE_URL'],
  )
})

/**
 * The `dbvar` step's shell, lifted so the alternation Rule 1 is configured with is the one the
 * workflow really computes rather than one this file imagines.
 */
function stepShell(id: string): string {
  const at = WORKFLOW.indexOf(`        id: ${id}\n`)
  assert.ok(at > 0, `no step with \`id: ${id}\` in service-ci.yml`)
  const opener = '        run: |\n'
  const runAt = WORKFLOW.indexOf(opener, at)
  assert.ok(runAt > at, `the \`${id}\` step no longer carries a run: block`)
  const body: string[] = []
  for (const line of WORKFLOW.slice(runAt + opener.length).split('\n')) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) break
    body.push(line.slice(10))
  }
  return body.join('\n')
}

/** Run the real `dbvar` step and read back what it wrote to GITHUB_OUTPUT. */
function runDbvar(
  service: string,
  declared: string,
): { status: number | null; stdout: string; outputs: Record<string, string> } {
  const file = join(mkdtempSync(join(tmpdir(), 'dbvar-')), 'github-output')
  writeFileSync(file, '')
  const res = spawnSync('bash', ['-c', stepShell('dbvar')], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      SERVICE: service,
      DECLARED: declared,
      GITHUB_OUTPUT: file,
    },
  })
  const outputs: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const kv = /^([a-z_]+)=(.*)$/.exec(line)
    if (kv?.[1]) outputs[kv[1]] = kv[2] ?? ''
  }
  return { status: res.status, stdout: res.stdout + res.stderr, outputs }
}

test('the workflow\'s own expression matches the one asserted here', () => {
  // If the workflow is edited without editing ALLOWED above, every test in this file goes on
  // passing while testing nothing. This is the line that stops that.
  //
  // The comparison used to be a shell `grep -vxE` against a `$prefix`; it is now the `allow-match:`
  // of a source-scan step (micro-org#303), and the prefix is a step output rather than a shell
  // variable. micro-org#519 then made that output an ALTERNATION built by a shell loop — and a
  // copied literal, which is what stood here, could only ever say that one half had changed. It
  // could not say whether the two halves still AGREE, which is the thing this test is for.
  //
  // So the shipped expression is read out of the file, filled in by running the workflow's own
  // `dbvar` shell, and compared to the model above. Drift in either half now fails here.
  const declared = /^\s*allow-match: '(.*\$\{\{ steps\.dbvar\.outputs\.[a-z_]+ \}\}.*)'\s*$/m.exec(WORKFLOW)
  assert.ok(declared, 'rule 1 no longer has an allow-match parameterised by the dbvar step')
  const template = declared[1] ?? ''

  for (const [service, input, prefixes] of [
    ['ledger', '', ['LEDGER']],
    ['hub-api', '', ['HUB_API']],
    ['lantern', 'LANTERN_DATABASE_URL ANALYTICS_DATABASE_URL', ['LANTERN', 'ANALYTICS']],
    ['lantern', 'LANTERN_DATABASE_URL,ANALYTICS_DATABASE_URL', ['LANTERN', 'ANALYTICS']],
  ] as const) {
    const step = runDbvar(service, input)
    assert.equal(step.status, 0, `the dbvar step failed for ${service}: ${step.stdout}`)
    const shipped = template.replace(
      /\$\{\{\s*steps\.dbvar\.outputs\.([a-z_]+)\s*\}\}/g,
      (_m, name: string) => {
        const value = step.outputs[name]
        assert.ok(value !== undefined, `the dbvar step emits no \`${name}\` for Rule 1 to read`)
        return value
      },
    )
    assert.equal(
      shipped,
      ALLOWED(prefixes).source,
      `service-ci.yml judges ${service} by an expression this file does not model`,
    )
  }
})

test('a declared database that is not a database variable is refused, not silently dropped', () => {
  // A list is a place to typo, and #519 made this input a list. A name that does not end in
  // _DATABASE_URL contributes a prefix that matches nothing, so Rule 1 would quietly go on
  // covering only the OTHER names — a guard narrowing itself with nothing said.
  const bad = runDbvar('lantern', 'LANTERN_DATABASE_URL ANALYTICS_DSN')
  assert.equal(bad.status, 1, 'a malformed entry must fail the step')
  assert.match(bad.stdout, /::error::database-env-var entry 'ANALYTICS_DSN' does not end in _DATABASE_URL/)
  assert.equal(bad.outputs['prefix_alt'], undefined, 'and must not publish a half-built alternation')
})

/* --------------------------- comment stripping ----------------------- */

test('rule 1 reads code, not prose', () => {
  // The guard used to grep raw source, so a comment explaining why this service does NOT read the
  // ledger's database failed the build by naming it. A rule that punishes documenting the rule
  // teaches people to delete the documentation. Same defect as the web template's nginx guard.
  //
  // The `awk` that first fixed it is gone: it was the first of seven local repairs of one defect,
  // and it was not string-aware, so it read the slashes in a URL as opening a comment and blanked
  // the code after them. Both halves — that prose passes and that code after a URL is still
  // caught — are exercised against the real step configuration in test/source-scan.test.ts.
  assert.doesNotMatch(WORKFLOW, /strip_comments\(\)/, 'the local stripper must not come back')
  assert.match(WORKFLOW, /uses: cloudsforge-online\/micro-org\/\.github\/actions\/source-scan@/)
  assert.match(
    WORKFLOW,
    /pattern: '\\b\[A-Z\]\[A-Z0-9_\]\*_\(DATABASE_URL\|DB_URL\|POSTGRES_URL\)\\b'/,
  )
})

test('rule 1 does not scan test files, which is where a foreign name is legitimately written', () => {
  // A test that proves a service IGNORES another service's DSN has to name it. micro-market's did,
  // and had to assemble it from ['LEDGER','DATABASE','URL'].join('_') to get past this check — the
  // rule forced a test that agrees with the rule to obscure its own assertion. The hard-coded-DSN
  // check in the same workflow had always exempted tests; this one had not.
  assert.match(WORKFLOW, /exclude-files: '\\\.\(test\|spec\)\\\.'/)
})

/* -------------------------- secret hygiene --------------------------- */

const HYGIENE = readFileSync(
  fileURLToPath(new URL('../.github/workflows/secret-hygiene.yml', import.meta.url)),
  'utf8',
)

/**
 * The .env.example check, lifted out so the shape can be exercised. Kept honest by the drift test
 * below, which fails if the workflow's own patterns stop matching these.
 */
const BENIGN = /=(localhost|127\.0\.0\.1|http:\/\/|https:\/\/|\$\{)/i
const PLACEHOLDER =
  /=.*(change[ _-]?me|replace|to[ _-]?be[ _-]?set|placeholder|example|your[ _-]|<[a-z]|todo|xxx|\.\.\.)/i
const LOCAL_ONLY = /^[^=]*=[^=]*(localhost|127\.0\.0\.1)/i
const EMPTY_JSON = /=(\{\}|\[\])$/
const SENSITIVE = /^[A-Z_]*(SECRET|TOKEN|PASSWORD|KEY|DSN|URL)[A-Z_]*=.+/

const flagged = (line: string) =>
  SENSITIVE.test(line) &&
  !BENIGN.test(line) &&
  !PLACEHOLDER.test(line) &&
  !LOCAL_ONLY.test(line) &&
  !EMPTY_JSON.test(line)

test('the placeholders five services actually use are recognised', () => {
  // billing, ledger, notify, pricing and settlement each failed this check on a value that could
  // not be mistaken for a credential. The allowlist knew `changeme` and not `CHANGE_ME`.
  for (const line of [
    'OUTBOX_SIGNING_SECRET=CHANGE_ME_TO_32_RANDOM_CHARACTERS',
    'NOTIFY_INGEST_SIGNING_SECRET=CHANGE_ME_at_least_24_characters',
    'OUTBOX_SIGNING_SECRET=REPLACE-with-openssl-rand-hex-24',
    'SETTLEMENT_SERVICE_TOKEN=REPLACE-with-a-scoped-service-token',
    'BILLING_LEDGER_TOKEN=CHANGE_ME_TO_A_SERVICE_TOKEN',
  ]) {
    assert.equal(flagged(line), false, `${line} is a placeholder and must pass`)
  }
})

test('a local development DSN passes, including one embedded in JSON', () => {
  assert.equal(flagged('NOTIFY_DATABASE_URL=postgres://cloudsforge:CHANGE_ME@127.0.0.1:5432/notify'), false)
  assert.equal(flagged('SETTLEMENT_RPC_URLS={"ember":"http://127.0.0.1:8545"}'), false)
})

test('a real credential is still caught — including a remote DSN carrying its password', () => {
  // The last of these passed before the scheme allowlist was tightened: `postgres://` was benign
  // on its own, so a production DSN with its password waved straight through the check whose
  // entire purpose is catching it.
  for (const line of [
    'OUTBOX_SIGNING_SECRET=8f3c2b91a7d54e60b12f9c3a7e8d1042',
    'STRIPE_API_KEY=sk_live_51H8xQ2LkdIwHu7ix',
    'ADMIN_PASSWORD=hunter2',
    'DB_URL=postgres://real:Pa55w0rd@prod.internal:5432/ledger',
  ]) {
    assert.equal(flagged(line), true, `${line} is a credential and must fail the build`)
  }
})

test('a bare postgres:// scheme is no longer treated as benign', () => {
  assert.doesNotMatch(
    HYGIENE,
    /benign='=\([^']*postgres:\/\/[^']*\)'/,
    'a scheme allowlist lets a remote DSN through with its password',
  )
})

test('the hygiene workflow\'s patterns match the ones asserted here', () => {
  assert.match(HYGIENE, /benign='=\(localhost\|127\\\.0\\\.0\\\.1\|http:\/\/\|https:\/\/\|\\\$\\\{\)'/)
  assert.match(HYGIENE, /placeholder='=\.\*\(change\[ _-\]\?me\|replace\|/)
  assert.match(HYGIENE, /local_only='\^\[\^=\]\*=\[\^=\]\*\(localhost\|127\\\.0\\\.0\\\.1\)'/)
})

test('an empty collection is not a credential, but a populated one still is', () => {
  // `IDENTITY_SERVICE_TOKEN_GRANTS={}` is the safe default for "which service may hold which
  // scope" — granting nothing — and its NAME matches *TOKEN*, so the guard flagged the one value
  // that is definitionally empty. Identity had no .env.example at all until this was fixed, which
  // is how a service every other service authenticates against came to be undeployable without
  // reading its source.
  assert.equal(flagged('IDENTITY_SERVICE_TOKEN_GRANTS={}'), false)
  assert.equal(flagged('ALLOWED_KEYS=[]'), false)

  // Narrow on purpose. The exemption is `{}` and `[]` and nothing else.
  assert.equal(flagged('API_TOKENS={"admin":"sk_live_realvalue"}'), true)
  assert.equal(flagged('SIGNING_KEYS=["8f3c2b91a7d54e60"]'), true)
  assert.equal(flagged('API_TOKEN={} and-more'), true, 'the literal must be the whole value')
})
