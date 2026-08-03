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
// jobs.ts:60` declares `EXPIRE_KIND = 'billing.entitlement.expire'` and `policy/src/actions.ts:154`
// declares an action `'identity.password.reset'`. Both are topic-shaped, neither is a topic, and a
// checker that called them emits would report four services as broken on its first run and be
// switched off by its second.
//
// Anything at a `topic:` value position that cannot be resolved is FATAL rather than skipped: the
// verdicts below say "nobody emits this", and that sentence is only true if the emitted set is
// complete. Fail, do not guess.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [, , estate, gapsPath] = process.argv
if (!estate) {
  console.error('usage: estate-topics.mjs <estate-dir> [gaps.json]')
  process.exit(2)
}

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
 * Comments out, strings kept.
 *
 * Six guards in this estate have fired on their own prose, and one — identity's
 * `unreferencedEmitters` — PASSED because the paragraph naming the dead function counted as a call
 * site. The same stripper as the scope audit in service-ci.yml, for the same reason.
 */
function stripComments(text) {
  let out = ''
  // 1 for every character INSIDE a string or template literal. A seed is only a seed in code:
  // `notify/src/events.ts:70` builds the message `topic: "${topic}" is not in this registry`, and a
  // checker that read that as an emit site would demand the estate emit a sentence.
  const inString = []
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
      push(c, false)
      i++
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') {
          push(text[i], true)
          push(text[i + 1] ?? '', true)
          i += 2
          continue
        }
        push(text[i], true)
        i++
      }
      push(text[i] ?? '', false)
      i++
      continue
    }
    push(c, false)
    i++
  }
  return { text: out, inString }
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

const repos = readdirSync(estate).filter((d) => {
  try {
    return statSync(join(estate, d)).isDirectory()
  } catch {
    return false
  }
})

/** repo -> [{ path, text }], comments already stripped. Only repositories with a src/. */
const sources = new Map()
for (const repo of repos) {
  const src = join(estate, repo, 'src')
  if (!existsSync(src)) continue
  sources.set(
    repo,
    collect(src).map((path) => ({
      path: `${repo}/${path.slice(join(estate, repo).length + 1)}`,
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

/** `const NAME = 'x.y.z'` anywhere in this repository, or `NAME: 'x.y.z'` inside `const OBJ`. */
function resolveIdentifier(repo, ident) {
  for (const file of sources.get(repo) ?? []) {
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*(?::[^=\\n]{0,80})?=\\s*'([a-z0-9_.]+)'`).exec(file.text)
    if (decl) return decl[1]
  }
  return null
}

function resolveMember(repo, object, member) {
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
    const hit = new RegExp(`\\b${member}\\s*:\\s*'([a-z0-9_.]+)'`).exec(body)
    if (hit) return hit[1]
  }
  return null
}

/** topic -> [{ where, file, offset }], for every topic this repository actually puts on the bus. */
function emitsOf(repo) {
  const out = new Map()
  for (const file of sources.get(repo) ?? []) {
    for (const m of file.text.matchAll(/\btopic:\s*/g)) {
      if (file.inString[m.index] === 1) continue
      const at = m.index + m[0].length
      // `envelope.topic as string` is the same expression as `envelope.topic`; the cast is TypeScript
      // talking to itself.
      const expr = valueAfter(file.text, at).replace(/\s+as\s+[\w.<>[\]|\s]+$/, '')
      const where = `${file.path}:${lineOf(file.text, m.index)}`
      if (expr === '' || TYPE_POSITION.test(expr)) continue
      const literal = expr.match(/^'([a-z0-9_.]+)'$/)
      let topic = literal ? literal[1] : null
      if (!topic && /^[A-Za-z_$][\w$]*$/.test(expr)) topic = resolveIdentifier(repo, expr)
      if (!topic) {
        const member = expr.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
        if (member) topic = resolveMember(repo, member[1], member[2])
      }
      if (!topic) {
        if (RUNTIME_TOPIC.test(expr)) continue // a relay forwards a topic it was handed
        errors.push(
          `${where}: emits \`topic: ${expr}\`, which this checker cannot resolve to a name — every verdict below says "nobody emits this", and that is only true of a set that is complete. Teach the resolver this shape.`,
        )
        continue
      }
      if (!TOPIC_SHAPE.test(topic)) {
        errors.push(`${where}: emits '${topic}', which is not a legal topic name (contracts-events TOPIC_PATTERN)`)
        continue
      }
      if (!out.has(topic)) out.set(topic, [])
      out.get(topic).push({ where, file: file.path, offset: m.index })
    }

    // ── the second emit shape, and the reason this is a derivation rather than a grep ──
    //
    // `ledger/src/entries.ts:426` puts `'ledger.entry.posted'` on the bus by writing the outbox row
    // itself, in SQL, inside a tagged template. There is no `topic:` anywhere near it. A checker
    // that knew only the first shape reported ledger's most-consumed topic as produced by nobody —
    // which is what the first run of this file did, and it is the same lesson conformance's
    // ledgeraccounts.ts records about account literals being spelled three ways.
    for (const m of file.text.matchAll(/insert\s+into\s+outbox\s*\(([^)]*)\)\s*values\s*\(/gi)) {
      const columns = m[1].split(',').map((c) => c.trim().toLowerCase())
      const at = columns.indexOf('topic')
      if (at < 0) continue
      const values = splitTopLevel(file.text, m.index + m[0].length - 1)
      const expr = (values[at] ?? '').trim()
      const where = `${file.path}:${lineOf(file.text, m.index)}`
      const literal = expr.match(/^'([a-z0-9_.]+)'$/)
      if (!literal) {
        // `${event.topic}` — the outbox helper every service shares, writing whatever it was handed.
        if (/^\$\{/.test(expr)) continue
        errors.push(
          `${where}: writes an outbox row whose topic column is \`${expr || '(nothing this checker could read)'}\`, which cannot be resolved to a name — fail, do not guess`,
        )
        continue
      }
      if (!out.has(literal[1])) out.set(literal[1], [])
      out.get(literal[1]).push({ where, file: file.path, offset: m.index })
    }
  }
  return out
}

/** The comma-separated members of a parenthesised list starting at `openParen`. */
function splitTopLevel(text, openParen) {
  const out = []
  let depth = 1
  let current = ''
  let i = openParen + 1
  while (i < text.length && depth > 0) {
    const c = text[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0) break
    }
    if (c === ',' && depth === 1) {
      out.push(current.trim())
      current = ''
      i++
      continue
    }
    current += c
    i++
  }
  out.push(current.trim())
  return out
}

const EMITS = new Map(repos.map((repo) => [repo, sources.has(repo) ? emitsOf(repo) : new Map()]))
const emits = (repo, topic) => (EMITS.get(repo)?.get(topic)?.length ?? 0) > 0
const emitSite = (repo, topic) => EMITS.get(repo)?.get(topic)?.[0]?.where ?? '(nowhere)'

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

function tablesOf(repo) {
  const groups = new Map()
  for (const file of sources.get(repo) ?? []) {
    const decls = [...file.text.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/gm)]
    for (const m of file.text.matchAll(/'([a-z0-9_.]+)'/g)) {
      if (!TOPIC_SHAPE.test(m[1])) continue
      let owner = null
      for (const d of decls) {
        if (d.index < m.index) owner = d[1]
        else break
      }
      const key = `${file.path}::${owner ?? '(top level)'}`
      if (!groups.has(key)) groups.set(key, { file: file.path, owner, members: [] })
      groups.get(key).members.push({ topic: m[1], where: `${file.path}:${lineOf(file.text, m.index)}` })
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
 * pattern (notify/src/topics.ts:106), moved to the only checkout that can see both halves.
 */
const gaps = new Map()
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
    if (!/^[a-z-]+:[a-z0-9_.]+$/.test(key)) {
      errors.push(`${gapsPath}: '${key}' is not a '<kind>:<topic>' key`)
      continue
    }
    if (typeof entry?.owner !== 'string' || typeof entry?.evidence !== 'string' || entry.evidence.length < 80) {
      errors.push(
        `${gapsPath}: the record for '${key}' names no owning repository, or its evidence is under eighty characters — that is a hole, not a decision`,
      )
      continue
    }
    gaps.set(key, entry)
  }
}
const recorded = new Set()
function record(topic, kind, message) {
  const key = `${kind}:${topic}`
  const entry = gaps.get(key)
  if (entry) {
    recorded.add(key)
    notes.push(`recorded ${key} — ${entry.owner} fixes it: ${entry.evidence}`)
    return
  }
  errors.push(message)
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
    `${topic}: registered, and no \`topic:\` in ${producer}/src ever names it. Every consumer classifying it is waiting for a fact that is never sent — identity.user.registered was exactly this, for the whole life of the service.`,
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
      // judge. `web.page.viewed` (analytics/src/catalogue.ts:327) is a browser event posted to an
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
        `${member.topic}: ${repo} holds a rule for it at ${member.where}, in a table of registered topics, and ${producer} emits no such thing. A rule for a topic nobody sends reports itself as coverage and can never fire.`,
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
 * `unreferencedEmitters` (identity/src/topics.ts:144) applied to every producer in the estate,
 * including the twenty that never wrote one.
 *
 * It is a syntactic proxy and says so: it catches an emitter with no caller, and it does not prove
 * the caller is itself reachable. A chain of dead functions calling each other satisfies it.
 */
function unreferencedEmitters(repo) {
  const files = sources.get(repo) ?? []
  // An emit site is one this checker RESOLVED, not one that looks like an emit. The first version
  // read the declaration text for `topic:` and called `describeTopic(topic: IdentityTopic)` an
  // emitter — it had matched a parameter's type annotation.
  const sites = []
  for (const [, where] of EMITS.get(repo) ?? new Map()) for (const site of where) sites.push(site)
  const emitters = []
  for (const file of files) {
    for (const match of file.text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
      const rest = file.text.slice(match.index)
      const end = rest.search(/\n\}/)
      const bodyEnd = match.index + (end === -1 ? rest.length : end)
      if (sites.some((s) => s.file === file.path && s.offset > match.index && s.offset < bodyEnd)) {
        emitters.push({ name: match[1], file: file.path, line: lineOf(file.text, match.index) })
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
    if (references === 0) dead.push(`${emitter.name} (${emitter.file}:${emitter.line})`)
  }
  return dead.sort()
}

for (const repo of repos) {
  if (!sources.has(repo)) continue
  for (const dead of unreferencedEmitters(repo)) {
    errors.push(
      `${dead}: it emits, and nothing else in ${repo}/src refers to it. The topic has a producer on paper and none in the running service — emitSessionRevoked, again.`,
    )
  }
}

// ---------------------------------------------------------------- stale records
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
