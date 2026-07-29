// The compatibility checker is the only thing standing between an edited contract and a runtime
// failure in a repository whose CI never sees the change. So each fixture pair below is a shape
// that has to be judged correctly, and each names the consumer failure it stands for.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  checkoutPackageAtRef,
  classifyRole,
  compareSurfaces,
  entryFileOf,
  surfaceOfEntry,
  type Finding,
} from '../tools/compat.ts';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function judge(fixture: string): Finding[] {
  const base = surfaceOfEntry(path.join(FIXTURES, fixture, 'base.ts'));
  const head = surfaceOfEntry(path.join(FIXTURES, fixture, 'head.ts'));
  return compareSurfaces(base, head);
}

function breaking(fixture: string): Finding[] {
  return judge(fixture).filter((finding) => finding.breaking);
}

test('an added optional field passes', () => {
  assert.deepEqual(breaking('added-optional'), []);
  const added = judge('added-optional').filter((finding) => finding.kind === 'added');
  assert.deepEqual(
    added.map((finding) => finding.path),
    ['Posting.memo'],
  );
});

test('an added required field on an input type fails', () => {
  const findings = breaking('added-required-input');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'added-required');
  assert.equal(findings[0]?.path, 'PostEntryRequest.actor');
});

test('an added required field on an output type passes', () => {
  // The pair that proves the input/output split does real work rather than failing everything.
  assert.deepEqual(breaking('added-required-output'), []);
});

test('a removed field fails', () => {
  const findings = breaking('removed-field');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'removed');
  assert.equal(findings[0]?.path, 'Wallet.label');
});

test('a renamed field fails, and the message names the new key', () => {
  const findings = breaking('renamed-field');
  const removed = findings.find((finding) => finding.kind === 'removed');
  assert.equal(removed?.path, 'Deposit.userId');
  // A rename reported as a bare removal sends the reader looking for a field nobody deleted.
  assert.match(removed?.detail ?? '', /renamed to 'Deposit\.accountId'/);
});

test('a widened union passes', () => {
  assert.deepEqual(breaking('widened-union'), []);
});

test('a narrowed union fails, naming the value that was withdrawn', () => {
  const findings = breaking('narrowed-union');
  const narrowed = findings.find((finding) => finding.kind === 'narrowed-union');
  assert.ok(narrowed, 'expected a narrowed-union finding');
  assert.match(narrowed.detail, /"stuck"/);
});

test('a removed export fails as a removed export, not as a pile of removed fields', () => {
  const findings = breaking('removed-export');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'removed-export');
  assert.equal(findings[0]?.path, 'Reversal');
});

test('a guaranteed field on an output becoming optional fails', () => {
  const findings = breaking('weakened-guarantee');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'weakened-guarantee');
  assert.equal(findings[0]?.path, 'Quote.price');
});

test('an optional field on an input becoming required fails', () => {
  const findings = breaking('now-required');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'now-required');
  assert.equal(findings[0]?.path, 'CreateWalletRequest.label');
});

test('a required field on an input becoming optional passes', () => {
  assert.deepEqual(breaking('relaxed-input'), []);
});

test('comparing a surface with itself finds nothing', () => {
  // The check runs on every push. A false positive on an unchanged package would train everybody
  // to ignore it, which costs more than not having it.
  for (const fixture of ['added-optional', 'narrowed-union', 'widened-union', 'removed-export']) {
    const surface = surfaceOfEntry(path.join(FIXTURES, fixture, 'head.ts'));
    assert.deepEqual(compareSurfaces(surface, surface), [], `${fixture} is not stable against itself`);
  }
});

test('nested object fields are compared, not just the top level', () => {
  const base = surfaceOfEntry(path.join(FIXTURES, 'widened-union', 'base.ts'));
  assert.ok(base.entries.has('Address.family'), 'expected the nested path Address.family');
  assert.equal(base.entries.get('Address.family')?.kind, 'union');
});

test('input types are recognised by suffix, and a JSDoc tag overrules the suffix', () => {
  assert.equal(classifyRole('PostEntryRequest', []), 'input');
  assert.equal(classifyRole('CreateWalletParams', []), 'input');
  assert.equal(classifyRole('Balance', []), 'output');
  assert.equal(classifyRole('Balance', ['input']), 'input');
  assert.equal(classifyRole('PostEntryRequest', ['output']), 'output');
});

test('the package entry is found from src, never from a stale dist', () => {
  // dist is a build artifact. Reading it would compare whatever was last built, which on a base
  // ref is usually nothing at all — the fixture's dist deliberately disagrees with its src.
  const entry = entryFileOf(path.join(FIXTURES, 'entry-package'));
  assert.ok(entry.endsWith(path.join('src', 'index.ts')), `expected a src entry, got ${entry}`);
  const surface = surfaceOfEntry(entry);
  assert.ok(!surface.entries.has('Fixture.staleFieldThatWasNeverInSource'));
});

// -- reading a package at a git ref --------------------------------------------------------------

function scratchRepo(): string {
  // realpath, because on macOS os.tmpdir() is /var/folders/... behind a /private symlink. That
  // difference is the bug this whole block exists to guard.
  const root = mkdtempSync(path.join(tmpdir(), 'cfcompat-test-'));
  mkdirSync(path.join(root, 'packages', 'money', 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'packages', 'money', 'package.json'),
    '{"name":"@cloudsforge/contracts-money","version":"1.0.0","types":"src/index.ts"}\n',
  );
  writeFileSync(path.join(root, 'packages', 'money', 'src', 'index.ts'), 'export interface Posting { amount: string }\n');
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  };
  run(['init', '-q']);
  run(['config', 'user.email', 'ci@cloudsforge.test']);
  run(['config', 'user.name', 'ci']);
  run(['add', '-A']);
  run(['commit', '-qm', 'base']);
  return root;
}

test('a package is found at a git ref even when the path reaches it through a symlink', () => {
  // The bug: /tmp is a symlink to /private/tmp, so `git rev-parse --show-toplevel` answered with
  // the resolved path while the argument did not, the relative path between them climbed out of
  // the repository, and the archive failed. The failure was swallowed as 'this package is new,
  // nothing to check' — a green tick on a package the checker never looked at.
  const root = scratchRepo();
  try {
    const real = realpathSync(root);
    const found = checkoutPackageAtRef(real, 'packages/money', 'HEAD');
    assert.ok(found, 'expected the package to be found at HEAD');
    const surface = surfaceOfEntry(entryFileOf(found.packageDir));
    assert.ok(surface.entries.has('Posting.amount'));
    found.cleanup();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a package that genuinely did not exist at the base ref passes, and is not confused with an error', () => {
  const root = scratchRepo();
  try {
    assert.equal(checkoutPackageAtRef(realpathSync(root), 'packages/brand-new', 'HEAD'), undefined);
    // A bad ref is an error, not 'new'. Reporting it as new is how a check goes quiet.
    assert.throws(() => checkoutPackageAtRef(realpathSync(root), 'packages/money', 'no-such-ref'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
