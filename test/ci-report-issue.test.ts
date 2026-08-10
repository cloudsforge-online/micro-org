/**
 * Which issue the nightly sweep is allowed to comment on and close — micro-org#342.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DECOY IS THE POINT.
 *
 * The reporter chose its issue as "the first open issue carrying `estate-invariant`". That
 * selector is green on every input: it always returns something, and something is always closable.
 * On 2026-08-10 what it returned was micro-org#38, a person's retrospective that carries the label
 * because the pattern it describes spans repositories — commented on at 02:09Z with an unrelated
 * failure, closed at 08:09Z with "The sweep is green again".
 *
 * So the test that matters is not "does it find its own report". It is "does it REFUSE a
 * human-authored issue wearing the same label", which is precisely the input the old selector was
 * never given. Every case below that ends in a refusal is red against the code as it stood that
 * morning; the two that end in a selection are green against it too, and are here only so that the
 * fix cannot be "refuse everything".
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { selectReportIssue, WORKFLOW_AUTHOR } from '../tools/ci-report-issue.mjs'

const SELECTOR = fileURLToPath(new URL('../tools/ci-report-issue.mjs', import.meta.url))
const WORKFLOW = fileURLToPath(new URL('../.github/workflows/estate-ci.yml', import.meta.url))

/** The exact title the reporter opens with, read from the workflow so the two cannot drift. */
const TITLE = (() => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const match = /^\s*ESTATE_CI_ISSUE_TITLE:\s*'([^']+)'\s*$/m.exec(yaml)
  assert.ok(match, 'estate-ci.yml must declare ESTATE_CI_ISSUE_TITLE once, in single quotes')
  return match[1] as string
})()

/** The shape `gh issue list --json number,title,author` returns, as measured on 2026-08-10. */
const bot = (number: number, title: string = TITLE) => ({
  number,
  title,
  author: { login: WORKFLOW_AUTHOR, is_bot: true },
})
const person = (number: number, title: string) => ({
  number,
  title,
  author: { login: 'savvaniss', is_bot: false },
})

describe('choosing the reporter’s own issue', () => {
  it('refuses a person’s issue that carries the same label', () => {
    // micro-org#38, as it actually was: a hand-written retrospective, correctly labelled, open, and
    // first in the list. The old selector returned 38 here and closed it.
    const decoy = person(38, 'The pattern worth keeping: nineteen defects were found because a check went red')
    const { number, declined } = selectReportIssue([decoy], { title: TITLE })
    assert.equal(number, null, 'a person’s issue is never this reporter’s to close')
    assert.deepEqual(declined, [`#38 — opened by savvaniss, not by ${WORKFLOW_AUTHOR}`])
  })

  it('refuses a person’s issue even when it is titled exactly like the report', () => {
    // Somebody quoting the reporter's title in a follow-up issue is not far-fetched — it is how you
    // would name the issue you open BECAUSE of the report. Author is checked first for that reason.
    const { number, declined } = selectReportIssue([person(400, TITLE)], { title: TITLE })
    assert.equal(number, null)
    assert.equal(declined.length, 1)
  })

  it('refuses a bot issue belonging to a different reporter', () => {
    // `cross-repo.yml` shares this label and opens its own issues under the same author. Closing
    // one of those from here would announce that an invariant this job never looked at is fixed —
    // which is the sentence its own close step already has a comment about.
    const other = bot(401, 'cross-repo: a reader of contracts disagrees with it')
    const { number, declined } = selectReportIssue([other], { title: TITLE })
    assert.equal(number, null)
    assert.match(declined[0] ?? '', /^#401 — a app\/github-actions issue, but titled "cross-repo/)
  })

  it('finds its own report among the decoys, wherever it sits in the list', () => {
    const rows = [
      person(38, 'The pattern worth keeping'),
      bot(401, 'cross-repo: a reader of contracts disagrees with it'),
      bot(402),
      person(403, 'Two claims that did not survive verification'),
    ]
    const { number, declined } = selectReportIssue(rows, { title: TITLE })
    assert.equal(number, 402)
    assert.equal(declined.length, 3, 'and it says what it passed over')
  })

  it('an empty list is not a refusal', () => {
    // The ordinary state of a healthy estate. It must be distinguishable from "three issues are
    // open and none is mine", because the caller opens a new issue on the first and must not on
    // the second's account.
    assert.deepEqual(selectReportIssue([], { title: TITLE }), { number: null, declined: [] })
  })

  it('two of its own means the older one, and the newer one is named', () => {
    // Only reachable if a previous run died between opening and closing. The older carries the
    // history; the newer is a defect in its own right and is not swallowed silently.
    const { number, declined } = selectReportIssue([bot(500), bot(410)], { title: TITLE })
    assert.equal(number, 410)
    assert.deepEqual(declined, ['#500 — a second open report; #410 is older and carries the history'])
  })

  it('a malformed row is declined, not thrown on', () => {
    // `gh` has changed its JSON shape before. A crash here takes the whole reporting step with it,
    // on a run that was already failing — the worst possible moment to lose the report.
    const { number, declined } = selectReportIssue([{ title: TITLE }, bot(411)], { title: TITLE })
    assert.equal(number, 411)
    assert.match(declined[0] ?? '', /^a row with no issue number/)
  })

  it('refuses to run without the title it is selecting on', () => {
    assert.throws(() => selectReportIssue([bot(1)], { title: '' }), /exact title/)
  })
})

describe('the selector as the workflow actually invokes it', () => {
  const run = (stdin: string, ...args: string[]) =>
    spawnSync(process.execPath, [SELECTOR, ...args], { input: stdin, encoding: 'utf8' })

  it('prints nothing on stdout for a decoy, and exits 0', () => {
    // The end-to-end shape of the 2026-08-10 incident: stdout is what the shell captures into
    // `$open`, and empty means "open a new issue", which is the correct action when the only thing
    // open is somebody else's. Exit 0 because a green sweep must not go red over the tracker.
    const decoy = JSON.stringify([person(38, 'The pattern worth keeping')])
    const out = run(decoy, '--title', TITLE)
    assert.equal(out.status, 0)
    assert.equal(out.stdout, '')
    assert.match(out.stderr, /declined #38 — opened by savvaniss/)
    assert.match(out.stderr, /::warning::/)
  })

  it('prints the bare number for its own report, with no newline for the shell to keep', () => {
    const out = run(JSON.stringify([bot(402)]), '--title', TITLE)
    assert.equal(out.status, 0)
    assert.equal(out.stdout, '402')
  })

  it('empty input is silent on stdout and does not warn', () => {
    const out = run('', '--title', TITLE)
    assert.equal(out.status, 0)
    assert.equal(out.stdout, '')
    assert.doesNotMatch(out.stderr, /::warning::/)
  })

  it('unparseable input is an error, not an empty answer', () => {
    // A `gh` failure leaves stdout empty or truncated. Reading that as "nothing open" is how a
    // reporter opens a duplicate issue on every transient API error until somebody notices thirty.
    const out = run('{"partial": ', '--title', TITLE)
    assert.equal(out.status, 2)
    assert.equal(out.stdout, '')
    assert.match(out.stderr, /::error::/)
  })

  it('refuses to run with no --title', () => {
    const out = run(JSON.stringify([bot(1)]))
    assert.equal(out.status, 2)
    assert.equal(out.stdout, '')
  })
})

describe('the workflow is wired to it', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')

  it('the title is declared once and never spelled again', () => {
    // The drift this prevents: the create step's title moves, the select steps' does not, and the
    // reporter opens a fresh issue every night and closes none of them. Invisible until the tracker
    // has thirty. One literal makes it unrepresentable rather than merely unlikely.
    const declarations = yaml.match(/ESTATE_CI_ISSUE_TITLE:\s*'/g) ?? []
    assert.equal(declarations.length, 1)
    const uses = yaml.match(/\$ESTATE_CI_ISSUE_TITLE|\$\{ESTATE_CI_ISSUE_TITLE\}/g) ?? []
    assert.ok(uses.length >= 3, `the create, comment and close steps must all read it (saw ${uses.length})`)
    assert.ok(
      !yaml.includes(`"${TITLE}"`),
      'the title must not appear as a second literal anywhere in the workflow',
    )
  })

  it('an issue number or nothing ever reaches `gh issue comment|close`', () => {
    // Found by running the two steps against a `gh` stub rather than by reading them: whatever the
    // capture produces becomes the ARGUMENT, so a partial response or a changed `--jq` addresses a
    // comment to a garbage number. Both steps must reduce `$open` to digits or empty first.
    const guards = yaml.match(/case "\$open" in ''\|\*\[!0-9\]\*\) open="" ;; esac/g) ?? []
    assert.equal(guards.length, 2, 'the reporting step and the closing step both need the guard')
  })

  it('no step picks an issue by taking the first one carrying the label', () => {
    // The defect itself, as a pattern, so it cannot come back in a fourth reporter. Comments are
    // stripped first: this file and the workflow both have to be able to WRITE `.[0]` while
    // explaining why it was wrong, and a check that punishes its own documentation gets reworded
    // rather than obeyed.
    const code = yaml
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')
    const labelQueries = code.split('--label estate-invariant').slice(1)
    assert.ok(labelQueries.length > 0, 'the reporter still queries by label')
    for (const query of labelQueries) {
      const head = query.slice(0, 400)
      if (!head.includes('--json')) continue
      const narrowed =
        /node "\$(selector|\{TOOLS[^}]*\}\/tools\/ci-report-issue\.mjs)"/.test(head) ||
        head.includes('ci-report-issue.mjs') ||
        (head.includes('--author app/github-actions') && head.includes('in:title'))
      assert.ok(narrowed, `a label query that is not narrowed by author and title:\n${head}`)
    }
  })
})
