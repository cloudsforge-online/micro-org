// The repository registry — one list, in one place.
//
// WHY a file rather than two shell arrays: `scripts/clone-all.sh` and `scripts/pull-all.sh` each
// carried their own copy of the repository list, and they drifted. `crucible` was in one and not
// the other, so the documented update path fast-forwarded eight repositories and left the ninth
// silently pinned, with nothing printed to say so. Two lists is one list that is wrong.
//
// Derived from docs/ecosystem/03-repository-responsibilities.md §1. Per the repository policy in
// that directory's README, every repository the documentation names `cloudsforge-<name>` is
// actually `micro-<name>`, checked out as a sibling of this one. That substitution is applied
// here and nowhere else.
//
// AND ONE LIST IS ONLY ONE LIST IF IT IS COMPLETE. Fixing the drift between two shell arrays did
// nothing about the failure they SHARED — that a repository can exist and be in neither. This file
// held the 46 rows 03 §1 enumerates while the organisation held 70 repositories and the tree held
// 61 directories, so seventeen repositories were invisible to `cfctl list`, `clone`, `pull`,
// `doctor` and `release` at once. One of them was `micro-emberkin`, which is one of the three
// repositories the ledger account-type defect was actually found in; `estate-ci.yml`'s header
// names this file as the reason it derives its repository list from the GitHub API instead. All 70
// are here now — 59 managed, 11 kept — and `cfctl doctor` FAILS on a directory beside the estate
// that no row names, so the omission cannot happen quietly a third time.
//
// `.github` is the one organisation repository with no row, and its omission is argued rather than
// merely true: see the org-infrastructure block below.
//
// The 'kept' repositories are listed and explicitly NOT managed. Listing them is the point:
// an omission that is written down is a decision, and an omission that is not is the crucible
// bug. cfctl will never clone, pull or write to one.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// `kept` IS NOW A TYPE, NOT A FLAG, AND ONE OF THEM IS SOMEBODY ELSE'S REPOSITORY.
//
// `kindred-upstream` is checked out as a sibling of every micro-* repository, and its remote is
// `savvaniss/kindred-resonance` — **not a CloudsForge repository at all**. 18-build-status.md §1
// says so in those words, and 19-new-products.md §3 makes it a requirement: "the upstream
// repository is not modified. Code is copied forward". `micro-emberkin` and `micro-emberkin-web`
// were copied out of it.
//
// So the estate now contains a directory that looks exactly like the fifty-nine cfctl clones,
// pulls and releases, and is not one. `managed: false` on a row is not enough protection for
// that, because it is one keystroke from `managed: true` and nothing would notice: a `git pull`
// in that directory reaches a stranger's repository, and a release manifest would name a GHCR
// image under an org that does not own the source. Three things make it structural instead:
//
//   1. **`kind: 'kept'` IMPLIES `managed: false` and `deployable: false` in the TYPE.** `Repo` is
//      a discriminated union, so `kept('kindred-upstream', …, managed: true)` is not a value that
//      can be written — it is a compile error, in the same way an unaudited topic is one in
//      `contracts-events`. There is no constructor that produces a managed kept repository.
//   2. **cfctl cannot compute a kept repository's directory.** `inspect` and `repoDir` take a
//      `ManagedRepo`. A kept row has a `path`, and it is documentation: nothing turns it into an
//      absolute path, so nothing can hand it to git. That is why `stackRoot()` is gone — the only
//      thing it ever did was resolve the three kept rows, and resolving one is now the mistake.
//   3. **`imageFor` takes a `ManagedRepo`**, so no kept repository can be given a GHCR name, and
//      `deployableRepos()` returns `ManagedRepo[]`, so none can reach a release manifest.
//
// The type only binds rows whose `kind` is `kept`, and a misclassification — giving this
// directory `kind: 'service'` — would slip past all three. `cfctl.ts` carries the belt for that:
// every mutating git command goes through one function, and it refuses a checkout whose `origin`
// is not a repository of this organisation, naming the foreign remote it found.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Every kind cfctl may clone, pull, inspect or release. `kept` is deliberately not among them. */
export type ManagedKind = 'service' | 'web' | 'ops' | 'library' | 'assets' | 'template' | 'org';

export type RepoKind = ManagedKind | 'kept';

interface RepoBase {
  // The local directory name and the suffix of the GitHub repository name.
  readonly name: string;
  // The GitHub repository. micro-* for everything this programme creates.
  readonly repo: string;
  /**
   * The phase from 03 §1 that creates or splits it — P2 is the machinery phase, the gate.
   *
   * 03 §1 enumerates 46 repositories and the estate now holds 70. For the ones it does not name,
   * this is the ecosystem document that adds them instead: `19` (new products), `20` (Aetherholm),
   * `23` (Tessera). `—` where no document creates it, which is the honest answer for the four
   * supporting repositories 18-build-status.md §2.5 records as having simply been needed, and for
   * everything kept.
   */
  readonly phase: string;
  // Where the checkout sits, relative to the tree root. Display only — cfctl resolves a managed
  // repository as a sibling of this one, by name (see cfctl.ts `repoDir`), and cannot resolve a
  // kept one at all.
  readonly path: string;
  readonly owns: string;
}

/**
 * A repository cfctl may act on. Every write path in cfctl takes this type and not `Repo`.
 */
export interface ManagedRepo extends RepoBase {
  readonly kind: ManagedKind;
  readonly managed: true;
  // Whether a release manifest pins an image for it. Libraries publish packages, assets publish
  // bytes, and neither publishes an image.
  readonly deployable: boolean;
}

/**
 * A repository this programme does not touch: the frozen estate, the repositories that are
 * leaving, and one that belongs to somebody else.
 *
 * `managed` and `deployable` are literal `false` rather than fields with a value, so there is no
 * such thing as a managed kept repository or a deployable one. `hearth` used to carry
 * `deployable: true` — inert, because `deployableRepos()` also requires `managed`, but a claim
 * cfctl contradicts, and precisely the row that would put `ghcr.io/<org>/hearth` into a release
 * manifest the day somebody "simplified" that filter.
 */
export interface KeptRepo extends RepoBase {
  readonly kind: 'kept';
  readonly managed: false;
  readonly deployable: false;
  /**
   * The remote this checkout really points at, spelled in full.
   *
   * Written down because for one of these it is not what the name suggests, and a reader who
   * assumes `cloudsforge-online/<repo>` for every row would assume it for `kindred-upstream` too.
   */
  readonly remote: string;
}

export type Repo = ManagedRepo | KeptRepo;

function service(name: string, phase: string, owns: string): ManagedRepo {
  return { name, repo: `micro-${name}`, kind: 'service', phase, path: `micro/${name}`, managed: true, deployable: true, owns };
}

function web(name: string, phase: string, owns: string): ManagedRepo {
  return { name, repo: `micro-${name}`, kind: 'web', phase, path: `micro/${name}`, managed: true, deployable: true, owns };
}

function ops(name: string, phase: string, owns: string): ManagedRepo {
  return { name, repo: `micro-${name}`, kind: 'ops', phase, path: `micro/${name}`, managed: true, deployable: true, owns };
}

function library(name: string, phase: string, owns: string): ManagedRepo {
  return { name, repo: `micro-${name}`, kind: 'library', phase, path: `micro/${name}`, managed: true, deployable: false, owns };
}

/**
 * An asset repository: generated art, its manifest, and the provenance of each file.
 *
 * Its own kind because it is none of the others and the difference is mechanical rather than
 * taxonomic. It is not a `library`: 03 §1.4 defines a library repository as one that PUBLISHES
 * PACKAGES, and all four of these are `"private": true` with no `files` and no `main` — nothing
 * is published, and putting one in `library` would also feed its version into cfctl doctor's
 * "which @cloudsforge package can a consumer resolve" map, where it would be an answer to a
 * question nobody asked. It is not a `service` or a `web`: no Dockerfile, no image, nothing runs.
 *
 * What it actually is: **a set of bytes resolved by identity.** `materialise.py` takes a provider
 * key and a destination, resolves every asset the reference set defines against the chosen set,
 * and writes it out under the SAME relative path the reference uses — so a consumer holds a
 * committed copy in its own `public/` and never reads this repository at run time. That is a
 * third consumption mechanism, next to "pull an image" and "install a package", and a kind that
 * did not name it would make `cfctl list --kind library` lie about four repositories.
 *
 * `deployable: false`: there is no image, and a release manifest that named one would be pinning
 * a tag that cannot be pulled.
 */
function assets(name: string, phase: string, owns: string): ManagedRepo {
  return { name, repo: `micro-${name}`, kind: 'assets', phase, path: `micro/${name}`, managed: true, deployable: false, owns };
}

/**
 * Organisation machinery: the estate's own infrastructure, which is not a product.
 *
 * 03 §1.6 calls this "org infrastructure" and this widens it from micro-org alone to what the
 * estate actually grew: the reusable workflows and cfctl (`org`), the ecosystem documentation
 * (`docs`), the deployment composition and telemetry configuration (`deploy`), and the
 * characterisation harness plus the estate-wide sweeps `estate-ci.yml` runs (`conformance`).
 *
 * `ops` was the other candidate for `deploy` and it is wrong: `ops` in this registry means an
 * operations SERVICE — lantern, beacon and faucet each build an image, run, and are pinned in a
 * release manifest. `micro-deploy` is the configuration those services are deployed WITH. Giving
 * it `ops` would set `deployable: true` and put `ghcr.io/<org>/micro-deploy` in the next manifest,
 * where `--verify` would fail on an image that has never existed and never will.
 */
function machinery(name: string, phase: string, owns: string): ManagedRepo {
  return { name, repo: `micro-${name}`, kind: 'org', phase, path: `micro/${name}`, managed: true, deployable: false, owns };
}

/**
 * A repository this programme never touches. There is no parameter for `managed` on purpose.
 */
function kept(name: string, repo: string, path: string, remote: string, owns: string): KeptRepo {
  return { name, repo, kind: 'kept', phase: '—', path, managed: false, deployable: false, remote, owns };
}

const ORG_REMOTE = (repo: string): string => `https://github.com/cloudsforge-online/${repo}.git`;

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

  // -- 4 further domain services, added by documents 03 does not cover -------------------------
  // 03 §1 predates all four. 18-build-status.md §1 counts 24 domain services against 03's 22 for
  // exactly this reason, and each of these calls the reusable `service-ci.yml` and ships a
  // Dockerfile, so `service` is what they already behave as rather than what this file decided.
  service('emberkin', '19', 'Kindred: authoritative saves, campaign, party, catches, Resonance, battle engine, worlds integration'),
  service('foresight', '19', 'Prediction markets: registry and lifecycle, idea pipeline, contract deployment, positions, resolution, fees'),
  service('aetherholm', '20', 'World state, cities, economy, fleets, battles, seasons, the chronicle, the title contract'),
  service('tessera', '23', 'Wards, parcels, claims, objects, placements, the Kiln, presence, the title contract, authorship anchoring'),

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

  // -- 5 further frontends, from the same three documents --------------------------------------
  // 05-user-journeys.md §1 already records the correction: "there are FIFTEEN frontend surfaces,
  // not ten". Four of the five call the reusable `web-ci.yml`; `micro-tessera-web` had no workflow
  // at all when this entry was written, which is what a registry naming it makes visible.
  web('emberkin-web', '19', 'The Kindred Three.js client, on estate conventions, with the generated art'),
  web('foresight-web', '19', 'Browse, market detail with cited sources, stake, portfolio, claim'),
  web('foresight-admin-web', '19', 'Operator panel: idea queue, open/close/resolve/void, disputes. Folds into admin-web at P13'),
  web('aetherholm-web', '20', 'Archipelago map, city view, fleet control, battle reports, chronicle browser'),
  web('tessera-web', '23', 'Isometric renderer, build and place tools, the Kiln, the ward map, Workshop pages'),

  // -- 2 operator consoles, absent from this file until 2026-08-04 -----------------------------
  //
  // `lantern` and `beacon` are `ops()` services below, and their CONSOLES were never listed here
  // at all — so cfctl pinned neither, no publish job was ever added to either (both rollouts
  // worked from this registry), no image was ever built, and the first real deployment answered
  // 502 on both. The estate compose has run them the whole time; nothing reconciled the two lists.
  //
  // That is the failure this registry exists to prevent, so the omission is worth naming rather
  // than quietly fixing: a surface the estate SERVES but the release cannot DEPLOY is exactly the
  // gap `cfctl release --verify` is meant to make loud, and it stayed silent because a surface it
  // does not know about cannot be reported missing.
  //
  // Both are `adminOnly` in `ui/packages/ui/src/surfaces.ts` and both now render the shared footer.
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

  // -- 4 asset repositories -------------------------------------------------------------------
  // See `assets()` for why this is a kind rather than a library. All four are byte-identical in
  // shape — the same `materialise.py`, `MANIFEST.json`, `candidates/` and provenance layout — and
  // 24-asset-model-comparison.md treats them as one class, which is what that document is for.
  // The generated reference sets are PERMANENT by instruction: a challenger model writes to
  // `candidates/` and never over `assets/`.
  assets('brand', '—', 'Platform brand assets: 73 generated, grounds normalised to #12100f, per-asset provenance'),
  assets('emberkin-assets', '19', 'Kindred art: 83 assets from the visuals.json spec the game already ships'),
  assets('aetherholm-assets', '20', 'Art bible, canonical content trees, generated art with per-asset provenance'),
  assets('tessera-assets', '23', 'Ground, object and ward art, and the content JSON the engine and the prompts share'),

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

  // -- 3 further pieces of organisation machinery ----------------------------------------------
  // See `machinery()` for why these are `org` rather than `ops` or `library`. None builds an
  // image, none publishes a package, and none is a product: they are what the estate runs on.
  machinery('docs', '—', 'The ecosystem documentation. 03 §1.5 gave this to `stack`; it is its own repository now'),
  machinery('deploy', '—', 'Compose, gateway, OTel collector, Prometheus, Tempo, Loki, Grafana, Alertmanager, runbooks'),
  machinery('conformance', '—', 'The characterisation corpus, and the estate-wide sweeps estate-ci.yml runs against every repository'),

  // -- 2 operator consoles, absent from this file until 2026-08-04 -----------------------------
  //
  // APPENDED, not filed with the other frontends, and the comment above `DERIVED_PORT_ORDER` is
  // why: ports derive from position in `deployableRepos()`, so a row inserted mid-list renumbers
  // everything below it. I filed these tidily beside the other `web()` rows first, and the test
  // named exactly what that cost — `lantern` 4142, `beacon` 4143 and `faucet` 4144 all moved.
  // Appending is the only free edit. Tidiness is not worth renumbering a port another repository
  // has already written down.
  //
  // `lantern` and `beacon` are `ops()` services above; their CONSOLES were never listed here at
  // all. So cfctl pinned neither, no publish job was ever added to either (both rollouts worked
  // from this registry), no image was ever built, and the first real deployment answered 502 on
  // both. The estate compose has run them the whole time and nothing reconciled the two lists —
  // a surface the estate SERVES but a release cannot DEPLOY, which is precisely what
  // `cfctl release --verify` exists to catch and could not, because a surface this file does not
  // know about cannot be reported missing.
  //
  // Both are `adminOnly` in `ui/packages/ui/src/surfaces.ts`; both now render the shared footer.
  web('lantern-web', 'P3', 'Lantern console: log triage, fingerprints, browser errors and RUM. Operator-only'),
  web('beacon-web', 'P3', 'Beacon console: journeys, incidents, SLOs and the release gate. Operator-only'),

  // -- kept exactly as they are. NEVER managed, and now never managEABLE. -----------------------
  // These are in the list so that their absence from every cfctl operation is a stated decision
  // rather than an oversight. `kept()` is the only constructor that produces one, and it takes no
  // `managed` parameter — see the header for the three reasons that is a type rather than a flag.

  // 03 §1.5 — the existing estate, deliberately unchanged.
  //
  // `hearth`'s recorded path used to be `repos/hearth`, from the layout 03 describes. That has not
  // been true for a while: it is checked out as a SIBLING of every micro-* repository, and its
  // remote is `cloudsforge-online/hearth`. The stale path was not inert — `repoDir` resolved kept
  // rows under a searched-for stack root, so cfctl reported a repository that is right there as
  // absent. Nothing resolves a kept row now, which is both the fix and the guarantee.
  kept('hearth', 'hearth', 'micro/hearth', ORG_REMOTE('hearth'),
    'Chain node, EVM, consensus, P2P, miner, CLI, contracts. Public, external contributors, its own security policy'),
  kept('asset-forge', 'asset-forge', '—', ORG_REMOTE('asset-forge'),
    'Build-time CLI; the engine micro-studio wraps. Never deployed. Not checked out in this tree'),
  kept('stack', 'stack', '—', ORG_REMOTE('stack'),
    'The original monorepo. Frozen. Not checked out in this tree'),

  // 03 §1.7 — leaving. "NOTHING HAPPENS TO THEM": neither archived nor deleted nor renamed. They
  // stop receiving feature work once their micro-* successor exits its phase and stay deployable
  // indefinitely as the ROLLBACK TARGET, which is the reason a tool must not touch one.
  //
  // Listed for the crucible reason, and for a second one this file did not have before: with these
  // seven, `.github` is the ONLY repository in the organisation the registry does not name, and its
  // omission is argued four blocks above rather than merely true. A registry that accounts for 70
  // of 70 can answer "is this ours, and may anything write to it"; one that accounts for 46 cannot,
  // which is why estate-ci.yml derives its repository list from the GitHub API instead of from here.
  kept('platform', 'platform', '—', ORG_REMOTE('platform'), 'Leaving (03 §1.7). Succeeded by micro-identity and micro-admin-api'),
  kept('forge-pay', 'forge-pay', '—', ORG_REMOTE('forge-pay'), 'Leaving. Succeeded by micro-ledger, -wallet, -settlement, -pricing, -billing'),
  kept('forge-keyvault', 'forge-keyvault', '—', ORG_REMOTE('forge-keyvault'), 'Leaving. Succeeded by micro-custody'),
  kept('forge-mint', 'forge-mint', '—', ORG_REMOTE('forge-mint'), 'Leaving. Succeeded by micro-mint and micro-mint-web'),
  kept('crucible', 'crucible', '—', ORG_REMOTE('crucible'), 'Leaving. Succeeded by micro-trade and micro-trade-web'),
  kept('ninety-days-after', 'ninety-days-after', '—', ORG_REMOTE('ninety-days-after'), 'Leaving. Succeeded by micro-nda, micro-worlds and micro-worlds-web'),
  kept('shared-libs', 'shared-libs', '—', ORG_REMOTE('shared-libs'), 'Leaving. Succeeded by micro-runtime and micro-contracts'),

  // NOT A CLOUDSFORGE REPOSITORY. Read the header before touching this row.
  //
  // A mirror of `savvaniss/kindred-resonance`, checked out beside the estate because
  // `micro-emberkin` and `micro-emberkin-web` were copied forward out of it (19-new-products.md
  // §3: "the upstream repository is not modified"). 18-build-status.md §1 names it as one of the
  // two directories in this tree that are not `micro-` prefixed, and warns that a sweep assuming
  // the prefix "reports them as having no CI rather than as unmigrated".
  //
  // The `remote` field exists for this row. Every other entry's remote can be derived from `repo`
  // and the org; this one's cannot, and a reader who derived it would produce a URL under an
  // organisation that has no such repository — which is what a write would have been aimed at.
  kept('kindred-upstream', 'kindred-resonance', 'micro/kindred-upstream',
    'https://github.com/savvaniss/kindred-resonance.git',
    'KINDRED: Resonance upstream, owned by savvaniss. The source micro-emberkin was copied from. Never written to'),
];

export const ORG = process.env['CLOUDSFORGE_ORG'] ?? 'cloudsforge-online';

export const REGISTRY_PACKAGE_HOST = 'ghcr.io';

// Both of these return `ManagedRepo[]`, and that is the point rather than a nicety: they are the
// ONLY way to obtain a `ManagedRepo`, and every write path in cfctl demands one. A kept repository
// cannot be laundered into a write by filtering the registry differently, because the filter is
// what produces the type.
export function managedRepos(): readonly ManagedRepo[] {
  return REGISTRY.filter((repo): repo is ManagedRepo => repo.managed);
}

export function deployableRepos(): readonly ManagedRepo[] {
  return managedRepos().filter((repo) => repo.deployable);
}

export function repoByName(name: string): Repo | undefined {
  return REGISTRY.find((repo) => repo.name === name);
}

// `ManagedRepo`, not `Repo`: a kept repository must not be able to acquire a GHCR image name. The
// name is what a release manifest pins and what `--verify` pulls, so handing one to a repository
// this organisation does not build is the first half of deploying somebody else's code.
export function imageFor(repo: ManagedRepo): string {
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
