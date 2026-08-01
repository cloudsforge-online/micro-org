// The compatibility checker is the only thing standing between an edited contract and a runtime
// failure in a repository whose CI never sees the change. So each fixture pair below is a shape
// that has to be judged correctly, and each names the consumer failure it stands for.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  widensScalar,
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

test('a literal widened to its own primitive passes, and any other scalar change does not', () => {
  // The rule `widened-union` above already applies, applied to scalars. It exists because `as
  // const` sweeps provenance into the public TYPE: `micro-sdk`'s `ROUTES.*.verifiedAt` is a
  // `<repo>/src/server.ts:<line>` citation whose whole value is being correct, and judging its
  // correction as a breaking change to consumers made the rule "never correct a citation".
  // The fixture also carries one deliberate non-widening, asserted in the next case, so the claim
  // here is that the two widenings are NOT among the breaking findings.
  assert.deepEqual(
    breaking('widened-scalar').map((finding) => finding.path),
    ['Spec.retries'],
  );
  const widened = judge('widened-scalar').filter((finding) => finding.kind === 'widened-scalar');
  assert.deepEqual(
    widened.map((finding) => finding.path).sort(),
    ['ROUTE.verifiedAt', 'ROUTE.weight'],
  );
});

test('a literal swapped for a DIFFERENT literal is still breaking', () => {
  // The half that keeps the relaxation honest. Same fixture, so it cannot go stale separately:
  // `Spec.retries` moves 2 → 5, which widens nothing.
  const changed = judge('widened-scalar').filter((finding) => finding.kind === 'type-changed');
  assert.deepEqual(changed.map((finding) => finding.path), ['Spec.retries']);
  assert.ok(changed[0]?.breaking, 'a different literal is not a widening');
});

test('widensScalar accepts only a literal and its own base primitive', () => {
  for (const [before, after] of [
    ['"a"', 'string'],
    ["'a'", 'string'],
    ['42', 'number'],
    ['-1.5e3', 'number'],
    ['7n', 'bigint'],
    ['true', 'boolean'],
  ] as const) {
    assert.equal(widensScalar(before, after), true, `${before} -> ${after}`);
  }
  for (const [before, after] of [
    // The finding this must never swallow: a field whose type genuinely changed.
    ['"a"', 'number'],
    ['42', 'string'],
    ['string', 'number'],
    ['string', 'unknown'],
    // A union is not the base primitive, and `any` is not a widening anybody asked for.
    ['"a"', 'string | null'],
    ['"a"', 'any'],
  ] as const) {
    assert.equal(widensScalar(before, after), false, `${before} -> ${after}`);
  }
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
  for (const fixture of ['added-optional', 'narrowed-union', 'widened-union', 'widened-scalar', 'removed-export']) {
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

/* --------------------------- the checker's own resolution ---------------------------- */

test("a package's OWN node_modules is linked, not just the workspace root's", () => {
  // The defect: in a pnpm workspace the root holds hoisted tooling and a package's real
  // dependencies — including the sibling contract packages whose types matter most here — live in
  // `packages/<name>/node_modules`. Linking only the root left the BASE side unable to resolve
  // them, so every type that flowed through a sibling degraded to `any` and the head side's real
  // types all read as `type-changed`: "AssetCode was scalar (any), is now union". That is a
  // breaking verdict on code nobody touched, on the one check standing between a removed contract
  // field and a runtime break in a consumer whose CI never sees the change.
  const root = scratchRepo();
  try {
    const real = realpathSync(root);
    mkdirSync(path.join(real, 'node_modules'), { recursive: true });
    mkdirSync(path.join(real, 'packages', 'money', 'node_modules', 'dep'), { recursive: true });

    const found = checkoutPackageAtRef(real, 'packages/money', 'HEAD');
    assert.ok(found, 'expected the package to be found at HEAD');
    // The scratch checkout must see the package's own dependency, reached through the link.
    assert.ok(
      existsSync(path.join(found.packageDir, 'node_modules', 'dep')),
      "the package's own node_modules was not linked into the checkout",
    );
    found.cleanup();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('well-known symbol members are not surface — their names carry an unstable compiler id', () => {
  // TypeScript spells these `__@unscopables@1100`, where the number is its internal symbol id for
  // THAT compilation. It moves whenever anything upstream changes, so identical code compared
  // against itself produced matched `removed`/`added` pairs — hundreds of them on one readonly
  // array constant, every one judged breaking. No consumer can read them either; they are
  // Array.prototype's plumbing.
  const dir = mkdtempSync(path.join(tmpdir(), 'cfcompat-sym-'));
  try {
    const file = path.join(dir, 'index.ts');
    writeFileSync(file, "export const ENTRY_KINDS = ['debit', 'credit'] as const\n");
    const surface = surfaceOfEntry(file);
    const symbolish = [...surface.entries.keys()].filter((key) => key.includes('__@'));
    assert.deepEqual(symbolish, [], `well-known symbol members leaked into the surface: ${symbolish.join(', ')}`);
    // The real surface is still there — this must not be a blanket mute.
    assert.ok([...surface.entries.keys()].some((key) => key.startsWith('ENTRY_KINDS')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
