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

/* --------------------- the scope-totality checker ------------------------ */

/**
 * The scope registry knew 14 scopes while the estate's services gated on ~30 more, and three
 * successive audit sweeps each missed a different SHAPE of demand — inline literals, sibling-file
 * constants, wrapper third arguments, computed families. That history is why the audit is a
 * checker embedded in service-ci.yml rather than a grep session, and why these tests feed the
 * checker every shape that defeated a sweep, plus a mutation: a checker that cannot be made to
 * fail proves nothing (this estate has had a canary that graded an unchanged file).
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/** The script, extracted from the workflow's heredoc — the exact bytes every service CI runs. */
function extractAuditScript(): string {
  const yaml = readFileSync(DIR + 'service-ci.yml', 'utf8')
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => l.includes("<<'SCOPE_AUDIT_SCRIPT'"))
  const end = lines.findIndex((l, i) => i > start && l.trim() === 'SCOPE_AUDIT_SCRIPT')
  assert.ok(start >= 0 && end > start, 'service-ci.yml must embed the scope-audit heredoc')
  return lines.slice(start + 1, end).map((l) => l.replace(/^ {10}/, '')).join('\n') + '\n'
}

const AUDIT_DIR = mkdtempSync(join(tmpdir(), 'scope-audit-'))
const AUDIT_SCRIPT = join(AUDIT_DIR, 'scope-audit.mjs')
writeFileSync(AUDIT_SCRIPT, extractAuditScript())

/** A registry fixture in the exact shape of contracts/packages/auth/src/index.ts. */
function registryFixture(names: readonly string[]): string {
  const entries = names
    .map((n) => `  '${n}': Object.freeze({ service: 'x', description: 'fixture' }),`)
    .join('\n')
  return `export const SCOPES = Object.freeze({\n${entries}\n} as const satisfies X)\n`
}

function runAudit(files: Record<string, string>, registry: readonly string[]): {
  status: number
  out: string
} {
  const dir = mkdtempSync(join(AUDIT_DIR, 'case-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, text)
  }
  writeFileSync(join(dir, 'contracts-index.ts'), registryFixture(registry))
  const res = spawnSync(
    process.execPath,
    [AUDIT_SCRIPT, join(dir, 'src'), join(dir, 'contracts-index.ts'), join(dir, 'scope-exemptions.json')],
    { encoding: 'utf8' },
  )
  return { status: res.status ?? -1, out: `${res.stdout}\n${res.stderr}` }
}

/** One fixture with every shape that defeated a sweep. */
const ESTATE_SHAPES: Record<string, string> = {
  // inline literal — the shape community/src/server.ts:1056 hid from the constant-reading sweep
  'src/inline.ts': `
    export async function handle(principal: Principal) {
      requireScope(principal, 'fixture:read')
    }
  `,
  // helper-resolved constant declared in a SIBLING file, demanded through a wrapper's third
  // argument (the ledger/beacon/indexer shape), plus a three-part name (the custody shape)
  'src/constants.ts': `
    export const WRITE_SCOPE = 'fixture:write'
    export const DEEP_SCOPE = 'fixture:audit:write'
  `,
  'src/wrapper.ts': `
    import { WRITE_SCOPE, DEEP_SCOPE } from './constants.ts'
    async function authorise(ctx: Ctx, deps: Deps, scope: string): Promise<Principal> {
      const principal = await deps.verifier.principal(ctx.token)
      if (principal.kind === 'service') requireScope(principal, scope)
      return principal
    }
    export async function write(ctx: Ctx, deps: Deps) {
      await authorise(ctx, deps, WRITE_SCOPE)
      await authorise(ctx, deps, DEEP_SCOPE)
    }
  `,
  // computed family closed over an enumerated set — custody/src/gates.ts:177's shape
  'src/family.ts': `
    const PURPOSES = new Set<Purpose>(['alpha', 'beta'])
    export function signScopeFor(purpose: string): string {
      return \`fixture:sign:\${purpose}\`
    }
    export function gate(principal: Principal, body: Body) {
      const claimed = stringField(body, 'purpose')
      if (!PURPOSES.has(claimed as Purpose)) throw new Error('unknown purpose')
      requireScope(principal, signScopeFor(claimed))
    }
  `,
  // prose naming a gate must not register a demand — six guards in this estate have fired on
  // their own documentation
  'src/prose.ts': `
    // A comment explaining that requireScope(principal, 'prose:only') is how OTHER services
    /* gate, and that this service deliberately does not demand 'prose:only' anywhere. */
    export const nothing = 0
  `,
  // a test file naming a scope is where fakes legitimately live; it must not count
  'src/fake.test.ts': `requireScope(principal, 'testonly:fake')`,
}

const ESTATE_REGISTRY = ['fixture:read', 'fixture:write', 'fixture:audit:write', 'fixture:sign:alpha', 'fixture:sign:beta']

test('the checker derives every shape that defeated a sweep, and only from code', () => {
  const { status, out } = runAudit(ESTATE_SHAPES, ESTATE_REGISTRY)
  assert.equal(status, 0, `expected a clean pass:\n${out}`)
  for (const scope of ESTATE_REGISTRY) {
    assert.match(out, new RegExp(`registered\\s+${scope}`), `must derive ${scope}`)
  }
  assert.doesNotMatch(out, /prose:only/, 'a demand must not be read out of a comment')
  assert.doesNotMatch(out, /testonly:fake/, 'a demand must not be read out of a test file')
})

test('a demanded scope missing from the registry fails the build and names the gate', () => {
  const { status, out } = runAudit(ESTATE_SHAPES, ESTATE_REGISTRY.filter((s) => s !== 'fixture:write'))
  assert.equal(status, 1, 'a missing scope must be red')
  assert.match(out, /'fixture:write' is demanded by a gate but absent/)
  assert.match(out, /wrapper\.ts/, 'the failure must cite where the demand was derived')
})

test('a computed family whose input set is not provably closed fails rather than guesses', () => {
  const open = {
    'src/family.ts': `
      export function signScopeFor(purpose: string): string {
        return \`fixture:sign:\${purpose}\`
      }
      export function gate(principal: Principal, purpose: string) {
        requireScope(principal, signScopeFor(purpose))
      }
    `,
  }
  const { status, out } = runAudit(open, ESTATE_REGISTRY)
  assert.equal(status, 1)
  assert.match(out, /not provably closed/)
})

describe('exemptions are decisions with their reasoning written down', () => {
  const demanding = {
    'src/gate.ts': `export function f(p: Principal) { requireScope(p, 'placeholder:read') }`,
  }

  it('a reasoned exemption passes', () => {
    const { status, out } = runAudit(
      {
        ...demanding,
        'scope-exemptions.json': JSON.stringify({
          'placeholder:read': 'A template placeholder no real service demands; registering it would mint a capability nothing enforces.',
        }),
      },
      ['fixture:read'],
    )
    assert.equal(status, 0, out)
    assert.match(out, /exempted\s+placeholder:read/)
  })

  it('a reason under forty characters is a hole, not a decision', () => {
    const { status, out } = runAudit(
      { ...demanding, 'scope-exemptions.json': JSON.stringify({ 'placeholder:read': 'placeholder' }) },
      ['fixture:read'],
    )
    assert.equal(status, 1)
    assert.match(out, /no real reason/)
  })

  it('an exemption for a scope that is registered, or that nothing demands, is stale and fails', () => {
    const registered = runAudit(
      {
        'src/gate.ts': `export function f(p: Principal) { requireScope(p, 'fixture:read') }`,
        'scope-exemptions.json': JSON.stringify({
          'fixture:read': 'This reason is long enough but the scope is already in the registry, so the exemption is stale.',
        }),
      },
      ['fixture:read'],
    )
    assert.equal(registered.status, 1)
    assert.match(registered.out, /exempted AND registered/)

    const undemanded = runAudit(
      {
        'src/gate.ts': `export const nothing = 0`,
        'scope-exemptions.json': JSON.stringify({
          'ghost:read': 'This reason is long enough but no gate anywhere demands the scope it exempts any more.',
        }),
      },
      ['fixture:read'],
    )
    assert.equal(undemanded.status, 1)
    assert.match(undemanded.out, /no gate demands it/)
  })
})

test('MUTATION: an injected gate on an unregistered scope turns the build red, and the file really changed', () => {
  // A checker that cannot be made to fail proves nothing. The injection is graded only after
  // asserting the fixture ACTUALLY differs from the original — this estate has had a canary that
  // graded an unchanged file and called the guard proven.
  const dir = mkdtempSync(join(AUDIT_DIR, 'mutation-'))
  mkdirSync(join(dir, 'src'))
  const target = join(dir, 'src', 'inline.ts')
  const original = ESTATE_SHAPES['src/inline.ts']!
  for (const [name, text] of Object.entries(ESTATE_SHAPES)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  writeFileSync(join(dir, 'contracts-index.ts'), registryFixture(ESTATE_REGISTRY))

  const run = () =>
    spawnSync(process.execPath, [AUDIT_SCRIPT, join(dir, 'src'), join(dir, 'contracts-index.ts')], {
      encoding: 'utf8',
    })

  assert.equal(run().status, 0, 'the fixture must be green before the mutation')

  const mutated = original.replace(
    "requireScope(principal, 'fixture:read')",
    "requireScope(principal, 'fixture:read')\n      requireScope(principal, 'mutant:write')",
  )
  writeFileSync(target, mutated)
  assert.notEqual(readFileSync(target, 'utf8'), original, 'the mutation must actually change the file before it is graded')

  const red = run()
  assert.equal(red.status, 1, 'the injected demand must turn the run red')
  assert.match(`${red.stdout}${red.stderr}`, /'mutant:write' is demanded by a gate but absent/)

  writeFileSync(target, original)
  assert.equal(readFileSync(target, 'utf8'), original, 'the restore must be byte-identical')
  assert.equal(run().status, 0, 'restored, the run must be green again')
})

test('the workflow step runs the script against the checked-out contracts and the declared source dir', () => {
  const yaml = readFileSync(DIR + 'service-ci.yml', 'utf8')
  assert.match(yaml, /- name: Every scope this service demands is registered/)
  assert.match(yaml, /node "\$RUNNER_TEMP\/scope-audit\.mjs" "service\/\$SRC" contracts\/packages\/auth\/src\/index\.ts service\/scope-exemptions\.json/)
  assert.match(yaml, /SRC: \$\{\{ inputs\.source-dir \}\}/, 'runtime uses source-dir: packages; the step must honour it')
})

test.after(() => rmSync(AUDIT_DIR, { recursive: true, force: true }))
