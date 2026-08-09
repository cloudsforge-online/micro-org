/**
 * `cfctl cross` — the sweep that runs the checks reading a sibling repository.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THESE TESTS ARE FOR, AND WHY THE RED ONE IS THE IMPORTANT HALF.
 *
 * micro-org#304: this estate has tests that open a sibling checkout and assert the two agree, and
 * nothing runs them when the sibling moves. Measured 2026-08-09, three repositories went red on
 * `main` without anyone touching them, and two of the three were discovered by a release PR whose
 * whole content is a version-string bump.
 *
 * A sweep for that is worth exactly as much as its ability to go red. A discovery that quietly
 * stops matching reports "0 cross-repository checks, all passing", which is the same output as a
 * healthy estate — the identical failure the issue describes one layer up. So every test below
 * comes in a pair: the fixture estate agrees and the sweep is green, then ONE upstream file
 * changes and the same sweep must be red, in the downstream repository, without the downstream
 * having been touched. That is the #304 scenario, reproduced end to end in a temporary directory.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  bindsEstateRoot,
  reachesForSibling,
  scanCrossRepo,
  siblingReads,
  testCommandFor,
} from '../tools/cfctl.ts';
import { REGISTRY } from '../tools/registry.ts';

const CFCTL = fileURLToPath(new URL('../tools/cfctl.ts', import.meta.url));
const KNOWN = new Set(REGISTRY.map((repo) => repo.name));

// -- the estate root ---------------------------------------------------------------------------

describe('finding the file that resolves the estate', () => {
  // Both depths are in use in the estate as of 2026-08-10: the cross-repo tests in `hub-web` and
  // `site` sit directly in `test/` and reach the estate with `../..`, and the journey helpers sit
  // in `test/journeys/` and need `../../..`. A check that knew only one silently classified the
  // other as reading nothing, which is a missing edge that looks exactly like no edge.
  it('reads the depth off the file, not off a fixed number of dots', () => {
    const two = "const ESTATE = fileURLToPath(new URL('../..', import.meta.url))";
    const three = "const ESTATE = fileURLToPath(new URL('../../../', import.meta.url))";
    assert.equal(bindsEstateRoot(two, 'test/wallet-assets.test.ts'), true);
    assert.equal(bindsEstateRoot(two, 'test/journeys/scenario.ts'), false);
    assert.equal(bindsEstateRoot(three, 'test/journeys/scenario.ts'), true);
  });

  it('a repository-local URL is not an estate root', () => {
    const local = "readFileSync(new URL('./templates.ts', import.meta.url), 'utf8')";
    assert.equal(bindsEstateRoot(local, 'src/catalogue.test.ts'), false);
  });
});

// -- the edges ---------------------------------------------------------------------------------

describe('the sibling directories a file reads', () => {
  // The three shapes that exist in the estate today. Written out separately because each one was
  // found by running the sweep and noticing an edge it had missed, not by design.
  it('interpolation against an estate root', () => {
    assert.deepEqual(siblingReads('readFileSync(`${ESTATE}pool/src/${f}`)', 'hub-web', KNOWN), ['pool']);
  });

  it('a join', () => {
    assert.deepEqual(siblingReads("const A = join(ESTATE, 'tessera-assets')", 'tessera-web', KNOWN), [
      'tessera-assets',
    ]);
  });

  it('a bare path literal in an edge table, where the root is nowhere near it', () => {
    const table = "{ dir: 'wallet', repo: 'micro-wallet', reads: 'wallet/src/addresses.ts' }";
    assert.deepEqual(siblingReads(table, 'hub-web', KNOWN), ['wallet']);
  });

  it("a repository does not read itself", () => {
    assert.deepEqual(siblingReads("readFileSync('site/src/content/pages.ts')", 'site', KNOWN), []);
  });

  it('a directory no registry row names is not an edge, because doctor is already shouting about it', () => {
    assert.deepEqual(siblingReads("readFileSync(`${ESTATE}packages/chain/src/index.ts`)", 'site', KNOWN), []);
  });

  // Not an import specifier, not a scoped package, not a URL. Each of these appears hundreds of
  // times in a test file and none of them is a checkout read.
  it('imports, scoped packages and URLs are not edges', () => {
    const noise = "import x from '../src/lib/money.ts'\nimport y from '@cloudsforge/ui'\nfetch('https://pool.example')";
    assert.deepEqual(siblingReads(noise, 'hub-web', KNOWN), []);
  });
});

describe('the near misses', () => {
  // Asymmetric with siblingReads on purpose, and the asymmetry is argued in cfctl.ts: a claimed
  // edge costs a suite run, but this list is read by a person deciding whether the sweep has a
  // hole. Measured 2026-08-10, the loose rule produced 128 near misses and the strict one is what
  // keeps that list from swallowing the eleven real edges printed above it.
  it('the repository name, or a path climbing out of this repository, counts', () => {
    assert.equal(reachesForSibling("checkout('micro-wallet')", 'hub-web', KNOWN), true);
    assert.equal(reachesForSibling("readFileSync('../../wallet/src/addresses.ts')", 'hub-web', KNOWN), true);
  });

  it('a repository naming itself does not count', () => {
    assert.equal(reachesForSibling("image: 'ghcr.io/cloudsforge-online/micro-hub-web'", 'hub-web', KNOWN), false);
  });
});

// -- the runner --------------------------------------------------------------------------------

describe('pointing a repository own test runner at specific files', () => {
  // Derived rather than assumed, because the runner is not uniform. All three of these are real
  // `test` scripts from the estate as of 2026-08-10. Running a cross-repository test without the
  // DOM loader its repository chose reports a failure this tool caused as a failure the estate has.
  it('keeps the loaders and the flags, and drops the glob', () => {
    assert.deepEqual(testCommandFor('node --import tsx --test test/*.test.ts', ['test/a.test.ts']), [
      'node',
      '--import',
      'tsx',
      '--test',
      'test/a.test.ts',
    ]);
    assert.deepEqual(
      testCommandFor('node --import tsx --import @cloudsforge/ui/test-loader --test test/*.test.ts', ['test/a.test.ts']),
      ['node', '--import', 'tsx', '--import', '@cloudsforge/ui/test-loader', '--test', 'test/a.test.ts'],
    );
    assert.deepEqual(
      testCommandFor('node --import tsx --test --test-concurrency=1 src/*.test.ts', ['src/a.test.ts']),
      ['node', '--import', 'tsx', '--test', '--test-concurrency=1', 'src/a.test.ts'],
    );
  });

  // Undefined, and the caller then runs the whole suite and SAYS it did. Guessing at an
  // unfamiliar runner is how a check ends up green because it never started.
  it('an unfamiliar runner is refused rather than guessed at', () => {
    assert.equal(testCommandFor('vitest run', ['test/a.test.ts']), undefined);
    assert.equal(testCommandFor('node scripts/check.js', ['test/a.test.ts']), undefined);
  });
});

// -- end to end --------------------------------------------------------------------------------

/**
 * A working tree with two repositories in it: one that decides something, and one that carries a
 * copy and checks it. Registry names, because cfctl only walks repositories the registry knows.
 */
function estate(assets: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cfctl-cross-'));
  mkdirSync(path.join(root, 'wallet', 'src'), { recursive: true });
  writeFileSync(path.join(root, 'wallet', 'src', 'addresses.ts'), `export const ASSET_FOR_CHAIN = ${assets}\n`);

  mkdirSync(path.join(root, 'hub-web', 'test'), { recursive: true });
  writeFileSync(
    path.join(root, 'hub-web', 'package.json'),
    JSON.stringify({ name: 'hub-web', scripts: { test: 'node --test test/*.test.js' } }),
  );
  // Plain JavaScript so the fixture needs no loader of its own — what is under test is the sweep,
  // not tsx. The shape is `hub-web/test/wallet-assets.test.ts`'s: resolve the estate, read the
  // service that decides, and throw rather than skip when it is not there.
  writeFileSync(
    path.join(root, 'hub-web', 'test', 'assets.test.js'),
    [
      "import assert from 'node:assert/strict'",
      "import { readFileSync } from 'node:fs'",
      "import { fileURLToPath } from 'node:url'",
      "import test from 'node:test'",
      "const ESTATE = fileURLToPath(new URL('../..', import.meta.url))",
      "test('the menu offers what wallet will move', () => {",
      "  const source = readFileSync(`${ESTATE}wallet/src/addresses.ts`, 'utf8')",
      "  assert.ok(source.includes('LTC'), 'wallet no longer moves LTC')",
      '})',
      '',
    ].join('\n'),
  );
  return root;
}

function cross(root: string, ...args: string[]): { code: number; out: string } {
  const result = spawnSync('node', ['--import', 'tsx', CFCTL, 'cross', ...args], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    env: { ...process.env, CLOUDSFORGE_MICRO_ROOT: root },
  });
  return { code: result.status ?? -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('the sweep, against a working tree', () => {
  it('finds the edge without being told about it', () => {
    const { code, out } = cross(estate("{ BTC: 'bitcoin', LTC: 'litecoin' }"), '--list');
    assert.equal(code, 0, out);
    assert.match(out, /hub-web\s+test\/assets\.test\.js\s+reads wallet/);
  });

  it('GREEN: the two repositories agree, and it runs the check rather than merely listing it', () => {
    const { code, out } = cross(estate("{ BTC: 'bitcoin', LTC: 'litecoin' }"));
    assert.equal(code, 0, out);
    assert.match(out, /ok\s+hub-web/);
    assert.match(out, /0 of 1 repositories disagree/);
  });

  // ── THE ONE THAT MATTERS ──────────────────────────────────────────────────────────────────────
  // The #304 scenario. `wallet` drops an asset — a correct, green, upstream-only change — and
  // NOTHING IN hub-web MOVES. Today that is discovered by a release cut hours later. Here it is a
  // command, and the command is red.
  //
  // IT ALSO PINS THE `NODE_TEST_CONTEXT` SCRUB, by the accident of running inside a test. Node's
  // runner sets that variable in its children, and a nested `node --test` that inherits it exits 0
  // however many assertions failed — measured 2026-08-10, this exact fixture, 1 without it and 0
  // with. So this test was green for the wrong reason before `cmdCross` cleaned the environment,
  // and it is the reason the cleaning exists. Do not "simplify" it to call the scanner directly:
  // spawning is what makes it able to catch that class at all.
  it('RED: the upstream drops an asset and the downstream goes red, untouched', () => {
    const { code, out } = cross(estate("{ BTC: 'bitcoin' }"));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL\s+hub-web/);
    assert.match(out, /wallet no longer moves LTC/);
    assert.match(out, /1 of 1 repositories disagree/);
  });

  it("--repo answers 'who breaks if I merge here', and is red for the repository that did not move", () => {
    const root = estate("{ BTC: 'bitcoin' }");
    const { code, out } = cross(root, '--repo', 'wallet');
    assert.equal(code, 1, out);
    assert.match(out, /read 'wallet'/);
    assert.match(out, /FAIL\s+hub-web/);
  });

  it('a repository nothing reads says so, and says it in a sentence rather than by being silent', () => {
    const { code, out } = cross(estate("{ BTC: 'bitcoin', LTC: 'litecoin' }"), '--repo', 'ledger');
    assert.equal(code, 0, out);
    assert.match(out, /nothing in this working tree reads 'ledger'/);
  });

  it('a repository in no registry row is refused rather than swept for silently', () => {
    const { code, out } = cross(estate("{ LTC: 'litecoin' }"), '--repo', 'not-a-repo');
    assert.equal(code, 2, out);
    assert.match(out, /is in no registry row/);
  });

  // micro-org#38's rule, applied here. A sweep that finds nothing has not proved the estate agrees
  // with itself; it has proved the sweep is broken. Silence and success must not look the same.
  it('an empty working tree is a failure, not a clean bill of health', () => {
    const { code, out } = cross(mkdtempSync(path.join(tmpdir(), 'cfctl-empty-')));
    assert.equal(code, 1, out);
    assert.match(out, /no cross-repository check found/);
    assert.match(out, /broken sweep, not a clean estate/);
  });
});

// -- prose is not a read -----------------------------------------------------------------------

describe('a path in a comment is not a file the test opens', () => {
  // Measured 2026-08-10: the first run of this sweep claimed eleven edges out of one service test
  // file, of which one was real. The other ten were CITATIONS — paths written in a docblock to
  // tell a reader where a rule comes from. That is micro-org#303 in a different tool, so the same
  // stripper those CI guards use runs here first.
  it('a cited path is not an edge, and the read beside it still is', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cfctl-prose-'));
    mkdirSync(path.join(root, 'test'), { recursive: true });
    writeFileSync(
      path.join(root, 'test', 'catalogue.test.ts'),
      [
        '/**',
        ' * The reward wording is decided by `worlds/src/rewards.ts` and the amounts by',
        " * `market/src/bids.ts`. Neither is read here.",
        ' */',
        "const ESTATE = new URL('../../', import.meta.url)",
        "const EMIT = new URL('identity/src/emailVerification.ts', ESTATE)",
        'export default EMIT',
        '',
      ].join('\n'),
    );
    const scan = scanCrossRepo(root, 'notify', KNOWN);
    assert.deepEqual(
      scan.files.map((file) => file.reads),
      [['identity']],
      'a path cited in prose was counted as a checkout read',
    );
  });
});
