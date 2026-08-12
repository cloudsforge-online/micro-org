#!/usr/bin/env bash
#
# Count the estate, reproducibly.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════
# WHY THIS IS A SCRIPT AND NOT A PARAGRAPH IN A README
# ══════════════════════════════════════════════════════════════════════════════════════════════
#
# The organisation profile publishes eleven numbers about this codebase. Every one of them was
# counted by hand, and the README already records what that costs: *"The two repository rows were
# previously 61 and 9 and had drifted, and the document row said 27 when micro-docs/ecosystem/
# holds 30 numbered documents."* Three of eleven figures wrong, discovered by accident.
#
# A hand count also cannot be compared with itself. The 2026-08-03 figure of 556,610 "lines of
# TypeScript" does not say whether it counted blank lines, comments, `.tsx`, or `dist/`, so the
# next person either guesses the method or publishes a number that is not comparable with the one
# it replaces. Both happened.
#
# So the method is the artifact, not the numbers. Run this, paste the table.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════
# THE METHOD, STATED SO IT CAN BE DISAGREED WITH
# ══════════════════════════════════════════════════════════════════════════════════════════════
#
#   - **Lines exclude blanks.** A blank line is formatting, not work, and counting it inflates
#     every figure by about 7% here. Comments are counted SEPARATELY rather than folded in or
#     thrown away: this codebase carries 237k comment lines against 542k of code, which is a real
#     property of it and is the wrong thing to either hide or quietly add to the headline.
#   - **`tokei`, not `cloc`.** Both are run below and they disagree by about 5% on code lines,
#     which is ordinary — they use different heuristics for JSX and for block comments. tokei is
#     the published figure because it classifies `.tsx` as its own language rather than folding it
#     into TypeScript, and 329 of these files are `.tsx`. cloc runs anyway as a cross-check: a
#     divergence beyond ~10% means one of them has started mis-parsing something.
#   - **`node_modules`, `dist`, `build` and `coverage` are excluded.** Vendored and generated code
#     is not work this organisation did.
#   - **Repository counts come from GitHub, not from the disk.** A checkout can be missing or
#     stale; the organisation is authoritative. The script fails loudly if the disk has fewer
#     checkouts than the organisation has public repositories, because in that case every code
#     figure below it is an undercount and should not be published.
#
# Usage:  org/tools/count-estate.sh            # from anywhere inside the estate
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT" || exit 1

EXCL_TOKEI=(--exclude node_modules --exclude dist --exclude build --exclude coverage)
EXCL_FIND='node_modules|/dist/|/build/|/coverage/'

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 — brew install $1" >&2; return 1; }; }
need tokei || exit 1
need gh || exit 1

echo "counted $(date -u '+%Y-%m-%d') from $ROOT"
echo

# ── repositories, from the organisation ───────────────────────────────────────────────────────
gh repo list cloudsforge-online --limit 300 --json name,isPrivate,isArchived > /tmp/cf-repos.json 2>/dev/null
PUBLIC=$(node -e 'const r=require("/tmp/cf-repos.json");console.log(r.filter(x=>!x.isPrivate&&!x.isArchived).length)')
ARCHIVED=$(node -e 'const r=require("/tmp/cf-repos.json");console.log(r.filter(x=>x.isArchived).length)')
LOCAL=$(ls -d */.git 2>/dev/null | wc -l | tr -d ' ')

echo "Repositories, public                 $PUBLIC"
echo "Repositories, archived               $ARCHIVED"
echo "  (checkouts on this disk            $LOCAL)"
if [ "$LOCAL" -lt "$PUBLIC" ]; then
  echo
  echo "!! $((PUBLIC - LOCAL)) public repositories are NOT checked out here. Every code figure below"
  echo "!! is an undercount. Run \`cfctl clone\` before publishing anything from this run." >&2
fi
echo

# ── deployables, from the newest release manifest ─────────────────────────────────────────────
# The manifest is the only list that is true by construction: it is generated from the registry
# and every entry was pulled and digest-verified. Counting directories would count checkouts that
# deploy nothing.
MANIFEST=$(ls -1 org/releases/*.yaml 2>/dev/null | sort -t. -k1,1 -k2,2n -k3,3n | tail -1)
if [ -n "$MANIFEST" ]; then
  SERVICES=$(grep -c 'kind: service' "$MANIFEST")
  OPS=$(grep -c 'kind: ops' "$MANIFEST")
  WEB=$(grep -c 'kind: web' "$MANIFEST")
  echo "Services that bind a port            $((SERVICES + OPS))   (${SERVICES} service + ${OPS} ops, from $(basename "$MANIFEST"))"
  echo "Frontends                            $WEB"
  echo
fi

# ── code ──────────────────────────────────────────────────────────────────────────────────────
tokei "${EXCL_TOKEI[@]}" -t TypeScript,Tsx -o json > /tmp/cf-tokei.json 2>/dev/null
node -e '
// Read tokei`s OWN Total rather than naming the languages. Naming them is how the first version
// of this script silently dropped every `.tsx` file: the JSON key is `TSX`, not `Tsx`, so
// `t["Tsx"]` was undefined, the `?? 0` swallowed it, and the script confidently published 2,228
// files and 493,408 lines instead of 2,557 and 542,243. A missing language looks exactly like a
// language with no files, which is the whole reason a hand-maintained list of keys is the wrong
// shape here.
const t = require("/tmp/cf-tokei.json");
const sum = (k) => t.Total?.[k] ?? 0;
const files = Object.entries(t)
  .filter(([name]) => name !== "Total")
  .reduce((n, [, lang]) => n + (lang?.reports?.length ?? 0), 0);
const fmt = (n) => n.toLocaleString("en-GB");
console.log("TypeScript / TSX files              ", fmt(files));
console.log("Lines of TypeScript, blanks excluded", fmt(sum("code") + sum("comments")));
console.log("  of which code                     ", fmt(sum("code")));
console.log("  of which comment                  ", fmt(sum("comments")));
console.log("  blank lines, NOT counted          ", fmt(sum("blanks")));
'
echo

# cloc is the cross-check, not the published figure. It is optional so the script still runs on a
# machine that has not installed it.
if command -v cloc >/dev/null 2>&1; then
  CLOC=$(cloc --exclude-dir=node_modules,dist,build,coverage,.git --include-lang=TypeScript,TSX --quiet --json . 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.SUM?.code??0))})' 2>/dev/null)
  echo "  cross-check, cloc code lines       ${CLOC:-unavailable}   (a >10% gap from tokei means one is mis-parsing)"
  echo
fi

# ── the rest ──────────────────────────────────────────────────────────────────────────────────
TESTS=$(find . \( -name '*.test.ts' -o -name '*.test.tsx' \) 2>/dev/null | grep -vE "$EXCL_FIND" | wc -l | tr -d ' ')
echo "Test files (node:test)               $TESTS"

# Every distinct table name any migration creates, across every service's own database.
TABLES=$(grep -rhoiE 'create table (if not exists )?[a-z_."]+' --include=*.sql --include=*.ts . 2>/dev/null \
  | grep -vE "$EXCL_FIND" | sed -E 's/.*[Tt]able (if not exists )?//I' | tr -d '"' | tr 'A-Z' 'a-z' | sort -u | wc -l | tr -d ' ')
echo "Distinct database tables             $TABLES"

# Route OBJECTS, which is how every service in this estate declares them — `{ method: 'GET',
# path: '/livez', ... }`. Test files are excluded: they build routes too, and counting them
# reports the test suite as API surface.
ROUTES=$(find . -name '*.ts' ! -name '*.test.ts' 2>/dev/null | grep -vE "$EXCL_FIND" \
  | xargs grep -hoE "method: '(GET|POST|PUT|PATCH|DELETE|OPTIONS)'" 2>/dev/null | wc -l | tr -d ' ')
echo "HTTP route declarations              $ROUTES"

DOCS=$(ls docs/ecosystem/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "Engineering documents                $DOCS"

SCENARIOS=$(grep -rhoE '\bBJ-[A-Z]+-[0-9]+' --include=*.ts . 2>/dev/null \
  | grep -vE "$EXCL_FIND" | sort -u | wc -l | tr -d ' ')
echo "Browser scenarios specified          $SCENARIOS"
