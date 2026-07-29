import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  inspect,
  microRoot,
  parseManifest,
  renderManifest,
  satisfies,
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

test('the registry holds all 46 repositories from 03 §1', () => {
  assert.equal(REGISTRY.length, 46);
  const counts = new Map<string, number>();
  for (const repo of REGISTRY) counts.set(repo.kind, (counts.get(repo.kind) ?? 0) + 1);
  assert.equal(counts.get('service'), 22, '22 domain services');
  assert.equal(counts.get('web'), 11, '11 frontends');
  assert.equal(counts.get('ops'), 3, '3 operations services');
  assert.equal(counts.get('library'), 4, '4 library repositories');
  assert.equal(counts.get('template'), 2, '2 templates');
  assert.equal(counts.get('org'), 1, 'this repository');
  assert.equal(counts.get('kept'), 3, '3 kept exactly as they are');
});

test('names are unique — a duplicate would make one entry unreachable', () => {
  const names = new Set(REGISTRY.map((repo) => repo.name));
  assert.equal(names.size, REGISTRY.length);
});

test('nothing managed lives under repos/, and everything kept does', () => {
  // The repository policy is absolute: the existing estate is read only for this programme. A
  // managed entry pointing into repos/ would let clone, pull and release write to it.
  for (const repo of REGISTRY) {
    if (repo.managed) {
      assert.ok(repo.path.startsWith('micro/'), `${repo.name} is managed but lives at ${repo.path}`);
      assert.ok(repo.repo.startsWith('micro-'), `${repo.name} is managed but is not a micro-* repository`);
    } else {
      assert.ok(!repo.path.startsWith('micro/'), `${repo.name} is unmanaged but lives at ${repo.path}`);
    }
  }
});

test('the kept repositories are listed rather than omitted', () => {
  // pull-all.sh omitted crucible, so the documented update path silently skipped it. An
  // exclusion that is written down is a decision; one that is not is that bug.
  for (const name of ['hearth', 'asset-forge', 'stack']) {
    const repo = repoByName(name);
    assert.ok(repo, `${name} is missing from the registry`);
    assert.equal(repo.managed, false);
  }
  assert.equal(managedRepos().length, 43);
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
  const org = repoByName('org');
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
