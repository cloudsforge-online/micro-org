/**
 * Two defect classes that this repository produced over and over, checked mechanically instead of
 * by review, because review is what missed them twelve times.
 *
 * ## 1. A capture that aborts its own step when it finds nothing
 *
 * `grep` and `git grep` exit 1 when they match nothing. GitHub runs every `run:` block as
 * `bash -e {0}`, and `set -uo pipefail` does not turn `-e` off. So
 *
 *     hits=$(git grep -n 'something-bad')
 *     if [ -n "$hits" ]; then …
 *
 * never reaches the `if` on a repository that is clean. The step dies at the assignment, with no
 * annotation, and the ONLY path that ever reached the reporting logic was the one where the bad
 * thing was really there. Every one of these checks was red on correct code and had never passed
 * anywhere — which nobody noticed, because no repository had pushed yet and the workflows had
 * therefore never run.
 *
 * Eleven captures across three workflow files had this shape. One of them was added while fixing
 * the others.
 *
 * ## 2. A guard that fires on the comment explaining the guard
 *
 * Separately and just as often: a grep over raw source matches the prose documenting the rule.
 * `nginx.conf`'s header quotes the directive it forbids; a service's comment names the database it
 * deliberately does not read; a test asserting a variable is ignored has to spell it. Each one
 * failed the build for being correct, and each was worked around by rewording the comment —
 * meaning the rule quietly deleted its own documentation wherever it was applied.
 *
 * Both classes share a cause: these checks read text and reason about meaning. That is fine, but it
 * has to be deliberate, and the two tests below make the deliberateness checkable.
 */
import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url))
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.yml'))

/** Commands that exit non-zero simply because they found nothing. */
const SEARCH = /\b(grep|git grep|ls-files|find)\b/

/**
 * Every `name=$( … )` capture in a workflow, joined across backslash continuations so a multi-line
 * pipeline is judged whole. Comment lines are dropped first — this file's own prose describes the
 * broken shape, and a checker that matched its own explanation would be the very bug it checks for.
 */
function captures(yaml: string): { line: number; text: string }[] {
  const lines = yaml.split('\n')
  const out: { line: number; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    if (/^\s*#/.test(raw)) continue
    if (!/^\s*[A-Za-z_][A-Za-z0-9_]*=\$\(/.test(raw)) continue
    let text = raw
    let j = i
    // Join backslash continuations and unbalanced-paren continuations.
    while (
      j + 1 < lines.length &&
      (/\\\s*$/.test(text) ||
        (text.split('(').length - text.split(')').length > 0))
    ) {
      j += 1
      text += ' ' + (lines[j] ?? '')
    }
    out.push({ line: i + 1, text })
    i = j
  }
  return out
}

test('no workflow capture can abort its own step by finding nothing', () => {
  const unguarded: string[] = []
  for (const file of FILES) {
    const yaml = readFileSync(DIR + file, 'utf8')
    for (const { line, text } of captures(yaml)) {
      if (!SEARCH.test(text)) continue
      if (/\|\|\s*true/.test(text)) continue
      unguarded.push(`${file}:${line} ${text.trim().slice(0, 100)}`)
    }
  }
  assert.deepEqual(
    unguarded,
    [],
    `these captures die on a clean repository instead of reporting success:\n  ${unguarded.join('\n  ')}`,
  )
})

test('the checker itself notices the broken shape', () => {
  // A test asserting an empty list passes just as well when the checker is blind, so the checker is
  // shown a known-bad input. Without this, deleting `SEARCH` would leave every test here green.
  const bad = `
      - name: A check
        run: |
          set -uo pipefail
          hits=$(git grep -nIE 'secret' -- . ':!*.md')
          if [ -n "$hits" ]; then exit 1; fi
`
  const found = captures(bad).filter((c) => SEARCH.test(c.text) && !/\|\|\s*true/.test(c.text))
  assert.equal(found.length, 1, 'the checker must flag an unguarded git grep capture')

  const good = bad.replace("':!*.md')", "':!*.md' || true)")
  const stillFound = captures(good).filter((c) => SEARCH.test(c.text) && !/\|\|\s*true/.test(c.text))
  assert.equal(stillFound.length, 0, 'and must accept the guarded form')
})

test('a multi-line pipeline is judged whole, not by its first line', () => {
  // The analytics check in web-ci.yml carries its `|| true` on the continuation line. A checker
  // reading single lines would report it as broken and, worse, would report a genuinely broken
  // multi-line capture as fine if its first line happened to contain the words.
  const multi = `
          hits=$(git grep -nIE 'gtag\\(' \\
                 -- . ':!*.md' || true)
`
  const found = captures(multi).filter((c) => SEARCH.test(c.text) && !/\|\|\s*true/.test(c.text))
  assert.equal(found.length, 0, 'the guard on the continuation line must count')
})

/* --------------------- guards that read prose ------------------------ */

/**
 * A grep over source that is meant to find CODE must not see comments. Each of these strips first;
 * the assertion is that they still do.
 */
test('every source-scanning guard strips comments before matching', () => {
  const service = readFileSync(DIR + 'service-ci.yml', 'utf8')
  assert.match(service, /strip_comments\(\)/, 'rule 1 must strip comments')
  assert.match(
    service,
    /! -name '\*\.test\.\*' ! -name '\*\.spec\.\*'/,
    'rule 1 must skip tests, where naming a foreign variable is the point',
  )
})

test('the two workflows do not demand opposite things of the same nginx config', () => {
  // web-ci.yml required a deep link to return 200 and named `try_files … /index.html` in its
  // failure message; web-template's nginx.conf forbids that directive and its CI fails the build
  // over it. A frontend could satisfy one guard or the other and never both, so micro-hub-web
  // declined to call the reusable workflow at all — correctly.
  const web = readFileSync(DIR + 'web-ci.yml', 'utf8')
  assert.doesNotMatch(
    web,
    /\[ "\$deep" = "200" \] \|\| \{ echo "::error::a deep link returned/,
    'an invented path must not be required to return 200',
  )
  assert.match(web, /"\$unknown" = "404"/, 'an unknown path must be required to 404')
  assert.match(web, /inputs\.deep-link-path/, 'the 200 check must use a route the app really has')
})

describe('a deployable documents itself', () => {
  // Twelve repositories had no README at all and every one was green, because nothing anywhere
  // asserted that a deployable explains itself — the same shape as four frontends shipping with no
  // favicon. A brief telling an agent to write one is a thing agents forget; a gate is not.
  const files = ['service-ci.yml', 'web-ci.yml'].map((f) => readFileSync(DIR + f, 'utf8'))

  it('both reusable workflows check for a README', () => {
    for (const yaml of files) {
      assert.match(yaml, /The repository documents itself/)
      assert.match(yaml, /this repository has no README\.md/)
    }
  })

  it('the bar is substance and a way to run it, not a prescribed shape', () => {
    // CALIBRATION IS THE POINT. Ten good READMEs were measured before this gate was written:
    // route tables and configuration tables are NOT universal — lantern and emberkin document
    // neither and are both strong — so requiring them would fail correct work, which is exactly
    // how six guards in this estate came to fire on their own prose. The floor is 4 kB (the
    // smallest genuinely-documented service is ~5.9 kB) and one run command.
    for (const yaml of files) {
      assert.match(yaml, /-lt 4000/, 'a size floor must exist')
      assert.match(yaml, /pnpm \(test\|dev\|install\)\|docker \(run\|compose\)/)
      assert.doesNotMatch(
        yaml,
        /README\.md never documents its routes|README must contain a route table/,
        'requiring a route table would fail lantern and emberkin, which are good',
      )
    }
  })
})
