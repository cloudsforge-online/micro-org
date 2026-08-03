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

/* --------------------- the estate-wide sweep ------------------------ */

/**
 * `estate-ci.yml` is the only job in the estate with every repository checked out at once, which is
 * the only vantage point from which the ledger account-type defect is visible at all. Everything
 * that makes it trustworthy is a property somebody could delete in a hurry and nothing would go red
 * — a green sweep of an empty directory looks exactly like a green sweep of an estate that agrees —
 * so the properties are asserted here rather than trusted.
 */
describe('estate-ci sweeps the whole estate, or says so', () => {
  const yaml = readFileSync(DIR + 'estate-ci.yml', 'utf8')

  /**
   * One step, from its `- name:` to the next one — not to a step named further down.
   *
   * A slice ending at a hard-coded later step grows silently when something is inserted between the
   * two, and every assertion in these tests is a `match`, so it keeps passing while grading a
   * subject twice the size of the one it names.
   */
  const stepNamed = (name: string): string => {
    const at = yaml.indexOf(`- name: ${name}`)
    assert.notEqual(at, -1, `no step named '${name}' in estate-ci.yml`)
    const rest = yaml.slice(at + 1)
    const next = rest.indexOf('\n      - name: ')
    return next === -1 ? rest : rest.slice(0, next)
  }

  it('derives the repository list instead of writing one down', () => {
    // tools/registry.ts lists 46 repositories and does NOT contain micro-emberkin, which is one of
    // the three repositories the account defect was actually found in. A hand-maintained list would
    // have made this job blind to the defect it exists to catch, and green while doing it.
    assert.match(yaml, /gh api --paginate "orgs\/\$\{OWNER\}\/repos/, 'the list must come from the API')
    assert.doesNotMatch(
      yaml,
      /^\s+(micro-ledger|micro-worlds|micro-settlement)\b/m,
      'no repository may be named as part of a checkout list',
    )
  })

  it('strips the micro- prefix, or the sweep reads its own answer key', () => {
    // The sweep's only exclusion is DEFAULT_EXCLUDED = ['conformance'], matched on the directory
    // name. Checked out as `micro-conformance/`, CANONICAL_ACCOUNTS — the chart itself — enters the
    // sweep as twenty claims by a service that has never posted an entry, manufacturing
    // disagreements out of the table that decides them.
    assert.match(yaml, /\$\{name#micro-\}/)
  })

  it('a clone that failed is fatal, never skipped', () => {
    // The sweep cannot tell "this repository holds no account literals" from "this repository was
    // not there", and the second silently shrinks the denominator of every green it ever prints.
    assert.match(yaml, /a repository in the estate could not be cloned/)
    assert.match(yaml, /MIN_REPOS/, 'the count must be asserted, not assumed')
  })

  it('carries a canary that is graded on more than an exit code', () => {
    // A broken checkout, a missing subcommand and an unresolvable import all exit non-zero too. A
    // canary that accepts any red accepts every way this job can quietly stop measuring the estate.
    assert.match(yaml, /- name: The canary — this job can still go red/)
    assert.match(yaml, /the sweep stayed GREEN with a known-bad account type injected/)
    assert.match(yaml, /grep -q '__estate_ci_canary\.ts'/, 'the red must be attributed to the injection')
    assert.match(yaml, /the canary file was not written/, 'this estate has graded an unchanged file before')
    assert.match(yaml, /the canary survived/, 'and the injection must be proven gone before the real sweep')
  })

  it('the verdict is still printed when the canary is what broke', () => {
    const verdict = yaml.slice(yaml.indexOf('- name: The estate agrees on every ledger account type'))
    assert.match(verdict.slice(0, 200), /if: always\(\)/)
  })

  it('a scheduled red gets an owner rather than a run record that ages out', () => {
    assert.match(yaml, /gh issue create --repo "\$REPO" --label estate-invariant/)
    assert.match(yaml, /gh issue close "\$open"/, 'and it must close again, or the label becomes noise')
  })

  /* ---- the two invariants added after the ledger sweep, held to the same rules ---- */

  it('every verdict is reached, even when an earlier one failed', () => {
    // Three unrelated questions share this checkout only because cloning it three times would be
    // absurd. Stopping at the first failure turns "the estate is wrong in three ways" into three
    // nights, and lets a broken sweep hide a real disagreement behind it.
    for (const step of [
      '- name: The estate agrees on every ledger account type',
      '- name: Every registered scope is demanded by a gate',
      '- name: The registry, the producers and the consumers agree about the bus',
    ]) {
      const at = yaml.indexOf(step)
      assert.notEqual(at, -1, `${step} must exist`)
      assert.match(yaml.slice(at, at + 200), /if: always\(\)/, `${step} must run regardless of the steps before it`)
    }
  })

  it('each new invariant carries its own canary, graded on what the red names', () => {
    // Same rule as the ledger canary: a partial checkout, an unreadable registry and a missing node
    // all exit non-zero. A canary that accepts any red accepts every way a step stops measuring.
    assert.match(yaml, /the sweep stayed GREEN with a dead scope registered AND a dead scope demanded/)
    assert.match(yaml, /grep -q 'canary:orphan' "\$\{RUNNER_TEMP\}\/scope-canary\.txt"/)
    assert.match(yaml, /grep -q '__estate_ci_scope_canary\.ts' "\$\{RUNNER_TEMP\}\/scope-canary\.txt"/)
    assert.match(yaml, /the sweep stayed GREEN with an unemitted registered topic, a dead emitter AND three stale records/)
    assert.match(yaml, /grep -q 'canary\.estate\.injected' "\$\{RUNNER_TEMP\}\/topic-canary\.txt"/)
    assert.match(yaml, /grep -q 'emitEstateCiCanary' "\$\{RUNNER_TEMP\}\/topic-canary\.txt"/)
    // …and both must prove the injection was written, and then proven gone.
    assert.match(yaml, /the injections were not written/)
    assert.match(yaml, /an injection survived/)
  })

  it('the topic canary plants the record shapes direction 4 was blind to, and grades each by name', () => {
    // The defect this replaces: direction 4 scanned record structures with /'([a-z0-9_.]+)'/, so
    // `emits: 'trade.bot.created, trade.bot.started, trade.bot.paused'` — one literal naming three
    // topics trade really emits — matched nothing, and a stale record for trade.bot.paused hid for
    // weeks while the sweep printed "everything else reconciles". Exit codes could never find it:
    // the sweep was red the whole time for unrelated findings. Only an injection whose ABSENCE from
    // the output is the failure can.
    // Ends at the NEXT step, whatever it is. It used to end at 'The registry, the producers', which
    // stopped being the next step the moment the raw-insert canary was added between them — and
    // every assertion below is a `match`, so the slice silently grew to two steps and went on
    // passing. A test whose subject can quietly change size is not testing the subject it names.
    const canary = stepNamed('The canary — the topic sweep can still go red')
    assert.match(canary, /__estate_ci_record_canary\.ts/, 'the record structure must actually be planted')
    assert.match(canary, /UNPRODUCED_NOTIFICATIONS/, 'and under the name direction 4 reads BY NAME')
    // The three shapes, each one a thing the old scan could not read.
    assert.match(canary, /emits: 'identity\.session\.created, ledger\.entry\.posted'/, 'a comma-joined list')
    assert.match(canary, /emits: ESTATE_CI_CANARY_TOPIC/, 'a constant, the shape every producer uses for its own emits')
    assert.match(canary, /emits: "wallet\.deposit\.confirmed"/, 'a double-quoted literal — there are three quote styles')
    // Graded on the line, not the name: `ledger.entry.posted` is quoted inside a recorded gap's own
    // evidence, so a bare grep for it would pass a run in which direction 4 read nothing at all.
    assert.match(
      canary,
      /grep -q "\$\{topic\}: notify records at notify\/src\/__estate_ci_record_canary\.ts"/,
      'each injected topic must be named on a line citing the injected file',
    )
    for (const topic of [
      'identity.session.created',
      'ledger.entry.posted',
      'market.listing.sold',
      'wallet.deposit.confirmed',
    ]) {
      assert.ok(canary.includes(topic), `${topic} must be one of the names the canary demands back`)
    }
    assert.match(canary, /rm -f "\$emitter" "\$record"/, 'and the record must be proven gone before the real sweep')
  })

  it('the raw-insert canary plants a constant in the topic column, and is graded in two passes', () => {
    // Not every emit reaches the bus through a `topic:` property. ledger/src/entries.ts:439 writes
    // the outbox row in SQL and names the topic with the constant at entries.ts:199 — for the
    // express reason that a constant is reachable from ledger's own topics.ts and an inlined string
    // is not. The raw-insert path read a LITERAL there and bailed on anything opening `${`, so the
    // estate's most-consumed topic left the emitted set the day ledger named it, and the sweep said
    // "the repair is an emit, not a rename" about a service that emits it. The sibling path had
    // resolved identifiers since its first run: one tool, two answers to what an emit is.
    const canary = stepNamed('The canary — the raw-insert emit path can still resolve a constant')
    // The injected emit must be the shape that went invisible — a raw INSERT whose topic column is
    // an identifier — and it must carry no `topic:` property, or it would prove the other path.
    assert.match(canary, /insert into outbox \(topic, key, producer, version, actor, correlation_id, payload\)/)
    assert.match(canary, /values \(\$\{ESTATE_CI_OUTBOX_TOPIC\}, 'canary'/, 'the topic column must be a CONSTANT')
    assert.doesNotMatch(canary, /topic: '/, 'a `topic:` property here would grade the path that never broke')
    // PASS 1: found. Graded on direction 4 naming the injected emit FILE, which it can only print if
    // the raw insert resolved through the constant.
    assert.match(canary, /grep -q 'and identity emits it at identity\/src\/__estate_ci_outbox_canary\.ts'/)
    // PASS 2: the same tree minus one file, so the difference is attributable to the emit alone.
    assert.match(canary, /rm -f "\$emitter"\n/, 'the second pass must differ by exactly the emit file')
    assert.match(canary, /outbox-canary-seen\.txt/)
    assert.match(canary, /outbox-canary-gone\.txt/)
    assert.match(
      canary,
      /grep -q 'identity\.canary\.outboxed: registered, and no `topic:` in identity\/src ever names it'/,
      'the red must be graded on the name, not the exit code',
    )
    // THE REASON THERE ARE TWO PASSES AND NOT AN EXIT CODE: run against the checker as it was, BOTH
    // passes exit 1 — the estate is red for unrelated findings either way — so an exit-code grade is
    // satisfied by the very defect this canary exists to catch.
    assert.doesNotMatch(
      canary,
      /if \[ "\$seen" -ne 0 \]/,
      'pass 1 may not be graded on its exit code: this sweep is red on a healthy estate too',
    )
    assert.match(canary, /the injections were not written/, 'a canary that grades an unchanged tree grades nothing')
    assert.match(canary, /an injection survived/, 'and the tree must be proven restored before the real sweep')
  })

  it('the scope union is built by service-ci.yml own derivation, not a copy of it', () => {
    // Three earlier audit sweeps each missed a different demand shape. A second implementation would
    // drift, and the drift is invisible: every verdict of this step is "NOTHING demands this scope",
    // which is exactly what a derivation that stopped seeing a shape produces.
    assert.match(yaml, /SCOPE_AUDIT_SCRIPT/, 'the script must be extracted from service-ci.yml')
    assert.match(yaml, /the heredoc markers .* have moved or been renamed/i)
    // The derivation's own machinery, none of which may be re-typed here. (`.scopes.includes(` is
    // deliberately not the test: the canary plants exactly that shape as a GATE, which is the point.)
    for (const identifier of ['addGate(', 'resolveExpr(', 'SCOPE_SHAPE', 'closedSetFor(']) {
      assert.ok(!yaml.includes(identifier), `${identifier} belongs to service-ci.yml's derivation, not a copy here`)
    }
  })

  it('the checkers are the ones under test, not main copies of themselves', () => {
    // The estate clone already contains micro-org. Running the checkers from THERE would grade a
    // pull request that changes a checker with main's copy of it — a workflow that cannot test its
    // own change.
    assert.match(yaml, /if: github\.repository == 'cloudsforge-online\/micro-org'/)
    assert.match(yaml, /TOOLS=\$\{GITHUB_WORKSPACE\}\/self/)
    assert.match(yaml, /tools\/estate-scopes\.mjs/)
    assert.match(yaml, /tools\/estate-topics\.mjs/)
    for (const path of ['tools/estate-scopes.mjs', 'tools/estate-topics.mjs', 'tools/estate-topic-gaps.json']) {
      assert.match(yaml, new RegExp(`- '${path.replace(/[.]/g, '\\.')}'`), `${path} must re-prove the job when it changes`)
    }
  })
})

/**
 * The recorded gaps are a ratchet, not an exemption list, and the properties that make them one are
 * mechanical: an owning repository, and evidence long enough to be evidence. The self-emptying half
 * — a record that outlives its finding fails — is in the checker itself and is exercised by the
 * canary; this is the half that can rot by hand.
 */
test('every recorded estate topic gap names an owner, its evidence, and why it is still here', () => {
  const raw = readFileSync(new URL('../tools/estate-topic-gaps.json', import.meta.url), 'utf8')
  const parsed = JSON.parse(raw) as {
    gaps: Record<string, { owner?: string; evidence?: string; status?: string; until?: string; recordedAt?: string }>
  }
  // EMPTY IS A LEGAL STATE, and this used to assert it was not — 'an empty ledger means the estate
  // reconciles, delete this test then'. It does not mean that, and on 2026-08-03 it went red for
  // being right: the last two records were deleted because micro-ledger wrote the missing emit and
  // micro-mint made the rename, which is the ratchet working exactly as the file's header argues it
  // should. A test that fails when the estate is repaired teaches people to keep a record alive.
  //
  // What that assertion was really guarding is worth keeping, because it is this repository's own
  // signature defect: if `gaps` is renamed or mistyped, `Object.entries(undefined ?? {})` is empty,
  // every per-record assertion below runs zero times, and the test passes while checking nothing.
  // So the STRUCTURE is asserted instead of the contents.
  assert.ok(
    parsed.gaps !== null && typeof parsed.gaps === 'object' && !Array.isArray(parsed.gaps),
    'estate-topic-gaps.json must hold a `gaps` object — without one the loop below asserts nothing about zero records and passes',
  )
  // The kinds estate-topics.mjs can actually produce. `stale:x` used to parse, sit in the file
  // looking like a known issue, and surface only as "no longer describes the estate — delete it":
  // the message for a gap that has been FIXED, on a record that never described anything.
  const KINDS = ['unemitted', 'unregistered', 'unproduced', 'stale-record']
  for (const [key, entry] of Object.entries(parsed.gaps)) {
    assert.match(key, /^[a-z-]+:[a-z0-9_.]+$/, `${key} must be '<kind>:<topic>'`)
    assert.ok(KINDS.includes(key.split(':')[0] ?? ''), `${key}: no such finding kind — a record that matches nothing`)
    assert.match(entry.owner ?? '', /^micro-[a-z-]+$/, `${key} must name the repository that can repair it`)
    assert.ok(
      (entry.evidence ?? '').length >= 80,
      `${key}: under eighty characters of evidence is a hole, not a decision`,
    )
    assert.match(entry.evidence ?? '', /\.ts:\d+/, `${key}: evidence must cite a file and a line, not a summary`)
    assert.match(entry.recordedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `${key}: a record with no age cannot be seen to rot`)
    // `status` is what the first nine were missing. Two of them were not omissions at all but
    // decisions taken in micro-notify, with the one field each needs written down; recorded as
    // omissions they read as neglect. A `deferred` with no `until` is an exemption with better
    // manners, so the end condition is required and an `unfixed` may not carry one.
    assert.ok(['unfixed', 'deferred'].includes(entry.status ?? ''), `${key}: status must be unfixed or deferred`)
    if (entry.status === 'deferred') {
      assert.ok((entry.until ?? '').length >= 40, `${key}: a deferral must state the condition that ends it`)
    } else {
      assert.equal(entry.until, undefined, `${key}: 'until' belongs to a deferred record`)
    }
  }
})

test('no per-repository workflow calls the estate sweep', () => {
  // Rejected mechanism 1, asserted rather than remembered: a service that called this would clone
  // fifty-five repositories per push and go red for defects its author did not cause and cannot fix,
  // which is how an estate-wide gate gets switched off within a week.
  for (const file of ['service-ci.yml', 'web-ci.yml']) {
    assert.doesNotMatch(readFileSync(DIR + file, 'utf8'), /estate-ci\.yml/, `${file} must not call the sweep`)
  }
})
