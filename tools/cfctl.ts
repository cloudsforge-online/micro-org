// cfctl — the CLI that replaces scripts/clone-all.sh and scripts/pull-all.sh (AD-03).
//
//   cfctl list                     the repository registry, and what is actually on disk
//   cfctl clone                    clone or fast-forward every micro-* repository
//   cfctl pull                     fast-forward the checkouts that already exist
//   cfctl doctor                   the checks for the things that actually break
//   cfctl cross [--repo <name>]    run the checks that read a sibling repository — 'who breaks
//                                  if I merge here', asked before the merge instead of after
//   cfctl cross --json             the same edges as data, for the workflow that runs the sweep
//                                  when an upstream merges (.github/workflows/cross-repo.yml)
//   cfctl bump <version>           move every deployable to one version, on main, tagged release/<v>
//   cfctl release <version>        generate releases/<version>.yaml, one image per service
//   cfctl release --verify <v>     check every image exists and is still the image that was pinned
//   cfctl clients [--verify]       what is in front of users for the three wallet clients — the
//                                  question a release manifest asks of 48 images, asked of the
//                                  three builds it cannot name (micro-org#352)
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
import { blankComments } from '../.github/actions/source-scan/source-scan.mjs';
import {
  ALLOWED_SCOPED_PACKAGES,
  ORG,
  REGISTRY,
  absorbedRepos,
  clientRepos,
  deployableRepos,
  imageFor,
  managedRepos,
  releasableRepos,
  type ClientRepo,
  type Distribution,
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

function run(command: string, args: readonly string[], cwd?: string, env?: NodeJS.ProcessEnv): Run {
  const result = spawnSync(command, [...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
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
//     That is micro-org#422, and `cfctl bump` no longer creates the branch that caused it — the
//     version bump lands on `main` and the release is named by a TAG. `release/**` stays in
//     publish-image's trigger because the branches that already exist must keep working.
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
    //
    // ASKED OF ROWS THAT STILL PUBLISH ONE, and an absorbed row does not. The visibility question
    // is "can a deploy host pull this image", and for these four nothing pulls it and nothing
    // pushes it any more — so the check has no true answer to give: `--online` would report
    // whatever the abandoned package happens to be today, and would start reporting
    // 'private or has never been published' for all four the day the packages are cleaned up. A
    // warning that becomes permanently true is a warning nobody reads, which is the failure the
    // five wallet-client FAILs cost this registry once already (see registry.ts's header).
    //
    // So it is replaced rather than deleted. Deleting it would leave `cfctl doctor` saying nothing
    // at all about four managed repositories that look, from every other check, exactly like the
    // forty-eight that ship — and "an omission that is written down is a decision, and one that is
    // not is the crucible bug". `info`, not `warn`: nothing here is wrong.
    if (repo.absorbedInto !== undefined) {
      findings.push({
        severity: 'info',
        repo: name,
        message: `absorbed into ${repo.absorbedInto} — not bumped, not built, not in a release manifest`,
        fix: `its code runs in the ${repo.absorbedInto} pod; the row stays in tools/registry.ts because deleting it would move every derived port beneath it`,
      });
    } else if (repo.deployable) {
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
// cross — the checks that read a sibling repository, run when you ask
// ---------------------------------------------------------------------------------------------
//
// This estate has a family of tests that open a sibling checkout, read its source and assert the
// two repositories agree. They are good checks and they are deliberately written to FAIL rather
// than skip when the sibling is absent. Nothing runs them when the sibling MOVES.
//
// Measured 2026-08-09 (micro-org#304): three repositories went red on `main` without anyone
// touching them, each within about an hour of the upstream merge that caused it, and none of the
// three was noticed by that merge. Two were discovered by a release PR whose entire content is a
// version-string bump — so the release cut is currently acting as the estate's cross-repository
// integration test, which is the worst available place to catch this: the failure arrives
// attached to the one diff guaranteed to be innocent, at the moment most work is blocked behind
// it.
//
// WHY A COMMAND AND NOT A `doctor` CHECK. Doctor is static, offline and finishes in seconds, and
// things that finish in seconds get run. Executing a dozen test suites is not that, and folding
// it in would make the fast check slow enough to stop being run at all. Doctor answers "is this
// estate wired up"; this answers "does it still agree with itself".
//
// WHY THE EDGES ARE DERIVED AND NOT WRITTEN DOWN. The tempting fix for #304 is a matrix listing
// upstream → downstream. Measured 2026-08-09: four files in the estate carry an explicit
// `repo: 'micro-*'` table, 71 test files mention a sibling checkout and 30 read one. A matrix
// built from the four would cover a twentieth of the real surface WHILE LOOKING COMPLETE, which
// is the same failure as the release cut — a green tick that means nothing was asked. So the
// edges are read back out of the files, every run, and a file that mentions a sibling without
// binding an estate root is reported as `unclassified` rather than silently dropped: a discovery
// gap is a thing to see, not a thing to be absent.
//
// WHY THE REGISTRY SUPPLIES THE VOCABULARY. The sibling directory names come from `REGISTRY`
// rather than a second list, and `diagnose` already FAILS on a directory beside the estate that
// no registry row names. So the vocabulary is complete by construction: a repository this
// function could not name is a repository doctor is already shouting about.
//
// WHAT RUNS THIS ON THE UPSTREAM MERGE, since 2026-08-10: `.github/workflows/cross-repo.yml` in
// this repository. Every repository that calls `service-ci.yml` or `web-ci.yml` sends one
// `repository_dispatch` from its main build — the sender is a step of those reusable workflows, so
// it cost no per-repository file — and micro-org answers it by running this command with `--repo`
// set to the repository that moved.
//
// THE RECEIVER COULD NOT LIVE IN THE DOWNSTREAM REPOSITORIES, which is what the issue first
// proposed. A reusable workflow declares `on: workflow_call` and nothing else; the trigger belongs
// to the CALLER's file, so "a receiver in service-ci.yml" would have been fifty-five per-repository
// edits wearing one file's name. The sweep therefore runs where the whole estate is already
// checked out, and — like `estate-ci.yml`, for the reason written at the top of that file — its
// red lands in micro-org and blocks nothing in the repository that merged.

// WHY THIS READS THROUGH THE COMMENT BLANKER. The first run of this sweep, 2026-08-10, claimed
// eleven edges out of `notify/src/catalogue.test.ts` and flagged sixty service test files as
// candidates. One of the eleven was real; the rest were CITATIONS IN PROSE — `worlds/src/rewards.ts`
// written in a docblock explaining why a template says what it says. A path in a comment is a
// thing a human is being told, not a file the test opens, and treating the two alike is exactly
// micro-org#303 in a different tool. So the same stripper those CI guards now use runs here first,
// and what is left is what the file actually does.

/** One file that reads outside its own repository. */
export interface CrossRepoFile {
  /** Repository-relative path. */
  readonly file: string;
  /** True when this file is itself a test the runner can be pointed at, rather than a helper. */
  readonly runnable: boolean;
  /** The sibling directory names it reads, registry names, sorted. */
  readonly reads: readonly string[];
}

export interface CrossRepoScan {
  readonly repo: string;
  readonly files: readonly CrossRepoFile[];
  /**
   * Files that reach for a sibling by NAME and bind no estate root, so this scan will not claim
   * them. Printed, because the alternative to an over-report is an under-report nobody sees.
   */
  readonly unclassified: readonly string[];
}

/**
 * Does this file resolve a path at or above the estate root?
 *
 * The estate is the parent of every repository, so from `test/x.test.ts` it is `../..` and from
 * `test/journeys/scenario.ts` it is `../../..`. The count is derived from the file's own depth
 * rather than matched against a fixed string, because both depths are in use today and a check
 * that only knew one would quietly classify the other as "reads nothing".
 */
export function bindsEstateRoot(source: string, relativeFile: string): boolean {
  const wanted = relativeFile.split('/').length;
  for (const match of source.matchAll(/new URL\(\s*['"`]([./]+)['"`]/g)) {
    const hops = (match[1] ?? '').split('/').filter((part) => part === '..').length;
    if (hops >= wanted) return true;
  }
  return false;
}

/**
 * The sibling directories a file reads, as registry names.
 *
 * Three shapes, all of them live in the estate today: interpolation against an estate root
 * (`${ESTATE}pool/src/...`), a join (`join(ESTATE, 'tessera-assets')`), and a bare path literal
 * whose first segment is a repository (`reads: 'wallet/src/addresses.ts'` in an edge table, where
 * the sibling name is nowhere near the root that will be prefixed to it).
 *
 * The third is the loose one and it is loose on purpose. Its cost is running a suite that did not
 * need running; the cost of tightening it is an edge that is real and unseen, which is the entire
 * defect this exists for.
 */
export function siblingReads(source: string, own: string, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  const add = (name: string | undefined): void => {
    if (name && name !== own && known.has(name)) found.add(name);
  };
  for (const match of source.matchAll(/\$\{[A-Za-z_$][\w$]*\}([a-z0-9-]+)\//g)) add(match[1]);
  for (const match of source.matchAll(/join\(\s*[A-Za-z_$][\w$]*\s*,\s*['"]([a-z0-9-]+)['"]/g)) add(match[1]);
  for (const match of source.matchAll(/['"`]([a-z0-9-]+)\/[^'"`\n]*['"`]/g)) add(match[1]);
  return [...found].sort();
}

/**
 * A file that reaches for a sibling by name without resolving the estate — the near miss.
 *
 * Deliberately narrow, and narrower than `siblingReads`. The two are asymmetric on purpose: a
 * claimed edge costs a suite run, so it can afford to be loose, whereas this list is READ BY A
 * PERSON deciding whether the sweep has a hole, and a list of sixty entries that are all fine is
 * a list nobody reads twice. So only the two shapes that mean somebody meant a checkout count:
 * the repository's own name (`micro-wallet`), and a relative path climbing out of this repository
 * into a named sibling.
 */
export function reachesForSibling(source: string, own: string, known: ReadonlySet<string>): boolean {
  for (const match of source.matchAll(/micro-([a-z0-9-]+)\b/g)) {
    const name = match[1] ?? '';
    if (name !== own && known.has(name)) return true;
  }
  for (const match of source.matchAll(/(?:\.\.\/){2,}([a-z0-9-]+)\//g)) {
    const name = match[1] ?? '';
    if (name !== own && known.has(name)) return true;
  }
  return false;
}

/** A file `node --test` could be pointed at, as opposed to a helper it would only import. */
const RUNNABLE = /\.test\.(ts|tsx|js|mjs)$/;

/**
 * Every source under `test/`, plus the `src/*.test.ts` layout the services use.
 *
 * JavaScript is included as well as TypeScript, even though every repository in the estate is
 * TypeScript today. The runner is `node --test`, which runs JavaScript; a repository that is not
 * TypeScript would otherwise be scanned as containing no tests at all, and "no tests" reads here
 * as "no cross-repository checks" — the exact silence this command exists to remove.
 */
function testSources(dir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    const absolute = path.join(dir, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) found.push(child);
    }
  };
  walk('test');
  if (existsSync(path.join(dir, 'src'))) {
    for (const entry of readdirSync(path.join(dir, 'src'), { withFileTypes: true })) {
      if (entry.isFile() && RUNNABLE.test(entry.name)) found.push(`src/${entry.name}`);
    }
  }
  return found.sort();
}

export function scanCrossRepo(dir: string, own: string, known: ReadonlySet<string>): CrossRepoScan {
  const files: CrossRepoFile[] = [];
  const unclassified: string[] = [];
  for (const file of testSources(dir)) {
    let source: string;
    try {
      source = blankComments(readFileSync(path.join(dir, file), 'utf8'), { syntax: 'js' });
    } catch {
      continue;
    }
    if (bindsEstateRoot(source, file)) {
      const reads = siblingReads(source, own, known);
      if (reads.length > 0) files.push({ file, runnable: RUNNABLE.test(file), reads });
    } else if (reachesForSibling(source, own, known)) {
      unclassified.push(file);
    }
  }
  return { repo: own, files, unclassified };
}

/**
 * The repository's own test command, pointed at specific files.
 *
 * Derived from `package.json` rather than assumed, because the runner is not uniform: one web
 * repository needs `--import @cloudsforge/ui/test-loader` for its DOM shims and one service runs
 * `--test-concurrency=1`. Running a cross-repository test without the loader its repository
 * chose is a failure this tool caused, reported as a failure the estate has.
 *
 * Returns undefined for anything that is not a `node … --test …` line, and the caller then runs
 * the whole suite and says that it did. Guessing at an unfamiliar runner is how a check ends up
 * green because it never started.
 */
export function testCommandFor(script: string, files: readonly string[]): string[] | undefined {
  const tokens = script.trim().split(/\s+/);
  if (tokens[0] !== 'node') return undefined;
  const at = tokens.indexOf('--test');
  if (at === -1) return undefined;
  const flags = tokens.slice(at + 1).filter((token) => token.startsWith('-'));
  return [...tokens.slice(0, at + 1), ...flags, ...files];
}

/**
 * The environment a nested `node --test` gets, with `NODE_TEST_CONTEXT` removed.
 *
 * NOT A TEST DETAIL — this is a false green. Node's test runner sets `NODE_TEST_CONTEXT` in the
 * children it spawns, and a `node --test` that inherits it believes it is reporting to a parent
 * runner instead of being one. Measured 2026-08-10: the same failing suite exits 1 without the
 * variable and 0 with it. So a `cfctl cross` invoked from anywhere inside a test — this
 * repository's own suite is the obvious case, and a wrapper script is the likely one — would
 * report every downstream repository as agreeing with its upstream, no matter what it found.
 *
 * A sweep whose whole purpose is to go red cannot inherit a variable that stops it going red.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  return env;
}

function testScript(dir: string): string | undefined {
  const manifest = readManifest(path.join(dir, 'package.json'));
  const scripts = (manifest as { scripts?: Record<string, string> } | undefined)?.scripts;
  return scripts?.['test'];
}

/** A TAP failure line: `not ok 12 - the site lists every surface`, at any nesting depth. */
const TAP_FAILURE = /^\s*not ok \d+ - /;
/** The header the `spec` reporter prints above its own failure detail, at the very end of a run. */
const SPEC_FAILURES = /✖ failing tests:/;

/**
 * The lines of a failed run that NAME what failed.
 *
 * ── WHY THIS IS NOT A TAIL ───────────────────────────────────────────────────────────────────
 *
 * It used to be `output.slice(-25)`, and on 2026-08-17 that printed, for a `site` run with three
 * red assertions in it, twenty-five lines of TAP epilogue — `ok 21 - …`, `# tests 84`, `# fail 3`
 * — and not one of the three names. The count was there and the identities were not, so the only
 * way to learn what had broken was to reproduce the whole sweep locally, which is exactly the work
 * this report exists to save. A tail is only the right answer when the reporter puts its detail
 * last, and only ONE of the two reporters in this estate does.
 *
 * Both are in play and neither is chosen here. `node --test` emits `spec` when stdout is a TTY and
 * `tap` when it is not, so a developer's terminal and a GitHub runner disagree about the format of
 * the same failing run — and a repository whose own test script pins `--test-reporter=spec` gets
 * spec in both. So this reads whichever arrived:
 *
 *   spec — a `✖ failing tests:` block at the end, holding each name and its assertion. Kept whole
 *          from the marker, because everything after it is the detail.
 *   tap  — `not ok N - <name>` scattered through the stream, each followed by a YAML block ending
 *          in `...` that carries the message, the expected and the actual. Kept per failure.
 *
 * The fallback is the old tail, for a runner that is neither: a crash before any test ran prints
 * a stack and no `not ok` at all, and twenty-five lines of that is the whole diagnosis.
 */
export function failureReport(output: readonly string[], limit = 80): string[] {
  const capped = (lines: readonly string[]): string[] =>
    lines.length <= limit
      ? [...lines]
      : [...lines.slice(0, limit), `… ${lines.length - limit} more line(s) — reproduce with 'cfctl cross --repo'`];

  const spec = output.findIndex((line) => SPEC_FAILURES.test(line));
  if (spec >= 0) return capped(output.slice(spec));

  const picked: string[] = [];
  for (let i = 0; i < output.length; i += 1) {
    if (!TAP_FAILURE.test(output[i] ?? '')) continue;
    picked.push(output[i] ?? '');
    // The YAML block under a TAP failure holds the assertion. It ends at a lone `...`; the bound is
    // there so a stack trace in one failure cannot crowd out the name of the next.
    for (let j = i + 1; j < output.length && j - i <= 20; j += 1) {
      const line = output[j] ?? '';
      if (TAP_FAILURE.test(line)) break;
      picked.push(line);
      if (/^\s*\.\.\.\s*$/.test(line)) break;
    }
  }
  return picked.length > 0 ? capped(picked) : [...output.slice(-25)];
}

function cmdCross(args: Args): number {
  const known = new Set(REGISTRY.map((repo) => repo.name));
  const only = args.option('repo');
  if (only !== undefined && !known.has(only)) {
    process.stdout.write(`cfctl cross: '${only}' is in no registry row\n`);
    return 2;
  }

  const scans: CrossRepoScan[] = [];
  for (const repo of managedRepos()) {
    const dir = path.join(microRoot(), repo.name);
    if (!existsSync(dir)) continue;
    const scan = scanCrossRepo(dir, repo.name, known);
    if (scan.files.length > 0 || scan.unclassified.length > 0) scans.push(scan);
  }

  const total = scans.reduce((sum, scan) => sum + scan.files.length, 0);

  // WHY THIS COMMAND HAS A MACHINE-READABLE MODE, when the table above is what a person reads.
  //
  // The trigger for micro-org#304 is a workflow, and the workflow has to do something this command
  // does not: INSTALL each reader's dependencies before its suite can run at all. A CI runner has
  // no node_modules anywhere, and a reader resolves @cloudsforge/* through `link:` to a sibling
  // that must be installed first — so the sweep has to be told which repositories to prepare, in
  // a shape a shell can consume, BEFORE it runs anything.
  //
  // The alternative was for the workflow to parse the padded table with awk. That is the estate's
  // recurring defect one layer down: a column layout is prose, and the run that changes it turns
  // "which repositories read wallet" into an empty list, which reads downstream as an estate that
  // agrees. Printed as data, a shape change is a `jq` failure rather than a silent green.
  //
  // Like `--list`, this RUNS NOTHING: it answers who reads whom, not whether they still agree.
  if (args.flag('json')) {
    const readers = scans
      .filter((scan) => scan.files.some((file) => only === undefined || file.reads.includes(only)))
      .map((scan) => {
        // Narrowed by `--repo`, both halves. A `reads` union taken over the reader's WHOLE scan
        // would name repositories the selected files do not read, and the caller is deciding what
        // to prepare and run from this — so it would prepare and blame the wrong ones.
        const files = scan.files.filter((file) => only === undefined || file.reads.includes(only));
        return {
          repo: scan.repo,
          files: files.map((file) => file.file),
          reads: [...new Set(files.flatMap((file) => file.reads))].sort(),
        };
      });
    process.stdout.write(
      `${JSON.stringify(
        {
          // The estate-wide total, NOT the narrowed one, because it is the anti-vacuity floor: a
          // caller asking about one repository still needs to know the detector is matching at all.
          total,
          repo: only ?? null,
          readers,
          unclassified: scans.reduce((sum, scan) => sum + scan.unclassified.length, 0),
        },
        null,
        2,
      )}\n`,
    );
    return total === 0 ? 1 : 0;
  }

  // Anti-vacuity, on micro-org#38's rule: a sweep that finds nothing has not proved the estate
  // agrees with itself, it has proved the sweep is broken. The estate had 30 such files on
  // 2026-08-09, so zero means the working tree is empty or the detector stopped matching.
  if (total === 0) {
    process.stdout.write(
      'cfctl cross: no cross-repository check found anywhere in this working tree.\n' +
        "  ↳ that is a broken sweep, not a clean estate — clone the repositories ('cfctl clone')\n" +
        '    or re-point siblingReads(), which is what stopped matching.\n',
    );
    return 1;
  }

  const readers = scans.filter((scan) => scan.files.length > 0);
  const wanted = readers.filter((scan) => only === undefined || scan.files.some((file) => file.reads.includes(only)));

  let shown = 0;
  for (const scan of wanted) {
    for (const file of scan.files) {
      if (only !== undefined && !file.reads.includes(only)) continue;
      shown += 1;
      process.stdout.write(`${pad(scan.repo, 18)}${pad(file.file, 40)}reads ${file.reads.join(', ')}\n`);
    }
  }
  process.stdout.write(
    only === undefined
      ? `\n${total} cross-repository check(s) in ${readers.length} repositories\n`
      : `\n${shown} check(s) in ${wanted.length} repositories read '${only}', of ${total} in the estate\n`,
  );

  // The near misses are a COUNT by default and a list on request. Printed in full they run to
  // three screens of files that are all fine, and a report nobody finishes is a report that hides
  // the one line that mattered — which is the failure mode this whole command exists to fix, at a
  // smaller scale. The number is here so that it moving is noticeable.
  const near = scans.reduce((sum, scan) => sum + scan.unclassified.length, 0);
  if (near > 0 && !args.flag('unclassified')) {
    process.stdout.write(
      `${near} more file(s) reach for a sibling by name and bind no estate root — ` +
        "'cfctl cross --unclassified' lists them\n",
    );
  } else if (near > 0) {
    for (const scan of scans) {
      for (const file of scan.unclassified) {
        process.stdout.write(`${pad(scan.repo, 18)}${pad(file, 40)}names a sibling, binds no estate root\n`);
      }
    }
  }

  if (args.flag('list')) return 0;
  if (only !== undefined && wanted.length === 0) {
    process.stdout.write(`nothing in this working tree reads '${only}'\n`);
    return 0;
  }

  let failed = 0;
  for (const scan of wanted) {
    const dir = path.join(microRoot(), scan.repo);
    const script = testScript(dir);
    if (script === undefined) {
      process.stdout.write(`${pad('SKIP', 6)}${scan.repo}: no test script in package.json\n`);
      failed += 1;
      continue;
    }
    // With --repo, run only the checks that read THAT repository. Running the rest would attribute
    // an unrelated failure to the merge being asked about, which is the release cut's mistake in
    // miniature: a red tick whose cause is somewhere else.
    const relevant = scan.files.filter((file) => only === undefined || file.reads.includes(only));
    const runnable = relevant.filter((file) => file.runnable).map((file) => file.file);
    const helpers = relevant.filter((file) => !file.runnable);
    const argv = helpers.length > 0 ? undefined : testCommandFor(script, runnable);
    const why =
      helpers.length > 0
        ? `whole suite: ${helpers.map((file) => file.file).join(', ')} is a helper, not a test file`
        : argv === undefined
          ? `whole suite: '${script}' is not a runner this tool can narrow`
          : runnable.join(', ');
    process.stdout.write(`\n── ${scan.repo}: ${why}\n`);
    const result =
      argv === undefined
        ? run('pnpm', ['-s', 'test'], dir, childEnv())
        : run(argv[0] ?? 'node', argv.slice(1), dir, childEnv());
    if (result.ok) {
      process.stdout.write(`${pad('ok', 6)}${scan.repo}\n`);
    } else {
      failed += 1;
      process.stdout.write(`${pad('FAIL', 6)}${scan.repo}\n`);
      const output = `${result.out}\n${result.err}`.trim().split('\n');
      for (const line of failureReport(output)) process.stdout.write(`       ${line}\n`);
    }
  }

  process.stdout.write(`\n${failed} of ${wanted.length} repositories disagree with a sibling\n`);
  return failed > 0 ? 1 : 0;
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

// ---------------------------------------------------------------------------------------------
// bump — the step before `release`, which until now was done by hand forty-eight times
// ---------------------------------------------------------------------------------------------
//
// `cfctl release` records what the tags resolve to. It does not CREATE them, and the thing that
// does is a version bump in every deployable's package.json, because `publish-image.yml` tags the
// image with `require('./package.json').version` and never moves a tag it has already published.
// So "cut 2.5.8" means: forty-eight package.json edits, forty-eight commits, forty-eight pushes —
// and then a manifest.
//
// 2.5.7 was done by hand. That is why this exists. The failure mode of doing it by hand is not
// tedium, it is a SILENT PARTIAL: one repository missed, its image never publishes 2.5.8, and
// `cfctl release` pins it at the version it still has. The manifest is then internally consistent
// and wrong — it says the estate is 2.5.8 and one service is a release behind, which is exactly
// the drift the manifest format exists to make impossible. `cfctl release`'s digest lookup would
// not catch it either: the old tag resolves perfectly well.
//
// Three refusals, and each is a partial release that has already happened somewhere:
//
//   * a DIRTY checkout is refused, not stashed. A version bump that sweeps up somebody else's
//     uncommitted work puts unreviewed code behind a version number, and the version number is
//     what the estate deploys by.
//   * a target that is not strictly AHEAD of the current version is refused. Re-cutting a version
//     is the one thing `publish-image.yml` cannot express — the tag is already taken and will not
//     move — so a bump that goes backwards or sideways produces a branch whose CI publishes
//     nothing and whose green tick means "already published", not "published this".
//   * a repository already AT the target is skipped rather than committed. Re-running after a
//     partial failure is the normal way this command is used, and an empty commit on a release
//     branch is a commit whose diff cannot answer what it released.
//
// Pushing is opt-in (`--push`). Forty-eight pushes start forty-eight image builds, and that is a
// thing to do on purpose rather than as the default behaviour of a command that also edits files.
//
// ── ON MAIN, NAMED BY A TAG, NOT ON A BRANCH (micro-org#422) ───────────────────────────────────
//
// This used to cut `release/<version>` in every repository. Forty-eight branches then had to be
// merged back, and they never were: forty-four repositories carry `release/2026.08.22` and older,
// `main` sits a release behind the images the estate runs, and the NEXT merge to main republishes
// the previous version's tag from a commit that version was never built from. The branch is not
// where the release lives — the image tag is — so the branch was a second, mutable, always-drifting
// record of a thing that already had a name.
//
// So the bump commits to `main` and creates an ANNOTATED TAG `release/<version>` at that commit.
// Three properties fall out, and each was a failure of the branch scheme:
//
//   * `main` is the released version. There is nothing to merge, so there is nothing to forget to
//     merge, and the drift micro-org#288 measured cannot open at all.
//   * a tag does not move. A branch tip does — `release/2.5.7` in a repository someone pushed a fix
//     to no longer names what 2.5.7 was built from, which is the same defect as a floating image
//     tag, one level up.
//   * the tag does not trigger anything. Each repository's `ci.yml` fires on pushes to BRANCHES, so
//     the publish is the push to `main` and the tag is pure record. A tag that also built would be
//     a second builder of the same version, and `publish-image.yml` will not republish a version
//     that already resolves — the second build's green tick would mean "already published".
//
// A tag and a branch of the same name coexist (`refs/tags/release/X` is not `refs/heads/release/X`),
// so the historical branches do not have to be deleted before this is used. `git rev-parse` becomes
// ambiguous between them, which is why every reference to the tag here is fully qualified.
//
// The cost is that a release commit does not go through a pull request. It is a one-line
// machine-written edit to a field whose value came from the command line, made in forty-eight
// repositories at once; a reviewer adds nothing a `--dry-run` does not, and the review that matters
// — of the code being released — happened when that code merged.

/** Numeric compare of dotted versions. Returns <0, 0 or >0. Non-numeric segments sort as -1. */
export function compareDotted(a: string, b: string): number {
  const parse = (value: string): readonly number[] =>
    value.split('.').map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isNaN(n) ? -1 : n;
    });
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Rewrite the top-level `"version"` of a package.json, touching nothing else.
 *
 * Deliberately a textual replacement rather than `JSON.parse` → `JSON.stringify`. A round trip
 * reformats the whole file — key order, indentation, the trailing newline — and turns a one-line
 * release diff into a whole-file one that no reviewer can read.
 *
 * `expected` is what `JSON.parse` says the version is, and it is passed in so the textual edit can
 * be checked against the parsed one. Without it this is a regex looking for the first line that
 * says `"version"`, and package.json is a format where a nested object can say that too. Requiring
 * the two to AGREE means the only string this can rewrite is the one the tag will be cut from: if
 * the regex found some other occurrence first, it does not match `expected` and this refuses
 * rather than editing the wrong field and reporting success.
 */
export function rewriteVersionText(
  text: string,
  expected: string,
  next: string,
): { readonly ok: boolean; readonly text?: string } {
  const match = /^(\s*"version"\s*:\s*")([^"]*)(")/m.exec(text);
  if (!match || match[2] !== expected) return { ok: false };
  return { ok: true, text: text.replace(match[0], `${match[1]}${next}${match[3]}`) };
}

function rewriteVersion(file: string, expected: string, next: string): boolean {
  const rewritten = rewriteVersionText(readFileSync(file, 'utf8'), expected, next);
  if (!rewritten.ok || rewritten.text === undefined) return false;
  writeFileSync(file, rewritten.text);
  return true;
}

function cmdBump(args: Args): number {
  const version = args.positional[1];
  if (!version) {
    process.stderr.write('usage: cfctl bump <version> [--only a,b] [--notes <file>] [--push]\n');
    return 2;
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    process.stderr.write(
      `cfctl: ${version} is not a three-part numeric version. The image tag is package.json's\n` +
        'version verbatim, and a tag the estate cannot order is a tag a rollback cannot walk back.\n',
    );
    return 2;
  }

  const notesFile = args.option('notes');
  if (notesFile !== undefined && !existsSync(notesFile)) {
    process.stderr.write(`cfctl: --notes ${notesFile} does not exist\n`);
    return 2;
  }
  const notes = notesFile === undefined ? '' : readFileSync(notesFile, 'utf8').trim();
  const tag = `release/${version}`;
  const tagRef = `refs/tags/${tag}`;
  const push = args.flag('push');

  const only = args.option('only');
  const names = only === undefined ? undefined : new Set(only.split(','));
  // `releasableRepos()`, NOT `deployableRepos()`. A bump is the first half of publishing an image:
  // it writes a version, tags it, and every push to main builds and pushes that tag. An absorbed
  // repository's code runs inside another pod and nothing pulls its image, so bumping it produced
  // a version nothing would ever deploy and a tag no manifest would ever name — four of them,
  // every release. `--only` cannot reach one either, and that is deliberate: naming an absorbed
  // repository explicitly is the case most likely to be a misunderstanding rather than an
  // instruction, and it is reported below rather than silently obeyed or silently dropped.
  const repos = releasableRepos().filter((repo) => names === undefined || names.has(repo.name));
  // Named, not merely absent. `releases/README.md`'s argument is that "a release where one of the
  // seven was forgotten looks exactly like a release where it was not" — and a release that
  // silently skips four repositories looks exactly like one that silently missed them. So the
  // skip is printed with the reason, every run.
  const skipped = absorbedRepos().filter((repo) => names === undefined || names.has(repo.name));

  const bumped: string[] = [];
  const already: string[] = [];
  const absent: string[] = [];
  const refused: string[] = [];

  /**
   * Put `tag` on HEAD, or agree that it is already there.
   *
   * Returns an error string, or `undefined` when the tag names this commit. Fully qualified on
   * both sides: a repository that still carries the historical `release/<version>` BRANCH would
   * otherwise make `git rev-parse release/<version>` ambiguous, and the branch is the answer git
   * prefers.
   */
  const ensureTag = (repo: ManagedRepo, dir: string): string | undefined => {
    const head = git(dir, ['rev-parse', 'HEAD']);
    if (!head.ok) return `could not read HEAD — ${head.err}`;
    const existing = git(dir, ['rev-parse', '--verify', '--quiet', `${tagRef}^{commit}`]);
    if (existing.ok && existing.out !== head.out) {
      return `${tag} already exists and names ${existing.out.slice(0, 12)}, not ${head.out.slice(0, 12)}`;
    }
    if (!existing.ok) {
      const message = notes === '' ? `release: ${version}` : `release: ${version}\n\n${notes}`;
      const made = gitWrite(repo, dir, ['tag', '-a', tag, '-m', message]);
      if (!made.ok) return `could not tag ${tag} — ${made.err || made.out}`;
    }
    if (!push) return undefined;
    const pushed = gitWrite(repo, dir, ['push', 'origin', tagRef]);
    if (!pushed.ok) return `could not push ${tag} — ${pushed.err || pushed.out}`;
    return undefined;
  };

  /**
   * Publish this repository's release: the branch first, then the tag.
   *
   * That order is the one that survives being interrupted. A pushed branch with no tag is a
   * published image nobody has named yet, which `cfctl release` still pins correctly and a re-run
   * repairs. A pushed tag with no branch names a commit the remote does not have.
   *
   * BOTH paths through the loop below go through here, and that is the point. Bumping without
   * `--push`, reading the diffs, and then re-running WITH it is the workflow the no-push summary
   * line prescribes — and on that second run every repository takes the `already at this version`
   * path. When that path pushed only the tag, the second run reported success having pushed no
   * branch, so no image was ever built and `cfctl release` then pinned tags that did not exist.
   * A local-only `main` is exactly the silent partial this command was written to make impossible.
   */
  const publish = (repo: ManagedRepo, dir: string, branch: string): string | undefined => {
    if (push) {
      const pushed = gitWrite(repo, dir, ['push', 'origin', branch]);
      if (!pushed.ok) return `could not push ${branch} — ${pushed.err || pushed.out}`;
    }
    return ensureTag(repo, dir);
  };

  for (const repo of repos) {
    const checkout = inspect(repo);
    if (checkout.state === 'absent' || checkout.state === 'not-a-repo') {
      absent.push(repo.name);
      continue;
    }
    if (checkout.state === 'dirty') {
      refused.push(`${repo.name}: uncommitted changes — a version bump must not carry them`);
      continue;
    }

    const file = path.join(checkout.dir, 'package.json');
    const manifest = readManifest(file);
    const current = manifest?.version;
    if (current === undefined) {
      refused.push(`${repo.name}: package.json has no version, so publish-image has nothing to tag`);
      continue;
    }
    if (current === version) {
      // Re-running after a partial failure is the normal way this is used, so the skip is not a
      // no-op: the tag is what names this release now, and a repository that is at the version
      // without carrying the tag is the silent partial one level along from the one this command
      // was written to stop. `publish`, not `ensureTag`: the commit may be local-only, and a
      // version that never reached the remote is a version no image was ever built for.
      const problem = publish(repo, checkout.dir, checkout.branch);
      if (problem !== undefined) refused.push(`${repo.name}: ${problem}`);
      else already.push(repo.name);
      continue;
    }
    if (compareDotted(version, current) <= 0) {
      refused.push(`${repo.name}: is ${current}, and ${version} does not come after it`);
      continue;
    }

    // The commit lands on whatever branch the checkout is standing on, and that is expected to be
    // `main`. Saying so out loud rather than forcing it: a release rehearsed from a feature branch
    // is a real thing an operator sometimes wants, and a tool that silently checks out `main` would
    // discard the branch they were standing on to get it. Since micro-org#422 this is the branch
    // that gets PUSHED, so the refusal matters more than it did when it only chose a fork point.
    if (checkout.branch !== 'main' && !args.flag('any-branch')) {
      refused.push(
        `${repo.name}: is on ${checkout.branch}, not main — pass --any-branch if that is deliberate`,
      );
      continue;
    }

    if (!rewriteVersion(file, current, version)) {
      refused.push(
        `${repo.name}: package.json parses as ${current}, but the first "version" line does not say ` +
          'that — refusing to guess which one the image tag comes from',
      );
      continue;
    }

    gitWrite(repo, checkout.dir, ['add', 'package.json']);
    const message = notes === '' ? `release: ${version}` : `release: ${version}\n\n${notes}`;
    const committed = gitWrite(repo, checkout.dir, ['commit', '-m', message]);
    if (!committed.ok) {
      refused.push(`${repo.name}: commit failed — ${committed.err || committed.out}`);
      continue;
    }

    // The branch first, then the tag — see `publish`, which both paths share so that neither can
    // drift into publishing half of what the other does.
    const problem = publish(repo, checkout.dir, checkout.branch);
    if (problem !== undefined) {
      refused.push(`${repo.name}: committed ${current} → ${version} on ${checkout.branch}, but ${problem}`);
      continue;
    }
    bumped.push(`${repo.name} ${current} → ${version}`);
  }

  for (const line of bumped) process.stdout.write(`  bumped   ${line}\n`);
  for (const name of already) process.stdout.write(`  already  ${name} is ${version}, tagged ${tag}\n`);
  for (const name of absent) process.stdout.write(`  absent   ${name}\n`);
  for (const line of refused) process.stdout.write(`  REFUSED  ${line}\n`);
  for (const repo of skipped) {
    process.stdout.write(`  absorbed ${repo.name} runs inside ${repo.absorbedInto}; nothing deploys its image\n`);
  }

  process.stdout.write(
    `\n${bumped.length} bumped, ${already.length} already at ${version}, ${absent.length} absent, ` +
      `${refused.length} refused, of ${repos.length} releasable repositories` +
      (skipped.length > 0 ? ` (${skipped.length} absorbed, not bumped)\n` : '\n'),
  );

  // A refusal is an ERROR rather than a note, and this is the whole point of the command. The
  // damage a hand-run bump does is the one repository that got missed, and a summary line reporting
  // it among forty-seven successes is a line that gets read as success.
  if (refused.length > 0) {
    process.stdout.write(
      '\n::error::the estate ships ONE version across every deployable. Until the refusals above ' +
        `are settled, ${version} is a partial release: cfctl release would pin the refused ` +
        'repositories at the version they still have, and the manifest would be consistent and wrong.\n',
    );
    return 1;
  }
  if (!push) {
    process.stdout.write(
      `\nnothing was pushed — the commits and the ${tag} tags are local. When the diffs look right:` +
        `  cfctl bump ${version} --push\n`,
    );
    return 0;
  }
  // bumped + already, not bumped: on the second run of the documented two-step both numbers are
  // real pushes, and reporting only the first printed "pushed in 0 repositories" immediately after
  // pushing forty-eight of them.
  process.stdout.write(
    `\nmain and ${tag} are pushed in ${bumped.length + already.length} repositories. Each push to ` +
      `main publishes an image tagged ${version}.\nWhen those builds are green:  cfctl release ${version}\n`,
  );
  return 0;
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
  // `releasableRepos()`, NOT `deployableRepos()`. A manifest is the record of what is deployed, and
  // the four absorbed repositories are not: their code runs inside another service's pod, their
  // compose services are gone, and `deploy/scripts/k8s-render.py` emits each as an ExternalName
  // alias rather than a Deployment. Pinning them made this file describe a 52-service estate that
  // runs 31 Deployments — four entries whose images would go stale, then unpullable, and take
  // `--verify` red with them on the day somebody needed a rollback.
  //
  // It is not merely that this loop skips them: `imageFor` will not accept one, so an absorbed row
  // has no image name to be pinned WITH. See `AbsorbedRepo` in registry.ts.
  process.stdout.write(`asking GHCR what each tag resolves to (up to ${releasableRepos().length} lookups)\n`);
  for (const repo of releasableRepos()) {
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
      `cfctl: nothing to release — none of the ${releasableRepos().length} releasable repositories is checked out.\n` +
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

  // SAID AT THE CUT, for the reason the client note below is: an operator reading a manifest can
  // see what it names and cannot see what it deliberately does not. Four rows are in the port
  // block and out of this file on purpose, and a reader who counts 48 against a registry of 52
  // deserves the answer here rather than in a git log.
  const merged = absorbedRepos();
  if (merged.length > 0) {
    process.stdout.write(
      `${merged.length} absorbed repositories are deliberately not pinned: ` +
        `${merged.map((repo) => `${repo.name} → ${repo.absorbedInto}`).join(', ')}\n`,
    );
  }

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

  // PRINTED AT THE CUT, not left to a separate command nobody runs. A manifest is "the record of
  // what was deployed" and it can only record container images, so an operator reading one has no
  // way to tell a client that ships from a client that does not — `releases/README.md`'s own
  // argument, that "a release where one of the seven was forgotten looks exactly like a release
  // where it was not", applied to three builds the format cannot name at all. Saying it here means
  // no release is cut without the person cutting it being told what is true of the other three.
  const clients = clientStates();
  if (clients.length > 0) {
    const distributed = clients.filter((state) => state.repo.distribution.state === 'distributed').length;
    process.stdout.write(
      `\nthis manifest names container images only. ${clients.length} wallet client(s) are outside it — ` +
        `${distributed} distributed, ${clients.length - distributed} recorded as built and deliberately not:\n`,
    );
    writeClientTable(clients);
    process.stdout.write(`\ncheck those records against GitHub:  cfctl clients --verify\n`);
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
// clients — the question a release manifest cannot ask, asked anyway (micro-org#352)
// ---------------------------------------------------------------------------------------------
//
// A release manifest names 48 container images and, for each, which artifact was built from which
// commit. A desktop binary is not a container image; neither is an MV3 bundle or an Android
// bundle. So the estate's ONE mechanism for saying what is shipped could say nothing at all about
// `micro-wallet-desktop`, `micro-wallet-extension` and `micro-wallet-mobile` — not "shipped", not
// "not shipped", not "at what version". `releases/README.md` argues a release must be a file
// rather than a tag because "a release where one of the seven was forgotten looks exactly like a
// release where it was not". These three were forgotten by construction.
//
// WHAT THIS IS NOT, AND WHY THAT MATTERS MORE THAN WHAT IT IS. Registering the five wallet
// repositories removes five permanent `doctor` FAILs. Removing five failures and adding nothing
// would leave the estate QUIETER AND LESS INFORMED than before — the only thing that had ever
// said anything about these repositories was the noise being deleted, and a regression that makes
// a red list green is the hardest kind to notice. So the state those failures implied is now
// recorded rather than inferred: `Distribution` in registry.ts is a required field on every client
// row, and this command is what prints it.
//
// ── WHY A COMMAND AND A REGISTRY FIELD, RATHER THAN A SECOND FILE ─────────────────────────────
//
// The obvious shape is `releases/clients.yaml`, mirroring the manifest that already works. It was
// rejected on registry.ts's own opening argument: `clone-all.sh` and `pull-all.sh` each carried a
// copy of the repository list and they drifted, and "two lists is one list that is wrong". A file
// listing the clients would be a second place that has to agree with the registry about which
// repositories exist, and the first thing to go stale would be the file nobody's tooling reads.
//
// Extending the release manifest itself was the other candidate, and it is worse for a concrete
// reason rather than an aesthetic one: `micro-deploy/scripts/release-render.py` parses that format
// and deliberately mirrors `parseManifest` above, on the rule that "a manifest that is not exactly
// this shape was not generated by cfctl and should not be deployed". A new top-level section is a
// cross-repository format change that cannot be verified from here — and `parseManifest`'s own
// `absent:` handling would silently swallow the new block's list items until it was taught not to.
// A release manifest is also the wrong cadence: clients ship on store review timescales, not on
// the estate's, and a manifest is "the record of what was deployed" for things that were.
//
// So: ONE list, the registry, holding the DECISION; the checkouts holding the MEASUREMENT (each
// client's version and HEAD); and this command joining them at print time, so there is nothing
// duplicated to drift. `cfctl release` prints the same block when it cuts a manifest, so the
// operator who is about to deploy 48 images is told, in the same breath, what is true of the three
// things that are not among them.
//
// ── HOW THIS GOES RED WHEN IT STOPS BEING TRUE ───────────────────────────────────────────────
//
// A record whose only property is that somebody wrote it down once is a comment. Two sensors, and
// they fail in opposite directions on purpose:
//
//   * OFFLINE, and the one that runs anywhere the estate is checked out: a client whose CI has
//     grown a step that PUBLISHES an artifact, while its row still says nothing is distributed.
//     `publishesAnArtifact` below. Measured 2026-08-10: none of the three has one — every `uses:`
//     in all three `ci.yml` files is checkout, setup-node, pnpm/action-setup, a Rust toolchain, or
//     micro-org's own `secret-hygiene.yml`.
//   * ONLINE (`--verify`): what GitHub says each client repository has actually released, against
//     what the row claims. Measured 2026-08-10: all five wallet repositories have zero releases and
//     zero tags. A `none` record and a published release is the loud case, and it is loud because
//     the record is then a FALSE STATEMENT about what a user can install rather than a stale one.
//
// THE RESIDUAL, STATED RATHER THAN PAPERED OVER: neither sensor can see a Chrome Web Store listing
// uploaded by a person from a laptop, because nothing in this organisation is touched when that
// happens. What is claimed is narrower and true — a client distributed BY THIS ESTATE'S MACHINERY,
// or by a GitHub release on its own repository, cannot stay unrecorded. The three blockers each
// row names in `blockedOn` are the owner's to clear, and clearing them is what puts a publish step
// into one of these repositories, which is the thing the offline sensor is watching for.

/** What GitHub just said about a repository's releases. Never a count on its own — see below. */
export interface ReleaseAnswer {
  /** The tags of every non-draft release, or undefined when GitHub did not answer with a list. */
  readonly tags?: readonly string[];
  readonly reason?: string;
}

/**
 * Read GitHub's answer to "what has this repository released".
 *
 * THE WHOLE POINT IS THE DIFFERENCE BETWEEN `[]` AND AN ERROR, and it is the same trap
 * `readGhcrTokenAnswer` documents one screen up. `[]` means "this repository has published
 * nothing", which is a finding. `{"message":"Not Found"}` — what the API returns for a repository
 * a caller cannot see, which is every private repository asked about anonymously — means "I could
 * not tell you", and a reader that counted its way to zero would report a private, shipping client
 * as undistributed. That is the exact failure mode this whole command exists to prevent, arriving
 * through the check meant to catch it.
 *
 * Pure and exported for the reason the two GHCR readers are: a check whose only test is the
 * internet is a check that is silently wrong between outages.
 *
 * DRAFTS ARE NOT RELEASES. A draft is invisible to everyone but the repository's own maintainers,
 * so it is not an artifact in front of a user and must not read as one. A PRERELEASE is public, is
 * downloadable by anybody with the link, and counts.
 */
export function readGithubReleases(body: string): ReleaseAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { reason: 'GitHub answered with something that is not JSON' };
  }
  if (!Array.isArray(parsed)) {
    const message = (parsed as { message?: unknown } | null)?.message;
    return {
      reason:
        typeof message === 'string'
          ? `GitHub answered '${message}' rather than a list of releases`
          : 'GitHub answered with something that is not a list of releases',
    };
  }
  const tags: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      return { reason: 'a release in the list is not an object' };
    }
    const release = entry as { tag_name?: unknown; draft?: unknown };
    if (release.draft === true) continue;
    // A release with no readable tag makes the whole answer untrustworthy rather than one entry
    // shorter: the question is "is anything published", and an entry this cannot name is an entry
    // it cannot rule out.
    if (typeof release.tag_name !== 'string' || release.tag_name === '') {
      return { reason: 'a release in the list carries no tag_name' };
    }
    tags.push(release.tag_name);
  }
  return { tags };
}

/** Ask GitHub what a repository has released. Authenticated when a token is in the environment. */
export function githubReleases(repo: string): ReleaseAnswer {
  if (!hasCommand('curl')) return { reason: 'curl is not available' };
  // Anonymous works for a public repository and is rate-limited per IP, which on a shared CI runner
  // runs out. A token is used when one is present and never printed; without one this can still
  // answer, and when it cannot it says so rather than counting to zero.
  const token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? '';
  const auth = token === '' ? [] : ['-H', `Authorization: Bearer ${token}`];
  const result = run('curl', [
    '-s',
    '-m',
    '15',
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
    ...auth,
    `https://api.github.com/repos/${ORG}/${repo}/releases?per_page=100`,
  ]);
  if (!result.ok) return { reason: 'GitHub did not answer the releases request' };
  return readGithubReleases(result.out);
}

/**
 * The five things `cfctl clients --verify` can conclude about one client, and none is a boolean.
 *
 *   `undistributed` the row says nothing is distributed and GitHub has published nothing. The only
 *                   state in which "no artifact is in front of users" is KNOWN rather than assumed.
 *   `shipped`       the row says nothing is distributed and something has been published. The loud
 *                   one: the registry is making a false statement about what a user can install,
 *                   and it is the failure this record exists to make impossible to hold quietly.
 *   `confirmed`     the row names a distributed artifact and GitHub has a release for that version.
 *   `missing`       the row names a distributed artifact and there is no release for it — a claim
 *                   that users have something they do not.
 *   `unreadable`    GitHub would not answer. Verification that cannot run is not verification, so
 *                   this is a failure rather than a shrug — `--verify` for images says the same.
 */
export type DistributionVerdict = 'undistributed' | 'shipped' | 'confirmed' | 'missing' | 'unreadable';

export function distributionVerdict(record: Distribution, answer: ReleaseAnswer): DistributionVerdict {
  if (!answer.tags) return 'unreadable';
  if (record.state === 'none') return answer.tags.length === 0 ? 'undistributed' : 'shipped';
  // `v1.2.3` and `1.2.3` are both in use across this organisation's tags, and a record that matched
  // only one spelling would report a shipped client as `missing` on a naming convention.
  return answer.tags.some((tag) => tag === record.version || tag === `v${record.version}`) ? 'confirmed' : 'missing';
}

/**
 * The markers of a workflow step that can put a build in front of a user, or undefined.
 *
 * DELIBERATELY PUBLISH VERBS ONLY. Signing and notarisation are NOT here, even though every row's
 * `blockedOn` names them, because a signing step landing is not yet a user holding a build — and a
 * `codesign` invocation appears in macOS build scripts that ship nothing. A sensor that fires on a
 * prerequisite is a sensor that fires early and is switched off; this estate's recurring defect is
 * the check nobody reads, and a false FAIL is the fastest way to make one.
 *
 * Comments are blanked before matching, on micro-org#303's rule: the first run of `cfctl cross`
 * claimed eleven edges out of one file and ten of them were CITATIONS IN PROSE. These workflow
 * files carry long argued headers — the one in `micro-wallet-desktop/.github/workflows/ci.yml`
 * explains what it does not do — and a header explaining why a repository does not publish must
 * not read as the repository publishing.
 */
const PUBLISH_MARKERS: readonly string[] = [
  'gh release create',
  'softprops/action-gh-release',
  'actions/upload-release-asset',
  'tauri-apps/tauri-action',
  'chrome-webstore-upload',
  'addons.mozilla.org/api',
  'web-ext sign',
  'upload-google-play',
  'apple-actions/upload-testflight-build',
  'app-store-connect',
  'xcrun altool',
  'npm publish',
  'pnpm publish',
];

export function publishesAnArtifact(source: string): string | undefined {
  const body = blankComments(source, { syntax: 'hash' });
  return PUBLISH_MARKERS.find((marker) => body.includes(marker));
}

/** One line of the clients table: what the row records, and what the checkout measures. */
interface ClientState {
  readonly repo: ClientRepo;
  /** package.json version of the checkout, or '' when it is not on this machine. */
  readonly version: string;
  /** HEAD of the checkout, or '' when it is not on this machine. */
  readonly commit: string;
  readonly present: boolean;
  /** A workflow that can publish, while the row says nothing is distributed. */
  readonly publishPath?: { readonly file: string; readonly marker: string };
}

export function clientStates(): ClientState[] {
  const states: ClientState[] = [];
  for (const repo of clientRepos()) {
    const checkout = inspect(repo);
    const present = checkout.state !== 'absent' && checkout.state !== 'not-a-repo';
    let publishPath: { file: string; marker: string } | undefined;
    if (present && repo.distribution.state === 'none') {
      for (const file of workflowFiles(checkout.dir)) {
        const marker = publishesAnArtifact(readFileSync(file, 'utf8'));
        if (marker !== undefined) {
          publishPath = { file: path.relative(checkout.dir, file), marker };
          break;
        }
      }
    }
    states.push({
      repo,
      version: present ? (readManifest(path.join(checkout.dir, 'package.json'))?.version ?? '') : '',
      commit: present ? checkout.head : '',
      present,
      ...(publishPath ? { publishPath } : {}),
    });
  }
  return states;
}

/** The block `cfctl clients` prints, and that `cfctl release` reprints when it cuts a manifest. */
function writeClientTable(states: readonly ClientState[]): void {
  process.stdout.write(
    `${pad('CLIENT', 18)}${pad('VERSION', 9)}${pad('COMMIT', 14)}${pad('STATE', 14)}${pad('SINCE', 12)}ARTIFACT\n`,
  );
  for (const state of states) {
    const record = state.repo.distribution;
    const artifact = record.state === 'none' ? '—  (nothing is in front of users)' : `${record.artifact} · ${record.channel}`;
    process.stdout.write(
      `${pad(state.repo.name, 18)}${pad(state.version || '—', 9)}${pad(state.commit || '—', 14)}` +
        `${pad(record.state === 'none' ? 'not shipped' : 'distributed', 14)}${pad(record.since, 12)}${artifact}\n`,
    );
    if (record.state === 'none') {
      for (const blocker of record.blockedOn) process.stdout.write(`${' '.repeat(24)}↳ waiting on ${blocker}\n`);
    } else {
      process.stdout.write(`${' '.repeat(24)}↳ built from ${record.commit}\n`);
    }
  }
}

function cmdClients(args: Args): number {
  const states = clientStates();
  writeClientTable(states);

  const distributed = states.filter((state) => state.repo.distribution.state === 'distributed').length;
  process.stdout.write(
    `\n${states.length} client(s) · ${distributed} distributed · ${states.length - distributed} recorded as built and ` +
      'deliberately not distributed\n',
  );
  // Said in words rather than left to a dash in a column. This is the sentence a release manifest
  // cannot contain, and it is the whole answer to micro-org#352 item 3.
  if (distributed === 0) {
    process.stdout.write(
      'No client artifact is in front of users. A release manifest names container images and none of\n' +
        'these is one, so this is where the same question is answered for them — and the answer is\n' +
        "'none', with a date and with what each is waiting on, rather than a silence that reads the same.\n",
    );
  }

  let failed = 0;
  for (const state of states) {
    if (!state.present) {
      process.stdout.write(`info  ${state.repo.name} is not checked out; its version and commit are unknown here\n`);
    }
    if (state.publishPath) {
      failed += 1;
      process.stdout.write(
        `::error::${state.repo.name} — ${state.publishPath.file} contains '${state.publishPath.marker}', which ` +
          `publishes an artifact, and tools/registry.ts records this client as NOT DISTRIBUTED since ` +
          `${state.repo.distribution.since}. One of the two is wrong and it is not the workflow.\n`,
      );
    }
  }

  if (!args.flag('verify')) {
    if (failed === 0) {
      process.stdout.write("\nnothing in these checkouts can publish. Ask GitHub too:  cfctl clients --verify\n");
    }
    return failed > 0 ? 1 : 0;
  }

  process.stdout.write(`\nasking GitHub what each client has released (${states.length} lookups)\n`);
  for (const state of states) {
    const answer = githubReleases(state.repo.repo);
    const record = state.repo.distribution;
    switch (distributionVerdict(record, answer)) {
      case 'undistributed':
        process.stdout.write(`ok: ${state.repo.name} — GitHub has published no release, as recorded\n`);
        break;
      case 'confirmed':
        process.stdout.write(`ok: ${state.repo.name} — ${record.state === 'distributed' ? record.artifact : ''} is released\n`);
        break;
      case 'shipped':
        failed += 1;
        process.stdout.write(
          `::error::${state.repo.name} — THIS CLIENT IS DISTRIBUTED AND THE REGISTRY SAYS IT IS NOT. ` +
            `GitHub serves release(s) ${(answer.tags ?? []).join(', ')}; tools/registry.ts records ` +
            `'none' since ${record.since}. Users have a build nothing in this estate can name.\n`,
        );
        break;
      case 'missing':
        failed += 1;
        process.stdout.write(
          `::error::${state.repo.name} — the registry records a distributed artifact and GitHub has no ` +
            `release for it. That is a claim that users hold something they do not.\n`,
        );
        break;
      case 'unreadable':
        failed += 1;
        process.stdout.write(`::error::${state.repo.name} — could not be checked: ${answer.reason ?? 'no answer'}\n`);
        break;
    }
  }

  process.stdout.write(
    failed > 0
      ? `\n${failed} client record(s) could not be confirmed against GitHub. Do not treat this list as current.\n`
      : `\nall ${states.length} client records agree with what GitHub has published\n`,
  );
  return failed > 0 ? 1 : 0;
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
  cfctl cross [--list] [--json] [--unclassified] [--repo <name>]
  cfctl bump <version> [--only a,b] [--notes <file>] [--any-branch] [--push]
  cfctl release <version> [--force]
  cfctl release --verify <version>
  cfctl clients [--verify]
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
    case 'cross':
      return cmdCross(args);
    case 'bump':
      return cmdBump(args);
    case 'release':
      return cmdRelease(args);
    case 'clients':
      return cmdClients(args);
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
