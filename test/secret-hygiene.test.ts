/**
 * THE CREDENTIAL-DEFAULT CHECK, TESTED LIKE CODE RATHER THAN EXERCISED BY ACCIDENT.
 *
 * `secret-hygiene.yml` is a reusable workflow that every repository in the estate calls `@main`.
 * There is no staging for it: the moment a change lands, sixty-nine repositories run it on their
 * next push. A false positive does not fail one build, it turns the estate red at once — and a
 * red guard on correct code does not get fixed, it gets bypassed, which is how three of the older
 * steps in that file came to have never passed anywhere.
 *
 * So the step that refuses a hard-coded credential default is not allowed to be believed. This
 * suite runs THE EXACT BYTES the workflow runs — extracted from the `run:` block, not copied, so
 * the two cannot drift — against a fixture tree of real estate lines, and grades both directions:
 *
 *   - the positives, one per SHAPE, so a regression names the shape it broke;
 *   - the negatives, every one of which is a line that exists somewhere in the estate today and
 *     is correct code, because the false-positive side is the side that decides whether a shared
 *     check survives contact with sixty-nine repositories;
 *   - `micro-org` itself, which is the blast-radius rehearsal: an early cut of the step failed
 *     this repository on four lines, every one of them a file DESCRIBING the check;
 *   - and a mutation, because a checker that cannot be made to fail proves nothing. This estate
 *     has already shipped a canary that graded an unchanged file.
 *
 * The assertion that matters most is the first one: the `estate-bootstrap.sh` line that published
 * the estate administrator's password fails, and the file that replaced it passes. Everything else
 * in this suite is in service of that claim being true for the reasons stated rather than by luck.
 * (micro-org #276, fixed in micro-deploy #13.)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/secret-hygiene.yml', import.meta.url))
const REPO = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures/credential-defaults/', import.meta.url))

const STEP = 'No credential-shaped default in a script'

/**
 * The step body, lifted out of the YAML by string parsing.
 *
 * There is no YAML dependency in this repository and this suite does not add one:
 * `workflow-shell.test.ts` reads these files the same raw way, and a parser here would mean the
 * tests read a different document from the one GitHub runs. The block is taken verbatim and
 * de-indented by the ten spaces of block-scalar indentation, so what `bash` receives below is
 * byte-for-byte what a runner receives.
 */
function extractStep(name: string): string {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n')
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`)
  assert.ok(at >= 0, `secret-hygiene.yml must contain a step named "${name}"`)
  const indent = lines[at]!.search(/\S/)
  const runAt = lines.findIndex((l, i) => i > at && l.trim() === 'run: |')
  assert.ok(runAt > at, `the step "${name}" must carry a literal run: | block`)

  // A step ends where the next thing at or outside the step's own indentation begins. Blank lines
  // have no indentation and must not be read as the end of anything.
  let end = lines.length
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i]!
    if (l.trim() === '') continue
    if (l.search(/\S/) <= indent) {
      end = i
      break
    }
  }
  const body = lines.slice(runAt + 1, end).map((l) => l.replace(/^ {10}/, ''))

  // If the extraction ever silently returns a stub, every assertion below becomes vacuous and the
  // suite goes green while testing nothing. Grade the extraction itself.
  assert.ok(body.length > 200, 'the extracted step is too small to be the checker — extraction broke')
  assert.match(body.join('\n'), /CREDENTIAL_DEFAULT_AUDIT/, 'the extracted step must embed the awk program')
  return body.join('\n') + '\n'
}

const SCRATCH = mkdtempSync(join(tmpdir(), 'secret-hygiene-'))
const SCRIPT = join(SCRATCH, 'credential-default-step.sh')
writeFileSync(SCRIPT, extractStep(STEP))

type Result = { status: number; out: string }

/**
 * `cwd` is the whole interface: the step scans `.` from wherever the job checked the repository
 * out, so pointing it at a fixture directory is exactly how a runner sees a repository. The
 * timeout is not decoration — the shape of failure this check has already had once is `xargs`
 * with an empty file list handing `awk` no arguments, at which point `awk` reads stdin and the
 * job hangs instead of failing. A hang must be a red test, not a wedged suite.
 */
function runCheck(cwd: string): Result {
  const res = spawnSync('bash', [SCRIPT], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, RUNNER_TEMP: mkdtempSync(join(SCRATCH, 'run-')) },
  })
  assert.notEqual(res.signal, 'SIGTERM', `the checker did not terminate within its timeout in ${cwd}`)
  return { status: res.status ?? -1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` }
}

/**
 * Findings, reduced to `path:line kind name` — the identity of a finding, with the digest and the
 * character count deliberately dropped so that a fixture whose value changes does not have to be
 * re-typed here, while a fixture whose SHAPE changes does.
 */
function shapes(out: string): string[] {
  const found: string[] = []
  for (const raw of out.split('\n')) {
    if (!/^ {2}\S/.test(raw)) continue
    const line = raw.trim()
    const finding = /^(\S+)\s{2}(\S+)\s{2}(\S+)\s{2}sha256:/.exec(line)
    if (finding) {
      found.push(`${finding[1]} ${finding[2]} ${finding[3]}`)
      continue
    }
    const marker = /^(\S+)\s{2}an allow marker/.exec(line)
    assert.ok(marker, `unparseable finding line: ${line}`)
    found.push(`${marker[1]} allow-without-reason`)
  }
  return found
}

/** The 12-character digests, in order, for the correlation assertion. */
function digests(out: string): string[] {
  return [...out.matchAll(/sha256:([0-9a-f]{12})/g)].map((m) => m[1]!)
}

/* ------------------------- the assertion this whole change exists for ------------------------ */

test('the published estate-bootstrap default fails and the line that replaced it passes', () => {
  // Both files are scanned in one run, from the directory that holds them, exactly as a runner
  // would scan a repository containing both. `before.sh` is the pre-fix block verbatim and
  // `after.sh` is the post-fix block verbatim, comments and all — including the post-fix file's
  // quotation of the defective line and its `PUBLISHED_DEFAULT=` constant, which is the case a
  // naive matcher gets wrong. A check that fails the code that fixes the bug is worse than none.
  const { status, out } = runCheck(join(FIXTURES, 'estate-bootstrap'))

  assert.equal(status, 1, 'the pre-fix bootstrap line must fail the check')
  assert.deepEqual(shapes(out), ['before.sh:13 shell-default ADMIN_PASSWORD'])
  assert.doesNotMatch(out, /after\.sh/, 'the fixed file must not produce a finding')
})

test('the fixed bootstrap file passes on its own, quoted defect and refusal constant included', () => {
  const dir = mkdtempSync(join(SCRATCH, 'after-only-'))
  cpSync(join(FIXTURES, 'estate-bootstrap', 'after.sh'), join(dir, 'after.sh'))
  const after = readFileSync(join(dir, 'after.sh'), 'utf8')

  // The fixture is only worth anything if it still contains the two things that make it hard.
  assert.match(after, /ADMIN_PASSWORD=\$\{ADMIN_PASSWORD:-correct-horse-battery-staple-42\}/)
  assert.match(after, /PUBLISHED_DEFAULT='correct-horse-battery-staple-42'/)

  const { status, out } = runCheck(dir)
  assert.equal(status, 0, out)
})

/* --------------------------------- every shape it refuses ------------------------------------ */

/**
 * One entry per shape. This list is long on purpose: a regression that drops a shape names the
 * shape, rather than reporting "22 findings, expected 23".
 *
 * It is compared as a SET, not a sequence. The step walks files in `find` order, which is
 * directory order, which is a property of the filesystem and not of the check — this suite passed
 * on macOS and failed on ubuntu-latest with the same twenty-three findings in a different order.
 * Asserting an order the check never promised would make the fixture a test of APFS. Within one
 * file the order is still line order, and the tests below that grade a single file rely on it.
 */
const EXPECTED_POSITIVES = [
  // an allow marker with no reason is itself a finding, AND the line beneath it is still reported
  'muted.sh:8 allow-without-reason',
  'muted.sh:9 shell-default MUTED_PASSWORD',
  'muted.sh:11 allow-without-reason',
  'muted.sh:12 shell-default SHORT_REASON_TOKEN',

  'shapes.mjs:10 js-fallback ADMIN_PASSWORD', // process.env.X || 'literal'
  'shapes.mjs:13 js-fallback SIGNING_SECRET', // process.env['X'] ?? "literal"
  'shapes.mjs:16 js-fallback SERVICE_TOKEN', // a destructured env binding
  'shapes.mjs:19 js-const password', // const password = 'literal'
  'shapes.mjs:22 js-const API_KEY', // a QUALIFIED key, which counts where a bare KEY does not
  'shapes.mjs:27 js-property password', // the shape a credential is actually posted in
  'shapes.mjs:32 js-fallback BEACON_SMOKE_PASSWORD', // a ?? chain over four lines, literal on the last

  'shapes.sh:6 shell-default ADMIN_PASSWORD', // the micro-org #276 line itself
  'shapes.sh:9 shell-default ESTATE_SECRET', // the same expansion inline rather than assigned
  'shapes.sh:12 shell-default SOME_SECRET',
  'shapes.sh:13 shell-default SOME_TOKEN',
  'shapes.sh:14 shell-default SOME_KEY',
  'shapes.sh:15 shell-default SOME_CREDENTIAL',
  'shapes.sh:16 shell-default SOME_PASS',
  'shapes.sh:19 assign PASS', // a plain assignment, which is what erasure-drill.sh had
  'shapes.sh:20 assign SERVICE_TOKEN', // bare and unquoted
  'shapes.sh:23 assign adminPassword', // camelCase, judged in the same vocabulary

  // compose interpolation IS shell parameter expansion, and the estate's one surviving finding
  // when this shipped lived in exactly this shape
  'compose.yml:10 shell-default THING_ADMIN_PASSWORD',
  'compose.yml:11 shell-default THING_SIGNING_SECRET',
]

test('every shape the estate actually published is refused, and named by shape', () => {
  const { status, out } = runCheck(join(FIXTURES, 'positives'))
  assert.equal(status, 1)
  assert.deepEqual(shapes(out).sort(), [...EXPECTED_POSITIVES].sort())
})

test('a finding is reported at the line the credential is on, not at the line above it', () => {
  // Continuation handling decides the REPORT as well as the match. A trailing `:` continues a
  // property in TypeScript but OPENS a mapping in YAML, so treating it as a continuation there
  // would blame `environment:` for the line beneath it and send the reader to the parent key.
  const compose = readFileSync(join(FIXTURES, 'positives', 'compose.yml'), 'utf8').split('\n')
  assert.match(compose[8]!, /^\s+environment:$/, 'the compose fixture must still nest under a mapping key')
  assert.match(compose[9]!, /THING_ADMIN_PASSWORD/)

  const { out } = runCheck(join(FIXTURES, 'positives'))
  assert.ok(shapes(out).includes('compose.yml:10 shell-default THING_ADMIN_PASSWORD'))
  assert.ok(!shapes(out).some((s) => s.startsWith('compose.yml:9 ')), 'the mapping key must not be blamed')
})

/* ------------------------------- and what it must never refuse ------------------------------- */

test('every exemption is a line that exists in the estate, and every one of them stays green', () => {
  // This is the half that decides whether the check survives. A first cut found 102
  // credential-named literals across the estate and 101 of them were correct code; this fixture
  // is what took that to zero, and each line in it is cited to the file it came from.
  const { status, out } = runCheck(join(FIXTURES, 'negatives'))
  assert.equal(status, 0, out)
  assert.match(out, /^ok: no credential-shaped defaults$/m)
})

test('the negative fixtures are not green because they are empty', () => {
  // The obvious way for the previous test to lie is for the fixture directory to have lost its
  // contents, or for the exemption fixtures to have quietly stopped containing credential words.
  const files = readdirSync(join(FIXTURES, 'negatives'))
  assert.ok(files.length >= 4, `expected the negative fixtures to still be there, found ${files.join(', ')}`)
  for (const f of files) {
    const text = readFileSync(join(FIXTURES, 'negatives', f), 'utf8')
    assert.match(text, /PASSWORD|SECRET|TOKEN|KEY|password|secret|token/, `${f} exercises nothing`)
  }
})

test('this repository passes the step it is shipping, which is the blast-radius rehearsal', () => {
  // Every caller references this workflow @main, so a false positive here is sixty-nine
  // repositories red on their next push. An earlier cut of the step failed micro-org on four
  // lines and all four were files DESCRIBING the check: the awk `MARKER =` definition, the
  // guidance text telling a reader what to write, and two fixtures demonstrating a bare mute.
  // That is this estate's most repeated defect — a guard firing on its own documentation.
  const { status, out } = runCheck(REPO)
  assert.equal(status, 0, out)
})

/* ------------------------------- the report never leaks a value ------------------------------ */

test('no matched value is ever printed, and equal values are still correlatable by digest', () => {
  const { out } = runCheck(join(FIXTURES, 'positives'))

  // These literals are in the fixtures the run above just matched. Each is asserted PRESENT in the
  // source first, so that this test cannot pass by checking for strings that no longer exist.
  const sources = ['shapes.sh', 'shapes.mjs', 'compose.yml', 'muted.sh']
    .map((f) => readFileSync(join(FIXTURES, 'positives', f), 'utf8'))
    .join('\n')
  const values = [
    'correct-horse-battery-staple-42',
    'a-literal-standing-in-for-a-secret',
    'a-literal-hidden-behind-a-mute',
    'cfk_live_aaaaaaaaaaaaaaaaaaaa',
    'an-inline-literal-secret',
  ]
  for (const v of values) {
    assert.ok(sources.includes(v), `the fixture no longer contains ${v} — this test is checking nothing`)
    assert.ok(!out.includes(v), 'a matched value reached the output; this step reports digests only')
  }

  // The digest is what makes a withheld value useful: two findings that share one show an operator
  // that one rotation covers both. Three of these fixtures hold the same published password.
  const d = digests(out)
  const repeated = d.filter((x, i) => d.indexOf(x) !== i)
  assert.ok(repeated.length > 0, 'identical values must produce identical digests')
  assert.ok(
    d.every((x) => /^[0-9a-f]{12}$/.test(x)),
    'a digest must be truncated, not a full hash',
  )
})

/* ---------------------------------- the mechanism, and mutation ------------------------------ */

describe('the allow marker is a decision, not a mute', () => {
  test('a marker with a reason exempts the line; a marker without one does not', () => {
    const dir = mkdtempSync(join(SCRATCH, 'marker-'))
    const line = 'GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-local-dev-only}\n'

    writeFileSync(join(dir, 'bare.sh'), `# secret-hygiene: allow\n${line}`)
    const bare = runCheck(dir)
    assert.equal(bare.status, 1)
    assert.deepEqual(shapes(bare.out), [
      'bare.sh:1 allow-without-reason',
      'bare.sh:2 shell-default GRAFANA_ADMIN_PASSWORD',
    ])

    // Forty characters is the floor the scope-exemption file service-ci.yml reads already applies
    // to the same kind of decision, so the estate has one answer to "how much writing is a
    // decision" rather than two.
    writeFileSync(join(dir, 'bare.sh'), '')
    const reason = 'the operator plane is bound to 127.0.0.1 in every environment'
    assert.ok(reason.length >= 40)
    writeFileSync(join(dir, 'reasoned.sh'), `# secret-hygiene: allow ${reason}\n${line}`)
    const ok = runCheck(dir)
    assert.equal(ok.status, 0, ok.out)
  })

  test('a short reason is refused, so the marker cannot decay into a paste', () => {
    const dir = mkdtempSync(join(SCRATCH, 'short-'))
    writeFileSync(
      join(dir, 'short.sh'),
      '# secret-hygiene: allow legacy\nLEGACY_TOKEN=${LEGACY_TOKEN:-a-literal-token-value}\n',
    )
    const { status, out } = runCheck(dir)
    assert.equal(status, 1)
    assert.deepEqual(shapes(out), ['short.sh:1 allow-without-reason', 'short.sh:2 shell-default LEGACY_TOKEN'])
  })
})

test('MUTATION: the defect injected into a passing fixture turns it red, and the file really changed', () => {
  // A checker that cannot be made to fail proves nothing, and this estate has shipped a canary
  // that graded an unchanged file. The mutation is the exact line from micro-org #276.
  const dir = mkdtempSync(join(SCRATCH, 'mutation-'))
  cpSync(join(FIXTURES, 'negatives'), dir, { recursive: true })
  const target = join(dir, 'exemptions.sh')
  const original = readFileSync(target, 'utf8')

  assert.equal(runCheck(dir).status, 0, 'the fixture must be green before it is mutated')

  writeFileSync(target, original + 'ADMIN_PASSWORD=${ADMIN_PASSWORD:-correct-horse-battery-staple-42}\n')
  assert.notEqual(readFileSync(target, 'utf8'), original, 'the mutation must actually change the file')

  const mutated = runCheck(dir)
  assert.equal(mutated.status, 1, 'the injected credential default must turn the check red')
  assert.deepEqual(shapes(mutated.out), [
    `exemptions.sh:${original.split('\n').length} shell-default ADMIN_PASSWORD`,
  ])

  writeFileSync(target, original)
  assert.equal(readFileSync(target, 'utf8'), original, 'the restore must be byte-identical')
  assert.equal(runCheck(dir).status, 0, 'and green again afterwards')
})

/* ------------------------------------- shape of the step ------------------------------------- */

test('a repository with nothing to scan passes rather than hanging', () => {
  // `xargs` handed an empty file list runs `awk` once with NO file arguments, and `awk` with no
  // file arguments reads stdin — so an empty repository would hang the job rather than pass it.
  // `-r` fixes that on GNU and not on BSD, where this also runs, so the step tests the list
  // instead. This is the same class of defect as the `|| true` rule in this file's header, in a
  // third shape, and it is only ever caught by running the step, never by reading it.
  const dir = mkdtempSync(join(SCRATCH, 'empty-'))
  mkdirSync(join(dir, 'docs'))
  writeFileSync(join(dir, 'docs', 'README.md'), '# nothing scannable here\n')
  const { status, out } = runCheck(dir)
  assert.equal(status, 0)
  assert.match(out, /^ok: no shell or JavaScript sources to scan$/m)
})

test('the step captures without letting a no-match abort it, like every other step in the file', () => {
  // The rule the whole workflow is built on: `grep`, `find` and `awk` exit non-zero when they have
  // nothing to say, GitHub runs each block under `bash -e`, and the verdict must be an `if`.
  //
  // A capture is judged as a LOGICAL line, joined across backslash continuations, for the same
  // reason `workflow-shell.test.ts` does it: this step's own capture spends three physical lines
  // getting to its `|| true`, and a line-at-a-time reader would call correct code broken.
  const body = extractStep(STEP)
  const logical: string[] = []
  for (const raw of body.split('\n')) {
    const previous = logical[logical.length - 1]
    if (previous !== undefined && /\\\s*$/.test(previous)) logical[logical.length - 1] = previous.replace(/\\\s*$/, ' ') + raw.trim()
    else logical.push(raw)
  }
  //
  // Only SEARCHING captures are graded, which is the same line `workflow-shell.test.ts` draws.
  // `grep`, `find`, `xargs` and `awk` all exit non-zero to mean "nothing to report", and that is
  // the direction that must never be allowed to end a step. `mktemp` and a hashing pipeline exit
  // non-zero to mean "I failed", and swallowing that would be the opposite mistake.
  const searching = /\b(grep|git grep|ls-files|find|xargs|awk)\b/
  const captures = logical.filter((l) => /^\s*[a-z_]+=\$\(/.test(l) && searching.test(l))
  assert.ok(captures.length > 0, 'the step must still capture something searchable')
  for (const c of captures) {
    assert.match(c, /\|\|\s*true/, `a capture that can exit non-zero must not abort the step: ${c.trim()}`)
  }
  assert.match(body, /^\s*set -uo pipefail\s*$/m, 'and it must not run under -e itself')
})
