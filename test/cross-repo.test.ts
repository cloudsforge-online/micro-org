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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// -- the edges as data -------------------------------------------------------------------------

describe('the edges, in a shape a workflow can act on', () => {
  // The trigger has to INSTALL each reader before its suite can run — a CI runner has no
  // node_modules, and @cloudsforge/* resolves through `link:` to a sibling that must be installed
  // first. So the sweep has to say who reads whom before it runs anything, and say it as data: the
  // alternative was a workflow parsing the padded table with awk, which turns a column change into
  // an empty reader list, which reads downstream as an estate that agrees.
  it('names the readers, the files and what they read, narrowed by --repo', () => {
    const { code, out } = cross(estate("{ BTC: 'bitcoin', LTC: 'litecoin' }"), '--json', '--repo', 'wallet');
    assert.equal(code, 0, out);
    assert.deepEqual(JSON.parse(out), {
      total: 1,
      repo: 'wallet',
      readers: [{ repo: 'hub-web', files: ['test/assets.test.js'], reads: ['wallet'] }],
      unclassified: 0,
    });
  });

  // The floor the workflow enforces is the ESTATE-wide count, not the narrowed one: a caller
  // asking about one repository still needs to know the detector is matching at all.
  it('reports the estate-wide total even when the answer is narrowed', () => {
    const { out } = cross(estate("{ LTC: 'litecoin' }"), '--json', '--repo', 'contracts');
    const scan = JSON.parse(out);
    assert.equal(scan.total, 1, 'the total is the whole tree, so an empty narrowing is still not zero');
    assert.deepEqual(scan.readers, [], 'nothing in this tree reads contracts');
  });

  // It lists, it does not run. This fixture DISAGREES — `cfctl cross` on it exits 1 four tests up —
  // and asking who reads whom must not answer that question by accident, or the workflow would
  // have run every reader's suite before it had installed any of them.
  it('runs nothing, so a disagreeing estate still answers 0', () => {
    const { code, out } = cross(estate("{ BTC: 'bitcoin' }"), '--json', '--repo', 'wallet');
    assert.equal(code, 0, out);
    assert.equal(JSON.parse(out).readers.length, 1);
  });

  // Still parseable when it is refusing. The workflow reads `.total` out of this file to decide
  // whether the sweep is broken, and a bare error message there would be a `jq` failure whose
  // cause is two steps away from what it says.
  it('an empty working tree is red AND is still JSON', () => {
    const { code, out } = cross(mkdtempSync(path.join(tmpdir(), 'cfctl-empty-json-')), '--json');
    assert.equal(code, 1, out);
    assert.equal(JSON.parse(out).total, 0);
  });
});

// -- the trigger -------------------------------------------------------------------------------

/**
 * WHAT MAKES THE SWEEP RUN WHEN AN UPSTREAM MERGES, checked as a wire contract rather than
 * remembered.
 *
 * The mechanism is two files agreeing about one string: `service-ci.yml` and `web-ci.yml` POST a
 * `repository_dispatch` from every caller's main build, and `cross-repo.yml` in this repository
 * listens for it. Both halves are green when they disagree — the sender gets its 204, the receiver
 * sits there listening for a type nobody sends — and the estate then goes on believing it has a
 * trigger. That is micro-org#304 rebuilt one layer up, so the two ends are compared here.
 */
describe('the merge trigger', () => {
  const workflow = (file: string): string =>
    readFileSync(fileURLToPath(new URL(`../.github/workflows/${file}`, import.meta.url)), 'utf8');

  const RECEIVER = workflow('cross-repo.yml');
  const SENDERS = { 'service-ci.yml': workflow('service-ci.yml'), 'web-ci.yml': workflow('web-ci.yml') };

  /** The dispatch step of a sender, from its name to the end of the file. */
  const dispatchStep = (yaml: string): string => {
    const at = yaml.indexOf('- name: Dispatch the cross-repository sweep');
    assert.notEqual(at, -1, 'the sender step is missing');
    return yaml.slice(at);
  };

  it('the type the senders send is the type the receiver listens for', () => {
    for (const [file, yaml] of Object.entries(SENDERS)) {
      const sent = /-f "event_type=([a-z0-9-]+)"/.exec(dispatchStep(yaml))?.[1];
      assert.ok(sent, `${file} sends no event_type`);
      assert.ok(
        new RegExp(`repository_dispatch:\\s*\\n\\s*types: \\[${sent}\\]`).test(RECEIVER),
        `${file} sends '${sent}', which cross-repo.yml does not listen for`,
      );
    }
  });

  it('every field the receiver reads is a field both senders send', () => {
    for (const field of [...RECEIVER.matchAll(/github\.event\.client_payload\.([a-z]+)/g)].map((m) => m[1])) {
      for (const [file, yaml] of Object.entries(SENDERS)) {
        assert.ok(
          dispatchStep(yaml).includes(`client_payload[${field}]=`),
          `cross-repo.yml reads client_payload.${field}, which ${file} never sends`,
        );
      }
    }
  });

  it('the two senders are the same sender, so they cannot drift', () => {
    // web-ci.yml's header says the copy is held identical here. Everything except the input the
    // repository is named by — a service knows itself as `inputs.service`, a frontend as
    // `inputs.app` — and except the prose, which is allowed to differ because each file argues its
    // own case. What must not differ is a line either shell executes.
    const body = (yaml: string): string =>
      dispatchStep(yaml)
        .replace('inputs.app', 'inputs.service')
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
    assert.equal(body(SENDERS['web-ci.yml']), body(SENDERS['service-ci.yml']));
  });

  it('only a merge to main asks — not a pull request, not a release branch', () => {
    for (const [file, yaml] of Object.entries(SENDERS)) {
      assert.ok(
        yaml.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'"),
        `${file} would dispatch on a ref no downstream resolves`,
      );
    }
  });

  // ── THE REJECTED MECHANISM, ASSERTED RATHER THAN REMEMBERED ──────────────────────────────────
  // A sender that cloned the estate and ran the readers' suites would turn a service's main build
  // red for a defect its author did not cause and cannot fix, which is how an estate-wide gate
  // gets switched off within a week (`estate-ci.yml`'s header, and the sibling assertion in
  // test/workflow-shell.test.ts). The upstream sends and does not wait.
  it('the sender cannot turn the merging repository red', () => {
    for (const [file, yaml] of Object.entries(SENDERS)) {
      const step = dispatchStep(yaml);
      assert.doesNotMatch(step, /cfctl/, `${file} runs the sweep itself instead of asking for it`);
      assert.doesNotMatch(step, /git clone/, `${file} clones the estate in a per-repository build`);
      assert.match(step, /::warning::could not ask micro-org/, `${file} must say so when it cannot dispatch`);
      assert.doesNotMatch(step.split('::warning::')[1] ?? '', /exit 1/, `${file} fails a build over micro-org's token`);
    }
  });

  it('the receiver never puts a dispatched value into a shell', () => {
    // Every field arrives in an HTTP body written by whoever holds a token, and two of them become
    // a directory and a `git fetch` argument. `${{ }}` inside a `run:` block is substituted before
    // bash sees the line, so the values are bound to env once, at the top, and quoted from there.
    for (const block of RECEIVER.split(/\n {8}run: \|/).slice(1)) {
      const body = block.split(/\n {6}- /)[0] ?? '';
      assert.doesNotMatch(body, /\$\{\{[^}]*client_payload/, 'a dispatched value is interpolated into a run block');
    }
    assert.match(RECEIVER, /UPSTREAM: \$\{\{ github\.event\.client_payload\.repo/);
  });

  it('the receiver refuses a payload that is not a repository name or a commit', () => {
    assert.match(RECEIVER, /is not the shape of a repository name/);
    assert.match(RECEIVER, /is not the shape of a commit/);
  });

  it('the receiver asks only about the repository that moved', () => {
    assert.match(RECEIVER, /cfctl\.ts cross --repo "\$UPSTREAM"/);
  });

  // The two ways this sweep can report agreement it never checked, both of them fatal in the
  // workflow: a clone that failed (a reader that is not on disk holds no checks) and a detector
  // that stopped matching (an estate-wide total below the floor measured on 2026-08-10).
  it('the receiver treats a partial estate and an empty sweep as failures', () => {
    assert.match(RECEIVER, /MIN_CHECKS: \d+/);
    assert.match(RECEIVER, /::error::.*cross-repository checks found in the whole estate/);
    assert.match(RECEIVER, /::error::a repository in the estate could not be cloned/);
    assert.match(RECEIVER, /::error::a reader could not be installed/);
  });

  it('the receiver still runs when no upstream ever dispatches', () => {
    // The dispatch needs a token with write access to micro-org. A mechanism whose whole value
    // waits on a credential nobody has granted is a mechanism that reports success and does
    // nothing, so the schedule asks the same question with no credential involved.
    assert.match(RECEIVER, /schedule:\s*\n\s*- cron:/);
  });
});
