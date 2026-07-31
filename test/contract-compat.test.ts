/**
 * The reusable contract-compatibility workflow, checked against the estate it is reusable for.
 *
 * THE TENTH DEFECT, and the same cause as the nine before it: the workflow had never been run.
 * micro-contracts declared no call to it (its package.json ran a `tools/compat.ts` that has never
 * existed in that repository), so the one thing standing between a removed contract field and a
 * runtime failure in a consumer whose CI never sees the change had not executed anywhere.
 *
 * The moment it did, it failed before the checker was fetched: "Fetch the checker" checks out
 * micro-org with the caller's job token, and a job token is scoped to the CALLING repository. It
 * cannot read a different private one, so every contract repository got `Repository not found`.
 *
 * These tests read the YAML as text rather than parsing it, because the thing being asserted is
 * the expression, and a parser would give back the same string anyway.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../.github/workflows/contract-compat.yml', import.meta.url)),
  'utf8',
)

test('the checker checkout is authenticated, because micro-org is private', () => {
  // The regression. A checkout of ANOTHER repository needs a token the job token cannot supply,
  // and the fallback keeps a public micro-org working without one.
  const step = WORKFLOW.slice(WORKFLOW.indexOf('Fetch the checker'))
  assert.match(step, /repository: \$\{\{ github\.repository_owner \}\}\/micro-org/)
  assert.match(step, /token: \$\{\{ secrets\.estate_token \|\| github\.token \}\}/)
})

test('the workflow declares the secret it consumes, and does not require it', () => {
  // An undeclared secret is silently empty in a reusable workflow — the failure would look
  // identical to having no token at all. `required: false` because the fallback is real.
  assert.match(WORKFLOW, /secrets:\s*\n\s+estate_token:/)
  const declaration = WORKFLOW.slice(WORKFLOW.indexOf('    secrets:'))
  assert.match(declaration.slice(0, declaration.indexOf('jobs:')), /required: false/)
})

test('the checker is read at full depth, or it silently has nothing to compare against', () => {
  // A shallow clone of the CALLER makes every package look new, which is a check that passes by
  // seeing nothing. This is asserted here so a future edit cannot quietly drop it.
  assert.match(WORKFLOW, /fetch-depth: 0/)
})

test('a package that cannot be judged fails the build rather than passing quietly', () => {
  // The whole value of this workflow is that it is red when a contract breaks a consumer. A
  // non-zero exit from the checker must reach the job's exit status.
  assert.match(WORKFLOW, /\|\| failed=1/)
  assert.match(WORKFLOW, /if \[ "\$failed" != "0" \]; then/)
})
