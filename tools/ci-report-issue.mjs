// ci-report-issue: which open issue, if any, is the sweep's own report?
//
//   usage: gh issue list … --json number,title,author \
//            | node tools/ci-report-issue.mjs --title "<the title the workflow opens with>"
//
// Prints the issue number on stdout when it finds its own report, and NOTHING on stdout otherwise.
// The reasoning always goes to stderr, including when the answer is "none" — see "silence is not a
// result" below. Exit status is 0 in every case a caller should continue from; a refusal is a
// `::warning::`, not a failure, because the sweep going green is a fact about the estate and must
// not be turned red by a fact about the issue tracker.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: micro-org#342
//
// The reporter used to choose its issue as "the first open issue carrying `estate-invariant`", and
// nothing in that sentence distinguishes an issue the workflow opened from one a person opened and
// labelled. On 2026-08-10 it commented an unrelated CI failure on micro-org#38 — a hand-written
// retrospective that carries the label because the pattern it describes spans repositories — and
// six hours later CLOSED it with "The sweep is green again". Neither event had anything to do with
// #38's contents. The close landed two and a half minutes before the pull request that actually
// resolved it merged, so the outcome was right and the reason recorded on the issue was wrong,
// which is the worse of the two failure modes: the issue now reads as settled by evidence it was
// never given.
//
// The blast radius was every issue a person labels `estate-invariant`. Measured the same day: of
// the eleven issues carrying that label, EIGHT were opened by a person and three by the workflow.
// The label's own description is "An invariant that spans repositories, so no single repository's
// CI can see it", which is exactly what a human retrospective about a cross-repository pattern is.
// The label is right. The selector was wrong.
//
// ## What identifies the workflow's own issue
//
// Two things it controls and a person does not casually reproduce: the AUTHOR is the app that runs
// the workflow, and the TITLE is the fixed string the workflow opens with. Measured against the
// real tracker on 2026-08-10, `gh issue list --json author` reports the workflow's issues with
// `author.login === 'app/github-actions'` and `author.is_bot === true`, and every human-authored
// issue carrying the label with `is_bot === false`. Both are required here rather than either: a
// bot-authored issue with a different title belongs to a DIFFERENT reporter — `cross-repo.yml`
// shares this label and opens its own — and closing that one from here would announce that an
// invariant this job never looked at is fixed.
//
// ## Why the filtering is here rather than in a `--author` flag on the query
//
// `gh issue list --author app/github-actions` would very likely work, and it is one flag. It is
// also unverifiable: if the qualifier ever stops matching, the query returns nothing, the reporter
// concludes there is no open issue, and it opens a NEW one every single run — a failure that looks
// like a working reporter and fills the tracker. Filtering a fetched list is a pure function over
// data, which is a thing a test can put a human-authored decoy in front of. The query stays as
// broad as it was.
//
// ## Silence is not a result
//
// The close step used to print "closed issue #N" whether N was its own report or somebody's
// retrospective, so it was green either way and its success was unobservable by construction. Every
// path below says which issues it looked at and which it declined and why. A refusal that does not
// name what it refused is the same log line as a run that had nothing to do.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The author login GitHub reports for the app that runs these workflows. */
export const WORKFLOW_AUTHOR = 'app/github-actions';

/**
 * Choose the reporter's own issue out of the open issues carrying the shared label.
 *
 * `candidates` is `gh issue list --json number,title,author` output: `{ number, title, author }`,
 * where `author` is `{ login, is_bot }`. `title` is the exact string the reporter opens with.
 *
 * Returns `{ number, declined }` when it found its own report, or `{ number: null, declined }`
 * when it did not. `declined` carries one line per candidate that was rejected and the reason, so
 * a caller can say what it looked at. An empty candidate list is not a refusal — it is the ordinary
 * state of a healthy estate — and yields `{ number: null, declined: [] }`.
 *
 * OLDEST WINS when more than one qualifies. Duplicates can only exist if a previous run failed
 * between opening and closing, and the older one carries the longer history; the newer ones are
 * named in `declined` rather than silently ignored, because two open reports is itself a defect.
 *
 * @typedef {{ number?: unknown, title?: unknown, author?: { login?: string } | null }} IssueRow
 * @param {readonly IssueRow[] | unknown} candidates
 * @param {{ title: string, author?: string }} options
 * @returns {{ number: number | null, declined: string[] }}
 */
export function selectReportIssue(candidates, { title, author = WORKFLOW_AUTHOR }) {
  if (typeof title !== 'string' || title.length === 0) {
    throw new Error('selectReportIssue needs the exact title the reporter opens with');
  }
  const rows = Array.isArray(candidates) ? candidates : [];
  /** @type {string[]} */
  const declined = [];
  /** @type {number[]} */
  const qualified = [];

  for (const row of rows) {
    const number = row?.number;
    if (typeof number !== 'number') {
      declined.push(`a row with no issue number: ${JSON.stringify(row)}`);
      continue;
    }
    const login = row?.author?.login ?? '(none)';
    if (login !== author) {
      declined.push(`#${number} — opened by ${login}, not by ${author}`);
      continue;
    }
    if (row?.title !== title) {
      declined.push(`#${number} — a ${author} issue, but titled ${JSON.stringify(row?.title ?? null)}`);
      continue;
    }
    qualified.push(number);
  }

  qualified.sort((a, b) => a - b);
  const [chosen, ...duplicates] = qualified;
  for (const number of duplicates) {
    declined.push(`#${number} — a second open report; #${chosen} is older and carries the history`);
  }
  return { number: chosen ?? null, declined };
}

/* ------------------------------------------------------------------------------ the CLI */

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  });
}

/**
 * `import.meta.filename` rather than comparing a URL to `process.argv[1]`: the workflow invokes
 * this by absolute path through `$TOOLS`, and a URL/path comparison has been wrong under at least
 * one of the two spellings every time somebody has written it.
 */
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const at = process.argv.indexOf('--title');
  const title = at === -1 ? '' : (process.argv[at + 1] ?? '');
  if (title === '') {
    process.stderr.write('::error::ci-report-issue: --title "<the reporter\'s own title>" is required\n');
    process.exit(2);
  }

  const raw = (await readStdin()).trim();
  let candidates = [];
  if (raw !== '') {
    try {
      candidates = JSON.parse(raw);
    } catch (error) {
      // A `gh` failure prints to stderr and leaves stdout empty or partial. Treating unparseable
      // input as "no candidates" would open a duplicate issue on every transient API error, so it
      // is louder than a refusal and the caller is told to read the log rather than trust this.
      const why = error instanceof Error ? error.message : String(error);
      process.stderr.write(`::error::ci-report-issue: could not parse the issue list: ${why}\n`);
      process.exit(2);
    }
  }

  const { number, declined } = selectReportIssue(candidates, { title });
  for (const line of declined) process.stderr.write(`ci-report-issue: declined ${line}\n`);

  if (number === null) {
    if (declined.length > 0) {
      process.stderr.write(
        `::warning::ci-report-issue: ${declined.length} open issue(s) carry the label and none is this reporter's own; leaving them alone\n`,
      );
    } else {
      process.stderr.write('ci-report-issue: nothing open under this label\n');
    }
  } else {
    process.stderr.write(`ci-report-issue: this reporter's own report is #${number}\n`);
    process.stdout.write(String(number));
  }
}
