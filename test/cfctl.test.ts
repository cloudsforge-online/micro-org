import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspect,
  isOrgRemote,
  microRoot,
  readGhcrTokenAnswer,
  parseManifest,
  portFor,
  renderManifest,
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
  assert.equal(REGISTRY.length, 71);
  const counts = new Map<string, number>();
  for (const repo of REGISTRY) counts.set(repo.kind, (counts.get(repo.kind) ?? 0) + 1);
  assert.equal(counts.get('service'), 26, '22 from 03 §1.1, plus emberkin, foresight, aetherholm and tessera');
  assert.equal(counts.get('web'), 17, '11 from 03 §1.2, four of the five 05-user-journeys §1 records (foresight-admin-web folded into admin-web at P13), and the two operator consoles');
  assert.equal(counts.get('ops'), 3, '3 operations services');
  assert.equal(counts.get('library'), 4, '4 library repositories');
  assert.equal(counts.get('assets'), 4, 'brand and the three per-title asset repositories');
  assert.equal(counts.get('template'), 2, '2 templates');
  assert.equal(counts.get('org'), 4, 'org, docs, deploy and conformance — machinery, not product');
  assert.equal(counts.get('kept'), 11, '3 kept, 7 leaving, and one that is not ours at all');
  assert.equal(managedRepos().length, 60);
  assert.equal(deployableRepos().length, 46, 'services, frontends and operations services');
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
 *   * `tessera` derives 4125, and `deploy/compose/docker-compose.estate.yml:1423` pins 4140
 *
 * `docker-compose.estate.yml:1545-1553` says its host ports are "derived, like every other port
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
  // 4144-4145 — the two operator consoles, appended (registry.ts:305-324).
  'lantern-web', 'beacon-web',
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
    },
    {
      name: 'hub-web',
      repo: 'micro-hub-web',
      kind: 'web',
      image: 'ghcr.io/cloudsforge-online/micro-hub-web',
      tag: '2.0.0',
      commit: 'aa11bb22cc33',
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
