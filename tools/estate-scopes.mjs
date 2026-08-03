// estate-scopes: the half of the scope registry that no single repository can prove.
//
//   usage: node tools/estate-scopes.mjs <estate-dir> <scope-audit.mjs> [--json]
//
// `service-ci.yml` proves **demands ⊆ registry**, one repository at a time: a gate asking for a
// scope `@cloudsforge/contracts-auth` does not name fails that repository's build, because identity
// would refuse to mint it (identity/src/env.ts:141). That is half of totality and it is the half a
// single checkout can see.
//
// The other half is **registry ⊆ demands**: a registered scope that no gate anywhere demands. From
// inside any one repository it is indistinguishable from a scope some *other* service enforces, so
// fifty-five green builds say nothing about it. It is a credential identity will happily mint, that
// opens nothing, and it makes a token look narrower than it is — the audit that reads the registry
// to find out what a caller could do gets a wrong answer. Only a checkout holding every gate can
// tell, and this is that checkout.
//
// THE DERIVATION IS NOT REIMPLEMENTED HERE. The union is built by running service-ci.yml's OWN
// scope-audit against each repository — the workflow step extracts it from that file and passes its
// path in. Three previous audit sweeps in this estate each missed a different demand shape (inline
// literals, sibling constants, wrapper third arguments, computed families); a second derivation
// would drift from the first, and the direction that fails silently is the one that only ever
// reports "nothing demands this".
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [, , estate, auditPath, ...flags] = process.argv
if (!estate || !auditPath) {
  console.error('usage: estate-scopes.mjs <estate-dir> <scope-audit.mjs> [--json]')
  process.exit(2)
}
const json = flags.includes('--json')

const AUTH_INDEX = join(estate, 'contracts/packages/auth/src/index.ts')
// Floors, for the same reason MIN_SERVICES exists in conformance's ledgeraccounts.ts: the whole
// output of this file is a set difference, and a set difference against an empty union accuses
// every scope in the registry at once, while a set difference against an empty registry passes.
const MIN_REGISTRY = 40
const MIN_REPOS_WITH_GATES = 18
const MIN_DEMANDS = 40

if (!existsSync(AUTH_INDEX)) {
  console.error(`estate-scopes: no scope registry at ${AUTH_INDEX} — this checkout is not the estate`)
  process.exit(2)
}

// ---------------------------------------------------------------- the registry, with its dead marked
const text = readFileSync(AUTH_INDEX, 'utf8')
const from = text.indexOf('export const SCOPES')
const to = text.indexOf('as const', from)
if (from < 0 || to < 0) {
  console.error(`estate-scopes: cannot find the SCOPES registry in ${AUTH_INDEX}`)
  process.exit(2)
}
const block = text.slice(from, to)
/** scope -> the `deprecated:` reason, or null when the registry states it is live. */
const REGISTRY = new Map()
for (const m of block.matchAll(/'([a-z][a-z0-9:-]+)':\s*Object\.freeze\(\{/g)) {
  let i = block.indexOf('{', m.index + m[0].length - 1)
  let depth = 0
  let end = i
  while (end < block.length) {
    if (block[end] === '{') depth++
    if (block[end] === '}') {
      depth--
      if (depth === 0) break
    }
    end++
  }
  const spec = block.slice(i, end)
  const deprecated = /\bdeprecated:\s*\n?\s*['"`]/.test(spec) ? spec.slice(spec.indexOf('deprecated:')).slice(0, 400) : null
  REGISTRY.set(m[1], deprecated)
}
if (REGISTRY.size < MIN_REGISTRY) {
  console.error(
    `estate-scopes: parsed ${REGISTRY.size} scopes out of the registry, expected at least ${MIN_REGISTRY} — the parser is broken, not the estate`,
  )
  process.exit(2)
}

// ---------------------------------------------------------------- the union of demands
const repos = readdirSync(estate).filter((d) => {
  try {
    return statSync(join(estate, d)).isDirectory() && existsSync(join(estate, d, 'src'))
  } catch {
    return false
  }
})

/** scope -> [ '<repo>: <provenance>' ] */
const demands = new Map()
const unsound = []
const missing = new Map()
let audited = 0

for (const repo of repos) {
  const exemptions = join(estate, repo, 'scope-exemptions.json')
  let stdout = ''
  let stderr = ''
  try {
    stdout = execFileSync('node', [auditPath, join(estate, repo, 'src'), AUTH_INDEX, exemptions], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (error) {
    if (error.status === undefined) {
      console.error(`estate-scopes: could not run the audit against ${repo} — ${error.message}`)
      process.exit(2)
    }
    stdout = error.stdout ?? ''
    stderr = error.stderr ?? ''
    // Exit 2 is the audit refusing to answer at all (no registry, no source directory). Exit 1 is an
    // answer that contains a failure. Only the first makes the union unusable by itself.
    if (error.status === 2) {
      unsound.push(`${repo}: the audit refused to run — ${stderr.trim().split('\n')[0] ?? '(no message)'}`)
      continue
    }
  }
  audited += 1

  // A demand this checker could not resolve makes the UNION INCOMPLETE, and every verdict below is
  // of the form "nothing demands this". An incomplete union does not produce a weaker answer, it
  // produces a WRONG one — a live scope reported as dead because the gate that demands it was
  // written in a shape the derivation cannot read. So it is fatal, not a warning.
  for (const line of stderr.split('\n')) {
    if (/fail, do not guess|not provably closed|cannot close|the derivation is wrong/.test(line)) {
      unsound.push(`${repo}: ${line.trim()}`)
    }
  }

  let current = null
  for (const line of stdout.split('\n')) {
    const verdict = line.match(/^(registered|exempted|MISSING)\s+(\S+)$/)
    if (verdict) {
      current = verdict[2]
      if (!demands.has(current)) demands.set(current, [])
      if (verdict[1] === 'MISSING') missing.set(current, repo)
      continue
    }
    const provenance = line.match(/^\s{6,}(\S.*)$/)
    if (provenance && current) demands.get(current).push(`${repo}: ${provenance[1]}`)
  }
}

const withGates = new Set([...demands.values()].flat().map((p) => p.split(':')[0]))
const errors = []

if (audited < 1 || withGates.size < MIN_REPOS_WITH_GATES) {
  console.error(
    `estate-scopes: only ${withGates.size} repositories contributed a demand (audited ${audited} of ${repos.length}), expected at least ${MIN_REPOS_WITH_GATES}. A union this small would report most of the registry as dead.`,
  )
  process.exit(2)
}
if (demands.size < MIN_DEMANDS) {
  console.error(
    `estate-scopes: the union holds ${demands.size} demanded scope(s), expected at least ${MIN_DEMANDS} — this is a partial estate, and a partial estate accuses live scopes of being dead`,
  )
  process.exit(2)
}

// ---------------------------------------------------------------- the two verdicts
//
// 1. A LIVE SCOPE NOTHING DEMANDS. The direction that needs every gate in one place.
for (const [scope, deprecated] of [...REGISTRY].sort()) {
  if (deprecated || demands.has(scope)) continue
  errors.push(
    `${scope}: registered, live, and NO gate in any of the ${repos.length} repositories demands it. identity will mint it into a token that opens nothing, and every audit that reads the registry to answer "what could this caller do" gets a wrong answer. Either a gate is missing, or mark it \`deprecated:\` in contracts/packages/auth/src/index.ts with the reasoning — that field exists for exactly this and two scopes already carry it.`,
  )
}

// 2. A DEAD SCOPE SOMETHING DEMANDS. The self-emptying half: `deprecated` says "no gate demands it",
//    so a gate that does makes the registry's own statement false. contracts states the repair —
//    "if a service-to-service send route is ever built, revive this in the same commit as its gate".
for (const [scope, deprecated] of [...REGISTRY].sort()) {
  if (!deprecated || !demands.has(scope)) continue
  errors.push(
    `${scope}: marked \`deprecated\` in the registry — "no gate demands it" — and ${demands.get(scope).length} gate(s) demand it: ${demands.get(scope).join('; ')}. One of the two is wrong. A deprecation that outlives its truth is how a dead scope quietly becomes a live one that nothing reviews.`,
  )
}

// ---------------------------------------------------------------- report
const live = [...REGISTRY].filter(([, d]) => !d).length
console.log(
  `registry: ${REGISTRY.size} scopes, ${live} live, ${REGISTRY.size - live} deprecated · union: ${demands.size} demanded across ${withGates.size} repositories with gates (${audited} audited)`,
)
// service-ci.yml's verdict, not this one: a demanded-but-unregistered scope fails the build of the
// repository that demands it, where its author can fix it. Repeating that failure here would put a
// second red on a third party's defect, in a repository that cannot repair it. It is PRINTED because
// a repository that never calls service-ci.yml would otherwise be unchecked in both directions.
for (const [scope, repo] of [...missing].sort()) {
  console.log(`  census  ${scope}: demanded by ${repo}, in neither the registry nor its exemptions — service-ci.yml's verdict, reported here`)
}
for (const [scope, deprecated] of [...REGISTRY].sort()) {
  if (deprecated && !demands.has(scope)) console.log(`  note    ${scope}: deprecated, and confirmed dead by this run — nothing in the estate demands it`)
}
if (json) {
  console.log(JSON.stringify({ demanded: [...demands.keys()].sort(), registry: [...REGISTRY.keys()].sort() }, null, 2))
}

if (unsound.length > 0) {
  console.error(`\nestate-scopes: THE UNION IS INCOMPLETE — ${unsound.length} repository/repositories could not be read whole`)
  for (const u of unsound) console.error(`  ${u}`)
  console.error(`\nNo verdict is issued from a partial union: "nothing demands this scope" is only true of a complete one.`)
  process.exit(1)
}
if (errors.length > 0) {
  console.error(`\nestate-scopes: FAILED — ${errors.length} scope(s) where the registry and the estate's gates disagree`)
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
console.log(`\nestate-scopes: ok — every live scope is demanded by a gate, and every deprecated scope by none`)
