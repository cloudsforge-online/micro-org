import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  compareDotted,
  digestVerdict,
  ghcrPath,
  inspect,
  isOrgRemote,
  microRoot,
  readContentDigest,
  readGhcrTokenAnswer,
  parseManifest,
  portFor,
  renderManifest,
  rewriteVersionText,
  satisfies,
  unregisteredSiblings,
  type ReleaseManifest,
} from '../tools/cfctl.ts';
import {
  ALLOWED_SCOPED_PACKAGES,
  REGISTRY,
  deployableRepos,
  imageFor,
  managedRepos,
  repoByName,
} from '../tools/registry.ts';

// -- the registry ------------------------------------------------------------------------------

test('the registry holds every repository in the organisation, and every directory on this disk', () => {
  // 70 rather than 46, and the gap is the whole point of this sweep. 03 §1 enumerates 46; the
  // organisation holds 70 unarchived repositories and the working tree holds 61 directories. The
  // seventeen this file could not see included micro-emberkin, one of the three repositories the
  // ledger account-type defect was found in — which is why estate-ci.yml derives its repository
  // list from the GitHub API and says, in its own header, that registry.ts "does not contain
  // micro-emberkin".
  //
  // The 59 managed rows are exactly the 59 `micro-*` repositories the organisation lists. The 11
  // kept rows are the other 11, less `.github`, whose omission is argued in registry.ts rather
  // than merely true: it cannot carry the prefix and cannot be checked out at micro/.github.
  // 72 since 2026-08-04: `lantern-web` and `beacon-web` were added, having been absent since this
  // file was written. The estate compose ran both the whole time, so a release could not deploy
  // two surfaces the estate serves — and `--verify` could not report them, because it can only
  // check images for repositories this registry names.
  //
  // 71 since the P13 fold: `micro-foresight-admin-web` is ARCHIVED. Its operator panel is a
  // section inside `micro-admin-web` (`/foresight`), nothing is served at `foresight-admin.<apex>`
  // any more, and the local checkout is gone — which is what this test's second half measures.
  // The count going DOWN is the unusual direction here, and it is the one that costs: see the note
  // above `DERIVED_PORT_ORDER` for the seven ports it moved and why a tombstone row would have
  // been worse than paying for the shift.
  //
  // The repository is archived rather than deleted and its images stay published, so this is not a
  // claim that it never existed — `org/releases/2026.08.1.yaml` and `2026.08.2.yaml` still name
  // it, correctly, because those are records of releases that happened.
  //
  // 73 since 2026-08-09: `pool` and `pool-web`, the Stratum v1 mining pool of
  // 36-multi-chain-and-mining-pool.md §5 and its console. This is the direction that is supposed
  // to be cheap and this time it was — both are APPENDED, so `DERIVED_PORT_ORDER` below gained
  // two entries and moved none, which is the whole argument that block makes.
  //
  // Registering them BEFORE they are deployed is the point rather than an accident of ordering.
  // `lantern-web` and `beacon-web` were built, served and 502ing for months while this file did
  // not name them, and nothing could report the gap: `cfctl release --verify` checks images for
  // the repositories the registry lists, so a surface it does not know about cannot be reported
  // missing. A row that exists before the deploy makes the missing image the loud case.
  assert.equal(REGISTRY.length, 73);
  const counts = new Map<string, number>();
  for (const repo of REGISTRY) counts.set(repo.kind, (counts.get(repo.kind) ?? 0) + 1);
  assert.equal(counts.get('service'), 27, '22 from 03 §1.1, plus emberkin, foresight, aetherholm, tessera and the mining pool');
  assert.equal(counts.get('web'), 18, '11 from 03 §1.2, four of the five 05-user-journeys §1 records (foresight-admin-web folded into admin-web at P13), the two operator consoles and the pool console');
  assert.equal(counts.get('ops'), 3, '3 operations services');
  assert.equal(counts.get('library'), 4, '4 library repositories');
  assert.equal(counts.get('assets'), 4, 'brand and the three per-title asset repositories');
  assert.equal(counts.get('template'), 2, '2 templates');
  assert.equal(counts.get('org'), 4, 'org, docs, deploy and conformance — machinery, not product');
  assert.equal(counts.get('kept'), 11, '3 kept, 7 leaving, and one that is not ours at all');
  assert.equal(managedRepos().length, 62);
  assert.equal(deployableRepos().length, 48, 'services, frontends and operations services');
});

test('names are unique — a duplicate would make one entry unreachable', () => {
  const names = new Set(REGISTRY.map((repo) => repo.name));
  assert.equal(names.size, REGISTRY.length);
});

test('every managed row is a micro-* repository of this organisation', () => {
  // The repository policy, on the rows cfctl may write to. `hearth` is checked out as a SIBLING
  // now rather than under repos/, so "everything kept lives under repos/" — which this test used
  // to assert — stopped being true and would have kept passing only because nothing looked.
  for (const repo of managedRepos()) {
    assert.ok(repo.path.startsWith('micro/'), `${repo.name} is managed but lives at ${repo.path}`);
    assert.ok(repo.repo.startsWith('micro-'), `${repo.name} is managed but is not a micro-* repository`);
    assert.equal(repo.managed, true);
  }
});

test('the kept repositories are listed rather than omitted, and none can be written to', () => {
  // pull-all.sh omitted crucible, so the documented update path silently skipped it. An
  // exclusion that is written down is a decision; one that is not is that bug.
  for (const name of [
    'hearth', 'asset-forge', 'stack',
    'platform', 'forge-pay', 'forge-keyvault', 'forge-mint', 'crucible', 'ninety-days-after', 'shared-libs',
    'kindred-upstream',
  ]) {
    const repo = repoByName(name);
    assert.ok(repo, `${name} is missing from the registry`);
    assert.equal(repo.managed, false, `${name} is kept and must never be managed`);
    assert.equal(repo.deployable, false, `${name} is kept and must never reach a release manifest`);
    assert.equal(repo.kind, 'kept');
  }
});

/**
 * The one repository in this tree that belongs to somebody else.
 *
 * `micro-emberkin` and `micro-emberkin-web` were copied forward out of
 * `savvaniss/kindred-resonance`, and 19-new-products.md §3 makes it a requirement that "the
 * upstream repository is not modified". Its mirror is checked out as a sibling of fifty-nine
 * repositories cfctl clones, pulls and releases, and it looks exactly like them.
 *
 * The type is the primary guarantee and it cannot be asserted here — `kept('kindred-upstream', …,
 * managed: true)` is not a value that can be written, so there is no test that observes it, only a
 * compiler that refuses the file. What CAN be asserted is the data the type is protecting: this
 * row's remote is not derivable from the org and the name, which is precisely what makes a tool
 * that assumes it dangerous.
 */
test('kindred-upstream is not a CloudsForge repository, and the registry says which one it is', () => {
  const repo = repoByName('kindred-upstream');
  assert.ok(repo);
  assert.equal(repo.managed, false);
  assert.equal(repo.kind, 'kept');
  assert.equal(repo.repo, 'kindred-resonance', 'the repository is not named after the directory');
  assert.equal(repo.deployable, false);
  const remote = repo.kind === 'kept' ? repo.remote : '';
  assert.equal(remote, 'https://github.com/savvaniss/kindred-resonance.git');
  assert.equal(isOrgRemote(remote), false, 'the guard in gitWrite must refuse this remote');
});

test('a foreign remote is recognised as foreign in every protocol git writes', () => {
  // The runtime half of the guarantee, and the half that survives a MISCLASSIFICATION — giving
  // kindred-upstream `kind: 'service'` type-checks perfectly and the type can say nothing.
  assert.equal(isOrgRemote('https://github.com/cloudsforge-online/micro-ledger.git'), true);
  assert.equal(isOrgRemote('git@github.com:cloudsforge-online/micro-ledger.git'), true);
  assert.equal(isOrgRemote('ssh://git@github.com/cloudsforge-online/micro-ledger'), true);
  assert.equal(isOrgRemote('https://github.com/savvaniss/kindred-resonance.git'), false);
  assert.equal(isOrgRemote('git@github.com:savvaniss/kindred-resonance.git'), false);
  // The near miss: an organisation whose name STARTS with ours. Without the trailing slash in the
  // prefix this would read as ours and the refusal would never fire.
  assert.equal(isOrgRemote('https://github.com/cloudsforge-online-evil/micro-ledger.git'), false);
});

/**
 * Ports are derived from registry POSITION, and this sweep moved every position after `analytics`.
 *
 * `portFor`'s comment says ports are assigned rather than chosen "because 'pick a free port' is how
 * the estate ended up with eighteen fixed host ports". Position gives uniqueness only while the
 * order is stable, and inserting nine deployables into the middle is exactly what breaks that — so
 * the property the comment is claiming is asserted here rather than assumed, and any future
 * insertion that collides two repositories on one port is a red instead of a duplicate `EXPOSE`.
 */
test('every deployable gets a distinct container port, and an unregistered name gets its own', () => {
  const ports = deployableRepos().map((repo) => portFor(repo.name));
  assert.equal(new Set(ports).size, ports.length, 'two repositories were assigned the same port');
  assert.equal(Math.min(...ports), 4100);
  // The one case position cannot cover: `cfctl new` runs BEFORE the registry row exists, so the
  // name is unknown and the port is one past the end. It must not be one already handed out.
  assert.ok(!new Set(ports).has(portFor('a-repository-that-does-not-exist-yet')));
});

/**
 * THE DERIVED ORDER IS PINNED, because distinctness was never the property that broke.
 *
 * The test above asserts no two repositories share a port. That was already true before the sweep
 * and after it, and it is not what went wrong: the sweep inserted NINE deployables into the MIDDLE
 * of the list — four services ahead of the frontend block, five frontends ahead of the ops block —
 * and every port after `analytics` MOVED. The set stayed distinct the whole time, so this file
 * stayed green while sixteen numbers another repository had already written down went stale.
 *
 * What moved, and it is pinned in micro-deploy's compose file rather than anywhere here:
 *
 *   * all eleven original frontends slid by four — `hub-web` 4122 -> 4126, `status-web` 4132 -> 4136
 *   * all three ops services slid by nine — `lantern` 4133 -> 4142, `faucet` 4135 -> 4144
 *   * `tessera` derives 4125, and `deploy/compose/docker-compose.estate.yml` pins 4140
 *
 * `docker-compose.estate.yml` says its host ports are "derived, like every other port
 * here", off `4100 + index in deployableRepos()`, and :1568 says `scripts/web-check.py` "fails when
 * this file and the registry disagree, so the drift cannot be silent". THAT SCRIPT DOES NOT EXIST.
 * micro-deploy/scripts holds nine files and none of them is it, so the sole claimed guard on this
 * coupling is a comment naming a checker nobody wrote — and the drift was, in fact, silent.
 *
 * The fix belongs in the repository that OWNS the derivation, which is this one. APPENDING STAYS
 * FREE: a new row at the end lengthens the list and moves nothing, which is the whole reason rows
 * are appended rather than inserted. What is no longer possible is moving a repository some other
 * repository has already pinned a number for, without a red that names it and both ports.
 */
const DERIVED_PORT_ORDER: readonly string[] = [
  // 4100-4121 — the 22 domain services of 03 §1.1. These never moved; the insertions were after.
  'identity', 'policy', 'ledger', 'wallet', 'settlement', 'pricing', 'billing', 'custody',
  'indexer', 'activity', 'notify', 'studio', 'mint', 'market', 'trade', 'worlds', 'nda',
  'community', 'devplatform', 'hub-api', 'admin-api', 'analytics',
  // 4122-4125 — the four services 03 §1 predates. INSERTED HERE by the sweep, which is what
  // displaced everything below. `tessera` is 4125, against the 4140 micro-deploy chose by hand.
  'emberkin', 'foresight', 'aetherholm', 'tessera',
  // 4126-4136 — the eleven frontends of 03 §1.2, each four higher than the number compose pins.
  'hub-web', 'site', 'admin-web', 'mint-web', 'trade-web', 'worlds-web', 'explorer-web',
  'network-site', 'market-web', 'devportal-web', 'status-web',
  // 4137-4140 — the further frontends. Four, not five: `foresight-admin-web` was here at 4139
  // until the P13 fold, and its removal is the one edit this list has ever taken that is neither
  // an append nor an insertion. See below.
  'emberkin-web', 'foresight-web', 'aetherholm-web', 'tessera-web',
  // 4141-4143 — the three operations services of 03 §1.3.
  'lantern', 'beacon', 'faucet',
  // 4144-4145 — the two operator consoles, appended (registry.ts, after the derived block).
  'lantern-web', 'beacon-web',
  // 4146-4147 — the mining pool and its console, appended for the same reason on 2026-08-09.
  // Filed with their kinds instead, `pool` would have landed at index 26 and `pool-web` at 44, and
  // every name below each of them would derive one lower — `lantern` 4142 and `beacon` 4143 among
  // them, both already pinned in micro-deploy's compose. Appended, this list grows and does not
  // shift, which is the only kind of registry edit that costs nothing.
  'pool', 'pool-web',
];

/**
 * ── WHY THIS LIST WAS EDITED RATHER THAN THE REGISTRY RESTORED ────────────────────────────────
 *
 * The test below is meant to make a moved port expensive, and it worked: removing
 * `foresight-admin-web` turned it red and it named the cost one row at a time —
 *
 *     port 4139 belonged to 'foresight-admin-web' and now belongs to 'aetherholm-web'
 *
 * — with `aetherholm-web`, `tessera-web`, `lantern`, `beacon`, `faucet`, `lantern-web` and
 * `beacon-web` each deriving one lower than before. This list was then updated, which is the thing
 * the comment above forbids doing casually, so the reasoning is recorded here rather than in a
 * commit message:
 *
 *   1. **The repository is gone, not renamed.** The Foresight operator panel folded into
 *      `micro-admin-web` at P13 as `/foresight`, and `micro-foresight-admin-web` is archived. A
 *      registry that still named it would claim the estate deploys a console it does not build.
 *
 *   2. **A tombstone row is worse than the shift.** Holding index 39 requires `deployable: true`,
 *      because `deployableRepos()` is what position is counted in — and that list is also what
 *      `cfctl release` writes a manifest from and what `--verify` pulls. The tombstone would pin
 *      a GHCR tag for a repository that no longer publishes one.
 *
 *   3. **The shift was PAID, not absorbed.** micro-deploy's `docker-compose.estate.yml` and
 *      `scripts/estate-verify.sh` moved their pins in the same change, and `web-check.py` there
 *      compares both against this derivation on every run — so the agreement is verified rather
 *      than asserted here. That script had itself been vacuous (its regex predated the
 *      `${CF_PORT_BASE:-4}` templating and matched none of the forty-four pins, reporting "all 0
 *      compose pins ... match"); it was fixed in the same change, which is the only reason this
 *      shift could be shown to have been paid at all.
 *
 * APPENDING IS STILL THE ONLY FREE EDIT. Deletion is not free, and this list going red is what
 * made that true rather than merely stated.
 */

test('no registry change moves a port that already exists; appending is the only free edit', () => {
  const actual = deployableRepos().map((repo) => repo.name);

  // Reported one row at a time, and by NAME rather than as a diff of two long arrays: the failure
  // this guards is "somebody inserted a row", and the useful output is which repository now answers
  // to a different number, not that two lists are unequal somewhere.
  for (const [index, expected] of DERIVED_PORT_ORDER.entries()) {
    assert.equal(
      actual[index],
      expected,
      `port ${4100 + index} belonged to '${expected}' and now belongs to '${actual[index] ?? 'nothing'}' — ` +
        `a row was inserted or removed ahead of it, so every host port from here down has moved. ` +
        `Append instead, or recompute micro-deploy's compose file and update this list in the same commit.`,
    );
  }

  // Growth is allowed, and only at the end. A shorter list means a row was deleted, which moves
  // ports just as surely as an insertion does.
  assert.ok(
    actual.length >= DERIVED_PORT_ORDER.length,
    `${DERIVED_PORT_ORDER.length - actual.length} deployable row(s) were removed; every port after the gap has moved`,
  );
});

test('a directory beside the estate that no row names is reported, not skipped', () => {
  // The crucible bug. Given a fixture rather than the real tree, because in this repository's own
  // CI the only sibling is this repository — and a check that passes vacuously where it runs is
  // the failure mode this estate keeps rediscovering.
  const root = mkdtempSync(path.join(tmpdir(), 'cfctl-siblings-'));
  for (const name of ['ledger', 'identity', 'somebody-elses-repo', '.hidden']) {
    mkdirSync(path.join(root, name));
  }
  writeFileSync(path.join(root, 'a-file'), 'not a repository');
  assert.deepEqual(unregisteredSiblings(root, ['ledger', 'identity']), ['somebody-elses-repo']);
  assert.deepEqual(unregisteredSiblings(root, ['ledger', 'identity', 'somebody-elses-repo']), []);
  assert.deepEqual(unregisteredSiblings(path.join(root, 'nowhere'), []), [], 'no tree is not a finding');
});

test("GHCR's token endpoint answer is read the way GHCR means it", () => {
  // THE FIXTURES ARE REAL RESPONSES, captured from ghcr.io rather than imagined, because both
  // times this check was wrong it was wrong about what the registry actually says.
  //
  // A package the public may read: a bearer token comes back.
  const published = readGhcrTokenAnswer(
    '{"token":"djE6Y2xvdWRzZm9yZ2Utb25saW5lL21pY3JvLXNlcnZpY2UtdGVtcGxhdGU6MTc4NTgzOTk0Njk4OTA3Mjc3Mw=="}',
  );
  assert.equal(published.denied, false);
  assert.match(published.token ?? '', /^djE6/);

  // A package that is private, or that has never been published — GHCR does not distinguish, and
  // neither does the warning, because the operator's next step is the same either way. DENIED is
  // an ANSWER: reading it as "cannot tell" silenced the warning for all 45 deployables at once.
  const denied = readGhcrTokenAnswer('{"errors":[{"code":"DENIED","message":"requested access to the resource is denied"}]}');
  assert.equal(denied.denied, true);
  assert.equal(denied.token, undefined);

  // Something neither shape — a proxy's error page, a truncated body. Not a finding: reporting a
  // package as private on the strength of an unparseable answer is the false alarm this check has
  // already been guilty of.
  const garbage = readGhcrTokenAnswer('<html>502 Bad Gateway</html>');
  assert.equal(garbage.denied, false);
  assert.equal(garbage.token, undefined);
});

test('every deployable resolves to a GHCR image under the org', () => {
  for (const repo of deployableRepos()) {
    assert.match(imageFor(repo), /^ghcr\.io\/[^/]+\/micro-[a-z0-9-]+$/);
  }
});

test('service-ci.yml enforces exactly the allowlist registry.ts holds', () => {
  // registry.ts says the list is kept there "so service-ci.yml and cfctl doctor cannot disagree
  // about it", and until this test that sentence was a hope. They disagreed for four days over
  // @cloudsforge/secrets: CI allowed it, doctor did not, and doctor reported 36 false FAILs — one
  // per manifest that imported the package the estate had just extracted.
  //
  // Parsed rather than duplicated. A second hand-written copy in this file would be a third place
  // to forget, which is the defect, not the fix.
  const orgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workflow = readFileSync(path.join(orgRoot, '.github/workflows/service-ci.yml'), 'utf8');
  // The list moved from a shell variable into the `allow-match:` of the source-scan step when the
  // guards stopped being greps (micro-org#303). Still parsed, still one copy.
  const alternation = workflow.match(/allow-match:.*@cloudsforge\/\(([a-z0-9|-]+)\)/)?.[1];
  assert.ok(alternation, 'service-ci.yml no longer declares the scope allow list — re-point this test, do not delete it');
  const inCi = alternation.split('|').map((name) => `@cloudsforge/${name}`);
  assert.deepEqual([...inCi].sort(), [...ALLOWED_SCOPED_PACKAGES].sort());
});

test('the allowed scope list contains no service names', () => {
  // Rule 2 of 03 §2. A package called @cloudsforge/ledger would be a cross-service source import
  // that had learned to look like a dependency.
  const services = new Set(REGISTRY.filter((repo) => repo.kind === 'service').map((repo) => repo.name));
  for (const allowed of ALLOWED_SCOPED_PACKAGES) {
    const suffix = allowed.slice('@cloudsforge/'.length);
    assert.ok(!services.has(suffix), `${allowed} names a service`);
  }
});

// -- semver ranges -----------------------------------------------------------------------------

test('a caret range on 0.x is patch-only, which is why contracts go to 1.0.0', () => {
  // AD-02 item 2. This is the reason no consumer can resolve the current contract version.
  assert.equal(satisfies('^0.3.0', '0.4.0'), 'no');
  assert.equal(satisfies('^0.3.0', '0.3.9'), 'yes');
  assert.equal(satisfies('^1.3.0', '1.9.0'), 'yes');
  assert.equal(satisfies('^1.3.0', '2.0.0'), 'no');
  assert.equal(satisfies('^1.3.0', '1.2.9'), 'no');
  assert.equal(satisfies('~1.3.0', '1.3.9'), 'yes');
  assert.equal(satisfies('~1.3.0', '1.4.0'), 'no');
  assert.equal(satisfies('1.3.0', '1.3.0'), 'yes');
  assert.equal(satisfies('1.3.0', '1.3.1'), 'no');
  assert.equal(satisfies('workspace:^', '1.3.0'), 'yes');
});

test('an unrecognised range is reported, never guessed at', () => {
  // A range this tool silently misreads is a consumer that silently cannot resolve.
  assert.equal(satisfies('>=1.2 <2', '1.5.0'), 'unknown');
  assert.equal(satisfies('^1.2.3-beta.1', '1.5.0'), 'unknown');
});

// -- the release manifest ----------------------------------------------------------------------

// Two real digests, captured from ghcr.io on 2026-08-09 rather than invented: the first is what
// `micro-identity:2.5.7` resolves to, the second what `micro-hub-web:2.5.7` does. A fixture that
// is a real answer is the difference between testing this parser and testing a guess about it.
const LEDGER_DIGEST = 'sha256:d82f87dc83bca045a20b5f49fb367b62fa780ce99a2ba696d5546fa7976e4d8b';
const HUB_WEB_DIGEST = 'sha256:f9348c23c5eb0afd980f1faeca4fd793122f1ce2479d39d3de78cf9c8175e156';

const MANIFEST: ReleaseManifest = {
  version: '2026.08.0',
  generated: '2026-07-30T09:00:00.000Z',
  services: [
    {
      name: 'ledger',
      repo: 'micro-ledger',
      kind: 'service',
      image: 'ghcr.io/cloudsforge-online/micro-ledger',
      tag: '1.4.2',
      commit: '9f1c0b2a44de',
      digest: LEDGER_DIGEST,
    },
    {
      name: 'hub-web',
      repo: 'micro-hub-web',
      kind: 'web',
      image: 'ghcr.io/cloudsforge-online/micro-hub-web',
      tag: '2.0.0',
      commit: 'aa11bb22cc33',
      digest: HUB_WEB_DIGEST,
    },
  ],
  absent: ['market', 'analytics'],
};

test('a manifest survives a render and parse round trip', () => {
  // --verify reads back exactly what release wrote. If those two disagree, a release is verified
  // against something other than what will be deployed.
  const parsed = parseManifest(renderManifest(MANIFEST));
  assert.deepEqual(parsed, MANIFEST);
});

test('the manifest pins one image tag per service and names the absent ones', () => {
  const text = renderManifest(MANIFEST);
  assert.match(text, /image: ghcr\.io\/cloudsforge-online\/micro-ledger\n {4}tag: "1\.4\.2"/);
  // A hole in a manifest is how a service gets left on an old image while everything else moves.
  assert.match(text, /absent:\n {2}- market\n {2}- analytics/);
});

test('the manifest carries the commit, so a tag can be traced to a source revision', () => {
  const parsed = parseManifest(renderManifest(MANIFEST));
  assert.equal(parsed.services[0]?.commit, '9f1c0b2a44de');
});

// -- the digest, which is the thing a tag is not (micro-org#288) --------------------------------

/**
 * The manifest names the ARTIFACT, not a pointer to one.
 *
 * Measured 2026-08-09: `ghcr.io/cloudsforge-online/micro-network-site:2.5.5` resolves to the image
 * built from `5aa61e4`, a merge that landed after 2.5.5 was cut, because six repositories cut
 * `release/2.5.6` and never merged it — leaving `main` on 2.5.5, so every later merge republished
 * the tag `releases/2.5.5.yaml` pins. Merging a release branch republishes the tag as well, from
 * the merge commit rather than the pinned one. Neither is visible to a check that asks whether an
 * image EXISTS, and existence was the only question `--verify` used to ask.
 */
test('the manifest records the digest a tag resolved to, and the digest survives the round trip', () => {
  const text = renderManifest(MANIFEST);
  assert.match(text, new RegExp(`tag: "1\\.4\\.2"\\n {4}commit: "9f1c0b2a44de"\\n {4}digest: "${LEDGER_DIGEST}"`));
  assert.equal(parseManifest(text).services[0]?.digest, LEDGER_DIGEST);
  assert.equal(parseManifest(text).services[1]?.digest, HUB_WEB_DIGEST);
});

/**
 * THE EIGHTEEN FILES THAT PREDATE THIS FIELD MUST STILL PARSE.
 *
 * Rollback is checking out the previous manifest, so those files are not history — they are the
 * rollback path. A parser that rejected them, or a renderer that wrote `digest: ""` into a shape
 * micro-deploy's `scripts/release-render.py` mirrors, would take that path away to fix a defect
 * about the path being untrustworthy.
 */
test('a manifest with no digests parses, round trips, and is reported as unverifiable rather than rejected', () => {
  const withoutDigests: ReleaseManifest = {
    ...MANIFEST,
    services: MANIFEST.services.map((service) => ({ ...service, digest: '' })),
  };
  const text = renderManifest(withoutDigests);
  assert.ok(!text.includes('digest:'), 'an unknown digest is an omitted line, not an empty value');
  assert.deepEqual(parseManifest(text), withoutDigests);
  assert.equal(digestVerdict('', { digest: LEDGER_DIGEST }), 'unrecorded');
});

/**
 * ── RE-POINTED 2026-08-09 WHEN THE FIRST DIGEST-BEARING MANIFEST WAS CUT ──────────────────────
 *
 * This read "none of the old ones claims a digest" and looped over every file in `releases/`, which
 * was the same sentence while every file WAS an old one. `2.5.8.yaml` — generated 11:04Z, three
 * hours after the field landed at 07:56Z — is the first manifest that pins all forty-eight
 * services, and it turned the compatibility check red for doing exactly what it was built to do.
 *
 * The fix is not to drop the assertion. Both halves are load-bearing and they are DIFFERENT
 * claims, so they are now split on the one thing that decides which applies: when the file was
 * generated.
 *
 *   * before the field existed → every service must read back '' and verify as `unrecorded`. This
 *     is the rollback path: those eighteen files are what `--rollback` checks out, and a parser
 *     that rejected them would remove the estate's way back to fix a defect about the way back.
 *   * after → every service must carry a well-formed digest. A cut that silently drops one is
 *     micro-org#288 again, one entry at a time, and `--verify` reports the hole as `unrecorded`
 *     rather than as a failure — so nothing else in this suite would go red for it.
 *
 * The pre-digest set is CLOSED: no manifest generated before 07:56Z on 2026-08-09 can ever be cut
 * again, so its size is asserted exactly — twenty files, being 2.3.0, 2.4.0, 2.5.2 through 2.5.7
 * and the twelve 2026.08.* files. A twenty-first dated before the cutoff is a hand-edited
 * manifest, which is the one thing the header of every one of these files forbids.
 */
const DIGESTS_LANDED = Date.parse('2026-08-09T07:56:19Z'); // 16142d1, "a tag is not an artifact"

test('every manifest in releases/ parses, and carries digests exactly if it was cut after they existed', () => {
  // Against the real files rather than a fixture of them. The eight releases named in micro-org#288
  // and the twelve 2026.08.* files are what a rollback actually reads, and a compatibility claim
  // tested against a copy is a claim about the copy.
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'releases');
  const files = readdirSync(dir).filter((file) => file.endsWith('.yaml'));
  assert.ok(files.length >= 18, `only ${files.length} manifests found; this test is meant to read them all`);
  let predating = 0;
  for (const file of files) {
    const parsed = parseManifest(readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(parsed.version !== '', `${file} parsed to no version`);
    assert.ok(parsed.services.length > 0, `${file} parsed to no services`);
    const generated = Date.parse(parsed.generated);
    assert.ok(!Number.isNaN(generated), `${file} has no readable generated timestamp`);
    const old = generated < DIGESTS_LANDED;
    if (old) predating += 1;
    for (const service of parsed.services) {
      assert.ok(service.name !== '' && service.image !== '' && service.tag !== '', `${file}: ${service.name} lost a field`);
      if (old) {
        assert.equal(service.digest, '', `${file} was generated before digests existed`);
        assert.equal(digestVerdict(service.digest, {}), 'unrecorded');
      } else {
        assert.match(
          service.digest,
          /^sha256:[0-9a-f]{64}$/,
          `${file}: ${service.name} was cut after digests existed and pins none, so a rollback to it ` +
            'names a tag rather than an artifact',
        );
      }
    }
  }
  assert.equal(predating, 20, 'the set of manifests cut before digests existed is history and cannot grow');
});

test('a tag that has moved is a failure, and one that has not is the only state called verified', () => {
  // The four verdicts, and the reason none of them is a boolean. `moved` is #288 happening;
  // `unreadable` is a recorded digest GHCR would not confirm, which is not the same as agreement
  // and must not be reported as it — "verification that cannot run is not verification".
  assert.equal(digestVerdict(LEDGER_DIGEST, { digest: LEDGER_DIGEST }), 'verified');
  assert.equal(digestVerdict(LEDGER_DIGEST, { digest: HUB_WEB_DIGEST }), 'moved');
  assert.equal(digestVerdict(LEDGER_DIGEST, { reason: 'GHCR did not answer the manifest request' }), 'unreadable');
  assert.equal(digestVerdict(LEDGER_DIGEST, {}), 'unreadable');
  assert.equal(digestVerdict('', {}), 'unrecorded');
});

test("GHCR's answer to 'what does this tag resolve to' is read out of the header it comes in", () => {
  // A REAL RESPONSE, captured from ghcr.io on 2026-08-09 for micro-identity:2.5.7. HTTP/2 header
  // names arrive lower-cased and the lines are CRLF-terminated, which is why the match is
  // case-insensitive and strips the carriage return rather than leaving it in the digest.
  const real =
    'HTTP/2 200 \r\n' +
    'content-type: application/vnd.oci.image.index.v1+json\r\n' +
    `docker-content-digest: ${LEDGER_DIGEST}\r\n` +
    'content-length: 856\r\n\r\n';
  assert.equal(readContentDigest(real), LEDGER_DIGEST);
  assert.equal(readContentDigest(real.replace('docker-content-digest', 'Docker-Content-Digest')), LEDGER_DIGEST);

  // A tag that does not exist carries no such header, and neither does a proxy's error page. Both
  // must read as "could not tell": handing back a value here is how a later run reports a tag as
  // moved when all that moved was the network.
  assert.equal(readContentDigest('HTTP/2 404 \r\ncontent-type: application/json\r\n\r\n'), undefined);
  assert.equal(readContentDigest('<html>502 Bad Gateway</html>'), undefined);
  // A truncated or otherwise malformed value is not a digest, and must not be treated as one.
  assert.equal(readContentDigest('docker-content-digest: sha256:d82f87dc\r\n'), undefined);
  assert.equal(readContentDigest('docker-content-digest: md5:abc\r\n'), undefined);
});

/**
 * THE NEW FIELD IS ADDITIVE, AND THE CONSUMER THAT PROVES IT IS IN ANOTHER REPOSITORY.
 *
 * `micro-deploy/scripts/release-render.py` parses these manifests and deliberately mirrors
 * `parseManifest` — "a manifest that is not exactly this shape was not generated by cfctl and
 * should not be deployed". Its parser starts an entry on `^  - ` and reads `key: value` off every
 * other line, splitting on the FIRST colon and stripping quotes; a key it does not know lands in
 * its dict and is never read. So a four-space `digest: "sha256:…"` line is invisible to it, and a
 * digest's own internal colon does not become part of the key.
 *
 * That repository cannot be imported from here and is not checked out in this repository's CI, so
 * the shape is asserted rather than the consumer. Checked for real on 2026-08-09: rendering a
 * 47-service manifest with digests through `release-render.py` produced output byte-identical to
 * the same render of `releases/2.5.7.yaml`, which has none.
 */
test('every line a manifest renders is a shape the python consumer in micro-deploy also parses', () => {
  for (const line of renderManifest(MANIFEST).split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const entry = /^ {2}- (\S+): ?(.*)$/.exec(line);
    const field = /^ {4}(\S+): ?(.*)$/.exec(line);
    const top = /^(\S+): ?(.*)$/.exec(line);
    const item = /^ {2}- (\S+)$/.exec(line);
    assert.ok(entry ?? field ?? top ?? item, `no parser reads this line: ${JSON.stringify(line)}`);
    // The first colon separates key from value in both parsers, so a value containing a colon —
    // which every digest does — must never be reachable as a key.
    const key = (entry ?? field ?? top)?.[1];
    if (key) assert.ok(!key.includes(':'), `${key} would be split by the consumer's partition(':')`);
  }
  // And the digest line specifically, at the indent a field is read at rather than the indent an
  // entry starts at: two spaces would begin a new service and lose everything after it.
  assert.match(renderManifest(MANIFEST), /\n {4}digest: "sha256:[0-9a-f]{64}"\n/);
});

test('only a GHCR reference yields a package path to ask about', () => {
  assert.equal(ghcrPath('ghcr.io/cloudsforge-online/micro-ledger'), 'cloudsforge-online/micro-ledger');
  // Anything else is answered with "this only knows how to ask GHCR" rather than a guess, because
  // a registry that is not GHCR does not take the token dance this asks it to.
  assert.equal(ghcrPath('docker.io/library/postgres'), undefined);
  assert.equal(ghcrPath('ghcr.io/cloudsforge-online'), undefined);
  assert.equal(ghcrPath('ghcr.io/cloudsforge-online/micro-ledger/extra'), undefined);
  // A reference that already carries a tag or a digest is not a package path: the tag is a
  // separate argument, and pasting one in here would ask GHCR for `micro-ledger:2.5.7:2.5.7`.
  assert.equal(ghcrPath('ghcr.io/cloudsforge-online/micro-ledger:2.5.7'), undefined);
  assert.equal(ghcrPath(`ghcr.io/cloudsforge-online/micro-ledger@${LEDGER_DIGEST}`), undefined);
});

// -- resolving where the checkouts are -----------------------------------------------------------

test('managed repositories are resolved as siblings of this one, not by walking up for micro/', () => {
  // The bug this guards: `stack/micro` is a symlink to a checkout elsewhere on the machine, and
  // `import.meta.url` reports the resolved path. A walk upward looking for a directory holding
  // both micro/ and repos/ therefore starts outside the stack tree and can never climb back into
  // it — it answered with a directory two levels too high and reported all 43 repositories as
  // absent, with no error and an exit code of zero.
  const org = managedRepos().find((repo) => repo.name === 'org');
  assert.ok(org);
  assert.equal(inspect(org).dir, path.join(microRoot(), 'org'));

  for (const repo of managedRepos()) {
    assert.equal(
      path.dirname(inspect(repo).dir),
      microRoot(),
      `${repo.name} is not resolved as a sibling of micro-org`,
    );
  }
});

test('nothing managed resolves to a path inside repos/', () => {
  // The repository policy, enforced where it can actually be enforced: on the path cfctl writes.
  for (const repo of managedRepos()) {
    assert.ok(!inspect(repo).dir.includes(`${path.sep}repos${path.sep}`), `${repo.name} resolves into repos/`);
  }
});

/* ------------------------------- bump ---------------------------------- */

// The ordering `cfctl bump` refuses on. A bump that is not strictly ahead produces a release
// branch whose CI publishes nothing, because publish-image never moves a tag it has already
// written — and the green tick on that run means "already published", not "published this".
test('compareDotted orders versions numerically, not as text', () => {
  assert.ok(compareDotted('2.5.8', '2.5.7') > 0);
  assert.ok(compareDotted('2.5.7', '2.5.8') < 0);
  assert.equal(compareDotted('2.5.7', '2.5.7'), 0);

  // The one every string comparison gets wrong, and the reason this is not `a < b`.
  assert.ok(compareDotted('2.10.0', '2.9.0') > 0);
  assert.ok(compareDotted('0.10.0', '0.9.0') > 0);

  // A shorter version is not a smaller one segment by segment: the missing segments are zeroes.
  assert.equal(compareDotted('2.5', '2.5.0'), 0);
  assert.ok(compareDotted('2.5.1', '2.5') > 0);
});

test('rewriteVersionText changes the version and nothing else about the file', () => {
  const before = [
    '{',
    '  "name": "micro-custody",',
    '  "version": "2.5.7",',
    '  "private": true,',
    '  "scripts": { "test": "node --test" }',
    '}',
    '',
  ].join('\n');

  const after = rewriteVersionText(before, '2.5.7', '2.5.8');
  assert.ok(after.ok);
  assert.equal(after.text, before.replace('"2.5.7"', '"2.5.8"'));

  // Said explicitly because the alternative implementation — JSON.parse then JSON.stringify —
  // passes an equality check on the parsed object while rewriting every line of the file, and a
  // release diff nobody can read is a release nobody reviews.
  assert.equal(after.text?.split('\n').length, before.split('\n').length);
  assert.ok(after.text?.endsWith('}\n'));
});

test('rewriteVersionText refuses when the first "version" line is not the parsed one', () => {
  // package.json is a format where a nested object can also say "version". If the regex reaches
  // one of those first, the edit would land on a field the image tag does not come from, and the
  // command would report a successful bump of the wrong string.
  const nestedFirst = [
    '{',
    '  "name": "micro-thing",',
    '  "engines": {',
    '    "version": "0.0.1"',
    '  },',
    '  "version": "2.5.7"',
    '}',
    '',
  ].join('\n');

  assert.equal(rewriteVersionText(nestedFirst, '2.5.7', '2.5.8').ok, false);

  // And a file with no version at all is refused rather than treated as an empty one.
  assert.equal(rewriteVersionText('{ "name": "micro-thing" }\n', '2.5.7', '2.5.8').ok, false);
});
