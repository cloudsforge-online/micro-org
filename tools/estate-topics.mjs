// estate-topics: the halves of the event bus that live in different repositories.
//
//   usage: node tools/estate-topics.mjs <estate-dir> [gaps.json]
//
// `<estate-dir>` is a directory of checkouts named WITHOUT the `micro-` prefix — the layout a
// developer already has in `cloudsforge-micro/`, and the one `.github/workflows/estate-ci.yml`
// builds on a runner. See that file's header for why an estate-wide reconciliation cannot live in
// any single repository's CI.
//
// WHAT IT READS AND WHY THAT SHAPE
//
// An emit site is DERIVED, not grepped. Every emit in this estate reaches the bus through a
// `topic:` property — `emit({ topic: 'x.y.z' })`, `topic: SETTLEMENT_OUTBOUND_FAILED`,
// `topic: TOPICS.keyIssued` — so that property is the seed, and identifiers are resolved to the
// string constants they name. A grep for topic-shaped literals cannot do this job: `billing/src/
// jobs.ts` declares `EXPIRE_KIND = 'billing.entitlement.expire'` and `policy/src/actions.ts`
// declares an action `'identity.password.reset'`. Both are topic-shaped, neither is a topic, and a
// checker that called them emits would report four services as broken on its first run and be
// switched off by its second.
//
// Anything at a `topic:` value position that cannot be resolved is FATAL rather than skipped: the
// verdicts below say "nobody emits this", and that sentence is only true if the emitted set is
// complete. Fail, do not guess.
//
// THE OTHER HALF READS RECORDS, AND USED TO READ THEM WORSE THAN IT READS EMITS.
//
// Directions 3 and 4 read structures in other repositories — consumer rule tables, and the
// `UNPRODUCED_NOTIFICATIONS` / `AWAITING_REGISTRATION` structures this file knows by name. Those
// were scanned with `/'([a-z0-9_.]+)'/`: one of JavaScript's three quote styles, no nesting, and
// only ever a literal that is a whole topic and nothing else. So
//
//     emits: 'trade.bot.created, trade.bot.started, trade.bot.paused'
//
// matched NOTHING — the comma is not in the character class — the record had no members, direction 4
// asked no question about it, and the run said "everything else reconciles in both directions". A
// stale record for `trade.bot.paused` hid there for weeks, next to an identical record that happened
// to name one topic and was caught on the first run.
//
// That is this estate's signature defect, a check that cannot fail, inside the check written to
// catch it, and nothing but a canary finds it: the sweep was red the entire time for other reasons,
// so every exit code was the expected one. `stripComments` now hands back every literal it walks,
// `topicsInLiteral` splits a list from prose, and the by-name structures get the SAME constant and
// member resolution the emit sites get. estate-ci.yml plants all three shapes on every run and
// fails unless each is named.
//
// AND THE SAME DEFECT WAS IN THE RAW-INSERT PATH, WHICH IS THE THIRD TIME IN THIS FILE.
//
// `outboxWrites` exists because ledger writes its most-consumed topic straight into the outbox
// table in SQL, with no `topic:` property anywhere near it. It was written to read a LITERAL in the
// topic column, and `ledger/src/entries.ts` now writes
//
//     values (${ENTRY_POSTED}, …)
//
// — the constant declared in the same file, for the express reason that a name is reachable from
// `topics.ts` and an inlined string is not. The `topic:` path has resolved identifiers and members
// since its first run. This one bailed on anything starting `${`, so the emit vanished and direction
// 1 reported "no `topic:` in ledger/src ever names it… the repair is an emit, not a rename" about a
// service that emits it. ONE TOOL DISAGREEING WITH ITSELF ABOUT WHAT AN EMIT IS. Both paths now go
// through `resolveTopicExpr`, so there is one answer to that question and teaching it a shape
// teaches both. What else that path could not see is listed at `outboxWrites`.
//
// The asymmetry that remains is written down at `tablesOf`: the consumer tables of direction 3 are
// still a heuristic over literals, because their quorum is calibrated against fifty-six
// repositories and the named structures are not.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [, , estate, gapsPath] = process.argv
if (!estate) {
  console.error('usage: estate-topics.mjs <estate-dir> [gaps.json]')
  console.error('       estate-topics.mjs <estate-dir> --where <service>')
  process.exit(2)
}
/**
 * `--where <service>` — print the directory this checker READS that service from, and exit.
 *
 * For the canaries in estate-ci, and it exists because one of them broke. The outbox canary planted
 * a record in `notify/src`, `notify` had moved to `agora/src/activity/notify`, and the sweep
 * correctly did not see a file in a directory it no longer reads — so the canary reported that the
 * checker had stopped resolving raw-insert emits, which was not true.
 *
 * A canary that hard-codes where the checker looks stops being a canary the day the layout moves,
 * and it fails in the direction that costs the most: it accuses the checker. So the canary asks,
 * rather than knowing. Nothing else uses this mode, and it prints ONE line so a shell can read it.
 */
const whereFlag = process.argv.indexOf('--where')

const REGISTRY_FILE = join(estate, 'contracts/packages/events/src/index.ts')
// Far below the 41 the registry holds today and far above any parse that has half broken. The same
// reasoning as MIN_SERVICES in conformance's ledgeraccounts.ts: a checker whose input silently
// became empty reports "no disagreements" and passes.
const MIN_TOPICS = 30
const MIN_PRODUCERS_WITH_SOURCE = 8

// ---------------------------------------------------------------- the registry
if (!existsSync(REGISTRY_FILE)) {
  console.error(`estate-topics: no registry at ${REGISTRY_FILE} — this checkout is not the estate`)
  process.exit(2)
}
const registryText = readFileSync(REGISTRY_FILE, 'utf8')
const registryBlock = registryText.slice(registryText.indexOf('export const TOPICS'))
/** topic -> the service the registry says owns it. */
const REGISTRY = new Map(
  [...registryBlock.matchAll(/'([a-z0-9_.]+)':\s*Object\.freeze\(\{\s*producer:\s*'([a-z-]+)'/g)].map((m) => [
    m[1],
    m[2],
  ]),
)
if (REGISTRY.size < MIN_TOPICS) {
  console.error(
    `estate-topics: parsed ${REGISTRY.size} topics out of the registry, expected at least ${MIN_TOPICS} — the parser is broken, not the estate`,
  )
  process.exit(2)
}

// ---------------------------------------------------------------- sources
const TOPIC_SHAPE = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*){2}$/

/**
 * Comments out, strings kept — and every string literal handed back as a token.
 *
 * Six guards in this estate have fired on their own prose, and one — identity's
 * `unreferencedEmitters` — PASSED because the paragraph naming the dead function counted as a call
 * site. The same stripper as the scope audit in service-ci.yml, for the same reason.
 *
 * `literals` is the list this walk already knows and used to throw away. Everything downstream that
 * wants a string used to re-find them with `/'([a-z0-9_.]+)'/`, which is wrong in three ways at
 * once: it sees ONE quote style of the three JavaScript has, it cannot see a quote nested inside
 * another kind of quote (so an apostrophe in a double-quoted sentence opens a phantom literal that
 * runs to the next one), and it can only ever read a literal that is a whole topic and nothing else.
 * The third of those is what hid a stale record for `trade.bot.paused` for weeks — see
 * `topicsInLiteral`.
 */
function stripComments(text) {
  let out = ''
  // 1 for every character INSIDE a string or template literal. A seed is only a seed in code:
  // `notify/src/events.ts` builds the message `topic: "${topic}" is not in this registry`, and a
  // checker that read that as an emit site would demand the estate emit a sentence.
  const inString = []
  /** { value, index, quote } for each literal, `index` in the STRIPPED text so lineOf agrees. */
  const literals = []
  let i = 0
  const n = text.length
  const push = (c, quoted) => {
    out += c
    inString.push(quoted ? 1 : 0)
  }
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') push('\n', false) // keep line numbers stable
        i++
      }
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      const at = out.length
      let value = ''
      push(c, false)
      i++
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') {
          push(text[i], true)
          push(text[i + 1] ?? '', true)
          value += text[i + 1] ?? ''
          i += 2
          continue
        }
        value += text[i]
        push(text[i], true)
        i++
      }
      push(text[i] ?? '', false)
      i++
      literals.push({ value, index: at, quote })
      continue
    }
    push(c, false)
    i++
  }
  return { text: out, inString, literals }
}

function collect(dir, out = []) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (/^(node_modules|dist|build|coverage)$/.test(name)) continue
      collect(p, out)
      continue
    }
    // Tests and test support are excluded: both emit deliberately fake events, and worlds'
    // testsupport.ts holds an emitter nothing calls ON PURPOSE.
    if (!/\.(ts|tsx|mts)$/.test(name)) continue
    if (/\.(test|spec)\.(ts|tsx|mts)$/.test(name) || /\.d\.ts$/.test(name) || /testsupport/.test(name)) continue
    out.push(p)
  }
  return out
}

/**
 * Where each service's source really is, after the M5 merge waves.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **ONE SERVICE'S SOURCE NOW EXISTS IN TWO CHECKOUTS, AND THIS FILE SAW TWO SERVICES.**
 *
 * `agora/src/community/` and `community/src/` are the same code: a merge wave copied it in, and
 * the standalone repository is still checked out because it is still a repository. To this file
 * that was one service emitting a topic and ANOTHER service holding a consumer rule for it, and
 * its direction-3 verdict for that shape is "the two agree by luck rather than by contract".
 * Eight community topics and `tessera.object.anchored` twice — ten disagreements, none of them
 * real, every one a repository counted twice.
 *
 * A false disagreement is worse than none: it is the noise a true one hides in, and this file's
 * whole argument is that a verdict is only worth reading if the set behind it is complete.
 *
 * ── AND WHY THE FIX IS A REMAP RATHER THAN A SKIP ─────────────────────────────────────────────
 *
 * Dropping the absorbed checkouts was the first attempt and it is WRONG, loudly: the registry
 * names producers by their original service name (`producer: 'market'`), so removing `market/`
 * left eleven of sixteen producers with no source at all — which the MIN_PRODUCERS_WITH_SOURCE
 * guard caught immediately, exactly as it was written to. A partial checkout says "nobody emits
 * it" about everything it is missing.
 *
 * So the mapping is: the absorbed service KEEPS its name, and its source is read from the
 * absorber's module directory. `market` is `agora/src/market/`; the nested ones are one level
 * deeper, `nda` at `agora/src/emberkin/nda/`. The absorber reads its own `src/` MINUS every
 * module subtree, so nothing is counted twice in either direction.
 *
 * `absorbed()` rows in the registry are the source of truth — `deployableRepos()` keeps them and
 * `releasableRepos()` drops them, so this is already stated once and there is no second list here.
 * Parsed rather than imported because this is a script with no build step.
 *
 * If the parse finds nothing, every checkout is read as before. A checker that quietly stopped
 * reading half the estate would report no disagreements and pass.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
const ABSORPTION = (() => {
  const file = join(estate, 'org/tools/registry.ts')
  const out = new Map()
  const unmapped = []
  if (!existsSync(file)) return out
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/\babsorbed\(\s*'([a-z0-9-]+)'\s*,\s*'[^']*'\s*,\s*'([a-z0-9-]+)'/g)) {
    const [, name, absorber] = m
    // One level, then two: `agora/src/market` and `agora/src/emberkin/nda`. Measured rather than
    // assumed — a module that moves deeper is a directory this finds, not a rule to re-derive.
    const direct = join(estate, absorber, 'src', name)
    if (existsSync(direct)) {
      out.set(name, { absorber, dir: direct })
      continue
    }
    let found = null
    try {
      for (const mid of readdirSync(join(estate, absorber, 'src'))) {
        const nested = join(estate, absorber, 'src', mid, name)
        if (existsSync(nested) && statSync(nested).isDirectory()) { found = nested; break }
      }
    } catch {
      /* the absorber is not checked out; the standalone copy below is then the only source */
    }
    // `hub-api` is `agora/src/hub`, `admin-api` is `agora/src/admin`: the registry name carries a
    // suffix the module directory does not. Tried LAST and only after both exact lookups fail, so
    // a real directory always wins over a guess.
    if (!found && name.endsWith('-api')) {
      const stem = name.slice(0, -'-api'.length)
      const trimmed = join(estate, absorber, 'src', stem)
      if (existsSync(trimmed)) found = trimmed
    }
    if (found) out.set(name, { absorber, dir: found })
    else unmapped.push(`${name} -> ${absorber}`)
  }
  if (unmapped.length > 0) {
    // NOT silent. An absorbed row whose module directory cannot be found is a service read from
    // BOTH its own checkout and its absorber's — the double count this block removes — and it
    // would come back as a disagreement that reads like a real one.
    console.log(
      `  absorbed  ${unmapped.length} row(s) name no module directory under their absorber and are read from their own checkout: ${unmapped.join(', ')}`,
    )
  }
  return out
})()

if (whereFlag !== -1) {
  const service = process.argv[whereFlag + 1]
  if (!service) {
    console.error('--where needs a service name')
    process.exit(2)
  }
  const moved = ABSORPTION.get(service)
  const dir = moved ? moved.dir : join(estate, service, 'src')
  if (!existsSync(dir)) {
    console.error(`estate-topics: ${service} has no sources at ${dir}`)
    process.exit(1)
  }
  console.log(dir)
  process.exit(0)
}

const repos = readdirSync(estate).filter((d) => {
  try {
    return statSync(join(estate, d)).isDirectory()
  } catch {
    return false
  }
})
if (ABSORPTION.size > 0) {
  console.log(
    `  absorbed  ${ABSORPTION.size} service(s) read from their absorber's module directory rather than their own checkout: ${[...ABSORPTION.keys()].sort().join(' ')}`,
  )
}

/** repo -> [{ path, text }], comments already stripped. Only repositories with a src/. */
const sources = new Map()
/** Every absorbed module's directory, so an absorber can exclude them from its own scan. */
const MODULE_DIRS = [...ABSORPTION.values()].map((v) => v.dir)
for (const repo of repos) {
  const moved = ABSORPTION.get(repo)
  // An absorbed service reads from its module directory and keeps its own NAME, because that is
  // what the registry's `producer:` says and what every consumer rule refers to.
  const src = moved ? moved.dir : join(estate, repo, 'src')
  if (!existsSync(src)) continue
  // The reported path is the ORIGINAL layout — `tessera/src/kiln.ts`, not
  // `tessera/src/tessera/kiln.ts`. Everything downstream keys on it: the deferral records in
  // `estate-topic-gaps.json`, every message a person reads, and the cross-references in the issues
  // this file opens. A module's move is a fact about the deployment, not about the file's name.
  const base = moved ? moved.dir : join(estate, repo, 'src')
  // Every module directory strictly BELOW this scan's base — which is not the same as "this repo is
  // an absorber". `notify` sits at `agora/src/activity/notify`, so `activity` is a module that is
  // itself an absorber, and a rule that only excluded from a top-level repository read notify's
  // files twice: once as notify and once as activity. The canary caught exactly that.
  const nested = MODULE_DIRS.filter((d) => d !== base && d.startsWith(base + '/'))
  sources.set(
    repo,
    collect(src)
      // The absorber's own scan stops at its modules' edges: they are read under their own names
      // above, and reading them twice is the double-count this whole block exists to remove.
      .filter((path) => !nested.some((d) => path.startsWith(d + '/')))
      .map((path) => ({
      path: `${repo}/src/${path.slice(base.length + 1)}`,
      ...stripComments(readFileSync(path, 'utf8')),
    })),
  )
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length
const errors = []
const notes = []

// ---------------------------------------------------------------- resolving an emit
/**
 * A `topic:` value that is a TYPE rather than a value, or a topic carried at runtime.
 *
 * `topic: string` and `topic: TopicName` are interface members. `topic: event.topic` and
 * `topic: row.topic` are relays — outbox pumps and test doubles that forward whatever they are
 * handed, which is a shape rather than a name, so there is nothing here for this checker to read.
 * Both lists are narrow deliberately: everything else unresolved is an error below.
 */
const TYPE_POSITION = /^(string|number|boolean|unknown|any|never|Topic|TopicName|[A-Z][\w$]*Topic|Topic[A-Z][\w$]*)\b/
const RUNTIME_TOPIC = /^[a-z_$][\w$]*(\.[\w$]+)+$/

/** The expression after `topic:` — up to the comma, closing brace or newline that ends it. */
function valueAfter(text, at) {
  let i = at
  let depth = 0
  let out = ''
  while (i < text.length) {
    const c = text[i]
    if (c === '\n') break
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      out += c
      i++
      while (i < text.length && text[i] !== quote) {
        out += text[i]
        i += text[i] === '\\' ? 2 : 1
      }
      out += quote
      i++
      continue
    }
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++
    if (c === ')' || c === ']' || c === '}' || c === '>') {
      if (depth === 0) break
      depth--
    }
    if ((c === ',' || c === ';') && depth === 0) break
    out += c
    i++
  }
  return out.trim()
}

/**
 * `const NAME = 'x.y.z'` anywhere in this repository, or `NAME: 'x.y.z'` inside `const OBJ`.
 *
 * The cache separator is written `\u0000` and must stay written that way. It was a literal NUL
 * BYTE in the source, here and at `resolveMember` below, which made this file binary to `grep`
 * (`file` reported it as `data`, and `grep -n unreachable tools/estate-topics.mjs` printed
 * nothing at all — not an error, nothing). git's own scan happened to still read it, because git
 * only sniffs the first 8000 bytes and these sat at 11487 and 12050, so `secret-hygiene.yml`'s
 * `git grep -nI` was never actually blind here. That is luck, not design: it is the same shape as
 * the secret scan that returned zero because `grep -I` had discarded a binary stream, and a
 * checker nobody can grep is a checker nobody audits. The escape is the identical string value.
 */
const IDENT_CACHE = new Map()
function resolveIdentifier(repo, ident) {
  const key = `${repo}\u0000${ident}`
  if (IDENT_CACHE.has(key)) return IDENT_CACHE.get(key)
  const found = resolveIdentifierUncached(repo, ident)
  IDENT_CACHE.set(key, found)
  return found
}

function resolveIdentifierUncached(repo, ident) {
  for (const file of sources.get(repo) ?? []) {
    const decl = new RegExp(
      `\\b(?:const|let|var)\\s+${ident}\\s*(?::[^=\\n]{0,80})?=\\s*(['"\`])([a-z0-9_.]+)\\1`,
    ).exec(file.text)
    if (decl) return decl[2]
  }
  return null
}

const MEMBER_CACHE = new Map()
function resolveMember(repo, object, member) {
  const key = `${repo}\u0000${object}.${member}`
  if (MEMBER_CACHE.has(key)) return MEMBER_CACHE.get(key)
  const found = resolveMemberUncached(repo, object, member)
  MEMBER_CACHE.set(key, found)
  return found
}

function resolveMemberUncached(repo, object, member) {
  for (const file of sources.get(repo) ?? []) {
    const start = new RegExp(`\\b(?:const|let|var)\\s+${object}\\s*(?::[^=\\n]{0,120})?=\\s*(?:Object\\.freeze\\()?\\{`).exec(
      file.text,
    )
    if (!start) continue
    const from = file.text.indexOf('{', start.index)
    let depth = 0
    let end = from
    while (end < file.text.length) {
      if (file.text[end] === '{') depth++
      if (file.text[end] === '}') {
        depth--
        if (depth === 0) break
      }
      end++
    }
    const body = file.text.slice(from, end)
    const hit = new RegExp(`\\b${member}\\s*:\\s*(['"\`])([a-z0-9_.]+)\\1`).exec(body)
    if (hit) return hit[2]
  }
  return null
}

/**
 * ONE ANSWER TO "WHAT TOPIC DOES THIS EXPRESSION NAME", for every path in this file that asks.
 *
 * It used to be two answers. The `topic:` path resolved a single-quoted literal, then an identifier,
 * then a member; the raw-insert path resolved a single-quoted literal and gave up on everything
 * else — which is how `values (${ENTRY_POSTED}, …)` became invisible and ledger read as emitting
 * nothing. A checker that cannot agree with itself about what an emit is will keep growing halves
 * that disagree, so this is the only place that decides.
 *
 * Returns the normalised expression alongside the topic, because the callers' remaining questions —
 * is this a type annotation, is this a relay forwarding what it was handed — are asked of the
 * expression after the casts and the substitution wrapper come off, not before.
 */
const QUOTED_TOPIC = /^(['"`])([a-z0-9_.]+)\1$/

/** `x as string`, `x::text`, `x::text[]` — the type system, or the database, talking to itself. */
function stripCasts(expr) {
  let out = expr.trim()
  for (;;) {
    const next = out
      .replace(/\s+as\s+(?:const|[\w.<>[\]|\s]+)$/, '')
      .replace(/::\s*"?[\w.]+"?\s*(?:\[\s*\])?$/, '')
      .trim()
    if (next === out) return out
    out = next
  }
}

/**
 * `${…}` around the WHOLE expression, or null.
 *
 * In a tagged SQL template the substitution *is* the value in that column, so `${ENTRY_POSTED}` and
 * `ENTRY_POSTED` are the same claim about the row. Only unwrapped when the braces balance and the
 * closing one ends the expression: `${a} || ${b}` is a concatenation, not a name, and must stay
 * unresolvable rather than silently become `a} || ${b`.
 */
function unwrapSubstitution(expr) {
  if (!expr.startsWith('${') || !expr.endsWith('}')) return null
  let depth = 0
  for (let i = 1; i < expr.length; i++) {
    if (expr[i] === '{') depth++
    else if (expr[i] === '}') {
      depth--
      if (depth === 0) return i === expr.length - 1 ? expr.slice(2, i).trim() : null
    }
  }
  return null
}

/**
 * `cond ? A : B` split at the TOP-LEVEL `?` and its matching `:`, or null.
 *
 * ── WHY A TOPIC EXPRESSION IS EVER A TERNARY ──────────────────────────────────────────────────
 *
 * `agora/src/posts.ts` writes one row for a spark and one for an echo through a single helper, and
 * chooses the topic at the call: `topic: table === 'sparks' ? 'agora.spark.created' : '…echo…'`.
 * Both names are registered and both are genuinely put on the bus. This checker read the whole
 * expression, failed to resolve it, and then said of BOTH topics "registered, and no `topic:` in
 * agora/src ever names it — the repair is an emit, not a rename". Three disagreements, all false,
 * and a false disagreement is worse than none: it is the noise a real one hides in.
 *
 * ── AND WHY IT IS SPLIT RATHER THAN PATTERN-MATCHED ───────────────────────────────────────────
 *
 * The condition can contain both characters this needs to find. `a?.b` and `a ?? b` are not the
 * ternary's `?`; a nested ternary and an object literal both put `:` in the way. So the scan is
 * depth-aware over `()[]{}`, skips strings and template substitutions, and refuses `?.`/`??`.
 *
 * BOTH ARMS MUST RESOLVE or the whole expression stays unresolved. That is the file's existing
 * discipline — "fail, do not guess" — and it matters more here than anywhere: half a ternary is a
 * set that LOOKS complete, which is the one thing every verdict below depends on not being.
 */
function splitTernary(expr) {
  let depth = 0
  let quote = null
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '(' || c === '[' || c === '{') { depth++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; continue }
    if (depth !== 0 || c !== '?') continue
    if (expr[i + 1] === '.' || expr[i + 1] === '?') { i++; continue } // `a?.b`, `a ?? b`
    // The matching `:` is the first at this depth that is not another ternary's.
    let inner = 0
    let q2 = null
    for (let j = i + 1; j < expr.length; j++) {
      const d = expr[j]
      if (q2) {
        if (d === '\\') j++
        else if (d === q2) q2 = null
        continue
      }
      if (d === "'" || d === '"' || d === '`') { q2 = d; continue }
      if (d === '(' || d === '[' || d === '{') { depth++; continue }
      if (d === ')' || d === ']' || d === '}') { depth--; continue }
      if (depth !== 0) continue
      if (d === '?' && expr[j + 1] !== '.' && expr[j + 1] !== '?') { inner++; continue }
      if (d !== ':') continue
      if (inner > 0) { inner--; continue }
      return [expr.slice(i + 1, j).trim(), expr.slice(j + 1).trim()]
    }
    return null
  }
  return null
}

function resolveTopicExpr(repo, raw) {
  let expr = stripCasts(String(raw ?? ''))
  const inner = unwrapSubstitution(expr)
  if (inner !== null) expr = stripCasts(inner)
  if (expr === '') return { topic: null, topics: [], expr }
  // All three of JavaScript's quote styles. The scan this replaced saw one of them, and direction 4
  // learned in the same file what that costs. A template literal carrying a substitution cannot
  // match the character class, which is the right answer: `${x}.bot.paused` is a shape, not a name.
  const literal = QUOTED_TOPIC.exec(expr)
  if (literal) return { topic: literal[2], topics: [literal[2]], expr }
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    const one = resolveIdentifier(repo, expr)
    return { topic: one, topics: one ? [one] : [], expr }
  }
  const member = expr.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
  if (member) {
    const one = resolveMember(repo, member[1], member[2])
    return { topic: one, topics: one ? [one] : [], expr }
  }
  const arms = splitTernary(expr)
  if (arms) {
    // Recursive, so `a ? X : b ? Y : Z` resolves to three, and so that each arm gets the cast
    // stripping and identifier resolution the single case gets. Either arm failing fails both.
    const left = resolveTopicExpr(repo, arms[0])
    const right = resolveTopicExpr(repo, arms[1])
    if (left.topics.length > 0 && right.topics.length > 0) {
      const both = [...new Set([...left.topics, ...right.topics])]
      return { topic: both[0], topics: both, expr }
    }
  }
  return { topic: null, topics: [], expr }
}

/** topic -> [{ where, file, offset }], for every topic this repository actually puts on the bus. */
function emitsOf(repo) {
  const out = new Map()
  for (const file of sources.get(repo) ?? []) {
    for (const m of file.text.matchAll(/\btopic:\s*/g)) {
      if (file.inString[m.index] === 1) continue
      const at = m.index + m[0].length
      // `envelope.topic as string` is the same expression as `envelope.topic`; the cast is TypeScript
      // talking to itself, and `resolveTopicExpr` takes it off.
      const { topic, topics, expr } = resolveTopicExpr(repo, valueAfter(file.text, at))
      const where = `${file.path}:${lineOf(file.text, m.index)}`
      if (expr === '' || TYPE_POSITION.test(expr)) continue
      if (!topic) {
        if (RUNTIME_TOPIC.test(expr)) continue // a relay forwards a topic it was handed
        errors.push(
          `${where}: emits \`topic: ${expr}\`, which this checker cannot resolve to a name — every verdict below says "nobody emits this", and that is only true of a set that is complete. Teach the resolver this shape.`,
        )
        continue
      }
      // `topics` rather than `topic`: one `topic:` property can carry a ternary and put TWO names
      // on the bus. Every one of them is checked for shape and every one is recorded, because a
      // half-recorded ternary is a set that looks complete.
      const illegal = topics.filter((t) => !TOPIC_SHAPE.test(t))
      if (illegal.length > 0) {
        errors.push(
          `${where}: emits ${illegal.map((t) => `'${t}'`).join(' and ')}, which is not a legal topic name (contracts-events TOPIC_PATTERN)`,
        )
        continue
      }
      for (const name of topics) {
        if (!out.has(name)) out.set(name, [])
        out.get(name).push({ where, file: file.path, offset: m.index })
      }
    }

    // ── the second emit shape, and the reason this is a derivation rather than a grep ──
    //
    // `ledger/src/entries.ts` puts `ledger.entry.posted` on the bus by writing the outbox row
    // itself, in SQL, inside a tagged template. There is no `topic:` anywhere near it. A checker
    // that knew only the first shape reported ledger's most-consumed topic as produced by nobody —
    // which is what the first run of this file did, and it is the same lesson conformance's
    // ledgeraccounts.ts records about account literals being spelled three ways.
    for (const write of outboxWrites(file.text)) {
      const where = `${file.path}:${lineOf(file.text, write.at)}`
      if (write.error) {
        errors.push(`${where}: ${write.error}`)
        continue
      }
      const { topic, topics, expr } = resolveTopicExpr(repo, write.expr)
      if (!topic) {
        // `${event.topic}` — the outbox helper every service shares, writing whatever it was handed.
        // The same judgement as RUNTIME_TOPIC at a `topic:` property, made by the same test rather
        // than by a bail on `${`, which could not tell a relay from a constant.
        if (RUNTIME_TOPIC.test(expr)) continue
        errors.push(
          `${where}: writes an outbox row whose topic column is \`${expr || '(nothing this checker could read)'}\`, which cannot be resolved to a name — fail, do not guess`,
        )
        continue
      }
      // Asked here for the same reason it is asked of a `topic:` property, and it was not: a raw
      // insert of 'foo.bar' used to be silently admitted to the emitted set as a topic no registry
      // could ever name.
      const badRow = topics.filter((t) => !TOPIC_SHAPE.test(t))
      if (badRow.length > 0) {
        errors.push(
          `${where}: writes an outbox row for ${badRow.map((t) => `'${t}'`).join(' and ')}, which is not a legal topic name (contracts-events TOPIC_PATTERN)`,
        )
        continue
      }
      for (const name of topics) {
        if (!out.has(name)) out.set(name, [])
        out.get(name).push({ where, file: file.path, offset: write.at })
      }
    }
  }
  return out
}

/**
 * Every outbox row written in SQL in one file: `{ at, expr }` per row, or `{ at, error }`.
 *
 * WHAT THIS PATH COULD NOT SEE, none of it loudly:
 *
 *   * A CONSTANT IN THE TOPIC COLUMN. `values (${ENTRY_POSTED}, …)`. It bailed on anything opening
 *     `${`, a rule written for the shared pump's `${event.topic}` and far too wide: the estate's
 *     most-consumed topic disappeared the day ledger named it rather than inlining it, and
 *     direction 1 said "the repair is an emit, not a rename" about a service that emits it. The
 *     relay is now identified by RUNTIME_TOPIC — the test the `topic:` path already used for the
 *     same judgement — so a name resolves and a shape is skipped.
 *   * ANY QUOTE BUT ONE. `values ("x.y.z", …)` was an error, not a topic. Direction 4 taught this
 *     file the same lesson one function away.
 *   * A SECOND ROW. `values (…), (…)` — only the first was read, in silence.
 *   * A QUALIFIED OR QUOTED TABLE. `insert into public.outbox`, `insert into "outbox"` matched
 *     nothing at all, and a service that adds a schema prefix stops emitting as far as this file is
 *     concerned.
 *   * A COMMA INSIDE A VALUE. `splitTopLevel` knew brackets but not strings, so one quoted comma
 *     shifted every column after it and the topic was read off some other column — a MISREAD rather
 *     than a miss, which is the worse of the two.
 *   * AN INSERT WITH NO `values (…)` TO READ. `insert into outbox (…) select …`, or a positional
 *     insert with no column list at all. Both are errors now: every verdict in this file says
 *     "nobody emits this", and that sentence is only true of a complete set.
 *   * AN ILLEGAL NAME. See TOPIC_SHAPE at the caller.
 *
 * THE HOLE THAT IS LEFT, deliberately. A bare `insert into outbox` with neither a column list nor a
 * `values (`, is skipped rather than reported, because `notify/src/topics.ts` says in a STRING
 * that "policy has no outbox at all — no outbox.ts, no `insert into outbox` anywhere in policy/src".
 * `inString` cannot separate that from real SQL: the real SQL is a tagged template, so every
 * character of it is inside a string too. Six guards in this estate have fired on their own prose,
 * so the structure — a column list, or `values` — is what makes a match code rather than a sentence.
 */
function outboxWrites(text) {
  const out = []
  const TABLE = /\binsert\s+into\s+(?:"?[A-Za-z_]\w*"?\s*\.\s*)?"?outbox"?(?![\w"])/gi
  for (const m of text.matchAll(TABLE)) {
    let i = m.index + m[0].length
    const skipSpace = () => {
      while (i < text.length && /\s/.test(text[i])) i++
    }
    skipSpace()
    let columns = null
    if (text[i] === '(') {
      const close = text.indexOf(')', i)
      if (close === -1) continue // not a column list, and not anything else either
      columns = text
        .slice(i + 1, close)
        .split(',')
        .map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''))
      i = close + 1
      skipSpace()
    }
    const isValues = /^values\b/i.test(text.slice(i, i + 7))
    // Neither a column list nor `values` — prose. See THE HOLE THAT IS LEFT above.
    if (columns === null && !isValues) continue
    if (!isValues) {
      out.push({
        at: m.index,
        error: `writes to the outbox with something other than \`values (…)\` — this checker cannot read which topic that row carries, and it will not guess one`,
      })
      continue
    }
    i += 6
    skipSpace()
    if (text[i] !== '(') {
      out.push({ at: m.index, error: 'writes an outbox `values` with no row after it — fail, do not guess' })
      continue
    }
    if (columns === null) {
      out.push({
        at: m.index,
        error:
          'writes an outbox row positionally, naming no columns, so which value carries the topic is a guess — name the columns',
      })
      continue
    }
    const col = columns.indexOf('topic')
    if (col < 0) {
      out.push({
        at: m.index,
        error: `writes an outbox row into (${columns.join(', ')}) and none of those columns is \`topic\` — an event with no name is not on the bus`,
      })
      continue
    }
    // Every row of a multi-row insert. Reading only the first is the same silence as reading only
    // one quote style: the second event is emitted and this file says nobody sends it.
    for (;;) {
      const row = splitTopLevel(text, i)
      out.push({ at: m.index, expr: row.values[col] ?? '' })
      let j = row.end + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] !== ',') break
      j++
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] !== '(') break
      i = j
    }
  }
  return out
}

/**
 * The comma-separated members of a parenthesised list starting at `openParen`, and where it closed.
 *
 * STRING-AWARE, because it was not, and that failure is a misread rather than a miss: a comma or an
 * unbalanced bracket inside a quoted value shifted every member after it by one, so the topic
 * column was read off a neighbouring column's expression and reported with total confidence.
 */
function splitTopLevel(text, openParen) {
  const values = []
  let depth = 1
  let current = ''
  let i = openParen + 1
  while (i < text.length) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      current += c
      i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') {
          current += text.slice(i, i + 2)
          i += 2
          continue
        }
        current += text[i]
        i++
      }
      current += text[i] ?? ''
      i++
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0) break
    }
    if (c === ',' && depth === 1) {
      values.push(current.trim())
      current = ''
      i++
      continue
    }
    current += c
    i++
  }
  values.push(current.trim())
  return { values, end: i }
}

const EMITS = new Map(repos.map((repo) => [repo, sources.has(repo) ? emitsOf(repo) : new Map()]))
const emits = (repo, topic) => (EMITS.get(repo)?.get(topic)?.length ?? 0) > 0
const emitSite = (repo, topic) => EMITS.get(repo)?.get(topic)?.[0]?.where ?? '(nowhere)'

/**
 * What a service puts on the bus under a name no registry knows.
 *
 * "NOBODY EMITS THIS" IS TWO FINDINGS WITH TWO DIFFERENT REPAIRS, and this file used to print one
 * sentence for both. `custody.key.exported` was recorded here as custody's export path "completing
 * in silence"; it was not silent. `custody/src/exports.ts` was emitting
 * `custody.export.completed` — a name in no registry, with no subscriber anywhere in the estate —
 * while `custody.key.exported` was named in seven places across five repositories, including a
 * CRITICAL notify rule. The repair was a rename in one repository. Read as written, the record
 * pointed at "add an emit", which is five registrations and three rules more expensive and leaves
 * the orphan emit behind.
 *
 * This checker already knows the difference: it derived the producer's emits to answer the question
 * in the first place, and the census below has been printing the count for both runs. So the
 * verdict says which of the two it is, and names the candidates, rather than making the next reader
 * guess and get it wrong the way the first record did.
 */
function unregisteredEmitsOf(repo) {
  return [...(EMITS.get(repo) ?? new Map()).keys()].filter((topic) => !REGISTRY.has(topic)).sort()
}

function orUnderAnotherName(producer, topic) {
  const others = unregisteredEmitsOf(producer)
  if (others.length === 0) {
    return `${producer} emits nothing this registry does not name, so the fact is not on the bus under another spelling either — the repair is an emit, not a rename.`
  }
  return `Before writing a new emit: ${producer} DOES emit ${others.length} topic(s) no registry names — ${others.join(', ')} — and one of them may be '${topic}' under a name nobody else knows. That is what custody.key.exported turned out to be, and the two findings look identical from here while their repairs differ by four repositories.`
}

const PRODUCERS = new Set(REGISTRY.values())
const withSource = [...PRODUCERS].filter((p) => sources.has(p))
if (withSource.length < MIN_PRODUCERS_WITH_SOURCE) {
  console.error(
    `estate-topics: only ${withSource.length} of ${PRODUCERS.size} producing services have a src/ here — this is a partial checkout, and a partial checkout says "nobody emits it" about everything it is missing`,
  )
  process.exit(2)
}

// ---------------------------------------------------------------- named topics, by repository
/**
 * Every topic-shaped literal, grouped by the top-level `const` it sits in.
 *
 * A CONSUMER TABLE is any such group naming three or more registered topics — a rule table, a
 * classifier, a retention map. The threshold is what separates notify's `RULES` from policy's
 * action list, and it calibrates itself: nothing here knows the name of a single consumer's data
 * structure, so a service that invents a fourth kind of table is checked on the day it lands.
 */
const TABLE_QUORUM = 3
const RECORD_STRUCTURES = new Set(['UNPRODUCED_NOTIFICATIONS'])
const QUARANTINES = new Set(['AWAITING_REGISTRATION'])
/** The structures this file reads BY NAME, and therefore owes the same resolver as an emit site. */
const BY_NAME = new Set([...RECORD_STRUCTURES, ...QUARANTINES])

/**
 * The topic names a single string literal states.
 *
 * THE DEFECT THIS REPLACES, because it is the estate's signature class living inside the check
 * built to catch it. `notify/src/topics.ts` used to record
 *
 *     emits: 'trade.bot.created, trade.bot.started, trade.bot.paused'
 *
 * — one literal naming three topics trade really emits — and the scan that fed direction 4 was
 * `/'([a-z0-9_.]+)'/`, which requires the quotes to touch the name. A comma is not in that class,
 * so the literal matched NOTHING, so the record had no members, so direction 4 asked no question
 * about it and the sweep said "everything else reconciles". A stale record for `trade.bot.paused`
 * hid behind that for weeks, next to an identical record that happened to name one topic and was
 * found immediately. A check that silently reads less than it claims is worse than no check: it
 * reports the gap as measured.
 *
 * So a literal is now SPLIT, and accepted only when EVERY token is topic-shaped. That is the line
 * between a list and prose, and it has to be drawn somewhere: these structures also carry
 * `evidence` paragraphs that name topics mid-sentence, and promoting those to members would make
 * every argument about a topic a claim about it. One token or seven, all of them names — a list.
 * One sentence mentioning a name — prose, and `evidence` is where the header of the record
 * structure says prose belongs.
 *
 * A template literal with a substitution is refused outright: `${x}.bot.paused` is a shape, not a
 * name, and the same reasoning as RUNTIME_TOPIC at the emit sites.
 */
function topicsInLiteral(value) {
  if (value.includes('${')) return []
  const tokens = value.split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0) return []
  if (!tokens.every((t) => TOPIC_SHAPE.test(t))) return []
  return tokens
}

/** The `{…}` or `[…]` body of `const NAME = …` in one file, or null. */
function bodyOfDeclaration(text, name) {
  const start = new RegExp(
    `\\b(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]{0,200})?=\\s*(?:Object\\.freeze\\()?[[{]`,
  ).exec(text)
  if (!start) return null
  const from = start.index + start[0].length - 1
  const open = text[from]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let end = from
  while (end < text.length) {
    if (text[end] === open) depth++
    if (text[end] === close) {
      depth--
      if (depth === 0) break
    }
    end++
  }
  return { from, to: end }
}

function tablesOf(repo) {
  const groups = new Map()
  for (const file of sources.get(repo) ?? []) {
    const decls = [...file.text.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/gm)]
    const ownerAt = (index) => {
      let owner = null
      for (const d of decls) {
        if (d.index < index) owner = d[1]
        else break
      }
      return owner
    }
    const add = (owner, topic, index) => {
      const key = `${file.path}::${owner ?? '(top level)'}`
      if (!groups.has(key)) groups.set(key, { file: file.path, owner, members: [] })
      const members = groups.get(key).members
      const where = `${file.path}:${lineOf(file.text, index)}`
      if (members.some((m) => m.topic === topic && m.where === where)) return
      members.push({ topic, where })
    }

    for (const literal of file.literals) {
      const owner = ownerAt(literal.index)
      for (const topic of topicsInLiteral(literal.value)) add(owner, topic, literal.index)
    }

    // ── the same resolution the emit sites get, for the structures read BY NAME ──
    //
    // Directions 1–3 resolve `topic: SETTLEMENT_OUTBOUND_FAILED` and `topic: TOPICS.keyIssued` to
    // the strings they name, and refuse to guess when they cannot. Direction 4 read raw literals
    // and nothing else, so `emits: TRADE_BOT_PAUSED` — the shape half this estate's producers
    // already use for their own emits — would have been just as invisible as the comma was. The
    // record structures are a cross-repository agreement about shape (notify/src/topics.ts states
    // it in a comment, which is the only place it has ever been written down), and an agreement one
    // side reads with a weaker parser than the other is one refactor from silence.
    //
    // Scoped to those structures deliberately. The consumer TABLES of direction 3 are a heuristic
    // over literals with a quorum, and resolving identifiers into them would move that quorum in
    // fifty-six repositories on a guess; here the structure is named, so the scope of the change is
    // named too.
    for (const name of BY_NAME) {
      const body = bodyOfDeclaration(file.text, name)
      if (!body) continue
      const text = file.text.slice(body.from, body.to)
      for (const m of text.matchAll(/[:[,]\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*[,\]}\n]/g)) {
        if (file.inString[body.from + m.index] === 1) continue
        const expr = m[1]
        const member = expr.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
        const topic = member ? resolveMember(repo, member[1], member[2]) : resolveIdentifier(repo, expr)
        if (topic && TOPIC_SHAPE.test(topic)) add(name, topic, body.from + m.index)
      }
    }
  }
  return [...groups.values()]
}

const TABLES = new Map(repos.map((repo) => [repo, sources.has(repo) ? tablesOf(repo) : []]))

/** Topics a repository has quarantined: emitted, unregistered, and written down with a spec. */
function quarantined(repo) {
  const out = new Set()
  for (const table of TABLES.get(repo) ?? []) {
    if (!QUARANTINES.has(table.owner ?? '')) continue
    for (const member of table.members) out.add(member.topic)
  }
  return out
}

// ---------------------------------------------------------------- recorded gaps
/**
 * Findings this job has already reported, each with the evidence and the repair.
 *
 * NOT AN EXEMPTION LIST, and the difference is mechanical: an entry is stale — and fails — the
 * moment the estate stops matching it, in either direction. It is the `UNPRODUCED_NOTIFICATIONS`
 * pattern (notify/src/topics.ts), moved to the only checkout that can see both halves.
 */
const gaps = new Map()

/**
 * The kinds this file can produce. A record of any other kind can NEVER match a finding.
 *
 * It used to be `[a-z-]+`, so `stale:trade.bot.paused` parsed, sat in the file looking like a
 * known issue, and surfaced only as "no longer describes the estate — delete it" at the bottom of a
 * run: the message for a gap that has been FIXED, on a record that never described anything. Two
 * opposite states, one sentence. The set is closed here so a typo is named as a typo.
 *
 * `unreachable` IS NEW, AND DIRECTION 5 COULD NOT BE RECORDED AT ALL BEFORE IT. Directions 1–4 go
 * through `record()`; direction 5 pushed straight onto `errors`, so an unreferenced emitter was the
 * one finding in this file with no way to carry evidence, an owner, a date or an `until`. That is
 * not a stricter check, it is a check with only one escape: fix it, or switch the step off — and
 * the header of the gap file is an argument about what happens to a red nobody can fix. It bit on
 * `tessera.object.anchored`, whose producer cannot be called because a Solidity contract has never
 * been written, four repositories away, while its consumer sits complete and waiting. "Delete the
 * emitter" and "wait for the chain" are two answers and the file could hold neither.
 *
 * It is keyed BY THE TOPIC, like every other kind, because that is what the finding is about: a
 * function name is a fact about one repository's source and a topic is the thing two repositories
 * disagree over. An emitter naming two topics is two findings, and each closes on its own.
 */
const KINDS = new Set(['unemitted', 'unregistered', 'unproduced', 'stale-record', 'unreachable'])

/**
 * Why a record is still here — and it is not one question, which is what the first nine got wrong.
 *
 * All nine were written as "found, and somebody else must fix it". Two of them were not that at
 * all: `settlement.outbound.failed` and `market.offer.made` are decisions, taken deliberately in
 * micro-notify, with the reason and the one field each needs written down — notify's own records
 * carry `blockedBy: 'no-subject'` and refuse to key a rule to an envelope that names nobody. A file
 * that cannot tell a decision from an omission reads as an inventory of neglect, and the fix for
 * that is the one notify already made for itself: a closed set of reasons, each implying something
 * checkable.
 *
 *   - `unfixed`   — nobody has done it yet. `owner` names the repository whose change closes it.
 *   - `deferred`  — it stays, on purpose, for now. `until` states the condition that ends the
 *                   deferral, in a sentence somebody else can test against the estate. A deferral
 *                   with no end condition is an exemption with better manners.
 *
 * There is deliberately no `wontfix`. A finding nobody will ever act on is not recorded here — it
 * is fixed in the estate or it is argued out of the checker, and both of those leave this file
 * empty rather than permanent.
 */
const STATUSES = new Set(['unfixed', 'deferred'])

if (gapsPath && existsSync(gapsPath)) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(gapsPath, 'utf8'))
  } catch (error) {
    console.error(`estate-topics: ${gapsPath} is not valid JSON — ${error.message}`)
    process.exit(2)
  }
  for (const [key, entry] of Object.entries(parsed.gaps ?? {})) {
    // `<kind>:<topic>`, because one topic can be wrong in two ways at once.
    const parts = /^([a-z-]+):(.+)$/.exec(key)
    if (!parts || !KINDS.has(parts[1]) || !TOPIC_SHAPE.test(parts[2])) {
      errors.push(
        `${gapsPath}: '${key}' is not a '<kind>:<topic>' key this file can ever match — kind must be one of ${[...KINDS].sort().join(', ')} and the topic must be a legal topic name. A record that matches nothing is not a known issue, it is a typo that reads as one.`,
      )
      continue
    }
    const problems = []
    if (typeof entry?.owner !== 'string' || !/^micro-[a-z-]+$/.test(entry.owner)) {
      problems.push('`owner` must be a `micro-<repository>` name — a gap nobody owns is a gap nobody closes')
    } else if (!sources.has(entry.owner.replace(/^micro-/, '')) && !repos.includes(entry.owner.replace(/^micro-/, ''))) {
      problems.push(`\`owner\` names '${entry.owner}', which is no repository in this checkout`)
    }
    if (typeof entry?.evidence !== 'string' || entry.evidence.length < 80) {
      problems.push('`evidence` is missing or under eighty characters — that is a hole, not a decision')
    }
    if (typeof entry?.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.recordedAt)) {
      problems.push('`recordedAt` must be a YYYY-MM-DD date — a record with no age cannot be seen to be rotting')
    }
    if (typeof entry?.status !== 'string' || !STATUSES.has(entry.status)) {
      problems.push(`\`status\` must be one of ${[...STATUSES].sort().join(', ')} — see STATUSES in this file`)
    } else if (entry.status === 'deferred' && (typeof entry.until !== 'string' || entry.until.length < 40)) {
      problems.push(
        '`status` is `deferred`, so `until` must state the condition that ends the deferral, in at least forty characters. A deferral with no end condition is an exemption with better manners.',
      )
    } else if (entry.status === 'unfixed' && entry.until !== undefined) {
      problems.push('`until` belongs to a `deferred` record — an `unfixed` one is waiting on nothing but the work')
    }
    if (problems.length > 0) {
      errors.push(`${gapsPath}: the record for '${key}' is malformed — ${problems.join('; ')}`)
      continue
    }
    gaps.set(key, entry)
  }
}

/**
 * key -> every finding it absorbed.
 *
 * A SET WAS NOT ENOUGH, and the reason is the sentence at the top of the gap file. One record
 * suppresses a finding by `<kind>:<topic>` and nothing else, so when two repositories hold a rule
 * for the same unregistered topic, ONE entry silences both while its evidence describes one. The
 * file then reads as an inventory of known issues while quietly omitting some — the exact failure
 * it exists to prevent. Suppression is not narrowed (the second occurrence is the same defect, and
 * a red micro-org cannot fix is a red somebody switches off), but every absorbed message is
 * PRINTED, so the run's report is complete even where the file is not.
 */
const recorded = new Map()
function record(topic, kind, message) {
  const key = `${kind}:${topic}`
  const entry = gaps.get(key)
  if (!entry) {
    errors.push(message)
    return
  }
  if (!recorded.has(key)) {
    recorded.set(key, [])
    const why =
      entry.status === 'deferred'
        ? `deferred until: ${entry.until}`
        : `unfixed since ${entry.recordedAt} — ${entry.owner} closes it`
    notes.push(`recorded ${key} [${why}]: ${entry.evidence}`)
  }
  recorded.get(key).push(message)
}

// ---------------------------------------------------------------- 1. registered, emitted by nobody
for (const [topic, producer] of [...REGISTRY].sort()) {
  if (!sources.has(producer)) {
    errors.push(
      `${topic}: the registry says '${producer}' produces it and there is no ${producer}/src in this checkout — fail, do not guess`,
    )
    continue
  }
  if (emits(producer, topic)) continue
  record(
    topic,
    'unemitted',
    `${topic}: registered, and no \`topic:\` in ${producer}/src ever names it. Every consumer classifying it is waiting for a fact that is never sent — identity.user.registered was exactly this, for the whole life of the service. ${orUnderAnotherName(producer, topic)}`,
  )
}

// ---------------------------------------------------------------- 2. emitted, registered by nobody
//
// A CENSUS, NOT A VERDICT, and the line is worth stating because it is where this step stops being
// estate-wide. A producer's own repository depends on `@cloudsforge/contracts-events`; it can read
// the registry and check its own emits against it, and eight of them do exactly that today
// (identity, market, community, devplatform, trade …, each with the `topics.ts` pattern and a
// self-emptying `AWAITING_REGISTRATION`). Failing here would be micro-org enforcing a per-repository
// convention on repositories it does not own — 53 reds this job cannot fix, in a file whose whole
// argument is that a red nobody owns gets switched off.
//
// It is COUNTED rather than dropped because the count is the argument for adopting the pattern, and
// because a repository whose quarantine empties while its emits stay unregistered shows up here.
const census = []
for (const repo of repos) {
  const quarantine = quarantined(repo)
  let unregistered = 0
  let held = 0
  for (const [topic] of [...(EMITS.get(repo) ?? new Map())].sort()) {
    if (REGISTRY.has(topic)) continue
    if (quarantine.has(topic)) held += 1
    else unregistered += 1
  }
  if (unregistered + held > 0) {
    census.push(
      `${repo}: ${unregistered} emitted topic(s) no registry names${held > 0 ? `, ${held} of its own quarantined with a spec` : ' and no quarantine of its own — the topics.ts pattern is not adopted here'}`,
    )
  }
}

// ---------------------------------------------------------------- 3. named by a consumer, emitted by nobody
for (const repo of repos) {
  for (const table of TABLES.get(repo) ?? []) {
    if (RECORD_STRUCTURES.has(table.owner ?? '') || QUARANTINES.has(table.owner ?? '')) continue
    const registeredMembers = table.members.filter((m) => REGISTRY.has(m.topic)).length
    if (registeredMembers < TABLE_QUORUM) continue
    for (const member of table.members) {
      // A registered member is direction 1's question, asked once for the estate rather than once
      // per consumer that classifies it.
      if (REGISTRY.has(member.topic)) continue
      const producer = member.topic.split('.')[0].replace(/_/g, '-')
      if (producer === repo) continue
      // A first segment that names no service in this checkout is not a service topic this job can
      // judge. `web.page.viewed` (analytics/src/catalogue.ts) is a browser event posted to an
      // ingest route by four separate front ends; there is no `web/src` and there is not meant to
      // be. Saying "no producer emits it" about that would be a confident falsehood.
      if (!sources.has(producer)) {
        notes.push(
          `unjudged ${member.topic} — ${repo} holds a rule for it at ${member.where}, and '${producer}' is no service in this checkout, so nothing here can say whether it is produced`,
        )
        continue
      }
      if (emits(producer, member.topic)) {
        record(
          member.topic,
          'unregistered',
          `${member.topic}: ${repo} holds a rule for it at ${member.where} and ${producer} emits it at ${emitSite(producer, member.topic)} — but no registry names it, so the two agree by luck rather than by contract.`,
        )
        continue
      }
      record(
        member.topic,
        'unproduced',
        `${member.topic}: ${repo} holds a rule for it at ${member.where}, in a table of registered topics, and ${producer} emits no such thing. A rule for a topic nobody sends reports itself as coverage and can never fire. ${orUnderAnotherName(producer, member.topic)}`,
      )
    }
  }
}

// ---------------------------------------------------------------- 4. a record whose premise expired
for (const repo of repos) {
  for (const table of TABLES.get(repo) ?? []) {
    if (!RECORD_STRUCTURES.has(table.owner ?? '')) continue
    for (const member of table.members) {
      const producer = member.topic.split('.')[0].replace(/_/g, '-')
      if (!sources.has(producer) || !emits(producer, member.topic)) continue
      record(
        member.topic,
        'stale-record',
        `${member.topic}: ${repo} records at ${member.where} that this fact is not produced, and ${producer} emits it at ${emitSite(producer, member.topic)}. The record is stale — write the rule. (${repo}'s own suite asks only whether the registry NAMES it, which is why this survived: the topic is unregistered, so the staleness is invisible from inside ${repo}.)`,
      )
    }
  }
}

// ---------------------------------------------------------------- 5. an emitter nothing reaches
/**
 * A name is proof of nothing if the code holding it never runs.
 *
 * `emitSessionRevoked` was written, correct, registered and called by NOTHING, while notify held a
 * critical rule on the topic. Every name-based check above passed. This is identity's
 * `unreferencedEmitters` (identity/src/topics.ts) applied to every producer in the estate,
 * including the twenty that never wrote one.
 *
 * It is a syntactic proxy and says so: it catches an emitter with no caller, and it does not prove
 * the caller is itself reachable. A chain of dead functions calling each other satisfies it.
 *
 * IT REPORTS THE TOPICS, NOT JUST THE FUNCTION, and that is what made it recordable. This was the
 * only direction whose findings never reached `record()` — see `unreachable` at KINDS — and the
 * reason was structural rather than deliberate: it had thrown the topic away one line into the
 * function, at `for (const [, where] of EMITS…)`, so there was nothing to key a record by. The
 * topic was always there; it was discarded by a destructuring hole.
 */
function unreferencedEmitters(repo) {
  const files = sources.get(repo) ?? []
  // An emit site is one this checker RESOLVED, not one that looks like an emit. The first version
  // read the declaration text for `topic:` and called `describeTopic(topic: IdentityTopic)` an
  // emitter — it had matched a parameter's type annotation.
  const sites = []
  for (const [topic, where] of EMITS.get(repo) ?? new Map()) for (const site of where) sites.push({ ...site, topic })
  const emitters = []
  for (const file of files) {
    for (const match of file.text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
      const rest = file.text.slice(match.index)
      const end = rest.search(/\n\}/)
      const bodyEnd = match.index + (end === -1 ? rest.length : end)
      const inBody = sites.filter((s) => s.file === file.path && s.offset > match.index && s.offset < bodyEnd)
      if (inBody.length > 0) {
        emitters.push({
          name: match[1],
          file: file.path,
          line: lineOf(file.text, match.index),
          topics: [...new Set(inBody.map((s) => s.topic))].sort(),
        })
      }
    }
  }
  const dead = []
  for (const emitter of emitters) {
    let references = 0
    for (const file of files) {
      for (const hit of file.text.matchAll(new RegExp(`\\b${emitter.name}\\b`, 'g'))) {
        const preceding = file.text.slice(Math.max(0, hit.index - 40), hit.index)
        if (file.path === emitter.file && /function\s+$/.test(preceding)) continue
        references += 1
      }
    }
    if (references === 0) dead.push(emitter)
  }
  return dead.sort((a, b) => a.name.localeCompare(b.name))
}

for (const repo of repos) {
  if (!sources.has(repo)) continue
  for (const emitter of unreferencedEmitters(repo)) {
    // The function name stays in the message — it is the only thing that says WHERE to look, and
    // estate-ci.yml's topic canary grades this direction by grepping for the injected emitter's
    // name. One finding per topic, because that is the unit a record can close on.
    for (const topic of emitter.topics) {
      record(
        topic,
        'unreachable',
        `${topic}: ${emitter.name} (${emitter.file}:${emitter.line}) emits it, and nothing else in ${repo}/src refers to ${emitter.name}. The topic has a producer on paper and none in the running service — emitSessionRevoked, again.`,
      )
    }
  }
}

// ---------------------------------------------------------------- stale records
for (const [key, absorbed] of recorded) {
  if (absorbed.length < 2) continue
  notes.push(
    `recorded ${key} absorbed ${absorbed.length} findings, and its evidence describes one — all of them: ${absorbed.join(' || ')}`,
  )
}
for (const [key] of gaps) {
  if (recorded.has(key)) continue
  errors.push(
    `${gapsPath}: the record '${key}' no longer describes the estate — the gap is closed, or it has changed shape. Delete it. A record that outlives its finding is the permanent allow-list this file exists not to be, and the fifteen unreachable rules in notify are what that looks like after a year.`,
  )
}

// ---------------------------------------------------------------- verdict
const emitted = [...EMITS.values()].reduce((n, m) => n + m.size, 0)
console.log(
  `registry: ${REGISTRY.size} topics from ${PRODUCERS.size} producers · checkout: ${sources.size} repositories with src/, ${withSource.length} of them producers · derived: ${emitted} emitted topic(s)`,
)
for (const line of census.sort()) console.log(`  census  ${line}`)
for (const note of notes.sort()) console.log(`  note    ${note}`)
if (errors.length > 0) {
  console.error(`\nestate-topics: FAILED — ${errors.length} disagreement(s) between repositories`)
  for (const e of errors.sort()) console.error(`  ${e}`)
  process.exit(1)
}
console.log(`\nestate-topics: ok — ${recorded.size} recorded gap(s), everything else reconciles in both directions`)
