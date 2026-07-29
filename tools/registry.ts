// The repository registry — one list, in one place.
//
// WHY a file rather than two shell arrays: `scripts/clone-all.sh` and `scripts/pull-all.sh` each
// carried their own copy of the repository list, and they drifted. `crucible` was in one and not
// the other, so the documented update path fast-forwarded eight repositories and left the ninth
// silently pinned, with nothing printed to say so. Two lists is one list that is wrong.
//
// Derived from docs/ecosystem/03-repository-responsibilities.md §1. Per the repository policy in
// that directory's README, every repository the documentation names `cloudsforge-<name>` is
// actually `micro-<name>`, checked out at `stack/micro/<name>/`. That substitution is applied
// here and nowhere else.
//
// The three 'kept' repositories are listed and explicitly NOT managed. Listing them is the point:
// an omission that is written down is a decision, and an omission that is not is the crucible
// bug. cfctl will never clone, pull or write to anything under repos/.

export type RepoKind = 'service' | 'web' | 'ops' | 'library' | 'template' | 'org' | 'kept';

export interface Repo {
  // The local directory name and the suffix of the GitHub repository name.
  readonly name: string;
  // The GitHub repository. micro-* for everything this programme creates.
  readonly repo: string;
  readonly kind: RepoKind;
  // The phase from 03 §1 that creates or splits it. P2 is the machinery phase — the gate.
  readonly phase: string;
  // Path relative to the stack root.
  readonly path: string;
  // Whether cfctl may clone, pull or write to it. False for the existing estate, always.
  readonly managed: boolean;
  // Whether a release manifest pins an image for it. Libraries publish packages, not images.
  readonly deployable: boolean;
  readonly owns: string;
}

function service(name: string, phase: string, owns: string): Repo {
  return { name, repo: `micro-${name}`, kind: 'service', phase, path: `micro/${name}`, managed: true, deployable: true, owns };
}

function web(name: string, phase: string, owns: string): Repo {
  return { name, repo: `micro-${name}`, kind: 'web', phase, path: `micro/${name}`, managed: true, deployable: true, owns };
}

function ops(name: string, phase: string, owns: string): Repo {
  return { name, repo: `micro-${name}`, kind: 'ops', phase, path: `micro/${name}`, managed: true, deployable: true, owns };
}

function library(name: string, phase: string, owns: string): Repo {
  return { name, repo: `micro-${name}`, kind: 'library', phase, path: `micro/${name}`, managed: true, deployable: false, owns };
}

export const REGISTRY: readonly Repo[] = [
  // -- 22 domain services (03 §1.1) -----------------------------------------------------------
  service('identity', 'P3', 'Accounts, credentials, MFA, sessions, devices, SSO exchange, JWKS, orgs, consents'),
  service('policy', 'P5', 'Rules, limits, velocity counters, trusted addresses, cooling-off, approvals, freezes'),
  service('ledger', 'P4', 'Chart of accounts, journal, postings, balances projection, reservations, reconciliation'),
  service('wallet', 'P4', 'Wallet registry, external links, deposit addresses, withdrawals, conversions, portfolio'),
  service('settlement', 'P4', 'Treasuries, sweeps, outbound transactions, broadcast, confirmation tracking'),
  service('pricing', 'P4', 'Market sources, median oracle, administered prices, rate history, valuation'),
  service('billing', 'P4', 'Products, prices, entitlements, subscriptions, usage, invoices, payouts, revenue share'),
  service('custody', 'P5', 'HD seeds, key generation, encryption envelope, signing policy, treasury pins, export'),
  service('indexer', 'P5', 'Blocks, transactions, receipts, logs, balances, transfers, reorgs, provider health'),
  service('activity', 'P6', 'Canonical activity records, event inbox, feed cursors, feed query API'),
  service('notify', 'P13', 'Preferences, templates, notifications, deliveries, digests, webhooks, broadcasts'),
  service('studio', 'P8', 'Brand kits, asset specs, generation jobs, generated assets, generation credits'),
  service('mint', 'P3', 'Token orders, deployment lifecycle, token registry, token pages, contract templates'),
  service('market', 'P9', 'Listings, offers, auctions, orders, escrow refs, collections, moderation, disputes'),
  service('trade', 'P3', 'Strategy catalogue, backtests, bots, fills, allocations, fee settlement, performance'),
  service('worlds', 'P5', 'Title registry, player profile, inventory, achievements, seasons, entitlement bridge'),
  service('nda', 'P5', 'Ninety Days After: worlds, tiles, players, resolution engine, communes, objectives'),
  service('community', 'P12', 'Communities, roles, treasury accounts, proposals, votes, delegations, timelocks'),
  service('devplatform', 'P11', 'Developer orgs, projects, API keys, OAuth clients, webhooks, quotas, directory'),
  service('hub-api', 'P6', 'Forge Hub BFF: dashboard aggregation, portfolio composition, search, saved views'),
  service('admin-api', 'P13', 'Operator BFF: cross-service actions, approvals, audit mirror, flags, broadcasts'),
  service('analytics', 'P13', 'Pseudonymised product event store, funnels, cohorts, retention, metric definitions'),

  // -- 11 frontends (03 §1.2) -----------------------------------------------------------------
  web('hub-web', 'P6', 'Forge Hub: dashboard, portfolio, wallet, activity, settings, security, entitlements'),
  web('site', 'P3', 'Marketing site'),
  web('admin-web', 'P3', 'Operator console'),
  web('mint-web', 'P3', 'Forge Create'),
  web('trade-web', 'P3', 'Forge Trade'),
  web('worlds-web', 'P3', 'Forge Worlds client'),
  web('explorer-web', 'P3', 'Block explorer'),
  web('network-site', 'P3', 'Forge Network marketing'),
  web('market-web', 'P9', 'Forge Market'),
  web('devportal-web', 'P11', 'Developer console and docs'),
  web('status-web', 'P13', 'Public status page, from Beacon’s redacted projection'),

  // -- 3 operations services (03 §1.3) --------------------------------------------------------
  ops('lantern', 'P3', 'Log triage: OTLP push ingest, fingerprinting, browser errors and RUM'),
  ops('beacon', 'P3', 'Synthetic monitoring, journeys, incidents, SLOs. The release gate (AD-04)'),
  ops('faucet', 'P3', 'Testnet EMBER faucet'),

  // -- 4 library repositories (03 §1.4) -------------------------------------------------------
  // Phases: 03 §1.4 gives no phase column, because a library repository has no split of its own.
  // The phase recorded here is the phase of its first consumer, which is what makes it blocking.
  library('contracts', 'P2', '@cloudsforge/contracts-auth, -money, -chain, -market, -worlds, -create, -events, -devplatform'),
  library('runtime', 'P2', '@cloudsforge/telemetry, -http, -jobs, -auth, -db, -lifecycle, -policy-client'),
  library('ui', 'P2', '@cloudsforge/ui, @cloudsforge/ui-charts'),
  library('sdk', 'P11', '@cloudsforge/sdk, @cloudsforge/cli — public, generated from the public OpenAPI'),

  // -- 3 pieces of organisation infrastructure (03 §1.6) --------------------------------------
  // 03 names the first of these `.github`. A repository literally called `.github` cannot carry
  // the micro- prefix and cannot be checked out at micro/.github without colliding with a
  // configuration directory, so the reusable workflows live here, in micro-org, and each
  // repository calls them by full path. The org profile README stays the only thing in .github.
  { name: 'org', repo: 'micro-org', kind: 'org', phase: 'P2', path: 'micro/org', managed: true, deployable: false,
    owns: 'Reusable workflows, cfctl, the compatibility checker, release manifests, the Renovate preset' },
  { name: 'service-template', repo: 'micro-service-template', kind: 'template', phase: 'P2', path: 'micro/service-template',
    managed: true, deployable: false, owns: 'A working service skeleton. `cfctl new service` instantiates it' },
  { name: 'web-template', repo: 'micro-web-template', kind: 'template', phase: 'P2', path: 'micro/web-template',
    managed: true, deployable: false, owns: 'The same for a frontend: Vite, React 19, design system, nginx, CI' },

  // -- 3 kept exactly as they are (03 §1.5). NEVER managed. -----------------------------------
  // These are in the list so that their absence from every cfctl operation is a stated decision
  // rather than an oversight. The repository policy is absolute: nothing under repos/ is touched.
  { name: 'hearth', repo: 'hearth', kind: 'kept', phase: '—', path: 'repos/hearth', managed: false, deployable: true,
    owns: 'Chain node, EVM, consensus, P2P, miner, CLI, contracts. Loses web/, site/ and tools/faucet' },
  { name: 'asset-forge', repo: 'asset-forge', kind: 'kept', phase: '—', path: 'repos/asset-forge', managed: false,
    deployable: false, owns: 'Build-time CLI; becomes the engine micro-studio wraps. Never deployed' },
  { name: 'stack', repo: 'stack', kind: 'kept', phase: '—', path: '.', managed: false, deployable: false,
    owns: 'Compose and Kubernetes manifests, gateway config, telemetry stack config, docs/' },
];

export const ORG = process.env['CLOUDSFORGE_ORG'] ?? 'cloudsforge-online';

export const REGISTRY_PACKAGE_HOST = 'ghcr.io';

export function managedRepos(): readonly Repo[] {
  return REGISTRY.filter((repo) => repo.managed);
}

export function deployableRepos(): readonly Repo[] {
  return REGISTRY.filter((repo) => repo.managed && repo.deployable);
}

export function repoByName(name: string): Repo | undefined {
  return REGISTRY.find((repo) => repo.name === name);
}

export function imageFor(repo: Repo): string {
  return `${REGISTRY_PACKAGE_HOST}/${ORG}/${repo.repo}`;
}

// The packages a repository is allowed to import from the @cloudsforge scope. Anything else in
// that scope is a cross-service source import wearing a package name, which rule 2 of 03 §2
// forbids. Kept here so service-ci.yml and cfctl doctor cannot disagree about it.
export const ALLOWED_SCOPED_PACKAGES: readonly string[] = [
  '@cloudsforge/contracts-auth',
  '@cloudsforge/contracts-money',
  '@cloudsforge/contracts-chain',
  '@cloudsforge/contracts-market',
  '@cloudsforge/contracts-worlds',
  '@cloudsforge/contracts-create',
  '@cloudsforge/contracts-events',
  '@cloudsforge/contracts-devplatform',
  '@cloudsforge/telemetry',
  '@cloudsforge/http',
  '@cloudsforge/jobs',
  '@cloudsforge/auth',
  '@cloudsforge/db',
  '@cloudsforge/lifecycle',
  '@cloudsforge/policy-client',
  '@cloudsforge/ui',
  '@cloudsforge/ui-charts',
  '@cloudsforge/sdk',
  '@cloudsforge/cli',
  '@cloudsforge/hearth-node',
];
