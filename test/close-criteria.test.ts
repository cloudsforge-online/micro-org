/**
 * The estate's close criteria, pinned.
 *
 * `README.md` says of its own prose: *"This paragraph said 'at least nine' for as long as the number
 * was nine; a count in prose is a claim, and claims here get re-checked."* It then states a count in
 * prose two paragraphs later and nothing checked it. This file is that check.
 *
 * It is here because of micro-org#390, whose whole subject is a rule that existed and was not
 * applied. A close criterion deleted in a tidy-up, or a numbered list that grows an item while the
 * sentence above it still says "four", is the same defect one layer down: the document disagrees
 * with itself, and the reader believes whichever half they read first.
 *
 * Deliberately narrow. It does not review the prose, it asserts two things a diff can silently get
 * wrong: that the count matches the list, and that the mainnet-measurement rule is still in it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const README = readFileSync(path.join(here, '..', 'README.md'), 'utf8');

/** The numbered list under "no fix is complete until the issue is closed with the evidence". */
const HEADING = '### And the other half: no fix is complete until the issue is closed with the evidence';

function closeCriteriaSection(): string {
  const start = README.indexOf(HEADING);
  assert.notEqual(start, -1, 'the close-criteria section has been renamed or removed');
  // It runs to the next `---` rule, which is the next top-level break in the file.
  const end = README.indexOf('\n---', start);
  assert.notEqual(end, -1, 'the close-criteria section is no longer terminated by a horizontal rule');
  return README.slice(start, end);
}

const WORDS: Record<string, number> = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8 };

describe('the estate close criteria', () => {
  it('states a count in prose that matches the list under it', () => {
    const section = closeCriteriaSection();

    const claimed = /(One|Two|Three|Four|Five|Six|Seven|Eight) things follow from it/.exec(section);
    assert.ok(claimed, 'the section no longer says how many things follow from it');
    const expected = WORDS[claimed[1]!]!;

    // Top-level ordered items only: a nested list or a table row inside a rule is indented.
    const items = section.split('\n').filter((line) => /^\d+\. \*\*/.test(line));
    assert.equal(
      items.length,
      expected,
      `the prose claims ${expected} rules and the list has ${items.length} — a count in prose is a claim`,
    );

    // Numbered from 1, in order, with nothing skipped or repeated.
    assert.deepEqual(
      items.map((line) => Number(line.slice(0, line.indexOf('.')))),
      Array.from({ length: expected }, (_, i) => i + 1),
    );
  });

  it('still requires a mainnet measurement to close a mainnet ticket', () => {
    const section = closeCriteriaSection();

    // The rule micro-org#390 asked for. #243 was closed on a testnet measurement, #392 nearly on a
    // CI run, #384's sweep ran against the wrong network — three tickets, one mistake, and the
    // mistake is that an artefact was verified and a running system was not.
    // The whole rule, not its first line: the exclusions below sit on the continuation lines, and a
    // rule that keeps its headline and loses its body is exactly the drift worth catching.
    const lines = section.split('\n');
    const first = lines.findIndex((line) => /^\d+\. \*\*.*MAINNET measurement/.test(line));
    assert.notEqual(first, -1, 'the mainnet-measurement close criterion is gone from the README');
    const after = lines.slice(first + 1).findIndex((line) => /^\d+\. \*\*/.test(line));
    const rule = lines.slice(first, after === -1 ? undefined : first + 1 + after).join('\n');

    // The negative half is the load-bearing half. "Closed by a mainnet measurement" without saying
    // what does NOT count is advice; naming the three near-misses is a rule, and each of them is a
    // thing this estate actually did.
    for (const excluded of ['testnet', 'CI', 'merged diff']) {
      assert.ok(
        rule.includes(excluded),
        `the rule no longer says a ${excluded} measurement does not close a mainnet ticket`,
      );
    }
  });
});
