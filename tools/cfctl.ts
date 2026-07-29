// cfctl — the CLI that replaces scripts/clone-all.sh and scripts/pull-all.sh (AD-03).
//
//   cfctl list                     the repository registry, and what is actually on disk
//   cfctl clone                    clone or fast-forward every micro-* repository
//   cfctl pull                     fast-forward the checkouts that already exist
//   cfctl doctor                   the checks for the things that actually break
//   cfctl release <version>        generate releases/<version>.yaml, one image tag per service
//   cfctl release --verify <v>     check every image the manifest names exists
//   cfctl new service <name>       instantiate micro-service-template
//   cfctl new web <name>           instantiate micro-web-template
//
// Two properties are inherited from the shell scripts on purpose, because they got them right:
// a checkout with local changes is reported and left alone rather than clobbered, and a branch
// that has diverged is a decision this tool will not make for you.
//
// One property is new: nothing under repos/ is ever touched. The existing estate is read-only
// for this programme (see docs/ecosystem/README.md), and the registry marks those three
// repositories unmanaged rather than omitting them, so the exclusion is visible in `cfctl list`.

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

// The stack root holds repos/ and docs/. It is needed only to display the three unmanaged
// repositories and to resolve their paths; nothing cfctl writes ever goes near it.
export function stackRoot(): string {
  const override = process.env['CLOUDSFORGE_STACK_ROOT'];
  if (override) return path.resolve(override);
  // PWD before cwd: the shell's logical path preserves the symlink that process.cwd() resolves
  // away, which is the difference between finding the stack tree and walking past it.
  const starts = [ORG_ROOT, process.env['PWD'] ?? process.cwd(), microRoot()];
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8; i += 1) {
      if (existsSync(path.join(dir, 'repos')) && existsSync(path.join(dir, 'docs'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  // A standalone checkout with no stack tree beside it. The kept repositories are not reachable,
  // which is correct: there is nothing to reach.
  return path.resolve(microRoot(), '..');
}

function repoDir(repo: Repo): string {
  // Managed repositories are siblings of this one. Only the three unmanaged entries live under
  // the stack root, and cfctl never writes to those.
  if (repo.managed) return path.join(microRoot(), repo.name);
  return path.join(stackRoot(), repo.path);
}

function cloneUrl(repo: Repo): string {
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

function git(dir: string, args: readonly string[]): Run {
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
  readonly repo: Repo;
  readonly dir: string;
  readonly state: CheckoutState;
  readonly branch: string;
  readonly head: string;
}

export function inspect(repo: Repo): Checkout {
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

function selected(args: Args): readonly Repo[] {
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
    if (!git(checkout.dir, ['fetch', '--quiet', 'origin']).ok) {
      failed.push(repo.name);
      continue;
    }
    const before = git(checkout.dir, ['rev-parse', 'HEAD']).out;
    if (!git(checkout.dir, ['merge', '--ff-only', '--quiet', 'FETCH_HEAD']).ok) {
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
    if (!git(checkout.dir, ['pull', '--ff-only', '--quiet']).ok) {
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

function ghcrVisibility(repo: Repo): 'public' | 'private-or-absent' | 'unknown' {
  // Anonymous pull. GHCR answers 401 for a package that exists but is private, which is the
  // 403 trap this check exists for: a new repository's package inherits the repository's
  // visibility, and the deploy path fails at pull time rather than at publish time.
  const url = `https://ghcr.io/v2/${ORG}/${repo.repo}/tags/list`;
  const result = run('curl', ['-s', '-m', '8', '-o', '/dev/null', '-w', '%{http_code}', url]);
  if (!result.ok) return 'unknown';
  if (result.out === '200') return 'public';
  if (result.out === '401' || result.out === '403') return 'private-or-absent';
  return 'unknown';
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
      if (!git(checkout.dir, ['remote', 'get-url', 'origin']).ok) {
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
    services.push({
      name: repo.name,
      repo: repo.repo,
      kind: repo.kind,
      image: imageFor(repo),
      tag,
      commit: git(checkout.dir, ['rev-parse', 'HEAD']).out,
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
  process.stdout.write(`wrote ${path.relative(process.cwd(), file)}: ${services.length} services pinned`);
  process.stdout.write(absent.length > 0 ? `, ${absent.length} absent\n` : '\n');
  process.stdout.write(`verify it before deploying:  cfctl release --verify ${version}\n`);
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
  let missing = 0;
  for (const service of manifest.services) {
    const reference = `${service.image}:${service.tag}`;
    const result = run('docker', ['manifest', 'inspect', reference]);
    if (result.ok) {
      process.stdout.write(`ok: ${reference}\n`);
    } else {
      missing += 1;
      // A 'denied' here is the GHCR visibility trap, not an absent image. Say both.
      process.stdout.write(`::error::${reference} — ${result.err.split('\n')[0] ?? 'not found'}\n`);
    }
  }
  if (manifest.absent.length > 0) {
    process.stdout.write(`note: ${manifest.absent.length} deployable(s) are not in this release: ${manifest.absent.join(' ')}\n`);
  }
  if (missing > 0) {
    process.stdout.write(`\n${missing} of ${manifest.services.length} images cannot be pulled. Do not deploy this manifest.\n`);
    return 1;
  }
  process.stdout.write(`\nall ${manifest.services.length} images exist\n`);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------------------------

// Ports are assigned from the registry position rather than chosen, because 'pick a free port'
// is how the estate ended up with eighteen fixed host ports and a compose file where
// deploy.replicas is illegal. Under the gateway these are container ports only.
function portFor(name: string): number {
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
