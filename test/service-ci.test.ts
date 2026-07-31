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
import { readFileSync } from 'node:fs'
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

test('both the runtime and the test variable are exported, because they are read by different code', () => {
  // Migration helpers read <SERVICE>_DATABASE_URL; testsupport.ts reads <SERVICE>_TEST_DATABASE_URL.
  // Exporting only one leaves half the suite unable to open a connection.
  assert.match(WORKFLOW, /_DATABASE_URL\/_TEST_DATABASE_URL/)
  assert.match(WORKFLOW, /export "\$want=\$CI_DSN"/)
  assert.match(WORKFLOW, /export "\$test_var=\$CI_DSN"/)
})

test('a skipped database suite fails the build rather than passing quietly', () => {
  // This is the whole point. A green run that skipped its database tests is worse than a red one,
  // because it is believed.
  assert.match(WORKFLOW, /database-backed tests SKIPPED/)
  assert.match(WORKFLOW, /grep -qiE 'set \[A-Z_\]\*TEST_DATABASE_URL\|database tests are disabled'/)
})

/* ------------------------------ rule 1 ------------------------------- */

/**
 * Rule 1's comparison, lifted out of the workflow so it can be exercised directly. Kept in step
 * with the shell by the test below, which fails if the workflow's expression drifts from this one.
 */
const ALLOWED = (service: string) =>
  new RegExp(
    `^${service.toUpperCase().replace(/-/g, '_')}_(TEST_)?(DATABASE_URL|DB_URL|POSTGRES_URL)$`,
  )

const rejected = (service: string, read: readonly string[]) =>
  read.filter((v) => !ALLOWED(service).test(v))

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

test('the workflow\'s own expression matches the one asserted here', () => {
  // If the shell is edited without editing ALLOWED above, every test in this file goes on passing
  // while testing nothing. This is the line that stops that.
  assert.match(WORKFLOW, /\$\{prefix\}_\(TEST_\)\?\(DATABASE_URL\|DB_URL\|POSTGRES_URL\)/)
  assert.match(WORKFLOW, /prefix="\$\{want%_DATABASE_URL\}"/)
})

/* --------------------------- comment stripping ----------------------- */

test('rule 1 reads code, not prose', () => {
  // The guard used to grep raw source, so a comment explaining why this service does NOT read the
  // ledger's database failed the build by naming it. A rule that punishes documenting the rule
  // teaches people to delete the documentation. Same defect as the web template's nginx guard.
  assert.match(WORKFLOW, /strip_comments\(\)/)
  assert.match(WORKFLOW, /grep -rhoE '\[A-Z\]\[A-Z0-9_\]\*_\(DATABASE_URL\|DB_URL\|POSTGRES_URL\)' "\$stripped"/)
  assert.doesNotMatch(
    WORKFLOW,
    /grep -rhoE '\[A-Z\]\[A-Z0-9_\]\*_\(DATABASE_URL\|DB_URL\|POSTGRES_URL\)' "\$src"/,
    'the unstripped source must not be scanned again',
  )
})
