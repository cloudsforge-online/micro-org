/**
 * The shared comment-aware guard, and every guard in this repository that now uses it.
 *
 * ## Why this file is shaped the way it is
 *
 * micro-org#303: seven CI guards in this estate have gone red on the comment explaining the rule
 * they enforce. Each was repaired locally — an inline `awk`, or a `grep -v` on lines that begin
 * with a comment marker — and nothing was generalised, so the eighth was only a matter of who
 * wrote the next comment. `.github/actions/source-scan` is the one implementation; this file is
 * the evidence that converting to it did not cost the guards their teeth.
 *
 * **A guard that stops being able to fail is worse than the bug it was hiding.** That is the whole
 * reason the table below exists. Every converted guard is exercised in BOTH directions against the
 * configuration read out of the workflow file itself:
 *
 *   * a GREEN fixture — the rule written down in prose, in every comment shape this estate uses —
 *     which must pass, and
 *   * a RED fixture — the real violation — which must fail, and must name the file it is in.
 *
 * A guard added to a workflow with no row here fails the completeness test at the bottom rather
 * than being quietly untested, because an unexercised guard is how the estate ended up with checks
 * that had never passed anywhere (micro-org#38).
 */
import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  blankComments,
  scanText,
  run,
  syntaxFor,
  DEFAULT_EXTENSIONS,
} from '../.github/actions/source-scan/source-scan.mjs'

const WORKFLOWS = fileURLToPath(new URL('../.github/workflows/', import.meta.url))

/* ===================================================================== the stripper == */

describe('comment text is blanked, and nothing else is', () => {
  it('keeps every byte and every line, so a reported line number is a real one', () => {
    const src = 'const a = 1\n// setInterval(x)\nconst b = 2\n'
    const out = blankComments(src)
    assert.equal(out.length, src.length)
    assert.equal(out.split('\n').length, src.split('\n').length)
    assert.equal(out.split('\n')[1], ' '.repeat('// setInterval(x)'.length))
  })

  it('a line that is entirely prose is allowed through — in all four shapes the estate writes', () => {
    // These four are the shapes that actually appear in this estate's source. The line-prefix
    // filter seven repairs used handles the first two and misses the last two.
    const shapes = [
      '// never call setInterval(fn) here',
      '  // indented: never call setInterval(fn) here',
      '/**\n * Rule 8 forbids setInterval(fn) in domain code.\n */',
      '/*\nsetInterval(fn) is forbidden — no leading asterisk on this line.\n*/',
    ]
    for (const shape of shapes) {
      assert.deepEqual(
        scanText(shape, { file: 'a.ts', pattern: /setInterval\s*\(/ }),
        [],
        `prose must not fail the build:\n${shape}`,
      )
    }
  })

  it('CODE ON A LINE THAT ALSO CARRIES A COMMENT IS STILL CODE', () => {
    // The distinction the whole mechanism turns on, and the half the previous repairs got wrong in
    // the dangerous direction: a trailing comment must not become an escape hatch.
    const hits = scanText('setInterval(sweep, 1000) // sweeps the claim table\n', {
      file: 'a.ts',
      pattern: /setInterval\s*\(/,
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.line, 1)
    assert.equal(hits[0]?.column, 1)
  })

  it('and a trailing comment that merely MENTIONS the construct is not code', () => {
    assert.deepEqual(
      scanText('stop(timer)  // never call setInterval(fn) here\n', {
        file: 'a.ts',
        pattern: /setInterval\s*\(/,
      }),
      [],
    )
  })

  it('a block comment that never closes swallows the rest of the file, and nothing more', () => {
    const out = blankComments('const a = 1\n/* setInterval(x)\nsetInterval(y)\n')
    assert.match(out, /^const a = 1\n/)
    assert.doesNotMatch(out, /setInterval/)
  })
})

describe('the stripper is string-aware, which is where the previous one silently failed', () => {
  /**
   * THE REGRESSION THAT MATTERS MOST. service-ci.yml's rule 1 stripped comments with an `awk` that
   * truncated each line at the first `//` it saw, with no idea what a string is. So this line —
   *
   *     connect('https://ledger.internal', process.env.CUSTODY_DATABASE_URL)
   *
   * — was cut at the slashes in the URL, the foreign database variable after it disappeared, and
   * the guard passed. That is the failure mode the issue calls out as worse than the bug: a guard
   * that strips too eagerly has quietly stopped working and looks green forever.
   */
  const naiveAwk = (line: string) => {
    const i = line.indexOf('//')
    return i === -1 ? line : line.slice(0, i)
  }
  const line = "connect('https://ledger.internal', process.env.CUSTODY_DATABASE_URL)\n"
  const foreign = /\b[A-Z][A-Z0-9_]*_(DATABASE_URL|DB_URL|POSTGRES_URL)\b/

  it('the old stripper really did lose the violation — this is the defect, reproduced', () => {
    assert.doesNotMatch(naiveAwk(line), foreign, 'if this passes, the regression is not reproduced')
  })

  it('the shared stripper keeps it, so the guard still has teeth', () => {
    const hits = scanText(line, { file: 'a.ts', pattern: foreign })
    assert.deepEqual(
      hits.map((h) => h.match),
      ['CUSTODY_DATABASE_URL'],
    )
  })

  it('a bare URL outside a string does not open a comment either', () => {
    // JSX and Markdown-ish prose in `.tsx` is not quoted, so `://` is special-cased. Without it,
    // the analytics guard would go blind on every line holding a bare link.
    const hits = scanText('<p>see https://x — and mixpanel is still forbidden</p>\n', {
      file: 'a.tsx',
      pattern: /mixpanel/,
    })
    assert.equal(hits.length, 1)
  })

  it('a regex literal containing an escaped slash is not a comment', () => {
    // `str.split(/\//)` holds two adjacent slashes. Read as a comment it blanks the rest of the
    // line, which is a guard going quietly blind.
    const hits = scanText('const parts = str.split(/\\//) && setInterval(fn)\n', {
      file: 'a.ts',
      pattern: /setInterval\s*\(/,
    })
    assert.equal(hits.length, 1, 'the code after a regex literal must still be scanned')
  })

  it('a division is still a division', () => {
    const hits = scanText('const half = total / 2 // setInterval(fn)\n', {
      file: 'a.ts',
      pattern: /setInterval\s*\(/,
    })
    assert.deepEqual(hits, [])
  })

  it('an apostrophe in prose does not swallow the rest of the file', () => {
    // An unterminated quote is the other way a stripper goes silently blind. It stops at the line.
    const hits = scanText("// the ledger's own\nsetInterval(fn)\n", {
      file: 'a.ts',
      pattern: /setInterval\s*\(/,
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.line, 2)
  })

  it('a template literal is a string', () => {
    const hits = scanText('const u = `https://x/${id}` \nconst dsn = CUSTODY_DATABASE_URL\n', {
      file: 'a.ts',
      pattern: /\b[A-Z][A-Z0-9_]*_DATABASE_URL\b/,
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.line, 2)
  })
})

describe('strings are kept by default, and blanked only on request', () => {
  it('by default the string IS the violation — a hostname, a DSN, a script src', () => {
    const hits = scanText('const dsn = "postgres://ledger:pw@db/ledger"\n', {
      file: 'a.ts',
      pattern: /(postgres|mysql):\/\/[a-zA-Z0-9_]+:/,
    })
    assert.equal(hits.length, 1, 'blanking strings by default would disarm half the estate')
  })

  it('ignore-strings blanks the body and keeps the delimiters', () => {
    // For an identifier rule that must not fire on a UI label — the shape of the
    // onBehalfOf/actAs/impersonat guards deployed in five web repositories.
    const src = 'const label = "we never impersonate a user"\nimpersonateUser(id)\n'
    assert.equal(scanText(src, { file: 'a.ts', pattern: /impersonat/ }).length, 2)
    const strict = scanText(src, { file: 'a.ts', pattern: /impersonat/, ignoreStrings: true })
    assert.equal(strict.length, 1)
    assert.equal(strict[0]?.line, 2)
  })
})

describe('markup', () => {
  it('an HTML comment is a comment', () => {
    assert.deepEqual(
      scanText('<!-- deliberately no googletagmanager tag: AD-21 -->\n', {
        file: 'index.html',
        pattern: /googletagmanager/,
      }),
      [],
    )
  })

  it('a script tag is not', () => {
    const hits = scanText('<script src="https://www.googletagmanager.com/gtag/js"></script>\n', {
      file: 'index.html',
      pattern: /googletagmanager/,
    })
    assert.equal(hits.length, 1)
  })

  it('the syntax is chosen by extension, and an unknown extension is treated as JavaScript', () => {
    assert.equal(syntaxFor('src/a.ts'), 'js')
    assert.equal(syntaxFor('index.html'), 'html')
    assert.equal(syntaxFor('App.vue'), 'both')
    assert.equal(syntaxFor('docker-compose.yml'), 'hash')
    assert.equal(syntaxFor('deploy/Dockerfile'), 'hash')
    assert.equal(syntaxFor('weird.qqq'), 'js')
  })
})

describe('compose files, Dockerfiles and shell — where a comment starts with #', () => {
  it("a `#` after whitespace opens a comment, which is YAML's rule and the shell's", () => {
    assert.deepEqual(
      scanText('# never use env_file: .env — rule 9\nservices:\n', {
        file: 'compose.yml',
        pattern: /env_file:[ \t]*\.?\/?\.env[ \t]*$/m,
      }),
      [],
    )
  })

  it('and the declaration itself is still caught', () => {
    const hits = scanText('services:\n  api:\n    env_file: .env\n', {
      file: 'compose.yml',
      pattern: /env_file:[ \t]*\.?\/?\.env[ \t]*$/m,
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.line, 3)
  })

  it('a `#` that is not after whitespace is not a comment — an image tag, a shell expansion', () => {
    const hits = scanText('image: ghcr.io/x/api#sha256-deadbeef\n', {
      file: 'compose.yml',
      pattern: /sha256-deadbeef/,
    })
    assert.equal(hits.length, 1, 'blanking from every # would blank half of every compose file')
  })
})

describe('the exemptions', () => {
  it('allow-line reads the ORIGINAL line, because the marker is written in a comment', () => {
    // Reading the blanked line would delete every `cfctl-allow` in the estate at a stroke, and the
    // guards would go from noisy to wrong without anyone noticing.
    assert.deepEqual(
      scanText('setInterval(flush, 5000) // cfctl-allow setInterval: metrics only\n', {
        file: 'a.ts',
        pattern: /setInterval\s*\(/,
        allowLine: /cfctl-allow setInterval/,
      }),
      [],
    )
  })

  it('an unmarked call beside a marked one is still caught', () => {
    const hits = scanText(
      'setInterval(flush, 5000) // cfctl-allow setInterval\nsetInterval(sweep, 1000)\n',
      { file: 'a.ts', pattern: /setInterval\s*\(/, allowLine: /cfctl-allow setInterval/ },
    )
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.line, 2)
  })

  it('allow-match reads the matched text, which is how a rule says "any of these but mine"', () => {
    const hits = scanText(
      'const a = LEDGER_DATABASE_URL\nconst b = LEDGER_TEST_DATABASE_URL\nconst c = CUSTODY_DATABASE_URL\n',
      {
        file: 'a.ts',
        pattern: /\b[A-Z][A-Z0-9_]*_(DATABASE_URL|DB_URL|POSTGRES_URL)\b/,
        allowMatch: /^LEDGER_(TEST_)?(DATABASE_URL|DB_URL|POSTGRES_URL)$/,
      },
    )
    assert.deepEqual(
      hits.map((h) => h.match),
      ['CUSTODY_DATABASE_URL'],
    )
  })

  it('the word boundary stops LEDGER_DATABASE_URL matching as EDGER_DATABASE_URL', () => {
    // Without \b the engine finds a second, shorter match starting one character in, the allow-list
    // does not recognise it, and every service fails rule 1 on its own variable.
    assert.deepEqual(
      scanText('process.env.LEDGER_DATABASE_URL\n', {
        file: 'a.ts',
        pattern: /\b[A-Z][A-Z0-9_]*_(DATABASE_URL|DB_URL|POSTGRES_URL)\b/,
        allowMatch: /^LEDGER_(TEST_)?(DATABASE_URL|DB_URL|POSTGRES_URL)$/,
      }),
      [],
    )
  })
})

/* ============================================================== the action entry == */

const ROOT = mkdtempSync(join(tmpdir(), 'source-scan-'))

/** Write a fixture tree and return its root. */
function tree(name: string, files: Record<string, string>): string {
  const root = join(ROOT, name)
  rmSync(root, { recursive: true, force: true })
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  mkdirSync(root, { recursive: true })
  return root
}

/**
 * The action, run exactly as GitHub runs it: inputs in the environment, output on stdout.
 *
 * **`INPUT_ALLOW-MATCH`, NOT `INPUT_ALLOW_MATCH`.** This helper used to replace the hyphen, which
 * is not what GitHub does — it upper-cases and replaces SPACES only — and the production code had
 * the same replacement, so eight hundred lines of tests agreed with the runtime about an encoding
 * neither of them would ever meet. Every hyphenated input was dead in CI and green here. If this
 * line is ever "tidied" back, `every hyphenated input in action.yml is readable` below fails.
 */
function act(root: string, inputs: Record<string, string>): { code: number; out: string } {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ 'working-directory': root, ...inputs })) {
    env[`INPUT_${key.toUpperCase()}`] = value
  }
  let out = ''
  const code = run(env, (s) => {
    out += s
  })
  return { code, out }
}

describe('the action entry point', () => {
  it('passes cleanly and says how much it looked at', () => {
    const root = tree('clean', { 'src/a.ts': 'const a = 1\n' })
    const { code, out } = act(root, { pattern: 'setInterval\\s*\\(', ok: 'ok: no unmarked setInterval' })
    assert.equal(code, 0)
    assert.match(out, /ok: no unmarked setInterval — 1 files scanned/)
  })

  it('fails with a file-anchored annotation, so the hit is clickable in the diff', () => {
    const root = tree('dirty', { 'src/a.ts': 'setInterval(sweep, 1000)\n' })
    const { code, out } = act(root, { pattern: 'setInterval\\s*\\(', title: 'a background timer' })
    assert.equal(code, 1)
    assert.match(out, /::error file=src\/a\.ts,line=1,col=1::a background timer: setInterval\(/)
  })

  it('a pattern that is empty is an ERROR, not a pass', () => {
    // The other half of micro-org#38: a guard that cannot fail is not a guard. An input that has
    // gone missing must be loud rather than green.
    const root = tree('nopattern', { 'src/a.ts': 'setInterval(x)\n' })
    const { code, out } = act(root, { pattern: '' })
    assert.equal(code, 2)
    assert.match(out, /could not have failed/)
  })

  it('a path that does not exist is an ERROR, not a pass', () => {
    const root = tree('nosrc', { 'README.md': 'x\n' })
    const { code, out } = act(root, { pattern: 'setInterval\\s*\\(' })
    assert.equal(code, 1)
    assert.match(out, /nothing to scan/)
  })

  it('unless the guard declares the path optional, and then it says so out loud', () => {
    const root = tree('nosrc-ok', { 'README.md': 'x\n' })
    const { code, out } = act(root, { pattern: 'setInterval\\s*\\(', 'missing-path': 'ok' })
    assert.equal(code, 0)
    assert.match(out, /declared optional/)
  })

  it('excluded files are not read, and the exclusion is a path regex', () => {
    const root = tree('excl', {
      'src/a.test.ts': 'setInterval(x)\n',
      'src/a.ts': 'const a = 1\n',
    })
    assert.equal(
      act(root, { pattern: 'setInterval\\s*\\(', 'exclude-files': '\\.(test|spec)\\.' }).code,
      0,
    )
    assert.equal(act(root, { pattern: 'setInterval\\s*\\(' }).code, 1)
  })

  it('node_modules and dist are never source', () => {
    const root = tree('skip', {
      'src/node_modules/x/i.js': 'setInterval(x)\n',
      'src/dist/i.js': 'setInterval(x)\n',
      'src/a.ts': 'const a = 1\n',
    })
    assert.equal(act(root, { pattern: 'setInterval\\s*\\(' }).code, 0)
  })

  it('only the declared extensions are read', () => {
    const root = tree('ext', { 'src/a.md': 'setInterval(x)\n', 'src/a.ts': 'const a = 1\n' })
    assert.equal(act(root, { pattern: 'setInterval\\s*\\(' }).code, 0)
    assert.equal(act(root, { pattern: 'setInterval\\s*\\(', extensions: 'ts,md' }).code, 1)
    assert.deepEqual(DEFAULT_EXTENSIONS.includes('md'), false)
  })
})

/* ============================================ the guards, read out of the workflows == */

/**
 * A `with:` block, read from the workflow. Deliberately not a general YAML parser: it handles the
 * scalar forms these files use and nothing else, and `the reader agrees with a real YAML parser`
 * below pins it against hand-written expectations so a parser that quietly returns the wrong
 * pattern cannot leave every test in this file green.
 */
export function stepsUsing(yaml: string, action: string): { name: string; with: Record<string, string> }[] {
  const lines = yaml.split('\n')
  const steps: { name: string; with: Record<string, string> }[] = []
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)-\s+name:\s*(.+?)\s*$/.exec(lines[i] ?? '')
    if (!start) continue
    const indent = (start[1] ?? '').length
    const body: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      const line = lines[j] ?? ''
      if (line.trim() === '') continue
      const lead = line.length - line.trimStart().length
      if (lead <= indent) break
      body.push(line)
    }
    i = j - 1
    const joined = body.join('\n')
    if (!new RegExp(`uses:\\s*\\S*${action}`).test(joined)) continue
    steps.push({ name: unquote(start[2] ?? ''), with: withBlock(body) })
  }
  return steps
}

function unquote(raw: string): string {
  const value = raw.trim()
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value
      .slice(1, -1)
      .replace(/\\(["\\/])/g, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  }
  return value
}

function withBlock(body: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const at = body.findIndex((l) => /^\s*with:\s*$/.test(l))
  if (at === -1) return out
  const keyIndent = (() => {
    const first = body[at + 1] ?? ''
    return first.length - first.trimStart().length
  })()
  for (let i = at + 1; i < body.length; i++) {
    const line = body[i] ?? ''
    const lead = line.length - line.trimStart().length
    if (lead < keyIndent) break
    const kv = /^\s*([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line)
    if (!kv || lead !== keyIndent) continue
    const key = kv[1] ?? ''
    const raw = kv[2] ?? ''
    if (raw === '|' || raw === '|-') {
      const block: string[] = []
      let j = i + 1
      for (; j < body.length; j++) {
        const next = body[j] ?? ''
        if (next.trim() !== '' && next.length - next.trimStart().length <= keyIndent) break
        block.push(next)
      }
      const dedent = Math.min(
        ...block.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length),
      )
      out[key] = block.map((l) => l.slice(dedent)).join('\n') + (raw === '|' ? '\n' : '')
      i = j - 1
      continue
    }
    out[key] = unquote(raw)
  }
  return out
}

/** Every `${{ … }}` a guard's inputs carry, resolved for a fixture run. */
function resolve(inputs: Record<string, string>, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(inputs)) {
    const filled = raw.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
      const value = values[expr]
      assert.ok(value !== undefined, `the fixture must say what ${expr} is`)
      return value
    })
    assert.doesNotMatch(filled, /\$\{\{/, `unresolved expression in ${key}`)
    out[key] = filled
  }
  return out
}

type Guard = {
  /** The workflow it lives in. */
  file: string
  /** Every `${{ … }}` the step's inputs use, and the value a fixture run gives it. */
  values: Record<string, string>
  /** The pattern as written in the workflow. Drift here fails loudly rather than silently. */
  pattern: string
  /** Correct code, with the rule written down in prose. Must PASS. */
  green: Record<string, string>
  /** The thing the guard exists to catch. Must FAIL, and must name this file. */
  red: Record<string, string>
  /** The file the red fixture's violation is in. */
  redFile: string
}

const SERVICE_VALUES = {
  'inputs.source-dir': 'src',
  'inputs.service': 'ledger',
  'steps.dbvar.outputs.prefix': 'LEDGER',
  'steps.dbvar.outputs.want': 'LEDGER_DATABASE_URL',
}

/**
 * Every guard in this repository that reads source, with the prose that must not fail it and the
 * violation that must. The prose is not invented: each green fixture is written the way the rule
 * WOULD be documented, because that is the artefact micro-org#303 is about protecting.
 */
const GUARDS: Record<string, Guard> = {
  'One database, and only its own': {
    file: 'service-ci.yml',
    values: SERVICE_VALUES,
    pattern: '\\b[A-Z][A-Z0-9_]*_(DATABASE_URL|DB_URL|POSTGRES_URL)\\b',
    green: {
      'src/db.ts':
        '/**\n' +
        ' * This service never reads CUSTODY_DATABASE_URL. Custody balances arrive over HTTP,\n' +
        ' * typed by @cloudsforge/contracts-money — rule 1.\n' +
        ' */\n' +
        'const dsn = process.env.LEDGER_DATABASE_URL ?? process.env.LEDGER_TEST_DATABASE_URL\n' +
        "const probe = 'https://ledger.internal/livez' // and not CUSTODY_DATABASE_URL either\n" +
        'export { dsn, probe }\n',
      // A test is where naming a foreign variable is the point: micro-market's proves it is ignored.
      'src/db.test.ts': "const foreign = process.env.CUSTODY_DATABASE_URL\n",
    },
    red: {
      // AFTER a URL on the same line, deliberately: the `awk` this replaced cut the line at the
      // slashes in `https://` and never saw the variable.
      'src/db.ts': "connect('https://ledger.internal', process.env.CUSTODY_DATABASE_URL)\n",
    },
    redFile: 'src/db.ts',
  },

  'No connection string written into the source': {
    file: 'service-ci.yml',
    values: SERVICE_VALUES,
    pattern: '(postgres|postgresql|mysql)://[a-zA-Z0-9_]+:',
    green: {
      'src/env.ts':
        '// LEDGER_DATABASE_URL looks like postgres://ledger:secret@db:5432/ledger in development.\n' +
        '// It is read from the environment and never written here.\n' +
        'export const dsn = process.env.LEDGER_DATABASE_URL\n',
      'src/testsupport.ts': "export const TEST_DSN = 'postgres://ledger:ledger@127.0.0.1:5432/ledger_test'\n",
    },
    red: { 'src/env.ts': "export const dsn = 'postgres://ledger:hunter2@db.internal:5432/ledger'\n" },
    redFile: 'src/env.ts',
  },

  'No import escapes this repository': {
    file: 'service-ci.yml',
    values: SERVICE_VALUES,
    pattern: "from '(\\.\\./){3,}",
    green: {
      'src/a.ts':
        "// Never write: from '../../../custody/src/keys' — that import leaves this repository\n" +
        "// and compiles on exactly one machine. Use a package in micro-runtime, or duplicate.\n" +
        "import { keys } from '../keys.ts'\n" +
        'export { keys }\n',
    },
    red: { 'src/a.ts': "import { keys } from '../../../custody/src/keys.ts'\n" },
    redFile: 'src/a.ts',
  },

  "No import reaches into another repository's checkout": {
    file: 'service-ci.yml',
    values: SERVICE_VALUES,
    pattern: "from '[^']*(repos|micro)/[a-z0-9-]+/(src|services|packages)",
    green: {
      'src/a.ts':
        "/* An import spelled from '../micro/custody/src/keys' names a sibling checkout and is\n" +
        '   forbidden for the same reason as the one above. */\n' +
        "import { keys } from './keys.ts'\n" +
        'export { keys }\n',
    },
    red: { 'src/a.ts': "import { keys } from '../micro/custody/src/keys.ts'\n" },
    redFile: 'src/a.ts',
  },

  'Only published contract and runtime packages': {
    file: 'service-ci.yml',
    values: SERVICE_VALUES,
    pattern: "['\"]@cloudsforge/[a-z0-9-]+['\"]",
    green: {
      'src/a.ts':
        "// Never import '@cloudsforge/custody-internals'. A cross-service import wearing a\n" +
        '// package name is still a cross-service import.\n' +
        "import { Money } from '@cloudsforge/contracts-money'\n" +
        "import { logger } from '@cloudsforge/telemetry'\n" +
        'export { Money, logger }\n',
    },
    red: { 'src/a.ts': "import { keys } from '@cloudsforge/custody-internals'\n" },
    redFile: 'src/a.ts',
  },

  'No setInterval doing domain work': {
    file: 'service-ci.yml',
    values: SERVICE_VALUES,
    pattern: 'setInterval\\s*\\(',
    green: {
      'src/jobs.ts':
        '/*\n' +
        'Rule 8: setInterval(fn) doing domain work is correct with one replica and wrong with two.\n' +
        'No leading asterisk on this line, on purpose — the line-prefix filter this replaced would\n' +
        'have failed the build here.\n' +
        '*/\n' +
        'export function claim() {} // and never setInterval(claim) — take a lease instead\n' +
        'setInterval(flushMetrics, 5000) // cfctl-allow setInterval: metrics only, no domain work\n',
      'src/jobs.test.ts': 'setInterval(() => {}, 1)\n',
    },
    red: { 'src/jobs.ts': 'setInterval(() => claimWithdrawals(), 1000) // every second\n' },
    redFile: 'src/jobs.ts',
  },

  'No env_file fan-out': {
    file: 'service-ci.yml',
    values: SERVICE_VALUES,
    pattern: 'env_file:[ \\t]*\\.?/?\\.env[ \\t]*$|^[ \\t]*-[ \\t]*\\.?/?\\.env[ \\t]*$',
    green: {
      'compose.yml':
        '# Rule 9: never write `env_file: .env` here, and never list\n' +
        '#   - .env\n' +
        '# under one. Every container would receive every secret in the file.\n' +
        'services:\n' +
        '  ledger:\n' +
        '    env_file: .env.ledger\n' +
        '    environment:\n' +
        '      - LEDGER_DATABASE_URL\n',
      // Not a compose file, so not this guard's business even though it matches.
      'k8s/deployment.yaml': '    env_file: .env\n',
    },
    red: { 'docker-compose.yml': 'services:\n  ledger:\n    env_file: .env\n' },
    redFile: 'docker-compose.yml',
  },

  'Nothing reads import.meta.env.VITE_*': {
    file: 'web-ci.yml',
    values: { 'inputs.app': 'hub-web' },
    pattern: 'import\\.meta\\.env\\.VITE_[A-Z0-9_]+',
    green: {
      'src/hosts.ts':
        '// Never read import.meta.env.VITE_API_URL. Vite inlines it at build time, so the bundle\n' +
        '// carries its environment and one image stops serving every environment.\n' +
        'export const api = () => `${window.location.protocol}//api.${window.location.host}`\n',
      'index.html': '<!-- import.meta.env.VITE_API_URL is deliberately not used here -->\n<div id="root"></div>\n',
      'README.md': 'Do not use import.meta.env.VITE_API_URL.\n',
    },
    red: { 'src/hosts.ts': 'export const api = import.meta.env.VITE_API_URL\n' },
    redFile: 'src/hosts.ts',
  },

  'No third-party analytics tag': {
    file: 'web-ci.yml',
    values: { 'inputs.app': 'hub-web' },
    pattern: 'googletagmanager|google-analytics\\.com|gtag\\(|segment\\.(com|io)/analytics|hotjar|mixpanel',
    green: {
      'index.html': '<!-- Deliberately no googletagmanager tag and no gtag( call: AD-21. -->\n<div id="root"></div>\n',
      'src/telemetry.ts':
        '// Product analytics is micro-analytics, fed by the event bus — never mixpanel, hotjar\n' +
        '// or a gtag( shim. AD-21.\n' +
        'export const track = (name: string) => fetch(`/api/events/${name}`)\n',
    },
    red: {
      'index.html': '<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>\n',
    },
    redFile: 'index.html',
  },
}

describe('every converted guard still catches what it exists to catch', () => {
  for (const [name, guard] of Object.entries(GUARDS)) {
    const yaml = readFileSync(WORKFLOWS + guard.file, 'utf8')
    const step = stepsUsing(yaml, 'source-scan').find((s) => s.name === name)

    it(`${name} — is declared in ${guard.file} with the pattern asserted here`, () => {
      // If the workflow is edited without editing this file, the fixtures below go on passing
      // while testing a pattern nobody ships. This is the line that stops that.
      assert.ok(step, `no step named "${name}" uses the source-scan action in ${guard.file}`)
      assert.equal(step.with['pattern'], guard.pattern)
      assert.ok((step.with['title'] ?? '') !== '', 'a guard must say what it found')
      assert.ok((step.with['ok'] ?? '') !== '', 'and what it checked when it passes')
    })

    it(`${name} — is GREEN on correct code that documents the rule`, () => {
      assert.ok(step)
      const { code, out } = act(tree(`green-${name}`, guard.green), resolve(step.with, guard.values))
      assert.equal(code, 0, `the rule written down in prose must not fail the build:\n${out}`)
    })

    it(`${name} — is RED on the real violation, and names the file`, () => {
      assert.ok(step)
      const { code, out } = act(tree(`red-${name}`, guard.red), resolve(step.with, guard.values))
      assert.equal(code, 1, `MUTATION: this guard has stopped being able to fail\n${out}`)
      assert.match(out, new RegExp(`::error file=${guard.redFile.replace(/[.]/g, '\\.')},line=`))
    })
  }
})

describe('the set of guards is complete, so a new one cannot arrive untested', () => {
  it('every source-scan step in every workflow here has a row above', () => {
    const declared: string[] = []
    for (const file of ['service-ci.yml', 'web-ci.yml', 'ci.yml', 'estate-ci.yml', 'secret-hygiene.yml', 'contract-compat.yml', 'publish.yml', 'publish-image.yml']) {
      for (const step of stepsUsing(readFileSync(WORKFLOWS + file, 'utf8'), 'source-scan')) {
        declared.push(step.name)
      }
    }
    assert.deepEqual(
      declared.filter((n) => GUARDS[n] === undefined),
      [],
      'a guard with no red/green fixture is a guard nobody has proved can fail',
    )
    assert.deepEqual(
      Object.keys(GUARDS).filter((n) => !declared.includes(n)),
      [],
      'this table claims a guard the workflows no longer declare',
    )
  })

  it('the reader agrees with a real YAML parser on the shapes these files use', () => {
    // The parser above is hand-rolled, so it is pinned against values written out by hand. A
    // parser that silently returned the wrong pattern would leave every fixture green.
    const sample = [
      '      - name: A guard',
      '        uses: cloudsforge-online/micro-org/.github/actions/source-scan@main',
      '        with:',
      "          pattern: 'a''b'",
      '          allow-match: "x\\\\y\\""',
      '          plain: from tests',
      '          guidance: |',
      '            one',
      '              two',
      '      - name: Another',
      '        run: echo hi',
    ].join('\n')
    const [step, ...rest] = stepsUsing(sample, 'source-scan')
    assert.equal(rest.length, 0, 'a step that does not use the action must not be collected')
    assert.equal(step?.name, 'A guard')
    assert.equal(step?.with['pattern'], "a'b")
    assert.equal(step?.with['allow-match'], 'x\\y"')
    assert.equal(step?.with['plain'], 'from tests')
    assert.equal(step?.with['guidance'], 'one\n  two\n')
  })
})

/* ============================================== what must NOT adopt comment blanking == */

test('secret-hygiene does not blank comments, and that is a decision', () => {
  // A credential written in a comment is still a credential in a public repository, still in
  // somebody's mirror, and still only fixable by rotating it. This guard reads EVERY byte on
  // purpose, and a sweep that converts the estate's greps to source-scan must not convert it.
  const hygiene = readFileSync(WORKFLOWS + 'secret-hygiene.yml', 'utf8')
  assert.doesNotMatch(hygiene, /source-scan/)
  assert.match(hygiene, /BEGIN \(RSA \|EC \|OPENSSH \|PGP \)\?PRIVATE KEY/)
})

test('the two converted workflows no longer grep source themselves', () => {
  // The point of the change: not "the seventh comment was escaped" but "there is one place where
  // this is implemented". A new `grep -r` over the source directory here is the eighth occurrence
  // waiting to happen.
  // READ THROUGH THE BLANKER, because this assertion is itself a guard over source and the first
  // draft of it went red — on the workflow comment that explains which grep was removed and why.
  // Eight, in a test rather than in CI. The mechanism is the same one the workflows now use, which
  // is the shortest possible demonstration that it is the right shape.
  const service = blankComments(readFileSync(WORKFLOWS + 'service-ci.yml', 'utf8'), {
    syntax: 'hash',
  })
  const web = blankComments(readFileSync(WORKFLOWS + 'web-ci.yml', 'utf8'), { syntax: 'hash' })
  assert.doesNotMatch(service, /strip_comments\(\)/, 'the inline awk stripper is gone')
  assert.doesNotMatch(web, /git grep -nIE/, 'no guard greps the working tree')

  // One recursive grep over the source directory is left, and it is the OPPOSITE polarity: the
  // `/livez`, `/readyz`, `/metrics` check requires each route to be PRESENT. A comment cannot turn
  // it red; a comment can only make it green when it should not be, which is micro-org#38's shape
  // rather than #303's. Converting it needs a "must appear" mode this action deliberately does not
  // have yet, so it is named here rather than left to be rediscovered.
  const recursive = service.split('\n').filter((l) => /grep -r/.test(l))
  assert.deepEqual(
    recursive.filter((l) => !/grep -rqF "\$route"/.test(l)),
    [],
    'a new recursive grep over source is the eighth occurrence of #303 waiting to happen',
  )
  // And the half-fix that seven repairs used must not come back.
  assert.doesNotMatch(service, /grep -vE ':\[0-9\]\+:/, 'the line-prefix comment filter is gone')
})

/* ================================================ the encoding GitHub actually uses == */

/**
 * **Every hyphenated input in action.yml is readable when the environment is spelled the way
 * GitHub spells it.**
 *
 * This test exists because the bug it pins was invisible to eight hundred lines of tests: the
 * runtime read `INPUT_ALLOW_MATCH` and the test harness WROTE `INPUT_ALLOW_MATCH`, so they agreed
 * with each other about an encoding GitHub never produces. `@actions/core`'s `getInput` upper-cases
 * the declared name and replaces SPACES with underscores; a hyphen survives. Nine of this action's
 * fifteen inputs are hyphenated, and all nine were dead the moment it went live — `allow-match`
 * first, which made "one database, and only its own" report micro-settlement reading
 * `SETTLEMENT_DATABASE_URL` as another service's database.
 *
 * It is driven off `action.yml` rather than a list written here, so an input added tomorrow is
 * covered by having been declared. That is the property the list would not have.
 */
test('every hyphenated input in action.yml is readable the way GitHub sets it', () => {
  const yaml = readFileSync(
    fileURLToPath(new URL('../.github/actions/source-scan/action.yml', import.meta.url)),
    'utf8',
  )
  // The `inputs:` block only — `runs:` follows it and has no two-space keys.
  const block = yaml.slice(yaml.indexOf('\ninputs:'), yaml.indexOf('\nruns:'))
  const declared = [...block.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1] as string)
  assert.ok(declared.length >= 10, `expected the full input list, parsed ${declared.length}`)
  const hyphenated = declared.filter((n) => n.includes('-'))
  assert.ok(hyphenated.length > 0, 'action.yml has no hyphenated input — has it been renamed?')

  // `allow-match` is the one with observable behaviour, so it is asserted end to end rather than
  // by reading the environment back: a fixture that WOULD fail, exempted by an allow-list, must
  // pass. If the hyphen handling regresses, the exemption is not seen and this goes red.
  const root = tree('hyphen-inputs', {
    'src/env.ts': "const url = process.env['SETTLEMENT_DATABASE_URL']\n",
  })
  const env: Record<string, string> = {
    'INPUT_WORKING-DIRECTORY': root,
    INPUT_PATTERN: '\\b[A-Z][A-Z0-9_]*_(DATABASE_URL|DB_URL|POSTGRES_URL)\\b',
    'INPUT_ALLOW-MATCH': '^SETTLEMENT_(TEST_)?(DATABASE_URL|DB_URL|POSTGRES_URL)$',
    INPUT_OK: 'ok: reads its own',
  }
  let out = ''
  const code = run(env, (s) => {
    out += s
  })
  assert.equal(code, 0, `allow-match was not read; the action said:\n${out}`)
  assert.match(out, /ok: reads its own/)

  // And the same run with the exemption removed must FAIL, or the assertion above proves nothing
  // about the allow-list and only that the pattern matched nothing (micro-org#38).
  delete env['INPUT_ALLOW-MATCH']
  let unexempt = ''
  assert.equal(
    run(env, (s) => {
      unexempt += s
    }),
    1,
    'without allow-match this fixture must be a hit, or the test is vacuous',
  )
  assert.match(unexempt, /SETTLEMENT_DATABASE_URL/)

  // `working-directory` is hyphenated too and was read above — had it been dead, the scan would
  // have run against the repository root and this file's own text would be the fixture.
  assert.doesNotMatch(out, /source-scan\.test/)
})
