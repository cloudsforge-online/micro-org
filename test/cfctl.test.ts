import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { blankComments } from '../.github/actions/source-scan/source-scan.mjs';
import {
  compareDotted,
  digestVerdict,
  distributionVerdict,
  ghcrPath,
  inspect,
  isOrgRemote,
  microRoot,
  readContentDigest,
  readGhcrTokenAnswer,
  parseManifest,
  portFor,
  publishesAnArtifact,
  readGithubReleases,
  renderManifest,
  rewriteVersionText,
  satisfies,
  unregisteredSiblings,
  type ReleaseManifest,
} from '../tools/cfctl.ts';
import {
  ALLOWED_SCOPED_PACKAGES,
  REGISTRY,
  absorbedRepos,
  clientRepos,
  deployableRepos,
  imageFor,
  managedRepos,
  releasableRepos,
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
  //
  // 78 since 2026-08-10: the five wallet-client repositories of 25-wallet-clients.md §9
  // (micro-org#352). All five had been checked out beside the estate since 2026-08-06 and were
  // named by no row, which `cfctl doctor` reported as five permanent FAILs — measured five before
  // this change and zero after. Five failures that are always there are five nobody reads, and a
  // sixth real one would have arrived indistinguishable from them.
  //
  // They are THREE kinds, not one, and the counts below are where that is asserted rather than
  // left to prose: `hearth-wallet-core` publishes a package so it is a fifth `library`;
  // `wallet-assets` has no package.json and a MANIFEST.json so it is a fifth `assets`; and the
  // three shells are `client`, a kind added in the same change because no existing one fits them
  // without claiming something false. All five are `deployable: false`, so `DERIVED_PORT_ORDER`
  // below is UNCHANGED — the measurement that let this block be filed tidily by kind rather than
  // appended the way `pool`/`pool-web` and the two consoles had to be.
  //
  // 79 since 2026-08-16: `exchange-web`, the Forge Exchange frontend of 39-forge-exchange.md §6
  // phase H. ONE ROW AND NOT TWO, which is the fact this line exists to record: every other
  // frontend added here arrived with a service beside it, and this one has none because there is
  // no `micro-exchange` to add. Its counterpart is a factory, a router and WEMBER on Hearth, and
  // the bundle reads them with `eth_call` from the reader's own browser. So `web` goes to 19 and
  // `service` stays at 27 — a shape no previous row in this file has had, and the reason to assert
  // both counts separately rather than only the total.
  //
  // 80 since 2026-08-17: `journal-web`, the Forge Journal frontend of 40-forge-journal.md. The
  // SECOND one-row frontend in a row, and for a different reason than the exchange's, which is why
  // this line does not simply extend the one above it. The exchange has no service because its
  // counterpart is a contract on Hearth. The Journal has no service because its counterpart is
  // `src/content/` in its own repository: every article is a typed module, and the build renders
  // each one to a static file with its own head. There is nothing to call at runtime, and a CMS
  // would move the words out of git — which is the property an editorial archive least wants,
  // since it is what makes an article's history a diff and its publication a merge.
  //
  // So `web` goes to 20 and `service` stays at 27 for the second consecutive addition.
  //
  // Appended, like `pool`/`pool-web` and the two consoles, so `DERIVED_PORT_ORDER` below gains one
  // entry at the end and moves none.
  //
  // 82 since 2026-08-17: `agora` and `agora-web`, Forge Agora of 41-forge-agora.md. TWO ROWS, and
  // the run of one-row frontends ends here rather than continuing — which is the fact worth
  // recording, because the two lines above it explain at length why a frontend can arrive alone.
  // Both of those reasons were about where the state lives: on Hearth for the exchange, in git for
  // the Journal. Agora's state is what strangers wrote a minute ago. There is no chain to read it
  // from and no build that can contain it, so `service` moves for the first time since the mining
  // pool — to 28 — and `web` to 21.
  //
  // The pair goes in together and at the end, so they derive 4150 and 4151 and nothing above them
  // moves. Filed by kind instead, `agora` would have landed among the services at index 26 and
  // shifted every frontend in the registry down one, which is the edit `DERIVED_PORT_ORDER` exists
  // to price.
  assert.equal(REGISTRY.length, 82);
  const counts = new Map<string, number>();
  for (const repo of REGISTRY) counts.set(repo.kind, (counts.get(repo.kind) ?? 0) + 1);
  assert.equal(counts.get('service'), 28, '22 from 03 §1.1, plus emberkin, foresight, aetherholm, tessera, the mining pool and Forge Agora');
  assert.equal(counts.get('web'), 21, '11 from 03 §1.2, four of the five 05-user-journeys §1 records (foresight-admin-web folded into admin-web at P13), the two operator consoles, the pool console, Forge Exchange, Forge Journal and Forge Agora — the exchange and the Journal the only two with no service beside them');
  assert.equal(counts.get('ops'), 3, '3 operations services');
  assert.equal(counts.get('library'), 5, '4 library repositories, plus the wallet core that publishes @cloudsforge/hearth-wallet-core');
  assert.equal(counts.get('assets'), 5, 'brand, the three per-title asset repositories and the wallet art');
  assert.equal(counts.get('client'), 3, 'desktop, extension and mobile — builds a user installs, not services the estate runs');
  assert.equal(counts.get('template'), 2, '2 templates');
  assert.equal(counts.get('org'), 4, 'org, docs, deploy and conformance — machinery, not product');
  assert.equal(counts.get('kept'), 11, '3 kept, 7 leaving, and one that is not ours at all');
  assert.equal(managedRepos().length, 71);
  assert.equal(
    deployableRepos().length,
    52,
    'services, frontends and operations services — UNCHANGED by the five wallet rows, which is why they could be filed by kind; 52 since agora and agora-web were appended at 4150 and 4151',
  );
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
  // 4148 — Forge Exchange's frontend, appended on 2026-08-16 for the same reason.
  //
  // THIS IS THE FIRST ENTRY IN THIS LIST WHOSE PORT NOTHING WILL EVER DIAL, and saying so here is
  // cheaper than letting somebody find out by connecting to it. The derivation is positional and
  // unconditional — index in `deployableRepos()`, plus 4100 — and it means "the service for this
  // row, on a developer's machine". There is no service: `micro-exchange-web` reads Hearth
  // directly, and the port it answers on in a checkout is its vite server, 5194, recorded in the
  // surface registry's `devPort` rather than derived here. In the estate it is
  // `exchange-web:8080` behind the gateway. 4148 exists because the derivation cannot skip a row,
  // and it is pinned here for the only reason any of these are: so that inserting something above
  // it is expensive.
  'exchange-web',
  // 4149 — Forge Journal's frontend, appended on 2026-08-17. The second entry whose port nothing
  // dials, for a different reason from the exchange's: the Journal has no service because every
  // article is a typed module in its own repository and the build renders it to a file. In a
  // checkout it answers on vite's 5195; in the estate it is `journal-web:8080` behind the gateway.
  'journal-web',
  // 4150-4151 — Forge Agora, appended on 2026-08-17. THE FIRST ENTRY SINCE `pool` WHOSE DERIVED
  // PORT IS A REAL ADDRESS, and it is worth saying because the three lines above this one all
  // explain why a number here dials nothing. `micro-agora` is a service: 4150 is where it listens
  // in a checkout, the same way 4100 is identity's. 4151 is `agora-web`, and that one is inert
  // again — the bundle's dev server is 5197, recorded in the surface registry's `devPort`.
  'agora', 'agora-web',
  // NOTHING FOR THE FIVE WALLET ROWS OF 2026-08-10, and that absence is a measurement rather than
  // an omission (micro-org#352). `pool`, `pool-web`, `lantern-web` and `beacon-web` all had to be
  // appended because they are deployable, and position in `deployableRepos()` IS the port. The
  // five wallet rows are `deployable: false` — `client()` fixes that in the constructor rather
  // than taking it as an argument — so `deployableRepos()` never sees them and they could be
  // filed where they belong, beside the other libraries and asset repositories and in a block of
  // their own. Measured before and after: 48 deployables both times, and this list unchanged.
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

/**
 * ── THE PORT MAP ITSELF, MEASURED ON 2026-08-26 AND FROZEN ─────────────────────────────────────
 *
 * `DERIVED_PORT_ORDER` above pins the ORDER of `deployableRepos()`. This pins the NUMBERS, which
 * is not the same assertion and does not have the same failure mode: the order test compares an
 * array against an array and can be made green by editing the array, which has happened once
 * already and is documented at length where it happened. This one is a name→port map captured from
 * the running tool before a change that had no business touching any of them, and every value in
 * it is a number some other repository has already written down.
 *
 * WHY IT WAS ADDED (micro-org, the absorbed-repository change). Four rows — `analytics`, `notify`,
 * `aetherholm`, `nda` — stopped being bumped, built and released while STAYING in
 * `deployableRepos()`, because that list is where position is counted and position is the port.
 * The obvious tidy-up is to delete them, and it silently moves forty-odd host ports; the whole
 * safety case for that change is that these numbers did not move, so the numbers are written down
 * rather than argued about.
 *
 * WHAT IT DOES NOT FORBID: appending. A new row at the end adds a name this map does not mention
 * and changes no value in it, which is exactly the freedom the append-only rule buys. What it
 * catches is a row inserted or REMOVED anywhere above the end — including the removal that looks
 * like housekeeping.
 */
const DERIVED_PORTS: Readonly<Record<string, number>> = {
  "identity": 4100, "policy": 4101, "ledger": 4102, "wallet": 4103,
  "settlement": 4104, "pricing": 4105, "billing": 4106, "custody": 4107,
  "indexer": 4108, "activity": 4109, "notify": 4110, "studio": 4111,
  "mint": 4112, "market": 4113, "trade": 4114, "worlds": 4115,
  "nda": 4116, "community": 4117, "devplatform": 4118, "hub-api": 4119,
  "admin-api": 4120, "analytics": 4121, "emberkin": 4122, "foresight": 4123,
  "aetherholm": 4124, "tessera": 4125, "hub-web": 4126, "site": 4127,
  "admin-web": 4128, "mint-web": 4129, "trade-web": 4130, "worlds-web": 4131,
  "explorer-web": 4132, "network-site": 4133, "market-web": 4134, "devportal-web": 4135,
  "status-web": 4136, "emberkin-web": 4137, "foresight-web": 4138, "aetherholm-web": 4139,
  "tessera-web": 4140, "lantern": 4141, "beacon": 4142, "faucet": 4143,
  "lantern-web": 4144, "beacon-web": 4145, "pool": 4146, "pool-web": 4147,
  "exchange-web": 4148, "journal-web": 4149, "agora": 4150, "agora-web": 4151,
};

test('every derived port is the number it was before the absorbed rows left the release', () => {
  // Reported one row at a time and by both numbers, because "two maps differ" is not the sentence
  // an operator needs — the useful one names the service and what compose now disagrees with.
  for (const [name, port] of Object.entries(DERIVED_PORTS)) {
    assert.equal(
      portFor(name),
      port,
      `'${name}' derived ${port} and now derives ${portFor(name)} — a deployable row was inserted ` +
        `or removed above it. deploy/compose/docker-compose.estate.yml pins \${CF_PORT_BASE:-4}` +
        `${String(port).slice(1)} for it and estate-verify.sh resolves the same number.`,
    );
  }

  // The map has to keep covering the whole block, or it stops being a safety net the day somebody
  // deletes a row AND its line here in the same commit. Appending is still free: this is >=.
  assert.ok(
    deployableRepos().length >= Object.keys(DERIVED_PORTS).length,
    `deployableRepos() holds ${deployableRepos().length} rows and this map pins ` +
      `${Object.keys(DERIVED_PORTS).length}; a row was removed, so ports below it have moved`,
  );
  for (const repo of deployableRepos().slice(0, Object.keys(DERIVED_PORTS).length)) {
    assert.ok(
      repo.name in DERIVED_PORTS,
      `'${repo.name}' sits inside the frozen block but is not in this map — it was inserted rather ` +
        `than appended, and every port below it has moved`,
    );
  }
});

/**
 * ── AN ABSORBED ROW HOLDS A PORT AND CANNOT REACH A MANIFEST ───────────────────────────────────
 *
 * The four services below were merged into other services' pods and the merges are deployed
 * (release 2026.8.103): their compose services are deleted, `deploy/scripts/k8s-render.py` emits
 * each as an ExternalName alias, and no pod runs their images. They were nonetheless still full
 * deployables — `cfctl bump` version-bumped them every release, every push published an image
 * nobody pulls, and all four appeared in `releases/*.yaml`, which described a 52-service estate
 * running 31 Deployments.
 *
 * The two halves of this test are the two things that had to become true at once, and they pull in
 * opposite directions — which is the entire reason the change was delicate:
 *
 *   * they must STAY in `deployableRepos()`, at their original indices, because that is where the
 *     port comes from and micro-deploy has written those numbers down;
 *   * they must LEAVE everything that describes a separately shipped artifact.
 *
 * A fix that satisfied only the second half — deleting the rows — passes every test about
 * manifests and moves forty-odd ports in silence.
 */
const ABSORBED: Readonly<Record<string, { into: string; index: number; port: number }>> = {
  // Wave M5a folded the four platform-tier services into agora — see registry.ts.
  policy: { into: 'agora', index: 1, port: 4101 },
  // Wave M5b folded the commerce/games tier into agora too — twelve modules.
  billing: { into: 'agora', index: 6, port: 4106 },
  pricing: { into: 'agora', index: 5, port: 4105 },
  notify: { into: 'activity', index: 10, port: 4110 },
  studio: { into: 'agora', index: 11, port: 4111 },
  mint: { into: 'agora', index: 12, port: 4112 },
  market: { into: 'agora', index: 13, port: 4113 },
  worlds: { into: 'agora', index: 15, port: 4115 },
  community: { into: 'agora', index: 17, port: 4117 },
  nda: { into: 'emberkin', index: 16, port: 4116 },
  devplatform: { into: 'agora', index: 18, port: 4118 },
  analytics: { into: 'lantern', index: 21, port: 4121 },
  foresight: { into: 'agora', index: 23, port: 4123 },
  aetherholm: { into: 'emberkin', index: 24, port: 4124 },
  tessera: { into: 'agora', index: 25, port: 4125 },
};

test('an absorbed row keeps its port slot and its index', () => {
  const order = deployableRepos().map((repo) => repo.name);
  for (const [name, expected] of Object.entries(ABSORBED)) {
    const row = repoByName(name);
    assert.ok(row, `${name} was DELETED from the registry — that moves every port beneath it`);
    assert.equal(row.deployable, true, `${name} stopped being deployable, which removes it from the port block`);
    assert.equal(row.absorbedInto, expected.into);
    assert.equal(order.indexOf(name), expected.index, `${name} moved within deployableRepos()`);
    assert.equal(portFor(name), expected.port);
  }
  assert.equal(absorbedRepos().length, Object.keys(ABSORBED).length);
});

test('an absorbed row cannot reach a release manifest', () => {
  // `releasableRepos()` is the list `cmdRelease` iterates and the list `cmdBump` bumps, so this is
  // the generated manifest's guest list rather than a proxy for it.
  const releasable = new Set(releasableRepos().map((repo) => repo.name));
  for (const name of Object.keys(ABSORBED)) {
    assert.ok(
      !releasable.has(name),
      `${name} is absorbed and would still be pinned — a manifest naming an image no pod runs is ` +
        `the defect this change exists to end`,
    );
  }
  assert.equal(releasable.size, 37, '52 deployables less the fifteen absorbed');
  assert.equal(deployableRepos().length, 52, 'and the port block is untouched');

  // Every releasable row still resolves to an image, so the filter removed the four and nothing
  // else. A filter that removed too much would leave a manifest silently short.
  for (const repo of releasableRepos()) {
    assert.match(imageFor(repo), /^ghcr\.io\/[^/]+\/micro-[a-z0-9-]+$/);
  }

  // THE STRUCTURAL HALF, and it is checked by `pnpm typecheck` rather than by this assertion.
  // `imageFor` takes `ReleasableRepo`; an `AbsorbedRepo` is not assignable to it, so an absorbed
  // row has no image name to be pinned WITH — the skip in `cmdRelease` is a convenience and this
  // is the guarantee. If somebody widens `imageFor` back to `ManagedRepo`, the directive below
  // becomes an unused-expect-error and typecheck goes red naming this line.
  const merged = absorbedRepos();
  if (merged.length > 0) {
    // @ts-expect-error an absorbed repository must never be given a GHCR image name
    imageFor(merged[0]);
  }
});

test('every absorber is a real repository that is itself still shipped', () => {
  // The failure this catches is a typo or a chain: `absorbedInto: 'lantren'` names nothing, and
  // `a → b` where `b` is itself absorbed describes a pod that does not exist. Both would make
  // doctor print a fix nobody can follow.
  for (const repo of absorbedRepos()) {
    const into = repoByName(repo.absorbedInto);
    assert.ok(into, `${repo.name} claims to run inside '${repo.absorbedInto}', which is in no registry row`);
    assert.equal(into.managed, true, `${repo.name} names an unmanaged absorber`);
    assert.equal(into.deployable, true, `${repo.name} names an absorber that is not deployed`);
    assert.equal(
      into.absorbedInto,
      undefined,
      `${repo.name} runs inside ${into.name}, which is itself absorbed — there is no pod at the end of that chain`,
    );
  }
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

// `releasableRepos()` rather than `deployableRepos()`, and the change is not a widening of scope
// to keep a compiler quiet: `imageFor` no longer ACCEPTS a deployable row, because four of them are
// absorbed and have no image. This assertion moved with the meaning it was always making — "every
// row a manifest can name resolves to an org image" — and the rows it stopped covering are covered
// by 'an absorbed row cannot reach a release manifest' above, which asserts they have no image name
// to resolve at all.
test('every releasable repository resolves to a GHCR image under the org', () => {
  for (const repo of releasableRepos()) {
    assert.match(imageFor(repo), /^ghcr\.io\/[^/]+\/micro-[a-z0-9-]+$/);
  }
});

test('publish-image.yml refuses exactly the absorbed repositories registry.ts names', () => {
  // A SECOND COPY OF SOMETHING registry.ts OWNS, and therefore a thing to check rather than to
  // trust. A workflow cannot import TypeScript, so the four repository names have to be written
  // into the YAML — and this file already knows what that costs: `@cloudsforge/secrets` was added
  // to service-ci.yml and not to registry.ts, and `cfctl doctor` reported 36 false failures for
  // four days. Parsed out of the workflow, exactly as the allow-list below it is, so that the
  // fifth absorbed row cannot be declared in one place and published from the other.
  const orgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workflow = readFileSync(path.join(orgRoot, '.github/workflows/publish-image.yml'), 'utf8');
  const literal = workflow.match(/!contains\(fromJSON\('(\[[^']*\])'\), github\.event\.repository\.name\)/)?.[1];
  assert.ok(
    literal,
    'publish-image.yml no longer refuses the absorbed repositories by name — re-point this test, do not delete it: ' +
      'without that clause every push to an absorbed repository publishes an image no manifest can name',
  );
  assert.deepEqual(
    [...(JSON.parse(literal) as string[])].sort(),
    absorbedRepos().map((repo) => repo.repo).sort(),
  );
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

// -- the clients, which a release manifest cannot name (micro-org#352) --------------------------

test('a client consumes no derived port, because a client is not deployed', () => {
  // The registry's own rule, asserted rather than trusted: `portFor` counts position in
  // `deployableRepos()`, so a `client` row that leaked into that list would both take a host port
  // from a service that already has one and put `ghcr.io/cloudsforge-online/micro-wallet-desktop`
  // into the next release manifest — an image that has never been built and never will be.
  // 25-wallet-clients.md §10.2: "they are not in the registry's deployable set, and they consume
  // no port from the derived block".
  const deployable = new Set(deployableRepos().map((repo) => repo.name));
  assert.equal(clientRepos().length, 3);
  for (const client of clientRepos()) {
    assert.equal(client.deployable, false, `${client.name} is deployable`);
    assert.ok(!deployable.has(client.name), `${client.name} reached the deployable set`);
  }
});

test('every client records what is in front of users, with a date and a reason', () => {
  // THE POINT OF THE WHOLE RECORD. A release manifest answers "which artifact, built from which
  // commit, is in front of users" for 48 container images. None of these three is a container
  // image, so before this row existed the estate's one mechanism for that question could say
  // nothing at all about them — not shipped, not unshipped, not at what version. This asserts the
  // record can still answer it: a state, a date it has been true since, and either an artifact or
  // the reasons there is not one.
  // The clock, not a date written here. A hardcoded "today" would either age into a trap — the
  // next client to be recorded gets a date this test calls the future — or be updated by whoever
  // it inconveniences, which is the same thing more slowly. `since` in the past is a property of
  // the record, not of the day the suite runs.
  const today = new Date();
  for (const client of clientRepos()) {
    const record = client.distribution;
    assert.match(record.since, /^\d{4}-\d{2}-\d{2}$/, `${client.name}: since is not a date`);
    const since = new Date(`${record.since}T00:00:00Z`);
    assert.ok(!Number.isNaN(since.getTime()), `${client.name}: since does not parse`);
    // A date in the future is how "recorded on the day it became true" turns into a placeholder.
    assert.ok(since <= today, `${client.name}: recorded as true since a date that has not happened`);
    if (record.state === 'none') {
      // "Not distributed" with no reason is indistinguishable from nobody having got round to it,
      // and the difference is the entire claim this makes: DELIBERATELY not distributed. Each
      // blocker is also the owner's decision rather than this tool's — a store listing, a signing
      // key, a developer account — so naming them is what keeps that boundary visible.
      assert.ok(record.blockedOn.length > 0, `${client.name}: not distributed, and no reason given`);
      for (const blocker of record.blockedOn) {
        assert.ok(blocker.trim().length > 10, `${client.name}: '${blocker}' does not say anything`);
      }
    } else {
      for (const [field, value] of Object.entries(record)) {
        assert.ok(String(value).trim() !== '', `${client.name}: ${field} is empty in a shipped record`);
      }
    }
  }
});

// Four real answers from api.github.com, captured 2026-08-10 rather than written by hand. The
// first is what `micro-wallet-desktop` returns today — the state this whole record describes; the
// second is the body GitHub serves for a repository the caller cannot see, verbatim including the
// documentation_url; the third and fourth are real release entries from tauri-apps/tauri and
// electron/electron, the second of which is a prerelease. A check whose only test is the internet
// is a check that is silently wrong between outages.
const RELEASES_EMPTY = '[\n\n]\n';
const RELEASES_NOT_FOUND =
  '{\n  "message": "Not Found",\n' +
  '  "documentation_url": "https://docs.github.com/rest/releases/releases#list-releases",\n' +
  '  "status": "404"\n}\n';
const RELEASES_REAL =
  '[{"tag_name":"tauri-v2.11.5","name":"tauri v2.11.5","draft":false,"prerelease":false},' +
  '{"tag_name":"tauri-v2.11.4","name":"tauri v2.11.4","draft":false,"prerelease":false}]';
const RELEASES_PRERELEASE = '[{"tag_name":"v44.0.0-beta.2","draft":false,"prerelease":true}]';

test('an empty release list is zero releases; a refusal is not', () => {
  // THE ONE THING THIS MUST NOT DO. `[]` means the repository has published nothing, which is a
  // finding. `{"message":"Not Found"}` is what the API returns for any repository the caller
  // cannot see — every private one, asked anonymously — and a reader that counted its way to zero
  // would report a private, shipping client as undistributed. That is the exact failure this
  // command exists to catch, arriving through the check meant to catch it. Same lesson as GHCR's
  // DENIED, one screen up in cfctl.ts.
  assert.deepEqual(readGithubReleases(RELEASES_EMPTY).tags, []);
  assert.equal(readGithubReleases(RELEASES_NOT_FOUND).tags, undefined);
  assert.match(readGithubReleases(RELEASES_NOT_FOUND).reason ?? '', /Not Found/);
  assert.deepEqual(readGithubReleases(RELEASES_REAL).tags, ['tauri-v2.11.5', 'tauri-v2.11.4']);
  // A prerelease is public and downloadable by anybody with the link, so it is an artifact in
  // front of users and counts. A draft is visible only to maintainers and does not.
  assert.deepEqual(readGithubReleases(RELEASES_PRERELEASE).tags, ['v44.0.0-beta.2']);
  assert.deepEqual(
    readGithubReleases('[{"tag_name":"v1.0.0","draft":true},{"tag_name":"v0.9.0","draft":false}]').tags,
    ['v0.9.0'],
  );
  // Nothing that is not a list of nameable releases is allowed to read as a count.
  assert.equal(readGithubReleases('<html>502 Bad Gateway</html>').tags, undefined);
  assert.equal(readGithubReleases('{}').tags, undefined);
  assert.equal(readGithubReleases('[{"name":"no tag here"}]').tags, undefined);
});

test('a client that is distributed while the registry says it is not is the loud case', () => {
  const notShipped = { state: 'none', since: '2026-08-10', blockedOn: ['a signing key'] } as const;
  const shipped = {
    state: 'distributed',
    since: '2026-09-01',
    channel: 'GitHub releases',
    artifact: 'micro-wallet-desktop.dmg',
    version: '2.11.5',
    commit: '6681ca630e14',
  } as const;

  // The state today, and the only one in which "no artifact is in front of users" is KNOWN.
  assert.equal(distributionVerdict(notShipped, { tags: [] }), 'undistributed');
  // The false-green this exists to prevent: the registry making a false statement about what a
  // user can install. Loud, and a non-zero exit, because a stale record here is not a tidiness
  // problem — it is the estate being unable to name a build people are running.
  assert.equal(distributionVerdict(notShipped, { tags: ['v1.0.0'] }), 'shipped');
  // Both tag spellings this organisation uses, because a record reported `missing` over a leading
  // 'v' would be a false alarm, and a false alarm is how a check gets switched off.
  assert.equal(distributionVerdict(shipped, { tags: ['tauri-v2.11.5', 'v2.11.5'] }), 'confirmed');
  assert.equal(distributionVerdict(shipped, { tags: ['2.11.5'] }), 'confirmed');
  // A claim that users hold something they do not.
  assert.equal(distributionVerdict(shipped, { tags: ['2.11.4'] }), 'missing');
  // Verification that could not run is a failure, never a pass — `release --verify` says the same.
  assert.equal(distributionVerdict(notShipped, { reason: 'GitHub answered nothing' }), 'unreadable');
  assert.equal(distributionVerdict(shipped, { reason: 'GitHub answered nothing' }), 'unreadable');
});

test('a client workflow that can publish is found, and one that only mentions publishing is not', () => {
  // The offline half, and the one that runs where the estate is checked out rather than where the
  // network is. It watches for the FIRST commit that turns a client into something a user can
  // install, in the repository where that commit lands — so the record cannot go stale quietly.
  assert.equal(
    publishesAnArtifact('jobs:\n  release:\n    steps:\n      - run: gh release create v1.0.0 out/*.dmg\n'),
    'gh release create',
  );
  assert.equal(
    publishesAnArtifact('      - uses: tauri-apps/tauri-action@v0\n        with:\n          tagName: v__VERSION__\n'),
    'tauri-apps/tauri-action',
  );
  assert.equal(publishesAnArtifact('      - run: pnpm dlx web-ext sign --channel listed\n'), 'web-ext sign');

  // micro-org#303: the first `cfctl cross` run claimed eleven edges out of one file and ten were
  // CITATIONS IN PROSE. All three of these workflows carry argued headers, and the header in
  // micro-wallet-desktop's ci.yml explains what the repository does NOT do. A comment saying "we
  // do not run gh release create here" must not read as running it.
  assert.equal(
    publishesAnArtifact('# nothing here runs gh release create; see tools/registry.ts\njobs:\n  ci:\n'),
    undefined,
  );
  // A `#` opens a comment only at the start of a line or after whitespace — YAML's rule, which
  // source-scan.mjs implements and this relies on rather than restates.
  assert.equal(publishesAnArtifact('      - run: echo "url#gh release create"\n'), 'gh release create');

  // Signing and notarisation are deliberately NOT markers, though every row's blockedOn names
  // them: a signed build that is uploaded nowhere is still in front of nobody, and `codesign`
  // appears in macOS build steps that ship nothing. A sensor that fires on a prerequisite fires
  // early, and a check that cries wolf is a check that gets deleted.
  assert.equal(publishesAnArtifact('      - run: codesign --deep --sign "Developer ID" out/app\n'), undefined);
  assert.equal(publishesAnArtifact('      - run: pnpm build && pnpm test\n'), undefined);
});

test('every client checkout on this machine is described by its row, or the row is stale', () => {
  // Vacuity guard, and it is the reason this test looks odd: in micro-org's own CI the only
  // sibling is micro-org, so a loop over the checkouts asserts nothing and would go green forever
  // — the failure mode this estate keeps rediscovering. So the ROW is what is checked, always, and
  // the checkout is only compared when it is actually here.
  for (const client of clientRepos()) {
    assert.equal(client.repo, `micro-${client.name}`);
    assert.equal(client.path, `micro/${client.name}`);
    assert.equal(client.kind, 'client');
    assert.equal(client.managed, true);
  }
  const checkedOut = clientRepos().filter((client) => inspect(client).state !== 'absent');
  for (const client of checkedOut) {
    // A client that is checked out has a package.json with a version, because that version is what
    // `cfctl clients` prints as "what is built here" beside "what is distributed".
    const manifest = JSON.parse(readFileSync(path.join(inspect(client).dir, 'package.json'), 'utf8')) as {
      version?: string;
      private?: boolean;
    };
    assert.match(manifest.version ?? '', /^\d+\.\d+\.\d+/, `${client.name} has no version to print`);
    // `private: true` is the evidence the kind was argued from: these publish no package, so
    // `library` would have fed a private version into doctor's "which @cloudsforge package can a
    // consumer resolve" map, answering a question nobody asked.
    assert.equal(manifest.private, true, `${client.name} is no longer private; re-argue its kind`);
  }
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

// -- bump does not create a branch (micro-org#422) -----------------------------------------------
//
// `cmdBump` is not exported and cannot be: it walks the real registry and writes to real sibling
// checkouts, so calling it in a test would bump the estate. What CAN be asserted is the shape of
// the git it runs, and the shape is the whole of micro-org#422 — a release branch that has to be
// merged back is a release branch that will not be, and forty-four repositories proved it.

function bumpSource(): string {
  const orgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = readFileSync(path.join(orgRoot, 'tools/cfctl.ts'), 'utf8');
  const start = source.indexOf('function cmdBump(');
  const end = source.indexOf('function cmdRelease(');
  assert.ok(start > 0 && end > start, 'cmdBump and cmdRelease must both still be in cfctl.ts');
  // Comments are blanked before matching. This file argues for the design it implements, so every
  // phrase this test looks for also appears in prose a few lines above the code — and a test that
  // a comment satisfies is a test that survives the code being deleted.
  return blankComments(source.slice(start, end));
}

test('bump commits the version on main and never cuts a release branch', () => {
  const bump = bumpSource();

  // The two ways the old implementation reached the branch. Either one coming back re-opens #422.
  assert.ok(!bump.includes("'checkout'"), 'cmdBump must not check out anything');
  assert.ok(!bump.includes("'-b'"), 'cmdBump must not create a branch');

  // What it pushes is the branch the operator is standing on, which the refusal above pins to
  // `main`. Pushing a literal would silently ignore --any-branch.
  assert.ok(bump.includes("['push', 'origin', branch]"));
  assert.ok(bump.includes('publish(repo, checkout.dir, checkout.branch)'));
  assert.ok(bump.includes("checkout.branch !== 'main'"));
});

test('a re-run over already-bumped repositories pushes the branch, not only the tag', () => {
  const bump = bumpSource();

  // The documented workflow is `bump`, read the diffs, then `bump --push`. On that second run
  // every repository is ALREADY at the version, so it takes the short path — and when that path
  // pushed only the tag, the run reported success having left `main` local in all forty-eight.
  // No push to main, no image built, and `cfctl release` then pins tags that do not exist.
  //
  // Asserted structurally: both paths must reach the remote through the SAME helper, so neither
  // can be extended without the other. Two call sites, one `publish`.
  const calls = bump.match(/publish\(repo, checkout\.dir, checkout\.branch\)/g) ?? [];
  assert.equal(calls.length, 2, 'both the already-at-version path and the fresh bump must publish');
  assert.ok(!bump.includes('ensureTag(repo, checkout.dir)'), 'no path may tag without pushing main');

  // And the order inside it stays branch-then-tag: a tag pushed before its commit names something
  // the remote does not have.
  const helper = bump.slice(bump.indexOf('const publish ='));
  assert.ok(helper.indexOf("['push', 'origin', branch]") < helper.indexOf('ensureTag(repo, dir)'));
});

test('the release is named by an annotated tag, referred to by its full ref', () => {
  const bump = bumpSource();

  // Annotated, not lightweight: a lightweight tag carries no tagger, no date and no message, so
  // `release/<v>` would answer "which commit" and nothing about who cut it or when.
  assert.ok(bump.includes("['tag', '-a', tag, '-m', message]"));

  // Fully qualified on every side. A repository that still carries the historical
  // `release/<version>` BRANCH makes the bare name ambiguous, and git resolves it to the branch —
  // so an unqualified read would compare HEAD against a branch tip and an unqualified push would
  // push the branch. Both are the failure this change exists to remove.
  assert.ok(bump.includes('const tagRef = `refs/tags/${tag}`'));
  assert.ok(bump.includes("`${tagRef}^{commit}`"));
  assert.ok(bump.includes("['push', 'origin', tagRef]"));

  // The tag is checked before it is written, and a tag that already names a DIFFERENT commit is a
  // refusal rather than a `--force`. Moving it would make the release name mutable again.
  assert.ok(!bump.includes("'-f'") && !bump.includes("'--force'"));
});
