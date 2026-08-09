// cfctl — the CLI that replaces scripts/clone-all.sh and scripts/pull-all.sh (AD-03).
//
//   cfctl list                     the repository registry, and what is actually on disk
//   cfctl clone                    clone or fast-forward every micro-* repository
//   cfctl pull                     fast-forward the checkouts that already exist
//   cfctl doctor                   the checks for the things that actually break
//   cfctl release <version>        generate releases/<version>.yaml, one image per service
//   cfctl release --verify <v>     check every image exists and is still the image that was pinned
//   cfctl new service <name>       instantiate micro-service-template
//   cfctl new web <name>           instantiate micro-web-template
//
// Two properties are inherited from the shell scripts on purpose, because they got them right:
// a checkout with local changes is reported and left alone rather than clobbered, and a branch
// that has diverged is a decision this tool will not make for you.
//
// One property is new, and it has been strengthened from a flag into a structure: cfctl cannot
// write to a repository this programme does not own. The existing estate is read-only for this
// programme (docs/ecosystem/README.md), the repositories in 03 §1.7 are leaving and stay
// deployable as the rollback target, and one directory in the tree — `kindred-upstream` — is a
// mirror of `savvaniss/kindred-resonance` and is not a CloudsForge repository at all. All eleven
// are LISTED in the registry rather than omitted, so the exclusion is visible in `cfctl list`,
// and three separate things now stop a write reaching one:
//
//   * `kind: 'kept'` implies `managed: false` in the type, so a managed kept row is a compile
//     error rather than a typo. `registry.ts`'s header carries the argument.
//   * `repoDir` and `inspect` take a `ManagedRepo`, so cfctl cannot compute a kept repository's
//     directory at all. `stackRoot()` is gone; resolving a kept row was its only purpose.
//   * every mutating git command goes through `gitWrite`, which refuses a checkout whose `origin`
//     is not a repository of this organisation — the gate that survives a misclassification, which
//     is the one failure the type cannot see.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_SCOPED_PACKAGES,
  ORG,
  REGISTRY,
  deployableRepos,
  imageFor,
  managedRepos,
  type ManagedRepo,
  type Repo,
} from './registry.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG_ROOT = path.resolve(HERE, '..');

// The directory the micro-* checkouts are siblings in — this checkout's own parent.
//
// This is derived by construction rather than searched for, because it is the one thing that is
// true whatever the layout: micro-org sits next to micro-ledger, micro-identity and the rest.
// Every managed repository is resolved from here.
//
// WHY not walk up looking for a directory containing 'micro' and 'repos': `stack/micro` is a
// symlink to a checkout elsewhere on this machine, and `import.meta.url` reports the resolved
// path. The walk therefore starts outside the stack tree and can never climb back into it — it
// silently answered with a directory two levels too high, and every repository was reported as
// absent. A path that is right only when nothing is symlinked is a path that is wrong.
export function microRoot(): string {
  const override = process.env['CLOUDSFORGE_MICRO_ROOT'];
  return override ? path.resolve(override) : path.resolve(ORG_ROOT, '..');
}

// `ManagedRepo`, and there is deliberately no way to resolve a kept one.
//
// This used to take a `Repo` and branch: managed repositories were siblings, and the kept ones
// were resolved under a `stackRoot()` that walked upward looking for a directory holding both
// `repos/` and `docs/`. Both halves of that were wrong. The path it produced was stale — `hearth`
// is a sibling now, not `repos/hearth` — and, much worse, it meant cfctl could compute an absolute
// path for a repository this programme must never touch. `kindred-upstream` is a checkout of
// `savvaniss/kindred-resonance` sitting among the estate's own, and the distance between "cfctl
// knows where it is" and "cfctl runs git in it" is one careless filter.
//
// So the resolution is gone rather than guarded, and `stackRoot()` with it: its only caller was
// the kept branch. A kept row keeps a `path` for a reader; nothing turns it into a directory.
function repoDir(repo: ManagedRepo): string {
  return path.join(microRoot(), repo.name);
}

function cloneUrl(repo: ManagedRepo): string {
  const proto = process.env['CLOUDSFORGE_GIT_PROTO'] ?? 'https';
  return proto === 'ssh' ? `git@github.com:${ORG}/${repo.repo}.git` : `https://github.com/${ORG}/${repo.repo}.git`;
}

interface Run {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

function run(command: string, args: readonly string[], cwd?: string): Run {
  const result = spawnSync(command, [...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    out: (result.stdout ?? '').trim(),
    err: (result.stderr ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------------------------
// The two git surfaces, and why there are two
// ---------------------------------------------------------------------------------------------
//
// The type system says a kept repository cannot reach a write path: `kind: 'kept'` implies
// `managed: false` in `Repo`'s union, `managedRepos()` is the only source of a `ManagedRepo`, and
// every write path takes one. That is a good guarantee and it has exactly one hole, which is the
// hole every type-level guarantee has: **it only binds the rows that say `kept`.** Give
// `kindred-upstream` `kind: 'service'` and it type-checks perfectly, and the next `cfctl pull`
// runs git in a stranger's repository.
//
// A checkout knows something the registry cannot lie about: where it came from. So the runtime
// half asks the checkout rather than the row, and it is a REFUSAL rather than a warning, because
// the failure it prevents — this programme's tooling committing, resetting or force-pushing into
// `savvaniss/kindred-resonance` — is not one an operator can undo by reading a log line.

/** Read-only git. Refuses anything that could move a checkout, whosever it is. */
function git(dir: string, args: readonly string[]): Run {
  const verb = args[0] ?? '';
  if (MUTATING_VERBS.has(verb)) {
    throw new Error(
      `cfctl: 'git ${verb}' can modify a checkout and was called on the read-only path. ` +
        'Use gitWrite(repo, …), which is the one function that may, and which refuses a ' +
        'repository outside this organisation.',
    );
  }
  return run('git', args, dir);
}

// Everything porcelain that can change a working tree, an index, a ref or a remote. Deliberately
// generous: a verb wrongly listed here costs a call site moving to `gitWrite`, and a verb wrongly
// omitted costs a repository.
const MUTATING_VERBS: ReadonlySet<string> = new Set([
  'add', 'am', 'apply', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'fetch',
  'gc', 'init', 'merge', 'mv', 'pull', 'push', 'rebase', 'remote', 'reset', 'restore', 'revert',
  'rm', 'stash', 'submodule', 'switch', 'tag', 'worktree',
]);

/** True for a remote that belongs to this organisation, in either protocol. */
export function isOrgRemote(url: string): boolean {
  const trimmed = url.trim().replace(/\.git$/, '');
  return (
    trimmed.startsWith(`https://github.com/${ORG}/`) ||
    trimmed.startsWith(`git@github.com:${ORG}/`) ||
    trimmed.startsWith(`ssh://git@github.com/${ORG}/`)
  );
}

/**
 * The ONE function in cfctl that may modify a checkout.
 *
 * Two gates, and the second is the one that matters:
 *
 *   1. `repo.managed` is re-asserted at runtime. The type is erased when this runs, so a JavaScript
 *      caller, an `as never`, or a `JSON.parse`d registry would all sail past the compiler.
 *   2. The checkout's own `origin` must be a repository of this organisation. This is the gate that
 *      survives a MISCLASSIFICATION — the failure the type cannot see — and it names what it found,
 *      because "refused" without the remote sends the reader to the wrong file.
 */
function gitWrite(repo: ManagedRepo, dir: string, args: readonly string[]): Run {
  if (!repo.managed) {
    throw new Error(`cfctl: refusing to run 'git ${args[0]}' in ${repo.name}: it is not managed`);
  }
  const origin = run('git', ['remote', 'get-url', 'origin'], dir);
  if (origin.ok && !isOrgRemote(origin.out)) {
    throw new Error(
      `cfctl: refusing to run 'git ${args[0]}' in ${dir} — its origin is ${origin.out}, which is ` +
        `not a ${ORG} repository. The registry says ${repo.name} is managed; the checkout says it ` +
        'belongs to somebody else, and the checkout is the one that cannot be edited by mistake.',
    );
  }
  return run('git', args, dir);
}

function hasCommand(command: string): boolean {
  // `which` rather than a shell builtin: passing arguments through a shell is a warned-against
  // injection surface, and this takes a command name that comes from this file.
  return spawnSync('which', [command], { encoding: 'utf8' }).status === 0;
}

// ---------------------------------------------------------------------------------------------
// State of a checkout
// ---------------------------------------------------------------------------------------------

export type CheckoutState = 'absent' | 'clean' | 'dirty' | 'detached' | 'no-upstream' | 'not-a-repo';

export interface Checkout {
  readonly repo: ManagedRepo;
  readonly dir: string;
  readonly state: CheckoutState;
  readonly branch: string;
  readonly head: string;
}

export function inspect(repo: ManagedRepo): Checkout {
  const dir = repoDir(repo);
  const base = { repo, dir, branch: '', head: '' };
  if (!existsSync(dir)) return { ...base, state: 'absent' };
  if (!existsSync(path.join(dir, '.git'))) return { ...base, state: 'not-a-repo' };

  const head = git(dir, ['rev-parse', 'HEAD']);
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const status = git(dir, ['status', '--porcelain']);
  const withHead = { repo, dir, branch, head: head.ok ? head.out.slice(0, 12) : '' };

  if (status.out !== '') return { ...withHead, state: 'dirty' };
  if (branch === 'HEAD') return { ...withHead, state: 'detached' };
  if (!git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).ok) {
    return { ...withHead, state: 'no-upstream' };
  }
  return { ...withHead, state: 'clean' };
}

// ---------------------------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------------------------

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function cmdList(args: Args): number {
  const kind = args.option('kind');
  const phase = args.option('phase');
  let rows = [...REGISTRY];
  if (kind) rows = rows.filter((repo) => repo.kind === kind);
  if (phase) rows = rows.filter((repo) => repo.phase === phase);

  process.stdout.write(
    `${pad('NAME', 18)}${pad('KIND', 10)}${pad('PHASE', 7)}${pad('REPO', 24)}${pad('PATH', 26)}STATE\n`,
  );
  let present = 0;
  for (const repo of rows) {
    const state = repo.managed ? inspect(repo).state : 'unmanaged';
    if (state !== 'absent' && repo.managed) present += 1;
    process.stdout.write(
      `${pad(repo.name, 18)}${pad(repo.kind, 10)}${pad(repo.phase, 7)}${pad(repo.repo, 24)}${pad(repo.path, 26)}${state}\n`,
    );
  }

  const managed = rows.filter((repo) => repo.managed).length;
  process.stdout.write(
    `\n${rows.length} repositories · ${managed} managed by cfctl · ${present} checked out · ` +
      `${rows.length - managed} kept as they are and never touched\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------------------------
// clone / pull
// ---------------------------------------------------------------------------------------------

// `ManagedRepo[]`, sourced from `managedRepos()` and narrowed only by filtering. clone and pull
// both iterate this, so the type they receive is the type that reaches `gitWrite`.
function selected(args: Args): readonly ManagedRepo[] {
  const only = args.option('only');
  const kind = args.option('kind');
  let repos = managedRepos();
  if (kind) repos = repos.filter((repo) => repo.kind === kind);
  if (only) {
    const names = new Set(only.split(','));
    repos = repos.filter((repo) => names.has(repo.name));
  }
  return repos;
}

function cmdClone(args: Args): number {
  const dryRun = args.flag('dry-run');
  const skipped: string[] = [];
  const failed: string[] = [];
  const cloned: string[] = [];
  const updated: string[] = [];

  mkdirSync(microRoot(), { recursive: true });

  for (const repo of selected(args)) {
    const checkout = inspect(repo);
    if (checkout.state === 'absent') {
      if (dryRun) {
        process.stdout.write(`would clone ${repo.repo} -> ${repo.path}\n`);
        continue;
      }
      process.stdout.write(`==> cloning ${repo.repo}\n`);
      // No checkout yet, so there is no origin to interrogate. The URL is built from ORG by
      // `cloneUrl`, which takes a ManagedRepo, so the destination is an organisation repository
      // by construction — and the directory is one `microRoot()` owns.
      const result = run('git', ['clone', '--quiet', cloneUrl(repo), checkout.dir]);
      if (!result.ok) {
        // A repository that does not exist yet is the normal state for a phase that has not
        // started. Say which, rather than printing git's 'Repository not found' nine times.
        process.stdout.write(`    not available yet (${repo.phase}): ${result.err.split('\n')[0] ?? ''}\n`);
        failed.push(repo.name);
        continue;
      }
      cloned.push(repo.name);
      continue;
    }
    if (checkout.state !== 'clean') {
      process.stdout.write(`==> ${repo.name} is ${checkout.state} — leaving it alone\n`);
      skipped.push(repo.name);
      continue;
    }
    if (dryRun) {
      process.stdout.write(`would fast-forward ${repo.name}\n`);
      continue;
    }
    if (!gitWrite(repo, checkout.dir, ['fetch', '--quiet', 'origin']).ok) {
      failed.push(repo.name);
      continue;
    }
    const before = git(checkout.dir, ['rev-parse', 'HEAD']).out;
    if (!gitWrite(repo, checkout.dir, ['merge', '--ff-only', '--quiet', 'FETCH_HEAD']).ok) {
      process.stdout.write(`==> ${repo.name} has diverged from origin — left as is\n`);
      skipped.push(repo.name);
      continue;
    }
    if (git(checkout.dir, ['rev-parse', 'HEAD']).out !== before) updated.push(repo.name);
  }

  summarise({ cloned, updated, skipped, failed });
  return failed.length > 0 ? 1 : 0;
}

function cmdPull(args: Args): number {
  const skipped: string[] = [];
  const failed: string[] = [];
  const updated: string[] = [];
  const missing: string[] = [];

  for (const repo of selected(args)) {
    const checkout = inspect(repo);
    if (checkout.state === 'absent' || checkout.state === 'not-a-repo') {
      missing.push(repo.name);
      continue;
    }
    if (checkout.state !== 'clean') {
      // dirty, detached or no upstream. All three are somebody's work in progress.
      process.stdout.write(`==> ${repo.name} is ${checkout.state} — leaving it alone\n`);
      skipped.push(repo.name);
      continue;
    }
    const before = git(checkout.dir, ['rev-parse', 'HEAD']).out;
    process.stdout.write(`==> pulling ${repo.name} (${checkout.branch})\n`);
    // --ff-only: a diverged branch stops here rather than gaining a merge commit nobody asked for.
    if (!gitWrite(repo, checkout.dir, ['pull', '--ff-only', '--quiet']).ok) {
      process.stdout.write('    (diverged from upstream, or fetch failed — left as is)\n');
      failed.push(repo.name);
      continue;
    }
    const after = git(checkout.dir, ['rev-parse', 'HEAD']).out;
    if (before !== after) {
      const count = git(checkout.dir, ['log', '--oneline', `${before}..${after}`]).out.split('\n').length;
      process.stdout.write(`    ${count} new commit(s)\n`);
      updated.push(repo.name);
    }
  }

  summarise({ cloned: [], updated, skipped, failed, missing });
  return failed.length > 0 ? 1 : 0;
}

function summarise(result: {
  cloned: string[];
  updated: string[];
  skipped: string[];
  failed: string[];
  missing?: string[];
}): void {
  process.stdout.write('\n');
  if (result.cloned.length > 0) process.stdout.write(`cloned: ${result.cloned.join(' ')}\n`);
  if (result.updated.length > 0) process.stdout.write(`updated: ${result.updated.join(' ')}\n`);
  if (result.skipped.length > 0) {
    process.stdout.write(`not touched (local changes, detached, no upstream or diverged): ${result.skipped.join(' ')}\n`);
  }
  if (result.missing && result.missing.length > 0) {
    process.stdout.write(`not checked out — run 'cfctl clone': ${result.missing.length} repositories\n`);
  }
  if (result.failed.length > 0) process.stdout.write(`failed: ${result.failed.join(' ')}\n`);
  if (
    result.cloned.length === 0 &&
    result.updated.length === 0 &&
    result.skipped.length === 0 &&
    result.failed.length === 0
  ) {
    process.stdout.write('already up to date.\n');
  }
}

// ---------------------------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------------------------

export type Severity = 'fail' | 'warn' | 'info';

export interface Diagnosis {
  readonly severity: Severity;
  readonly repo: string;
  readonly message: string;
  readonly fix: string;
}

interface Manifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readManifest(file: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}

function packageManifests(root: string): { file: string; manifest: Manifest }[] {
  const found: { file: string; manifest: Manifest }[] = [];
  const push = (file: string): void => {
    const manifest = readManifest(file);
    if (manifest) found.push({ file, manifest });
  };
  push(path.join(root, 'package.json'));
  for (const group of ['packages', 'services', 'apps']) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const child of readdirSync(dir)) {
      const file = path.join(dir, child, 'package.json');
      if (existsSync(file)) push(file);
    }
  }
  return found;
}

// A deliberately small semver check: enough for '^1.2.3', '~1.2.3', '1.2.3', '*' and
// 'workspace:*'. Anything else is reported as unrecognised rather than guessed at, because a
// range this tool silently misreads is a consumer that silently cannot resolve.
export function satisfies(range: string, version: string): 'yes' | 'no' | 'unknown' {
  if (range.startsWith('workspace:') || range === '*' || range === 'latest') return 'yes';
  const parse = (value: string): [number, number, number] | undefined => {
    const parts = value.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return undefined;
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const have = parse(version);
  if (!have) return 'unknown';
  const operator = range.startsWith('^') ? '^' : range.startsWith('~') ? '~' : '=';
  const want = parse(operator === '=' ? range : range.slice(1));
  if (!want) return 'unknown';
  const [wantMajor, wantMinor, wantPatch] = want;
  const [haveMajor, haveMinor, havePatch] = have;
  const atLeast =
    haveMajor > wantMajor ||
    (haveMajor === wantMajor && (haveMinor > wantMinor || (haveMinor === wantMinor && havePatch >= wantPatch)));
  if (operator === '=') return haveMajor === wantMajor && haveMinor === wantMinor && havePatch === wantPatch ? 'yes' : 'no';
  if (!atLeast) return 'no';
  if (operator === '~') return haveMajor === wantMajor && haveMinor === wantMinor ? 'yes' : 'no';
  // Caret. On 0.x a caret is patch-only, which is exactly the trap AD-02 item 2 exists to close.
  if (wantMajor === 0) return haveMajor === 0 && haveMinor === wantMinor ? 'yes' : 'no';
  return haveMajor === wantMajor ? 'yes' : 'no';
}

// Every @cloudsforge/* package this machine can see, and the version it is at. Built from the
// library checkouts, because that is what a consumer's Renovate bump is chasing.
function localPackageVersions(): Map<string, string> {
  const versions = new Map<string, string>();
  for (const repo of managedRepos()) {
    if (repo.kind !== 'library') continue;
    const dir = repoDir(repo);
    if (!existsSync(dir)) continue;
    for (const { manifest } of packageManifests(dir)) {
      if (manifest.name?.startsWith('@cloudsforge/') && manifest.version && !manifest.name.endsWith('/org')) {
        versions.set(manifest.name, manifest.version);
      }
    }
  }
  return versions;
}

function workflowFiles(root: string): string[] {
  const dir = path.join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => path.join(dir, file));
}

/**
 * What GHCR's token endpoint just said about a package.
 *
 * THE WHOLE ANSWER IS HERE, which is not obvious and cost this check its correctness twice. A
 * registry client that wants to read anonymously asks `/token` first; GHCR replies with a bearer
 * token for a package it will let the public read, and with
 * `{"errors":[{"code":"DENIED", ...}]}` for one it will not — which covers BOTH a private package
 * and a package that has never been published, and those are exactly the two cases the visibility
 * warning exists to raise. Treating a DENIED body as "cannot tell" is how the check went from
 * warning about all 45 deployables to warning about none of them.
 *
 * Pure, and exported, so the three answers can be tested against fixtures. The version of this
 * logic that lived inline was only ever exercised by a live network call, and a check whose only
 * test is the internet is a check that is silently wrong between outages.
 */
export function readGhcrTokenAnswer(body: string): { readonly token?: string; readonly denied: boolean } {
  const token = /"token"\s*:\s*"([^"]+)"/.exec(body)?.[1];
  if (token) return { token, denied: false };
  return { denied: /"code"\s*:\s*"DENIED"/.test(body) || /"errors"\s*:/.test(body) };
}

function ghcrVisibility(repo: Repo): 'public' | 'private-or-absent' | 'unknown' {
  // The 403 trap this check exists for: a new repository's package inherits the repository's
  // visibility, and the deploy path fails at PULL time rather than at publish time.
  //
  // IT ASKED THE QUESTION IN A WAY GHCR CANNOT ANSWER. This was a single bare GET of
  // `/v2/<org>/<repo>/tags/list`, treating 401 as 'private-or-absent' — but GHCR answers 401 to
  // an UNAUTHENTICATED /v2/ request for a PUBLIC package just as readily as for a private one.
  // The registry protocol is challenge-response: the 401 carries a `WWW-Authenticate` header
  // telling the client where to fetch a token, and anonymous callers are expected to go and get
  // one. So this reported 'private or has never been published' for every package in existence,
  // including packages that are public and pulling fine.
  //
  // Measured, not reasoned: `ghcr.io/cloudsforge-online/hearth-node` is published and PUBLIC —
  // micro-hearth has been pushing it since July — and a bare GET of its tags list returns 401,
  // while the same request bearing an anonymously-obtained token returns 200.
  //
  // That mattered more than a cosmetic wrong word. This check is the estate's only automated
  // warning about the visibility trap, and a check that fires on everything is a check nobody
  // reads — so on the day a package really was private it would have said exactly what it had
  // been saying all along about the ones that were fine.
  const pkgPath = `${ORG}/${repo.repo}`;
  const tokenResult = run('curl', [
    '-s',
    '-m',
    '8',
    `https://ghcr.io/token?service=ghcr.io&scope=repository:${pkgPath}:pull`,
  ]);
  if (!tokenResult.ok) return 'unknown';

  const answer = readGhcrTokenAnswer(tokenResult.out);
  if (answer.denied) return 'private-or-absent';
  if (!answer.token) return 'unknown';

  const result = run('curl', [
    '-s',
    '-m',
    '8',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    '-H',
    `Authorization: Bearer ${answer.token}`,
    `https://ghcr.io/v2/${pkgPath}/tags/list`,
  ]);
  if (!result.ok) return 'unknown';
  if (result.out === '200') return 'public';
  if (result.out === '401' || result.out === '403') return 'private-or-absent';
  return 'unknown';
}

// ---------------------------------------------------------------------------------------------
// What a tag resolves to, which is not the same question as whether it exists
// ---------------------------------------------------------------------------------------------
//
// A RELEASE MANIFEST DID NOT NAME A FIXED ARTIFACT (micro-org#288). It named a tag, and a tag is a
// mutable pointer that this estate's own machinery moves:
//
//   * `publish-image.yml` tags at the repository's package.json version on every push to `main` or
//     `release/**`. If a `release/X` branch is never merged, `main` stays on the PREVIOUS version,
//     so the next merge to main republishes the PREVIOUS release's tag from a different commit.
//     Six repositories did exactly this with 2.5.6, measured 2026-08-09:
//     `ghcr.io/cloudsforge-online/micro-network-site:2.5.5` resolves to the image built from
//     `5aa61e4`, a merge that landed after 2.5.5 was cut.
//   * Merging the release branch republishes the tag too, from the MERGE commit rather than the
//     commit the manifest pins. The trees are identical so the content is, but the digest need not
//     be — and the estate pulls by tag.
//
// `--verify` could not see either, because `docker manifest inspect` establishes EXISTENCE and
// existence is all it establishes. So the answer recorded here is the digest, which is the name of
// the bytes rather than a name pointing at them.
//
// THE INDEX DIGEST, not a platform's. `docker manifest inspect --verbose` reports the per-platform
// manifest digest — for `micro-identity:2.5.7` that is `sha256:c63d5278…`, while the digest the tag
// itself resolves to is `sha256:d82f87dc…`. The second is the one `docker pull image@sha256:…`
// takes and the one a deploy would pin, so it is the one recorded. That is why this asks the
// registry over HTTP rather than shelling out to docker: the registry answers the question in a
// header, `Docker-Content-Digest`, and answers it for the reference as a whole.

/** The digest a GHCR tag resolves to right now, or — never silently — why it could not be read. */
export interface DigestAnswer {
  readonly digest?: string;
  readonly reason?: string;
}

/** The `<org>/<package>` path inside a GHCR image reference; undefined for anything else. */
export function ghcrPath(image: string): string | undefined {
  const prefix = 'ghcr.io/';
  if (!image.startsWith(prefix)) return undefined;
  const rest = image.slice(prefix.length);
  return /^[^/:@]+\/[^/:@]+$/.test(rest) ? rest : undefined;
}

// Every media type a GHCR push produces. WITHOUT THIS HEADER the registry is entitled to answer
// with a converted schema-1 manifest, whose digest is a digest of something else — so the Accept
// list is part of the question, not a politeness.
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/**
 * The digest out of a raw HTTP response header block.
 *
 * Pure, and exported, for the reason `readGhcrTokenAnswer` is: a check whose only test is the
 * internet is a check that is silently wrong between outages. Header names are case-insensitive
 * per RFC 9110 and curl reports HTTP/2 headers lower-cased, so the match is too; the line endings
 * are CRLF and are stripped here rather than by the caller.
 *
 * The shape is validated rather than trusted. A truncated or proxied answer that happens to carry
 * the header name must read as "could not tell", because the one thing this must never do is hand
 * back a value that a later run will compare against and find different.
 */
export function readContentDigest(headers: string): string | undefined {
  for (const raw of headers.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const value = /^docker-content-digest:\s*(\S+)$/i.exec(line)?.[1];
    if (value && /^sha256:[0-9a-f]{64}$/.test(value)) return value;
  }
  return undefined;
}

/** Ask GHCR what `<image>:<tag>` resolves to. Anonymous, like `ghcrVisibility` above. */
export function ghcrDigest(image: string, tag: string): DigestAnswer {
  const pkg = ghcrPath(image);
  if (!pkg) return { reason: `${image} is not a ghcr.io image, and this only knows how to ask GHCR` };
  if (!hasCommand('curl')) return { reason: 'curl is not available' };

  // The same challenge-response dance ghcrVisibility documents: an anonymous reader fetches a
  // bearer token first, and a DENIED body is an ANSWER — private, or never published.
  const tokenResult = run('curl', [
    '-s',
    '-m',
    '8',
    `https://ghcr.io/token?service=ghcr.io&scope=repository:${pkg}:pull`,
  ]);
  if (!tokenResult.ok) return { reason: 'GHCR did not answer the token request' };
  const answer = readGhcrTokenAnswer(tokenResult.out);
  if (answer.denied) {
    return { reason: 'GHCR denied an anonymous pull token — the package is private, or was never published' };
  }
  if (!answer.token) return { reason: 'GHCR returned neither a token nor a denial' };

  const head = run('curl', [
    '-sI',
    '-m',
    '15',
    '-H',
    `Authorization: Bearer ${answer.token}`,
    '-H',
    `Accept: ${MANIFEST_ACCEPT}`,
    `https://ghcr.io/v2/${pkg}/manifests/${tag}`,
  ]);
  if (!head.ok) return { reason: 'GHCR did not answer the manifest request' };
  const digest = readContentDigest(head.out);
  if (!digest) return { reason: `GHCR served no digest for :${tag} — the tag does not exist, or it would not serve it` };
  return { digest };
}

/**
 * The four things `--verify` can conclude about one entry, and none of them is a boolean.
 *
 *   `verified`   the tag still resolves to the digest the manifest recorded. The only state in
 *                which this manifest is known to name the artifact it named when it was cut.
 *   `moved`      it resolves to something else. This is micro-org#288 happening, and it is the
 *                whole reason the field exists — LOUD, and a failure.
 *   `unrecorded` the manifest carries no digest for this entry. Every manifest cut before
 *                2026-08-09 is in this state, and rollback is checking out the previous file, so
 *                this must stay READABLE and must not fail. It is reported as unverifiable, which
 *                is what it is: the image exists and nothing here can say it is the right one.
 *   `unreadable` a digest was recorded and GHCR would not answer. Verification that cannot run is
 *                not verification, so this is a failure rather than a shrug.
 */
export type DigestVerdict = 'verified' | 'moved' | 'unrecorded' | 'unreadable';

export function digestVerdict(recorded: string, answer: DigestAnswer): DigestVerdict {
  if (recorded === '') return 'unrecorded';
  if (!answer.digest) return 'unreadable';
  return answer.digest === recorded ? 'verified' : 'moved';
}

/**
 * Directories sitting beside this checkout that the registry does not name.
 *
 * THE CRUCIBLE BUG, made findable. `registry.ts`'s first paragraph is about `clone-all.sh` and
 * `pull-all.sh` carrying two copies of the repository list: `crucible` was in one and not the
 * other, so the documented update path fast-forwarded eight repositories and left the ninth
 * silently pinned. One list fixed the drift BETWEEN the two scripts and did nothing about the
 * failure they shared — that a repository can exist and be in no list at all. It happened again
 * and larger: this registry held 46 rows against a tree of 61 directories, and the seventeen it
 * could not see included `micro-emberkin`, one of the three repositories the ledger account-type
 * defect was actually found in. `estate-ci.yml` derives its repository list from the GitHub API
 * for exactly that reason, and says so.
 *
 * A pure function over a directory rather than a hard-coded read of `microRoot()`, so it can be
 * tested against a fixture. A test that could only run where the whole estate is checked out
 * would pass vacuously in this repository's own CI, where the only sibling is this one — and a
 * check that passes vacuously in the place it runs is the thing this estate keeps rediscovering.
 */
export function unregisteredSiblings(root: string, known: Iterable<string>): string[] {
  if (!existsSync(root)) return [];
  const named = new Set(known);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => !named.has(name))
    .sort();
}

export function diagnose(options: { online: boolean }): Diagnosis[] {
  const findings: Diagnosis[] = [];
  const versions = localPackageVersions();
  let absent = 0;

  for (const repo of managedRepos()) {
    const checkout = inspect(repo);
    if (checkout.state === 'absent') {
      absent += 1;
      continue;
    }
    const name = repo.name;

    // 1. Git state. A directory that is not yet a repository is the normal state of a repository
    // being written before anybody pushes it, so it is a warning rather than a failure — but it
    // is reported, because until it is a checkout, cfctl pull cannot move it and cfctl release
    // cannot record the commit an image was built from.
    if (checkout.state === 'not-a-repo') {
      findings.push({
        severity: 'warn',
        repo: name,
        message: `${repo.path} is a directory, not a git checkout`,
        fix: `git -C ${repo.path} init && git -C ${repo.path} remote add origin ${cloneUrl(repo)}`,
      });
    } else {
      // No upstream. The failure this causes is silent: a pull that fast-forwards nothing and
      // says nothing, which is how a checkout ends up months behind while looking fine.
      if (checkout.state === 'no-upstream') {
        findings.push({
          severity: 'warn',
          repo: name,
          message: `'${checkout.branch}' tracks nothing, so pull can never move it`,
          fix: `git -C ${repo.path} push -u origin ${checkout.branch}`,
        });
      }
      if (!run('git', ['remote', 'get-url', 'origin'], checkout.dir).ok) {
        findings.push({
          severity: 'warn',
          repo: name,
          message: 'no origin remote',
          fix: `git -C ${repo.path} remote add origin ${cloneUrl(repo)}`,
        });
      }
    }

    // 2. CI: the reusable workflow, and any bespoke file. This is the measured mitigation in
    // 03 §5 — the target is zero bespoke CI files, so the count has to be observable.
    if (repo.kind === 'service' || repo.kind === 'web' || repo.kind === 'ops' || repo.kind === 'library') {
      const workflows = workflowFiles(checkout.dir);
      const wanted =
        repo.kind === 'web'
          ? 'web-ci.yml'
          : repo.kind === 'library'
            ? 'service-ci.yml (plus publish.yml and contract-compat.yml)'
            : 'service-ci.yml';
      const bodies = workflows.map((file) => ({ file, body: readFileSync(file, 'utf8') }));
      const callsReusable = bodies.some(({ body }) => body.includes(`${ORG}/micro-org/.github/workflows/`));
      if (workflows.length === 0) {
        findings.push({
          severity: 'warn',
          repo: name,
          message: 'no CI at all',
          fix: `add .github/workflows/ci.yml calling ${ORG}/micro-org/.github/workflows/${wanted}`,
        });
      } else if (!callsReusable) {
        findings.push({
          severity: 'warn',
          repo: name,
          message: `CI does not call the reusable ${wanted}`,
          fix: `replace the jobs with: uses: ${ORG}/micro-org/.github/workflows/${wanted}@main`,
        });
      }
      for (const { file, body } of bodies) {
        // A workflow that declares its own runner is doing the work service-ci.yml is meant to
        // do once for everybody. That is how eleven near-identical files drifted.
        if (body.includes('runs-on:') && !body.includes(`${ORG}/micro-org/.github/workflows/`)) {
          findings.push({
            severity: 'fail',
            repo: name,
            message: `bespoke CI file: ${path.relative(checkout.dir, file)} defines its own jobs`,
            fix: `call the reusable workflow instead; open an issue on micro-org if it cannot express what this needs`,
          });
        }
      }
    }

    // 3. Contract packages a consumer cannot resolve. Two separate failures: a caret range on a
    // 0.x version resolves patches only (AD-02 item 2, and the reason no consumer can resolve
    // the contract version today), and a range no available version satisfies.
    for (const { file, manifest } of packageManifests(checkout.dir)) {
      const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
      for (const [dependency, range] of Object.entries(deps)) {
        if (!dependency.startsWith('@cloudsforge/')) continue;
        const where = path.relative(checkout.dir, file);
        if (!ALLOWED_SCOPED_PACKAGES.includes(dependency)) {
          findings.push({
            severity: 'fail',
            repo: name,
            message: `${where} depends on ${dependency}, which is not a published contract or runtime package`,
            fix: 'a cross-service import wearing a package name is still a cross-service import (rule 2)',
          });
          continue;
        }
        // A file: or link: range resolves through the filesystem, which works in a monorepo and
        // cannot survive the split: the moment this directory is its own repository, cloned on
        // its own, the path it points at is not there. It also means Renovate has nothing to
        // bump, so the package silently never moves.
        if (range.startsWith('file:') || range.startsWith('link:') || range.startsWith('portal:')) {
          findings.push({
            severity: 'warn',
            repo: name,
            message: `${where} resolves ${dependency} through the filesystem ('${range}')`,
            fix: 'a path link cannot survive one repository per deployable — publish it and use ^1',
          });
          continue;
        }
        if (range.startsWith('^0.')) {
          findings.push({
            severity: 'fail',
            repo: name,
            message: `${where} pins ${dependency} at '${range}' — a caret on 0.x is patch-only`,
            fix: 'publish the package at 1.0.0 and use ^1 (AD-02 item 2)',
          });
          continue;
        }
        const available = versions.get(dependency);
        if (!available) continue;
        const verdict = satisfies(range, available);
        if (verdict === 'no') {
          findings.push({
            severity: 'fail',
            repo: name,
            message: `${where} wants ${dependency}@${range}; the published version is ${available}`,
            fix: 'widen the range, or publish a version that satisfies it',
          });
        } else if (verdict === 'unknown') {
          findings.push({
            severity: 'warn',
            repo: name,
            message: `${where} pins ${dependency} at '${range}', which cfctl cannot evaluate`,
            fix: 'use ^1.2.3, ~1.2.3, 1.2.3 or workspace:*',
          });
        }
      }
    }

    // 4. The GHCR 403 trap. A new repository's package inherits the repository's visibility, so
    // the very first deploy after a split 403s on pull with a token that published it fine.
    if (repo.deployable) {
      if (!options.online) {
        findings.push({
          severity: 'info',
          repo: name,
          message: 'GHCR package visibility not checked (offline)',
          fix: "run 'cfctl doctor --online'",
        });
      } else if (ghcrVisibility(repo) === 'private-or-absent') {
        findings.push({
          severity: 'warn',
          repo: name,
          message: `${imageFor(repo)} is private or has never been published`,
          fix: 'GitHub → Packages → this package → Package settings → Change visibility → Public',
        });
      }
    }
  }

  if (absent > 0) {
    findings.push({
      severity: 'info',
      repo: '—',
      message: `${absent} of ${managedRepos().length} managed repositories are not checked out`,
      fix: "expected while their phase has not started; 'cfctl list' shows which",
    });
  }

  // 5. A repository on this disk that the registry does not name. `fail`, not `warn`, on doctor's
  // own dividing line: a warning is a repository that has not caught up with the machinery, and
  // this is a rule already broken — the registry is meant to BE the list, and a directory missing
  // from it is skipped by list, clone, pull, doctor and release at once, silently and in that
  // order. That is what happened to `crucible`, and then to seventeen repositories at once.
  for (const name of unregisteredSiblings(microRoot(), REGISTRY.map((repo) => repo.name))) {
    findings.push({
      severity: 'fail',
      repo: name,
      message: `${name}/ is checked out beside the estate and is in no registry row`,
      fix:
        'add it to tools/registry.ts — as a managed kind if this programme owns it, or with ' +
        'kept() if it must never be written to. An omission that is written down is a decision.',
    });
  }
  return findings;
}

function cmdDoctor(args: Args): number {
  const findings = diagnose({ online: args.flag('online') });
  const order: Severity[] = ['fail', 'warn', 'info'];
  for (const severity of order) {
    for (const finding of findings.filter((item) => item.severity === severity)) {
      const marker = severity === 'fail' ? 'FAIL' : severity === 'warn' ? 'warn' : 'info';
      process.stdout.write(`${pad(marker, 6)}${pad(finding.repo, 18)}${finding.message}\n`);
      process.stdout.write(`${' '.repeat(24)}↳ ${finding.fix}\n`);
    }
  }

  const fails = findings.filter((item) => item.severity === 'fail').length;
  const warns = findings.filter((item) => item.severity === 'warn').length;
  process.stdout.write(`\n${fails} failure(s), ${warns} warning(s)\n`);

  // A warning is a repository that has not caught up with the machinery yet, which is the normal
  // state of a phase in progress. A failure is a rule already broken. CI runs --strict, so a
  // warning is a thing somebody sees rather than a thing that blocks a merge.
  if (fails > 0) return 1;
  if (warns > 0 && args.flag('strict')) return 1;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------------------------

export interface ManifestService {
  readonly name: string;
  readonly repo: string;
  readonly kind: string;
  readonly image: string;
  readonly tag: string;
  readonly commit: string;
  /**
   * The GHCR digest the tag resolved to when this release was cut, or '' when it is not known.
   *
   * REQUIRED IN THE TYPE, EMPTY-ABLE IN THE FILE, and the distinction is the whole design. Every
   * manifest generated before 2026-08-09 — 2.3.0, 2.4.0, 2.5.2 through 2.5.7 and the ten 2026.08.*
   * files — has no `digest:` line, and they must go on parsing: rollback is checking out the
   * previous file, so a parser that rejects them takes the estate's rollback path away. They read
   * back as '' and `--verify` reports them as unverifiable rather than as verified or as broken.
   *
   * Optional in the type would have been the wrong shape. The defect this fixes is a field nobody
   * recorded; making it a field a caller may forget rebuilds it one construction site at a time.
   */
  readonly digest: string;
}

export interface ReleaseManifest {
  readonly version: string;
  readonly generated: string;
  readonly services: readonly ManifestService[];
  readonly absent: readonly string[];
}

export function renderManifest(manifest: ReleaseManifest): string {
  const lines: string[] = [
    '# CloudsForge release manifest. Generated by `cfctl release` — do not hand-edit.',
    '#',
    '# This file replaces CLOUDSFORGE_TAG. With one repository per service there is no shared',
    '# version to name, so a release is the list below: exactly which image of each service is in',
    '# it. Rollback is checking out the previous file. See releases/README.md.',
    '#',
    '# `digest` is the artifact. `tag` is a name that pointed at it, and a name this estate moves —',
    '# see micro-org#288. Verify with `cfctl release --verify`; an entry with no digest predates',
    '# 2026-08-09 or was cut before its image published, and cannot be verified at all.',
    `version: "${manifest.version}"`,
    `generated: "${manifest.generated}"`,
    'generator: cfctl release',
    'services:',
  ];
  for (const service of manifest.services) {
    lines.push(`  - name: ${service.name}`);
    lines.push(`    repo: ${service.repo}`);
    lines.push(`    kind: ${service.kind}`);
    lines.push(`    image: ${service.image}`);
    lines.push(`    tag: "${service.tag}"`);
    lines.push(`    commit: "${service.commit}"`);
    // Omitted rather than emitted empty. `digest: ""` in a file would read as a claim that the
    // image has no digest; the absence of the line is the same thing every manifest before this
    // one said, and it is what the parser turns back into ''. It is also what keeps this ADDITIVE
    // for micro-deploy's `scripts/release-render.py`, which mirrors the parser below and pins
    // `image:tag`: a key it does not know about lands in its dict and is never read.
    if (service.digest !== '') lines.push(`    digest: "${service.digest}"`);
  }
  lines.push('# Deployables with no checkout on the machine that generated this. Listed rather than');
  lines.push('# omitted: a manifest with a silent hole is how a service gets left on an old image.');
  lines.push('absent:');
  for (const name of manifest.absent) lines.push(`  - ${name}`);
  return `${lines.join('\n')}\n`;
}

// A parser for exactly the shape renderManifest emits, and nothing else. A general YAML parser
// would be a dependency this repository does not otherwise need, and a manifest that is not
// exactly this shape was not generated by cfctl and should not be deployed.
export function parseManifest(text: string): ReleaseManifest {
  const unquote = (value: string): string => value.replace(/^"(.*)"$/, '$1');
  let version = '';
  let generated = '';
  const services: ManifestService[] = [];
  const absent: string[] = [];
  let section: 'none' | 'services' | 'absent' = 'none';
  let current: Record<string, string> | undefined;

  const flush = (): void => {
    if (!current) return;
    services.push({
      name: current['name'] ?? '',
      repo: current['repo'] ?? '',
      kind: current['kind'] ?? '',
      image: current['image'] ?? '',
      tag: current['tag'] ?? '',
      commit: current['commit'] ?? '',
      // '' for the eight-plus manifests written before digests existed. A missing digest is a
      // manifest that cannot be verified, which --verify says out loud; it is not a parse error,
      // because rollback is checking out the previous file and those files are the rollback.
      digest: current['digest'] ?? '',
    });
    current = undefined;
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line === '' || line.trimStart().startsWith('#')) continue;
    if (line.startsWith('version:')) {
      version = unquote(line.slice('version:'.length).trim());
      continue;
    }
    if (line.startsWith('generated:')) {
      generated = unquote(line.slice('generated:'.length).trim());
      continue;
    }
    if (line === 'services:') {
      flush();
      section = 'services';
      continue;
    }
    if (line === 'absent:') {
      flush();
      section = 'absent';
      continue;
    }
    if (section === 'absent' && line.startsWith('  - ')) {
      absent.push(line.slice(4).trim());
      continue;
    }
    if (section === 'services') {
      if (line.startsWith('  - ')) {
        flush();
        current = {};
      }
      const body = line.replace(/^ {2}(- )?/, '').replace(/^ {2}/, '');
      const colon = body.indexOf(':');
      if (colon > 0 && current) current[body.slice(0, colon).trim()] = unquote(body.slice(colon + 1).trim());
    }
  }
  flush();
  return { version, generated, services, absent };
}

function releasesDir(): string {
  return path.join(ORG_ROOT, 'releases');
}

function cmdRelease(args: Args): number {
  const version = args.option('verify') ?? args.positional[1];
  if (!version) {
    process.stderr.write('usage: cfctl release <version> | cfctl release --verify <version>\n');
    return 2;
  }
  const file = path.join(releasesDir(), `${version}.yaml`);
  if (args.has('verify')) return verifyRelease(file);

  if (existsSync(file) && !args.flag('force')) {
    process.stderr.write(
      `cfctl: ${path.relative(process.cwd(), file)} already exists.\n` +
        'A manifest is the record of what was deployed; regenerating one changes history. Use --force if that is what you mean.\n',
    );
    return 1;
  }

  const services: ManifestService[] = [];
  const absent: string[] = [];
  const unresolved: string[] = [];
  process.stdout.write(`asking GHCR what each tag resolves to (up to ${deployableRepos().length} lookups)\n`);
  for (const repo of deployableRepos()) {
    const checkout = inspect(repo);
    if (checkout.state === 'absent' || checkout.state === 'not-a-repo') {
      absent.push(repo.name);
      continue;
    }
    if (checkout.state === 'dirty') {
      process.stderr.write(
        `::error::${repo.name} has uncommitted changes. An image tag cannot name a working tree — ` +
          'commit or stash before cutting a release.\n',
      );
      return 1;
    }
    const manifest = readManifest(path.join(checkout.dir, 'package.json'));
    const tag = manifest?.version ?? version;
    const image = imageFor(repo);

    // Resolved HERE, at cut time, rather than left to --verify to discover later. The digest is
    // evidence of what the tag meant on the day the release was cut, and evidence gathered after
    // the fact is not evidence: asking a week later would record whatever the tag had drifted to
    // and call it the release.
    const answer = ghcrDigest(image, tag);
    if (!answer.digest) unresolved.push(`${repo.name}: ${answer.reason ?? 'no digest'}`);

    services.push({
      name: repo.name,
      repo: repo.repo,
      kind: repo.kind,
      image,
      tag,
      commit: git(checkout.dir, ['rev-parse', 'HEAD']).out,
      digest: answer.digest ?? '',
    });
  }

  if (services.length === 0) {
    process.stderr.write(
      `cfctl: nothing to release — none of the ${deployableRepos().length} deployables is checked out.\n` +
        'A manifest that names no image is not a release, and writing one would put a file in\n' +
        'releases/ that a deploy could read and act on.\n',
    );
    return 1;
  }

  mkdirSync(releasesDir(), { recursive: true });
  const rendered = renderManifest({
    version,
    generated: new Date().toISOString(),
    services,
    absent,
  });
  writeFileSync(file, rendered);
  const withDigest = services.filter((service) => service.digest !== '').length;
  process.stdout.write(`wrote ${path.relative(process.cwd(), file)}: ${services.length} services pinned`);
  process.stdout.write(absent.length > 0 ? `, ${absent.length} absent\n` : '\n');
  process.stdout.write(`${withDigest} of ${services.length} entries name an image digest\n`);

  // NOT a failure, and the reasoning is worth having in one place. An image publishes from the
  // push, so a manifest cut in the minutes before its builds finish has tags that resolve to
  // nothing yet — refusing would make the tool unusable in exactly the window it is used in. What
  // it must not do is stay quiet: a tag-only entry is the state this whole change exists to end.
  if (unresolved.length > 0) {
    process.stdout.write(
      `\n::warning::${unresolved.length} of ${services.length} entries have NO digest and are pinned by tag alone:\n`,
    );
    for (const line of unresolved) process.stdout.write(`  ${line}\n`);
    process.stdout.write(
      'A tag is a name that this estate moves (micro-org#288), so these entries do not name a fixed\n' +
        `artifact. Once their images have published, re-run:  cfctl release ${version} --force\n`,
    );
  }
  process.stdout.write(`\nverify it before deploying:  cfctl release --verify ${version}\n`);
  return 0;
}

function verifyRelease(file: string): number {
  if (!existsSync(file)) {
    process.stderr.write(`cfctl: no manifest at ${path.relative(process.cwd(), file)}\n`);
    return 1;
  }
  const manifest = parseManifest(readFileSync(file, 'utf8'));
  if (manifest.services.length === 0) {
    process.stderr.write(
      `cfctl: ${path.relative(process.cwd(), file)} names no images. 'all 0 images exist' is a true\n` +
        'sentence and a useless one — refusing to report an empty manifest as verified.\n',
    );
    return 1;
  }
  if (!hasCommand('docker')) {
    process.stderr.write(
      'cfctl: docker is not available, so no image can be checked. Verification that cannot run is\n' +
        'not verification — refusing to report a manifest as verified.\n',
    );
    return 1;
  }
  const recorded = manifest.services.filter((service) => service.digest !== '').length;
  if (recorded > 0 && !hasCommand('curl')) {
    process.stderr.write(
      'cfctl: curl is not available, so no recorded digest can be checked against GHCR. This\n' +
        'manifest records digests and the point of recording them is that they are compared —\n' +
        'refusing to report it as verified on the strength of the images merely existing.\n',
    );
    return 1;
  }

  let missing = 0;
  let moved = 0;
  let unreadable = 0;
  let unrecorded = 0;
  for (const service of manifest.services) {
    const reference = `${service.image}:${service.tag}`;
    const result = run('docker', ['manifest', 'inspect', reference]);
    if (!result.ok) {
      missing += 1;
      // A 'denied' here is the GHCR visibility trap, not an absent image. Say both.
      process.stdout.write(`::error::${reference} — ${result.err.split('\n')[0] ?? 'not found'}\n`);
      continue;
    }

    // No lookup at all when nothing was recorded: there is nothing to compare against, and a
    // manifest from before this field existed should not pay 48 network round trips to be told so.
    const answer: DigestAnswer = service.digest === '' ? {} : ghcrDigest(service.image, service.tag);
    switch (digestVerdict(service.digest, answer)) {
      case 'verified':
        process.stdout.write(`ok: ${reference} @ ${service.digest}\n`);
        break;
      case 'moved':
        moved += 1;
        // The loudest line this programme emits, because it is the only one that means the file
        // in front of you is lying about what it deploys.
        process.stdout.write(
          `::error::${reference} — THE TAG HAS MOVED. This manifest records ${service.digest}; GHCR ` +
            `now serves ${answer.digest}. Deploying this file would run an image it did not pin.\n`,
        );
        break;
      case 'unreadable':
        unreadable += 1;
        process.stdout.write(
          `::error::${reference} — records a digest that could not be checked: ${answer.reason ?? 'no answer'}\n`,
        );
        break;
      case 'unrecorded':
        unrecorded += 1;
        process.stdout.write(`unverifiable: ${reference} exists, and this manifest records no digest for it\n`);
        break;
    }
  }
  if (manifest.absent.length > 0) {
    process.stdout.write(`note: ${manifest.absent.length} deployable(s) are not in this release: ${manifest.absent.join(' ')}\n`);
  }
  if (missing > 0) {
    process.stdout.write(`\n${missing} of ${manifest.services.length} images cannot be pulled. Do not deploy this manifest.\n`);
  }
  if (moved > 0) {
    process.stdout.write(
      `\n${moved} of ${manifest.services.length} tags no longer resolve to the image this release pinned.\n` +
        'This is micro-org#288: an image tag is republished by any later push that carries the same\n' +
        'package.json version, so the bytes a manifest was verified against are not the bytes the\n' +
        'tag names today. DO NOT DEPLOY THIS MANIFEST — deploy the digest, or rebuild the release.\n',
    );
  }
  if (unreadable > 0) {
    process.stdout.write(
      `\n${unreadable} of ${manifest.services.length} entries record a digest that GHCR would not confirm.\n` +
        'Verification that cannot run is not verification.\n',
    );
  }
  if (missing > 0 || moved > 0 || unreadable > 0) return 1;

  // Not a failure — every manifest up to and including 2.5.7 is in this state, and they are the
  // rollback targets. But "all N images exist" was the sentence that let #288 stay invisible for
  // six repositories, so a manifest that cannot be checked no longer gets to print it unqualified.
  process.stdout.write(`\nall ${manifest.services.length} images exist\n`);
  if (unrecorded === 0) {
    process.stdout.write(`all ${manifest.services.length} still resolve to the digest this release recorded\n`);
    return 0;
  }
  process.stdout.write(
    `${manifest.services.length - unrecorded} verified by digest; ${unrecorded} record no digest and CANNOT BE VERIFIED.\n` +
      'Their images exist, and nothing here can tell you whether they are the images that were\n' +
      'released: a tag is republished by any later push carrying the same package.json version\n' +
      '(micro-org#288). Manifests cut from 2026-08-09 record digests and do not have this hole.\n',
  );
  return 0;
}

// ---------------------------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------------------------

// Ports are assigned from the registry position rather than chosen, because 'pick a free port'
// is how the estate ended up with eighteen fixed host ports and a compose file where
// deploy.replicas is illegal. Under the gateway these are container ports only.
export function portFor(name: string): number {
  const index = deployableRepos().findIndex((repo) => repo.name === name);
  return 4100 + (index === -1 ? deployableRepos().length : index);
}

function instantiate(templateDir: string, targetDir: string, replacements: Record<string, string>): number {
  let count = 0;
  const walkDir = (dir: string): void => {
    for (const child of readdirSync(dir)) {
      const source = path.join(dir, child);
      if (statSync(source).isDirectory()) {
        walkDir(source);
        continue;
      }
      const relative = path.relative(templateDir, source);
      const destination = path.join(targetDir, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      let body = readFileSync(source, 'utf8');
      for (const [token, value] of Object.entries(replacements)) {
        body = body.split(token).join(value);
      }
      writeFileSync(destination, body);
      count += 1;
    }
  };
  walkDir(templateDir);
  // Shipped as dotfiles-with-a-prefix so that npm, pnpm and git do not treat the template as a
  // real package or a real repository while it sits in this repository.
  for (const [from, to] of [
    ['_gitignore', '.gitignore'],
    ['_dockerignore', '.dockerignore'],
  ] as const) {
    const source = path.join(targetDir, from);
    if (existsSync(source)) renameSync(source, path.join(targetDir, to));
  }
  const workflows = path.join(targetDir, '_github');
  if (existsSync(workflows)) renameSync(workflows, path.join(targetDir, '.github'));
  return count;
}

function cmdNew(args: Args): number {
  const kind = args.positional[1];
  const name = args.positional[2];
  if ((kind !== 'service' && kind !== 'web') || !name) {
    process.stderr.write('usage: cfctl new service <name> | cfctl new web <name>\n');
    return 2;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    process.stderr.write(`cfctl: '${name}' is not a repository name. Lower case, digits and hyphens.\n`);
    return 2;
  }
  const target = path.join(microRoot(), name);
  if (existsSync(target)) {
    process.stderr.write(`cfctl: ${path.relative(process.cwd(), target)} already exists\n`);
    return 1;
  }
  const templateDir = path.join(ORG_ROOT, 'templates', kind);
  if (!existsSync(templateDir)) {
    process.stderr.write(`cfctl: no template at ${templateDir}\n`);
    return 1;
  }

  const upper = name.toUpperCase().replace(/-/g, '_');
  const files = instantiate(templateDir, target, {
    __NAME__: name,
    __REPO__: `micro-${name}`,
    __ORG__: ORG,
    __UPPER__: upper,
    // Prometheus metric names are lower snake case by convention, and a metric named
    // HUB-API_requests_total is not a valid metric name at all.
    __METRIC__: name.replace(/-/g, '_'),
    __DB_ENV__: `${upper}_DATABASE_URL`,
    __PORT__: String(portFor(name)),
  });

  process.stdout.write(`created ${path.relative(process.cwd(), target)} — ${files} files\n`);
  const known = REGISTRY.some((repo) => repo.name === name);
  if (!known) {
    process.stdout.write(
      `\nnote: '${name}' is not in tools/registry.ts. Add it there, or cfctl list, clone, doctor and\n` +
        'release will all silently skip it — which is the bug pull-all.sh had with crucible.\n',
    );
  }
  process.stdout.write(
    '\nnext:\n' +
      `  cd ${path.relative(process.cwd(), target)}\n` +
      '  pnpm install && pnpm check\n' +
      `  gh repo create ${ORG}/micro-${name} --private --source . --push\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Argument parsing and dispatch
// ---------------------------------------------------------------------------------------------

class Args {
  readonly positional: readonly string[];
  private readonly options: ReadonlyMap<string, string>;

  constructor(argv: readonly string[]) {
    const positional: string[] = [];
    const options = new Map<string, string>();
    for (let i = 0; i < argv.length; i += 1) {
      const token = argv[i];
      if (token === undefined) continue;
      if (!token.startsWith('--')) {
        positional.push(token);
        continue;
      }
      const body = token.slice(2);
      const equals = body.indexOf('=');
      if (equals > 0) {
        options.set(body.slice(0, equals), body.slice(equals + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options.set(body, next);
        i += 1;
      } else {
        options.set(body, 'true');
      }
    }
    this.positional = positional;
    this.options = options;
  }

  has(name: string): boolean {
    return this.options.has(name);
  }

  option(name: string): string | undefined {
    const value = this.options.get(name);
    return value === 'true' ? undefined : value;
  }

  flag(name: string): boolean {
    return this.options.has(name);
  }
}

const USAGE = `cfctl — CloudsForge organisation machinery (AD-03)

  cfctl list [--kind <kind>] [--phase <phase>]
  cfctl clone [--only a,b] [--kind <kind>] [--dry-run]
  cfctl pull  [--only a,b] [--kind <kind>]
  cfctl doctor [--online] [--strict]
  cfctl release <version> [--force]
  cfctl release --verify <version>
  cfctl new service <name>
  cfctl new web <name>

Never touches anything under repos/. See micro/org/README.md.
`;

export function main(argv: readonly string[]): number {
  const args = new Args(argv);
  switch (args.positional[0]) {
    case 'list':
      return cmdList(args);
    case 'clone':
      return cmdClone(args);
    case 'pull':
      return cmdPull(args);
    case 'doctor':
      return cmdDoctor(args);
    case 'release':
      return cmdRelease(args);
    case 'new':
      return cmdNew(args);
    default:
      process.stdout.write(USAGE);
      return args.positional.length === 0 ? 0 : 2;
  }
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('cfctl.ts');
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
