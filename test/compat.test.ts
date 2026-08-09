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
  applyAcceptedBreaks,
  checkoutPackageAtRef,
  classifyRole,
  compareVersions,
  compareSurfaces,
  entryFileOf,
  readAcceptedBreaks,
  surfaceOfEntry,
  widensFunctionSignature,
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

test('branding a type does not read as removing its fields', () => {
  // `micro-contracts` 326de9d branded `explorerTxUrl` so a wrong explorer URL could not be written
  // by hand, and this gate called it BREAKING: an intersection's flags do not include `Object`, so
  // the type collapsed to one scalar leaf and every field under it read as removed. The reader's
  // type was unchanged. Both halves are asserted, because "no breaking findings" would also pass
  // if the walker stopped seeing the fields altogether.
  assert.deepEqual(breaking('branded-alias'), []);
  const paths = [...surfaceOfEntry(path.join(FIXTURES, 'branded-alias', 'head.ts')).entries.keys()];
  assert.ok(paths.includes('ChainSpec.explorerTxUrl.mainnet'), 'mainnet is still walked');
  assert.ok(paths.includes('ChainSpec.explorerTxUrl.testnet'), 'testnet is still walked');
  // The brand is a unique symbol, whose checker-assigned name shifts between compilations.
  assert.ok(!paths.some((p) => p.includes('__@')), 'the brand itself is not surface');
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

test('a function signature that only gained union members passes — registering a topic is additive', () => {
  // The events registry's own shape: `topicSpec(topic: TopicName)` and the
  // `topic is TopicName` predicate both re-print the whole union in their signature text, so
  // every registered topic used to read as breaking — which would make the registry
  // unmaintainable, the exact trap widened-scalar closed for citations.
  assert.deepEqual(breaking('widened-function'), []);
  const widened = judge('widened-function').filter((finding) => finding.kind === 'widened-function');
  assert.deepEqual(
    widened.map((finding) => finding.path).sort(),
    ['describeTopic', 'isRegisteredTopic'],
  );
});

test('a function signature that LOST a union member is still breaking', () => {
  // The half that keeps the relaxation honest: a caller passing the removed member no longer
  // compiles, and the checker must keep saying so.
  const findings = breaking('narrowed-function');
  assert.ok(findings.some((finding) => finding.path === 'describeTopic' && finding.kind === 'type-changed'));
});

test('widensFunctionSignature accepts only bare-member union insertions', () => {
  for (const [before, after] of [
    // Appended, string literal.
    ['(t: "a" | "b") => void', '(t: "a" | "b" | "c") => void'],
    // Prepended, and in a type predicate.
    ['(t: string) => t is "a" | "b"', '(t: string) => t is "z" | "a" | "b"'],
    // A named type joining a union.
    ['(t: A) => R', '(t: A | B) => R'],
    // REORDERED members, with and without an addition. A union is a set — the printed order is
    // an accident of declaration order, and regrouping the scope registry's keys by service
    // reordered every union derived from `keyof typeof` without changing any type a consumer
    // can observe. Six such signatures read as breaking before this case existed.
    ['(t: "b" | "a") => void', '(t: "a" | "b") => void'],
    ['(t: "c" | "a") => void', '(t: "a" | "b" | "c") => void'],
    ['(t: string) => t is "c" | "a"', '(t: string) => t is "a" | "b" | "c" | "d"'],
  ] as const) {
    assert.equal(widensFunctionSignature(before, after), true, `${before} -> ${after}`);
  }
  for (const [before, after] of [
    // Unchanged is not a widening.
    ['(t: "a") => void', '(t: "a") => void'],
    // A removal, a swap, a retyped parameter, a new parameter, a changed return.
    ['(t: "a" | "b") => void', '(t: "a") => void'],
    ['(t: "a" | "b") => void', '(t: "a" | "c") => void'],
    // Reordering does not launder a removal or a swap: the sorted sets still differ.
    ['(t: "c" | "a" | "b") => void', '(t: "b" | "c") => void'],
    ['(t: "b" | "a") => void', '(t: "c" | "b") => void'],
    ['(t: string) => void', '(t: number) => void'],
    ['(t: "a") => void', '(t: "a", u: string) => void'],
    ['(t: "a") => string', '(t: "a") => number'],
    // A structurally rich member is not recognised — deliberately conservative.
    ['(t: "a") => void', '(t: "a" | { kind: string }) => void'],
  ] as const) {
    assert.equal(widensFunctionSignature(before, after), false, `${before} -> ${after}`);
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

/* --------------------------- accepted breaks ---------------------------- */

// A gate that cannot be satisfied is a gate that gets bypassed. micro-sdk#1 is the case: the
// correct fix for a client that decoded a field its server had stopped sending was to REMOVE two
// fields, every additive alternative was worse than the break, and there was no way to say so — so
// the only moves left were "do not fix the bug" and "merge red", and neither leaves a record.
//
// So the mechanism has to make taking a break cost something. Each test below is one of those
// costs, and the point of every one of them is that the waiver file must not become the thing this
// checker is protecting the estate from.

const removedField: Finding = {
  kind: 'removed',
  path: 'MintCatalogue.priceShards',
  detail: 'field removed',
  breaking: true,
};
const otherRemoved: Finding = { kind: 'removed', path: 'Token.priceShards', detail: 'field removed', breaking: true };
const REASON = 'mint stopped sending it when SHARD was retired, so the strict decoder threw on every live call';

test('with no waiver file, nothing changes — a break is still a break', () => {
  const split = applyAcceptedBreaks([removedField], [], '0.3.0', '0.2.0');
  assert.deepEqual(split.unwaived, [removedField]);
  assert.deepEqual(split.waived, []);
  assert.deepEqual(split.refusals, []);
});

test('a recorded break with a version bump is accepted, and keeps its reason for the log', () => {
  const split = applyAcceptedBreaks(
    [removedField, otherRemoved],
    [
      { path: removedField.path, acceptedIn: '0.3.0', reason: REASON },
      { path: otherRemoved.path, acceptedIn: '0.3.0', reason: REASON },
    ],
    '0.3.0',
    '0.2.0',
  );
  assert.deepEqual(split.unwaived, []);
  assert.deepEqual(split.refusals, []);
  assert.deepEqual(
    split.waived.map((finding) => finding.path),
    [removedField.path, otherRemoved.path],
  );
  // The reason travels with the finding because the run's log IS the record. A waiver that
  // silences the finding records nothing at all.
  assert.equal(split.waived[0]?.reason, REASON);
});

test('a break WITHOUT a version bump is refused — that is the condition that makes this honest', () => {
  // The whole value a consumer gets from this mechanism is that a break arrives with a version it
  // can pin away from. Without the bump, a consumer resolving the same range receives the break by
  // surprise, which is the failure this file's header exists to describe.
  const split = applyAcceptedBreaks([removedField], [{ path: removedField.path, acceptedIn: '0.2.0', reason: REASON }], '0.2.0', '0.2.0');
  assert.equal(split.refusals.length, 1);
  assert.match(split.refusals[0]!, /not greater than the base ref's 0\.2\.0/);
});

test('a waiver expires when the version moves on, rather than exempting the path for ever', () => {
  // Recorded for 0.3.0, package is now 0.4.0: the entry is stale, and a stale entry must fail the
  // build that carries it instead of quietly protecting nothing. This is the property that stops
  // compat-breaks.json becoming a permanent hole with a date on it.
  const split = applyAcceptedBreaks([removedField], [{ path: removedField.path, acceptedIn: '0.3.0', reason: REASON }], '0.4.0', '0.3.0');
  assert.deepEqual(split.unwaived, [removedField]);
  assert.equal(split.refusals.length, 1);
  assert.match(split.refusals[0]!, /records one release/);
});

test('a waiver for a path that is not breaking is itself an error', () => {
  // Every allowlist this estate has kept has decayed the same way: entries outlive the thing they
  // described and the file stops meaning anything. Unused is an error, so it cannot.
  const split = applyAcceptedBreaks([], [{ path: 'Token.gone', acceptedIn: '0.3.0', reason: REASON }], '0.3.0', '0.2.0');
  assert.equal(split.refusals.length, 1);
  assert.match(split.refusals[0]!, /is not breaking here/);
});

test('a waiver waives only the path it names', () => {
  const split = applyAcceptedBreaks(
    [removedField, otherRemoved],
    [{ path: removedField.path, acceptedIn: '0.3.0', reason: REASON }],
    '0.3.0',
    '0.2.0',
  );
  assert.deepEqual(split.unwaived, [otherRemoved]);
  assert.deepEqual(split.refusals, []);
});

test('an unversioned package cannot accept a break', () => {
  // A break nobody can pin away from is not a break anybody accepted.
  const split = applyAcceptedBreaks([removedField], [{ path: removedField.path, acceptedIn: '0.3.0', reason: REASON }], undefined, '0.2.0');
  assert.ok(split.refusals.some((refusal) => /no major\.minor\.patch version/.test(refusal)));
  assert.deepEqual(split.unwaived, [removedField]);
});

test('the waiver file is refused unless every entry says WHY, at length', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cfcompat-waiver-'));
  try {
    const file = path.join(dir, 'compat-breaks.json');
    assert.deepEqual(readAcceptedBreaks(dir), [], 'no file means no waivers, not an error');

    writeFileSync(file, JSON.stringify({ path: 'A.b' }));
    assert.throws(() => readAcceptedBreaks(dir), /must be an array/);

    // 40 characters, the number `deploy/compose/estate/grant-gaps.json` arrived at the same way: a
    // one-word reason is a field nobody read before filling in.
    writeFileSync(file, JSON.stringify([{ path: 'A.b', acceptedIn: '0.3.0', reason: 'renamed' }]));
    assert.throws(() => readAcceptedBreaks(dir), /at least 40 characters/);

    writeFileSync(file, JSON.stringify([{ path: 'A.b', acceptedIn: 'next', reason: REASON }]));
    assert.throws(() => readAcceptedBreaks(dir), /major\.minor\.patch/);

    writeFileSync(file, JSON.stringify([{ acceptedIn: '0.3.0', reason: REASON }]));
    assert.throws(() => readAcceptedBreaks(dir), /'path' must name/);

    writeFileSync(file, JSON.stringify([{ path: 'A.b', acceptedIn: '0.3.0', reason: REASON }]));
    assert.deepEqual(readAcceptedBreaks(dir), [{ path: 'A.b', acceptedIn: '0.3.0', reason: REASON }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('versions compare by number, not by string — 0.10.0 is after 0.9.0', () => {
  // `'0.10.0' > '0.9.0'` is false as strings, which would refuse a legitimate bump at exactly the
  // release where a package has shipped enough to have accumulated consumers.
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.ok(Number.isNaN(compareVersions('0.3.0', undefined)));
  // A prerelease suffix compares on its release numbers rather than being refused outright.
  assert.equal(compareVersions('0.3.0-rc.1', '0.3.0'), 0);
});
