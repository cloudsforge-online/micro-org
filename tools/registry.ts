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
// names this file as the reason it derives its repository list from the GitHub API instead. All 78
// are here now — 67 managed, 11 kept — and `cfctl doctor` FAILS on a directory beside the estate
// that no row names, so the omission cannot happen quietly a third time.
//
// That count is maintained by hand and it had already drifted once: it read "70 … 59 managed" on
// 2026-08-09 while the file held 71 rows and 60 managed ones, because the two operator consoles
// were appended below and this paragraph was not touched. `test/cfctl.test.ts` asserts the real
// numbers, so the drift was in the prose and nowhere else — but a paragraph whose whole argument
// is "one list, and it is complete" cannot be allowed to miscount the list. Corrected then in the
// same change that added `pool` and `pool-web`, which took it from 71 to 73, and corrected again
// here at 78 — see the next paragraph, which is the third time the omission this file exists to
// prevent had happened and the first time the machinery caught it unaided.
//
// ── 73 → 78: THE FIVE WALLET CLIENTS, AND WHAT FIVE PERMANENT FAILURES COST (micro-org#352) ────
//
// `micro-hearth-wallet-core`, `micro-wallet-assets`, `micro-wallet-desktop`, `micro-wallet-extension`
// and `micro-wallet-mobile` are the five repositories 25-wallet-clients.md §9 creates. All five
// have been checked out beside the estate since 2026-08-06 and were named by no row here, so
// `cfctl doctor` reported five FAILs — measured 2026-08-10 while cutting 2.5.15, and still five
// on 2026-08-10 at the head of this branch.
//
// That is the check working, and it is also the check being spent. A failure that is always there
// is a failure nobody reads; a sixth, real one would have arrived into a list that already looked
// like that and been indistinguishable from the wallpaper. The seventeen-repository gap this file
// was widened to close was found by a person reading a second repository for an unrelated reason,
// which is the state doctor exists to end — and a permanently-red doctor returns the estate to it
// with a green-looking tool in the way.
//
// The five are three kinds, not one, and each is argued from what the repository IS rather than
// from the name it shares with the other four: see `library()` for the core, `assets()` for the
// art, and `client()` — new here — for the three shells.
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
//   3. **`imageFor` takes a `ReleasableRepo`**, so no kept repository can be given a GHCR name,
//      and `releasableRepos()` returns `ReleasableRepo[]`, so none can reach a release manifest.
//      (It took a `ManagedRepo` when this was written; the type narrowed further when the
//      absorbed rows arrived, and both refusals are the same mechanism. See `AbsorbedRepo`.)
//
// The type only binds rows whose `kind` is `kept`, and a misclassification — giving this
// directory `kind: 'service'` — would slip past all three. `cfctl.ts` carries the belt for that:
// every mutating git command goes through one function, and it refuses a checkout whose `origin`
// is not a repository of this organisation, naming the foreign remote it found.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Every kind cfctl may clone, pull, inspect or release. `kept` is deliberately not among them. */
export type ManagedKind = 'service' | 'web' | 'ops' | 'library' | 'assets' | 'client' | 'template' | 'org';

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
 * Where a client build is, and since when.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE MANIFEST'S QUESTION, ASKED OF THE THINGS THE MANIFEST CANNOT NAME (micro-org#352 item 3).
 *
 * A release manifest names 48 container images and answers, for each one, "which artifact, built
 * from which commit, is deployed". A desktop binary is not a container image, a browser extension
 * is not one, an Android bundle is not one — so the estate's single mechanism for saying what is
 * shipped could say NOTHING AT ALL about the three clients: not "shipped", not "not shipped", not
 * "shipped at what version". `releases/README.md` argues that a release must be a file rather than
 * a tag because "a release where one of the seven was forgotten looks exactly like a release where
 * it was not". These were forgotten by construction — they were not in the file, and there was no
 * file they could be in.
 *
 * The honest state today is **built, deliberately not distributed**, and until this field existed
 * that state was only INFERABLE — from five doctor failures whose message was about registry rows
 * and not about distribution at all. Deleting those five failures and adding nothing would have
 * made the estate quieter and less informed than before: a regression wearing a green tick.
 *
 * So it is recorded, and three properties make it hard to let drift:
 *
 *   1. **REQUIRED IN THE TYPE.** `ClientRepo` has no optional `distribution`, and `client()` takes
 *      it as a parameter with no default. A client row that answers nothing is a compile error, in
 *      the same way `kept(…, managed: true)` is. `ManifestService.digest` is "required in the type,
 *      empty-able in the file" for the same reason: the defect being fixed is a field nobody
 *      recorded, and making it a field a caller MAY forget rebuilds the defect one row at a time.
 *   2. **THE TWO STATES CARRY DIFFERENT FIELDS.** `none` has no artifact, no version and no commit,
 *      so "not distributed, at version 1.0.0" cannot be written. `distributed` requires all four,
 *      so "shipped, somewhere, somehow" cannot be either. A half-answer is not a value.
 *   3. **IT IS CHECKED AGAINST THE WORLD, NOT TRUSTED.** `cfctl clients` prints it beside the
 *      measured version and HEAD of each checkout; `cfctl clients --verify` asks GitHub what each
 *      client repository has actually published. A `none` record and a published release is the
 *      loud failure — see `distributionVerdict` in cfctl.ts, and the residual it names honestly.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export type Distribution =
  | {
      readonly state: 'none';
      /** ISO date the decision was recorded. Not the date the repository was created. */
      readonly since: string;
      /**
       * What has to exist before this can change — and every entry is OWNER-LEVEL.
       *
       * micro-org#352 item 2 says so in as many words: an extension needs a store listing and a
       * signing key, a desktop build needs code-signing and notarisation, a mobile build needs a
       * developer account. None of those is a thing a tool creates, and this field is the reason
       * the state is a recorded decision rather than an accident: an omission that is written down
       * is a decision, and one that is not is the crucible bug (see the header).
       */
      readonly blockedOn: readonly string[];
    }
  | {
      readonly state: 'distributed';
      /** ISO date this artifact went in front of users. */
      readonly since: string;
      /** Where a user gets it, spelled in full — a store URL, or the release page. */
      readonly channel: string;
      /** The artifact's exact published name. What `--verify` looks for, and what a user downloads. */
      readonly artifact: string;
      /** The client's package.json version when it was published. Matched against the release tag. */
      readonly version: string;
      /** The commit it was built from. The manifest's `commit`, for a thing that has no image. */
      readonly commit: string;
    };

/**
 * A repository cfctl may act on. Every write path in cfctl takes this type and not `Repo`.
 *
 * ── A UNION SINCE 2026-08-10, AND THE SPLIT IS LOAD-BEARING RATHER THAN TIDY ───────────────────
 *
 * This was one interface with `kind: ManagedKind`. Under that shape a row could be written inline
 * as `{ kind: 'client', … }` with no `distribution` at all and it would compile — the field would
 * be a convention, and a convention is what `foresight-admin-web`'s `deployable: true` was on a
 * kept row before `kept` became a type. Discriminated on `kind`, `kind: 'client'` selects the only
 * branch that exists for it, and that branch has no optional fields. There is no client row that
 * does not say where its build is.
 *
 * Nothing else moved. Both members carry every field `ManagedRepo` carried, so every signature in
 * cfctl that takes a `ManagedRepo` — `repoDir`, `inspect`, `gitWrite`, `cloneUrl` — takes both
 * members unchanged, and `managedRepos()` still returns the one type every write path demands.
 *
 * ── A THIRD MEMBER SINCE 2026-08-28: THE ROWS WHOSE CODE RUNS SOMEWHERE ELSE ────────────────────
 *
 * `AbsorbedRepo` joined it for the reason the split above exists: a state that must not be
 * writable as a flag. See that interface for the whole argument. `imageFor` no longer takes a
 * `ManagedRepo` — it takes `ReleasableRepo`, which is this union minus that member.
 */
export type ManagedRepo = NonClientRepo | ClientRepo | AbsorbedRepo;

/**
 * A managed repository that still publishes an image of its own, and may therefore be pinned.
 *
 * `ManagedRepo` minus `AbsorbedRepo`, written out rather than derived, because this is the type
 * `imageFor` takes and a reader chasing "what can reach a release manifest" should not have to
 * evaluate a conditional type to find out. `ClientRepo` is in it and is harmless: `deployable` is
 * the literal `false` there, so `deployableRepos()` never yields one and `cfctl release` never
 * asks it for an image.
 */
export type ReleasableRepo = NonClientRepo | ClientRepo;

/**
 * Everything managed that is not a client: service, web, ops, library, assets, template, org.
 *
 * The name is negative on purpose. The only thing these seven kinds have in common is that a user
 * never installs one — the estate runs them, publishes them or generates them — and a name that
 * claimed more than that ('estate', 'internal', 'hosted') would be wrong about at least two of
 * them. `library` and `assets` are neither run nor installed.
 */
export interface NonClientRepo extends RepoBase {
  readonly kind: Exclude<ManagedKind, 'client'>;
  readonly managed: true;
  /**
   * Whether this row takes a slot in the derived-port block. Libraries publish packages, assets
   * publish bytes, and neither publishes an image or binds a port.
   *
   * THIS FIELD USED TO SAY "whether a release manifest pins an image for it", AND THAT IS NO
   * LONGER THE SAME QUESTION. It was one question while the two answers could not differ; the
   * four absorbed rows are the case where they do, and the comment was silently wrong about them
   * for as long as it stood. `deployable` decides membership of `deployableRepos()`, which is
   * where POSITION — and therefore the port — is counted. What a manifest may pin is
   * `releasableRepos()`, which is that list minus the rows whose code now runs inside another
   * pod. See `AbsorbedRepo`.
   */
  readonly deployable: boolean;
  /**
   * Never set on this member. Declared so the union above is discriminated on a real field rather
   * than on a name, and so `repo.absorbedInto` can be READ on a `ManagedRepo` at all — without it
   * the filter that produces `ReleasableRepo` could not be written as a property test.
   */
  readonly absorbedInto?: undefined;
}

/**
 * A build a user installs, rather than a service the estate runs or a package a developer resolves.
 *
 * `deployable` is literal `false` rather than a field with a value, for the reason `KeptRepo` gives
 * for `managed`: it is one keystroke from `true` on a row, and nothing would notice until a release
 * manifest pinned `ghcr.io/<org>/micro-wallet-desktop` for an image that has never existed. See
 * `client()` for why no existing kind fits and what each wrong one would have broken.
 */
export interface ClientRepo extends RepoBase {
  readonly kind: 'client';
  readonly managed: true;
  readonly deployable: false;
  readonly distribution: Distribution;
  /** Never set. See the note on `NonClientRepo.absorbedInto`. A client has no pod to be absorbed into. */
  readonly absorbedInto?: undefined;
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
  /** Never set. See the note on `NonClientRepo.absorbedInto`. Nothing this programme does not manage can be absorbed. */
  readonly absorbedInto?: undefined;
}

/**
 * A repository whose CODE STILL RUNS AND WHOSE IMAGE NO LONGER DOES — it was merged into another
 * service's pod, and this row is what is left.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE YOU DELETE ONE OF THESE ROWS. DELETING IT MOVES PORTS.
 *
 * Four services were merged into others and the merges are deployed (release 2026.8.103):
 * `analytics` into `lantern`, `notify` into `activity`, `aetherholm` and `nda` into `emberkin`.
 * Their compose services are gone, `deploy/scripts/k8s-render.py`'s `MERGED_INTO` emits each as an
 * ExternalName alias so callers keep resolving, and no pod runs their images.
 *
 * The obvious edit is to delete the four rows. **It is the one edit this file cannot afford.**
 * Ports derive from POSITION in `deployableRepos()` (`portFor` in cfctl.ts: `4100 + index`), so
 * removing `analytics` at index 21 would pull all thirty rows beneath it down by one, and removing
 * all four would move forty-odd host ports that `deploy/compose/docker-compose.estate.yml` has
 * already written down and `deploy/scripts/estate-verify.sh` resolves as `${PB}NNN`. Nothing in
 * micro-org would notice; the estate would notice at the next deploy, on ports nobody changed.
 *
 * ── WHY THIS IS NOT THE TOMBSTONE THE `foresight-admin-web` BLOCK REFUSES ──────────────────────
 *
 * That block, further down, weighs the same two options and picks the other one: it deletes the
 * row, pays seven moved ports, and states plainly that "a tombstone row is worse than the shift"
 * because holding an index requires `deployable: true`, and `deployableRepos()` is ALSO what
 * `cfctl release` writes a manifest from — so the tombstone would pin a GHCR tag for a repository
 * that no longer publishes one.
 *
 * That reasoning was correct and its premise has been removed. It rests entirely on one list
 * answering two questions, and the two questions are now two functions: `deployableRepos()` is
 * position, `releasableRepos()` is what a manifest may name. A row can hold its index without
 * being pinned. The choice the earlier block faced no longer exists, which is why this file now
 * does the thing that block argued against — not because the argument was wrong, but because the
 * thing that made it true was fixed.
 *
 * `foresight-admin-web` is NOT retroactively restored, and the difference is real rather than
 * convenient: that repository is archived and its ports were already paid for, in the same change,
 * in micro-deploy. Reinstating it now would move the same seven numbers back.
 *
 * ── WHY IT CANNOT BE MARKED ABSORBED AND STILL REACH A MANIFEST ────────────────────────────────
 *
 * Three things, and the first two are the type rather than a rule anybody has to remember:
 *
 *   1. **`imageFor` takes `ReleasableRepo`, not `ManagedRepo`.** An `AbsorbedRepo` is not
 *      assignable to it — `absorbedInto: string` against `absorbedInto?: undefined` — so an
 *      absorbed row CANNOT BE GIVEN A GHCR IMAGE NAME. `ManifestService.image` is required, so a
 *      manifest entry for one is a compile error and not a review comment. This is the argument
 *      the header already makes for `kept`, applied to the one other row-shape that must never be
 *      pinned.
 *   2. **`deployable: true` IS THE LITERAL, with no constructor parameter.** The port slot is the
 *      whole reason the row survives, so `absorbed(…, deployable: false)` is not a value that can
 *      be written. A future tidy-up cannot silently renumber the block by flipping it.
 *   3. `cfctl bump` and `cfctl release` iterate `releasableRepos()`, and `test/cfctl.test.ts`
 *      asserts both that the four are absent from a generated manifest and that they still sit at
 *      their original indices with their original ports.
 *
 * ── WHAT AN ABSORBED ROW STILL IS ─────────────────────────────────────────────────────────────
 *
 * `managed: true`, and every word of that. cfctl still clones it, still pulls it, still reports it
 * in `cfctl list` and still runs `doctor` over it. The repository exists, the source is real, and
 * it is where the absorbed code came from. What stops is the three things that describe a
 * separately deployed artifact: it is not version-bumped, its image is not published (the publish
 * job is skipped in `.github/workflows/publish-image.yml`), and it is not pinned in a release.
 *
 * ARCHIVING THE GITHUB REPOSITORY IS A SEPARATE AND IRREVERSIBLE STEP, and it is not implied by
 * this row. When it happens, the row still cannot be deleted — the port hazard above is unchanged
 * by what GitHub thinks of the repository.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface AbsorbedRepo extends RepoBase {
  readonly kind: Exclude<ManagedKind, 'client'>;
  readonly managed: true;
  /**
   * The literal `true`, and it is load-bearing rather than vestigial: it is what holds this row's
   * slot in `deployableRepos()`, and the slot is what holds every port beneath it still. It does
   * NOT mean a manifest pins an image — see `NonClientRepo.deployable`, which no longer means that
   * either.
   */
  readonly deployable: true;
  /**
   * The registry name of the repository whose pod now runs this code. Required, and a name rather
   * than a boolean, because "absorbed" on its own is the fact that is useless six months later:
   * the question anyone actually has is where the code went, and `cfctl doctor` prints this
   * answer where it used to print a warning about a GHCR package that will never be published
   * again. `test/cfctl.test.ts` requires it to name a real, deployable, non-absorbed row.
   */
  readonly absorbedInto: string;
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

/**
 * A row whose code was merged into another service's pod. See `AbsorbedRepo` for the whole
 * argument, including why the row is not simply deleted.
 *
 * A CONSTRUCTOR AND NOT A FIELD ON `service()`, for the reason `kept()` takes no `managed`
 * parameter: the two states have different consequences and a caller who may pass either will
 * eventually pass the wrong one. `deployable` is fixed at `true` in the type here and there is no
 * argument for it, so the port slot cannot be dropped by accident; `into` is required, so
 * "absorbed into somewhere" is not a value.
 *
 * It keeps the row's original `kind` — all four are services and they still ARE services, run by
 * a different process. A kind of its own would make `cfctl list --kind service` lie about four
 * repositories and would drop them out of doctor's bespoke-CI check, which still applies: the
 * source is still there and still builds.
 */
function absorbed(
  name: string,
  phase: string,
  into: string,
  owns: string,
  // Wave M5c absorbed `lantern`, which is an `ops` repository rather than a
  // service. Defaulting to 'service' keeps every existing call identical; passing
  // it explicitly stops an absorbed ops repo from silently becoming a service,
  // which is a fact other readers group by.
  kind: AbsorbedRepo['kind'] = 'service',
): AbsorbedRepo {
  return {
    name,
    repo: `micro-${name}`,
    kind,
    phase,
    path: `micro/${name}`,
    managed: true,
    deployable: true,
    absorbedInto: into,
    owns,
  };
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
 * A wallet client: a build a USER INSTALLS, on a machine this estate does not own.
 *
 * Its own kind because none of the seven that existed fits, and the wrong ones fail in ways this
 * file has already paid for once. Measured on the three repositories this constructor is for, all
 * on 2026-08-10: `micro-wallet-desktop` 0.1.0, `micro-wallet-extension` 1.0.0 and
 * `micro-wallet-mobile` 0.1.0 are each `"private": true`, with no `main`, no `files`, no exports
 * map and no Dockerfile. They publish no package, build no container image, and are served by no
 * gateway.
 *
 *   * NOT `web` OR `service`. Both set `deployable: true`, which would put
 *     `ghcr.io/<org>/micro-wallet-desktop` into the next release manifest for an image that has
 *     never existed — the exact failure the `foresight-admin-web` tombstone argument below refuses
 *     ("a release manifest pinning a retired console, which nothing would catch until a deploy")
 *     and the one `assets()` states in its own words ("a release manifest that named one would be
 *     pinning a tag that cannot be pulled"). It would also consume three numbers from the derived
 *     port block, for three programmes that never bind a port. 25-wallet-clients.md §10.2 says the
 *     same thing from the other side: "They are clients. They are not services, they have no
 *     database, they are not in the registry's deployable set, and they consume no port from the
 *     derived block."
 *   * NOT `library`. 03 §1.4 defines a library repository as one that PUBLISHES PACKAGES, and all
 *     three are private. `library` is also the kind `cfctl doctor` builds its "which @cloudsforge
 *     package can a consumer resolve" map from (`localPackageVersions` in cfctl.ts), so a private
 *     application's version would become an answer to a question nobody asked — `assets()` refuses
 *     `library` for that same second reason.
 *   * NOT `ops` OR `org`. Both mean machinery the estate runs for itself. These run on a user's
 *     laptop and phone, and the whole point of 25 §1 is that the platform cannot reach them: "this
 *     is the wallet where YOU hold the key and the platform cannot move your money".
 *
 * What a client actually is, mechanically: a fourth consumption mechanism, next to "pull an image",
 * "install a package" and — `assets()`'s third — "materialise a set of bytes by identity". A user
 * downloads and installs it, from a store or a signed file, and after that the estate has no way to
 * move it. That is why `distribution` is a required field and not a nicety: for the other three
 * mechanisms the estate can ASK what is out there (GHCR serves a digest, a registry serves a
 * version, a manifest names a file), and for this one it cannot. What is in front of users is a
 * fact somebody has to write down.
 *
 * `managed: true` — cfctl clones and pulls these, exactly as it does the other 64. They are this
 * organisation's repositories, their remotes are `cloudsforge-online/micro-wallet-*`, and there is
 * nothing about "a user installs it" that makes a fast-forward dangerous.
 *
 * `deployable: false` IN THE CONSTRUCTOR AND IN THE TYPE, with no parameter for it. `ClientRepo`
 * declares it as the literal `false`, so a future edit cannot flip it on one row: `client(…)` has
 * no argument to pass and `{ kind: 'client', deployable: true }` does not type-check. The header's
 * argument for `kept` applies unchanged — a flag is one keystroke from wrong and nothing notices.
 *
 * CI is not checked for these, and that is a decision rather than an oversight: `cfctl doctor`'s
 * bespoke-CI check names the kinds it applies to (service, web, ops, library) and `client` is not
 * among them. `service-ci.yml` asserts /livez, /readyz, /metrics and a Dockerfile, and `web-ci.yml`
 * asserts an nginx image; a Tauri build, an MV3 bundle and a React Native bundle satisfy none of
 * those and forcing them through would mean weakening the rules for everyone else — the argument
 * `micro-hearth-wallet-core`'s own ci.yml already makes for a library. All three do call the
 * reusable `secret-hygiene.yml`, which is the check that applies to any repository whatever it is.
 */
function client(name: string, phase: string, distribution: Distribution, owns: string): ClientRepo {
  return {
    name,
    repo: `micro-${name}`,
    kind: 'client',
    phase,
    path: `micro/${name}`,
    managed: true,
    deployable: false,
    distribution,
    owns,
  };
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
  absorbed('policy', 'P5', 'agora', 'Rules, limits, velocity counters, trusted addresses, cooling-off, approvals, freezes'),
  service('ledger', 'P4', 'Chart of accounts, journal, postings, balances projection, reservations, reconciliation'),
  service('wallet', 'P4', 'Wallet registry, external links, deposit addresses, withdrawals, conversions, portfolio'),
  service('settlement', 'P4', 'Treasuries, sweeps, outbound transactions, broadcast, confirmation tracking'),
  absorbed('pricing', 'P4', 'agora', 'Market sources, median oracle, administered prices, rate history, valuation'),
  absorbed('billing', 'P4', 'agora', 'Products, prices, entitlements, subscriptions, usage, invoices, payouts, revenue share'),
  service('custody', 'P5', 'HD seeds, key generation, encryption envelope, signing policy, treasury pins, export'),
  service('indexer', 'P5', 'Blocks, transactions, receipts, logs, balances, transfers, reorgs, provider health'),
  absorbed('activity', 'P6', 'agora', 'Canonical activity records, event inbox, feed cursors, feed query API'),
  // ABSORBED — runs inside `activity`, still holds index 10 and port 4110. Read `AbsorbedRepo`
  // before touching this line: deleting the row moves every port beneath it. `owns` is unchanged
  // and still true; what changed is which pod executes it.
  absorbed('notify', 'P13', 'agora', 'Preferences, templates, notifications, deliveries, digests, webhooks, broadcasts'),
  absorbed('studio', 'P8', 'agora', 'Brand kits, asset specs, generation jobs, generated assets, generation credits'),
  absorbed('mint', 'P3', 'agora', 'Token orders, deployment lifecycle, token registry, token pages, contract templates'),
  absorbed('market', 'P9', 'agora', 'Listings, offers, auctions, orders, escrow refs, collections, moderation, disputes'),
  service('trade', 'P3', 'Strategy catalogue, backtests, bots, fills, allocations, fee settlement, performance'),
  absorbed('worlds', 'P5', 'agora', 'Title registry, player profile, inventory, achievements, seasons, entitlement bridge'),
  // ABSORBED — runs inside `emberkin`, still holds index 16 and port 4116. See `AbsorbedRepo`.
  absorbed('nda', 'P5', 'emberkin', 'Ninety Days After: worlds, tiles, players, resolution engine, communes, objectives'),
  absorbed('community', 'P12', 'agora', 'Communities, roles, treasury accounts, proposals, votes, delegations, timelocks'),
  absorbed('devplatform', 'P11', 'agora', 'Developer orgs, projects, API keys, OAuth clients, webhooks, quotas, directory'),
  service('hub-api', 'P6', 'Forge Hub BFF: dashboard aggregation, portfolio composition, search, saved views'),
  service('admin-api', 'P13', 'Operator BFF: cross-service actions, approvals, audit mirror, flags, broadcasts'),
  // ABSORBED — runs inside `lantern`, still holds index 21 and port 4121. It is the LAST row of
  // the 03 §1.1 block, so deleting it would move the four services below and everything after
  // them. See `AbsorbedRepo`.
  absorbed('analytics', 'P13', 'agora', 'Pseudonymised product event store, funnels, cohorts, retention, metric definitions'),

  // -- 4 further domain services, added by documents 03 does not cover -------------------------
  // 03 §1 predates all four. 18-build-status.md §1 counts 24 domain services against 03's 22 for
  // exactly this reason, and each of these calls the reusable `service-ci.yml` and ships a
  // Dockerfile, so `service` is what they already behave as rather than what this file decided.
  service('emberkin', '19', 'Kindred: authoritative saves, campaign, party, catches, Resonance, battle engine, worlds integration'),
  absorbed('foresight', '19', 'agora', 'Prediction markets: registry and lifecycle, idea pipeline, contract deployment, positions, resolution, fees'),
  // ABSORBED — runs inside `emberkin`, still holds index 24 and port 4124. See `AbsorbedRepo`.
  absorbed('aetherholm', '20', 'emberkin', 'World state, cities, economy, fleets, battles, seasons, the chronicle, the title contract'),
  absorbed('tessera', '23', 'agora', 'Wards, parcels, claims, objects, placements, the Kiln, presence, the title contract, authorship anchoring'),

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
  // `foresight-admin-web` was a row here, and P13 happened. Its own blurb named the date —
  // "Folds into admin-web at P13" — and the panel is now a section inside `micro-admin-web`
  // (`/foresight`), so there is no repository left to deploy. The GitHub repository is ARCHIVED
  // rather than deleted and its published images stay in the registry, because deleting a
  // published tag breaks anyone who pinned it.
  //
  // ── REMOVING IT MOVED SEVEN PORTS, AND THAT WAS THE DECISION RATHER THAN THE ACCIDENT ───────
  //
  // The row was at index 39, so `aetherholm-web`, `tessera-web`, `lantern`, `beacon`, `faucet`,
  // `lantern-web` and `beacon-web` each derive one lower than before — 4140→4139 down to
  // 4146→4145. `DERIVED_PORT_ORDER` in test/cfctl.test.ts went red naming every one, which is
  // exactly what that test is for, and it was updated as a stated decision rather than to make
  // red go green. micro-deploy's compose pins and `estate-verify.sh` moved in the same change,
  // and `scripts/web-check.py` there proves the two agree.
  //
  // ── THE ALTERNATIVE WAS A TOMBSTONE ROW, AND IT WAS WORSE *THEN* ────────────────────────────
  //
  // A row kept in place purely to hold index 39 would have to stay `deployable: true` to occupy a
  // port at all, because `deployableRepos()` is what the position is counted in. But that list is
  // also what `cfctl release` builds a manifest from and what `--verify` pulls — so the tombstone
  // would put `ghcr.io/<org>/micro-foresight-admin-web` into the next release, for a repository
  // that no longer builds an image. `assets()` above states the same rule for the same reason:
  // "a release manifest that named one would be pinning a tag that cannot be pulled."
  //
  // So the choice was between seven derived numbers moving, which a test names and a script
  // verifies, and a release manifest pinning a retired console, which nothing would catch until a
  // deploy. Seven numbers moved.
  //
  // ── AND THE PREMISE WAS REMOVED ON 2026-08-28. DO NOT CITE THIS BLOCK AS PRECEDENT ──────────
  //
  // Every word above turns on ONE list answering TWO questions — "where is the port" and "what
  // does a release pin". They are two functions now: `deployableRepos()` is position,
  // `releasableRepos()` is what a manifest may name, and `imageFor` takes a type an absorbed row
  // cannot satisfy. A row CAN now hold its index without being pinned, so the dilemma this block
  // resolves no longer arises — and four rows (`analytics`, `notify`, `aetherholm`, `nda`) do
  // exactly the thing it argues against, safely. See `AbsorbedRepo`.
  //
  // This row is still not restored, and that is a decision rather than an oversight: the console
  // is archived, and its seven numbers were already moved and PAID FOR in micro-deploy in the same
  // change. Putting it back would move the same seven again, to un-fix something that is not
  // broken. The lesson that survives is the narrow one — deleting a deployable row moves ports —
  // and it is the reason the four absorbed rows stayed.
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
  absorbed('lantern', 'P3', 'agora', 'Log triage: OTLP push ingest, fingerprinting, browser errors and RUM', 'ops'),
  ops('beacon', 'P3', 'Synthetic monitoring, journeys, incidents, SLOs. The release gate (AD-04)'),
  ops('faucet', 'P3', 'Testnet EMBER faucet'),

  // -- 5 library repositories (03 §1.4, plus one it predates) ----------------------------------
  // Phases: 03 §1.4 gives no phase column, because a library repository has no split of its own.
  // The phase recorded here is the phase of its first consumer, which is what makes it blocking.
  library('contracts', 'P2', '@cloudsforge/contracts-auth, -money, -chain, -market, -worlds, -create, -events, -devplatform'),
  library('runtime', 'P2', '@cloudsforge/telemetry, -http, -jobs, -auth, -db, -lifecycle, -policy-client'),
  library('ui', 'P2', '@cloudsforge/ui, @cloudsforge/ui-charts'),
  library('sdk', 'P11', '@cloudsforge/sdk, @cloudsforge/cli — public, generated from the public OpenAPI'),
  // -- a fifth library, from 25-wallet-clients.md §3 -------------------------------------------
  //
  // `library` ON THE EVIDENCE, NOT ON THE NAME IT SHARES WITH THE THREE CLIENTS BELOW. 03 §1.4
  // defines a library repository as one that PUBLISHES PACKAGES, and this is the only one of the
  // five wallet repositories that does. Measured 2026-08-10: `package.json` is
  // `@cloudsforge/hearth-wallet-core@1.0.0`, it has NO `"private": true`, it carries
  // `files: ["dist", "src", "!src/**/*.test.ts"]` and a `prepack` script, and all three clients
  // resolve it as a dependency — two by `link:` to the sibling checkout and one by a pinned
  // `github:` ref. That is a package with consumers, which is the whole of the test.
  //
  // The kind is not cosmetic here: `library` is what puts a repository into `cfctl doctor`'s
  // "which @cloudsforge package can a consumer resolve" map (`localPackageVersions` in cfctl.ts),
  // and this package has three consumers whose ranges doctor should be evaluating. `assets()`
  // refuses `library` precisely BECAUSE nothing resolves an asset repository; the same sentence
  // read the other way is why this row is one.
  //
  // Its package name is added to ALLOWED_SCOPED_PACKAGES below and to service-ci.yml's
  // `allow-match` in the same change. Without that, registering the three clients would have
  // traded five doctor FAILs for three: `@cloudsforge/hearth-wallet-core` is in the scope, and
  // doctor fails any manifest importing a scoped name the estate has not declared. The list is
  // kept in one place "so service-ci.yml and cfctl doctor cannot disagree about it", and they
  // disagreed for four days over `@cloudsforge/secrets` when somebody edited one copy.
  //
  // No image, no port, `deployable: false` from `library()` — it is pure TypeScript with zero
  // runtime dependencies, no Node built-ins and no DOM, because 25 §3 requires it to run unmodified
  // inside a Tauri webview, a React Native JSI context and an MV3 service worker.
  library('hearth-wallet-core', '25', '@cloudsforge/hearth-wallet-core — BIP-39/32/44, secp256k1, keccak, RLP, EIP-155/1559/712, the keystore, and the differential suite against hearth/node'),

  // -- 5 asset repositories -------------------------------------------------------------------
  // See `assets()` for why this is a kind rather than a library. All five are byte-identical in
  // shape — the same `materialise.py`, `MANIFEST.json`, `candidates/` and provenance layout — and
  // 24-asset-model-comparison.md treats them as one class, which is what that document is for.
  // (Four until 2026-08-10; `wallet-assets` is the fifth and its evidence is beside its row.)
  // The generated reference sets are PERMANENT by instruction: a challenger model writes to
  // `candidates/` and never over `assets/`.
  assets('brand', '—', 'Platform brand assets: 73 generated, grounds normalised to #12100f, per-asset provenance'),
  assets('emberkin-assets', '19', 'Kindred art: 83 assets from the visuals.json spec the game already ships'),
  assets('aetherholm-assets', '20', 'Art bible, canonical content trees, generated art with per-asset provenance'),
  assets('tessera-assets', '23', 'Ground, object and ward art, and the content JSON the engine and the prompts share'),
  // The fifth, and `assets()`'s own docstring already states the test it passes. Measured
  // 2026-08-10: `micro-wallet-assets` has NO `package.json` at all — so it is not a library and
  // not a client, because there is no package to publish and no build to install — and it holds
  // `MANIFEST.json`, `assets/`, `content/`, `PLAN.json`, `LICENSE-ASSETS` and the same
  // generate/verify/normalise Python layout the other four carry. It is "a set of bytes resolved
  // by identity": a consumer runs the materialise step and holds a committed copy under its own
  // path, which is exactly what the three clients above it do (`sync-art` and `prove:art` are
  // scripts in all three of their package.json files).
  //
  // 25-wallet-clients.md §9 lists it beside the four client repositories, and that is a table of
  // what to CREATE rather than a claim about kind. The layout on disk is the evidence, and it is
  // byte-for-byte the shape 24-asset-model-comparison.md treats as one class.
  assets('wallet-assets', '25', 'Wallet icons, illustrations and store assets in both model sets, with per-asset provenance and a plan derived from content/'),

  // -- 3 wallet clients, from 25-wallet-clients.md §4 and §9 ------------------------------------
  //
  // FILED TIDILY RATHER THAN APPENDED, AND — UNLIKE THE TWO BLOCKS BELOW — THAT COST NOTHING.
  //
  // The operator consoles and the pool rows both had to be appended, and each block says why:
  // ports derive from POSITION IN `deployableRepos()`, so a `web()` or `service()` inserted
  // mid-list renumbers every derived port beneath it, including numbers micro-deploy's compose has
  // already written down. That rule bites on DEPLOYABLE rows and only on those, because
  // `deployableRepos()` filters `deployable` before position is counted at all.
  //
  // All five wallet rows are `deployable: false` — the three here by the literal in `ClientRepo`,
  // the core by `library()`, the art by `assets()` — so none of them enters that list, and the
  // list's order is untouched wherever they sit. Verified rather than reasoned: `DERIVED_PORT_ORDER`
  // in test/cfctl.test.ts pins all 48 derived names in order and stayed green through this change,
  // with `deployableRepos().length` still 48 and `pool-web` still last at 4147.
  //
  // So the reader learns the rule rather than the exception: appending is the only free edit FOR A
  // DEPLOYABLE ROW. A row that cannot reach a manifest can go where it belongs.
  //
  // `phase: '25'` follows the convention `RepoBase.phase` documents for repositories 03 §1 does not
  // enumerate — the ecosystem document that CREATES it, as `19`, `20`, `23` and `36` already do.
  // 03 §1 predates all five and is not corrected for them: it is the P2-era target set of 46, and
  // it names none of emberkin, foresight, aetherholm, tessera, pool or the two operator consoles
  // either.
  //
  // Each row's `distribution` is the answer to the question a release manifest asks and cannot ask
  // of these — see `Distribution` above. Today all three answer `none`, with a date and with the
  // owner-level thing each is waiting on. `cfctl clients` prints it; `cfctl clients --verify` asks
  // GitHub whether it is still true.
  client(
    'wallet-desktop',
    '25',
    {
      state: 'none',
      since: '2026-08-10',
      // 25 §8 sequences desktop third, after the extension. None of these is a tool's decision.
      blockedOn: [
        'an Apple Developer ID certificate, for signing the macOS build',
        'Apple notarisation, without which macOS Gatekeeper refuses the .dmg',
        'a Windows Authenticode certificate, without which SmartScreen warns on every install',
      ],
    },
    'Tauri v2 for Windows, macOS and Linux, the bundled Hearth node, and the desktop send/receive/token surfaces',
  ),
  client(
    'wallet-extension',
    '25',
    {
      state: 'none',
      since: '2026-08-10',
      // 25 §8 makes this phase 2 — "the fastest path to a real user doing a real thing" — so it is
      // the row most likely to change state first, and the one this record most needs to be right
      // about. §8 also notes that store listings GATE submission, which is why the asset repository
      // above is a dependency of shipping rather than of building.
      blockedOn: [
        'a Chrome Web Store developer account and a published listing',
        'an addons.mozilla.org account, for the signed Firefox build',
        'a signing key held somewhere the estate has decided on',
      ],
    },
    'MV3 for Chrome, Firefox, Opera and Edge, and the EIP-1193 and EIP-6963 provider',
  ),
  client(
    'wallet-mobile',
    '25',
    {
      state: 'none',
      since: '2026-08-10',
      blockedOn: [
        'a Google Play developer account and an upload key',
        'an Apple Developer Program membership, for TestFlight and the App Store',
      ],
    },
    'React Native for Android and iOS, with native secure storage holding the keys',
  ),

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

  // -- the mining pool and its console, created by 36-multi-chain-and-mining-pool.md ------------
  //
  // APPENDED for the reason the block above states and this one will not restate: ports derive
  // from position in `deployableRepos()`. `pool` is a `service()` and `pool-web` is a `web()`, and
  // filed with their kinds they would have sat at indices 26 and 44, moving every derived port
  // below them — including `lantern` 4142 and `beacon` 4143, which micro-deploy's compose has
  // already written down. They derive 4146 and 4147 here instead, and nothing moves.
  //
  // `phase: '36'` follows the convention `RepoBase.phase` documents for the repositories 03 §1
  // does not enumerate: the ecosystem document that CREATES it, as `19`, `20` and `23` already do.
  //
  // Why `service` and not `ops`: the same test `machinery()` states. `ops` here means an operations
  // service the estate runs FOR ITSELF — lantern, beacon, faucet. A mining pool is a product
  // surface that miners outside the estate connect to over raw TCP, it has its own Postgres schema
  // and migrations, and it ships a Dockerfile and calls `service-ci.yml` exactly as the other
  // twenty-six do. `service` is what it already behaves as rather than what this file decided.
  //
  // One thing this row does NOT claim: that the pool pays anybody. micro-pool records a PPLNS debt
  // and stops — `src/payouts.ts` is a typed seam that throws, and there is deliberately no payouts
  // table. `owns` says "accounting" and not "payouts" for that reason, because `cfctl list` prints
  // this string and it is the shortest description of the service most readers will ever see.
  service('pool', '36', 'Stratum v1 mining pool: getblocktemplate, vardiff, share validation, block submission, PPLNS accounting'),
  web('pool-web', '36', 'Pool console: connection details, hashrate and share charts, worker list, blocks found, per-miner earnings'),

  // -- Forge Exchange's frontend, created by 39-forge-exchange.md §6 phase H --------------------
  //
  // APPENDED, for the rule the two blocks above state and this one will not restate a third time.
  // It derives 4148 and nothing above it moves.
  //
  // THERE IS NO `service('exchange', …)` BESIDE IT, AND THAT ABSENCE IS THE ROW'S MAIN FACT. Every
  // other `web()` in this file has a service somewhere in this list that it reads; this one is the
  // first deployable frontend in the estate whose entire data source is a chain. Forge Exchange is
  // a factory, a router and WEMBER deployed on Hearth (phase F, booked); `micro-exchange-web`
  // reads them with `eth_call` against `rpc.<apex>` from the reader's own browser. An AMM's whole
  // state is four numbers in a pair contract, so a service in front of them could only ever be a
  // cache that is wrong between blocks — 39 §2 argues that at length and this row follows it.
  //
  // THE DERIVED PORT IS THE ONE THING THIS ROW PRODUCES THAT NOTHING USES, and it is worth saying
  // so rather than letting somebody discover it. 4148 is `4100 + index`, the address of a SERVICE
  // on a developer's machine, and there is no service. The port this bundle actually answers on in
  // a checkout is 5194 — its vite dev server, recorded in the surface registry's `devPort` — and
  // in the estate it is `exchange-web:8080` behind the gateway, resolved by container name. The
  // derived number exists because the derivation is positional and unconditional, not because
  // anything dials it. `web-check.py` fails on a CHOSEN port in the derived block, so the honest
  // move is to let it derive and say plainly that nothing calls it.
  //
  // `phase: '39'` follows the convention `RepoBase.phase` documents for repositories 03 §1 does not
  // enumerate: the ecosystem document that CREATES it, as `19`, `20`, `23`, `25` and `36` do.
  //
  // `owns` says "no custody, no account" because `cfctl list` prints this string and it is the
  // shortest description most readers will ever see of a surface that asks strangers to sign
  // transactions. A description that left it out would be the one place in the estate where that
  // claim is missing.
  web('exchange-web', '39', 'Forge Exchange: swap against constant-product pools on Hearth, every market the factory has made, and the contract checks re-run in the browser. No custody, no account'),

  // -- Forge Journal, created by 40-forge-journal.md ---------------------------------------------
  //
  // APPENDED, for the rule the blocks above state and this one will not restate. It derives 4149
  // and nothing above it moves.
  //
  // THE SECOND `web()` IN THIS FILE WITH NO SERVICE BESIDE IT, and for a different reason from
  // `exchange-web`'s. The exchange has no service because its state lives on a chain. The Journal
  // has none because its state is IN THE FRONTEND REPOSITORY: every article is a typed module under
  // `src/content/articles/`, and the build renders each one to a static HTML file. That is not a
  // shortcut around writing a CMS; it is the only architecture that answers the requirement the
  // surface exists for. A blog whose article HTML is assembled by JavaScript after load hands every
  // link-preview fetcher — none of which run scripts — one identical card for every article, and
  // hands a crawler a document whose `<title>` is the site's rather than the piece's. micro-site
  // documents that exact limitation in its own `index.html` and lives with it, because a marketing
  // site has eleven addresses. An editorial surface cannot.
  //
  // So `owns` names prerendering first: it is the single fact that decides whether this surface can
  // do its job, and `cfctl list` prints this string.
  web('journal-web', '40', 'Forge Journal: the public editorial surface. Every article prerendered to its own HTML with its own title, description, card and Article JSON-LD; RSS and a sitemap generated from the same content'),

  // -- Forge Agora, created by 41-forge-agora.md -------------------------------------------------
  //
  // APPENDED, and this pair is the reason the append-only rule is written down rather than assumed:
  // two rows land together, so they derive 4150 and 4151, and every index above them is untouched.
  // Inserting them anywhere else would have renumbered the two rows above and silently moved a
  // developer's `journal-web` off the port their shell history dials.
  //
  // A SERVICE *AND* A FRONTEND, which the two rows above it deliberately are not. The exchange has
  // no service because its state is on a chain; the Journal has none because its state is in the
  // repository. Agora has one because its state is neither: it is what strangers typed a minute
  // ago, and there is no chain and no build step that can hold that. Everything that makes this
  // surface hard — a bar that has to be enforced on every read path, a rate limit that has to
  // survive a restart, a notification that must not become an email nobody asked for — is server
  // work, and 41 §4 makes each of them a test rather than an intention.
  //
  // `owns` names the refusals rather than the features, because `cfctl list` prints this string and
  // a one-line description of a social network that says "posts, replies, follows" describes forty
  // other products. What is actually distinctive here is what it will not do: there is no ranked
  // feed, and nothing counts an audience in public. Both are enforced (41 §4.1, §4.2), and a reader
  // deciding whether this row is the thing they are looking for is better served by the constraint
  // than by the feature list.
  service('agora', '41', 'Forge Agora: voices, posts, replies, quotes, echoes, sparks, follows, circles, tags, whispers, notifications and moderation. Reverse-chronological only — no ranked feed, and no audience count is ever public'),
  web('agora-web', '41', 'Forge Agora: the public square. Composing, reading and moderating conversation on one account, with an explicit control to load more rather than a feed that never ends'),

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

/**
 * THE PORT BLOCK. Membership AND ORDER are a published interface, not an implementation detail.
 *
 * `portFor` is `4100 + index in this list`, so this function's output order is written down in
 * `deploy/compose/docker-compose.estate.yml`, in `deploy/scripts/estate-verify.sh` as `${PB}NNN`,
 * and in `DERIVED_PORT_ORDER` in test/cfctl.test.ts, which pins every name against its index.
 * Appending is free. Inserting and DELETING are not, and deleting is the one that looks harmless.
 *
 * It still contains the four absorbed rows, and that is the point of them: they hold their slots.
 * This list is no longer the answer to "what does a release pin" — that is `releasableRepos()`.
 */
export function deployableRepos(): readonly ManagedRepo[] {
  return managedRepos().filter((repo) => repo.deployable);
}

/**
 * What a release manifest may name, and what `cfctl bump` may version-bump: the port block minus
 * the rows whose code runs inside somebody else's pod.
 *
 * ONE LIST WAS ANSWERING TWO QUESTIONS. `deployableRepos()` decided both "where is this row's
 * port" and "is this row a separately shipped artifact", which was the same question until four
 * services were merged into others and stayed in the list to keep their ports. After that it was
 * the wrong answer to the second question, four times over, on every release: `cfctl bump`
 * version-bumped four repositories nothing deploys, each push published an image nobody pulls, and
 * `releases/*.yaml` described a 52-service estate that runs 31 Deployments. A manifest that names
 * four images no pod runs is the same defect as one that forgets a service — in both cases the
 * file has stopped being the record of what is deployed.
 *
 * `ReleasableRepo[]`, and the filter is what produces the type — the sentence `managedRepos()`
 * already makes about `managed`. Because `imageFor` takes exactly this type, a row that skips this
 * function cannot be given an image name to put in a manifest with.
 */
export function releasableRepos(): readonly ReleasableRepo[] {
  return deployableRepos().filter((repo): repo is ReleasableRepo => repo.absorbedInto === undefined);
}

/**
 * The rows whose code runs somewhere else, so that "which four, and where did they go" is a
 * question with one answer rather than a grep.
 *
 * Read by `cfctl doctor`, which reports an absorbed row instead of warning that its GHCR package
 * looks unpublished — a warning that would become true and stay true the moment publishing stops,
 * and a permanently-true warning is the "check being spent" failure the header describes.
 */
export function absorbedRepos(): readonly AbsorbedRepo[] {
  return managedRepos().filter((repo): repo is AbsorbedRepo => repo.absorbedInto !== undefined);
}

/**
 * The rows that answer "what is in front of users", because they are the only rows the question
 * applies to.
 *
 * Narrowed on `kind` and not on a hand-written predicate over a wider type: `ManagedRepo` is a
 * union discriminated on exactly that field, so this returns `ClientRepo[]` because the compiler
 * agrees rather than because this function asserts it. `managedRepos()` above says the same thing
 * about `managed`, and for the same reason — "the filter is what produces the type".
 *
 * `micro-hearth-wallet-core` and `micro-wallet-assets` are deliberately NOT here. A user never
 * installs either: the core is a package three clients resolve, the art is bytes they materialise.
 * Asking "which artifact is in front of users" of a library is asking a question whose answer is
 * always the client that embedded it, which is the answer this list already gives.
 */
export function clientRepos(): readonly ClientRepo[] {
  return managedRepos().filter((repo): repo is ClientRepo => repo.kind === 'client');
}

export function repoByName(name: string): Repo | undefined {
  return REGISTRY.find((repo) => repo.name === name);
}

// `ReleasableRepo`, not `Repo` and no longer `ManagedRepo`. The name is what a release manifest
// pins and what `--verify` pulls, so it is refused to both row-shapes that must never be pinned,
// for two different reasons:
//
//   * a KEPT repository, because this organisation does not build it — handing one a GHCR name is
//     the first half of deploying somebody else's code;
//   * an ABSORBED repository, because nothing publishes that image any more. `--verify` would pull
//     a tag that stops moving today and stops resolving whenever the package is cleaned up, and it
//     would fail on the day of a rollback rather than on the day of the mistake.
//
// Refused in the TYPE both times, which is the only way it stays refused: `AbsorbedRepo` carries
// `absorbedInto: string` and this parameter requires `absorbedInto?: undefined`, so the call does
// not compile. That is what makes "an absorbed row cannot reach a manifest" a property of the
// program rather than of the current shape of `cmdRelease`.
export function imageFor(repo: ReleasableRepo): string {
  return `${REGISTRY_PACKAGE_HOST}/${ORG}/${repo.repo}`;
}

// The packages a repository is allowed to import from the @cloudsforge scope. Anything else in
// that scope is a cross-service source import wearing a package name, which rule 2 of 03 §2
// forbids. Kept here so service-ci.yml and cfctl doctor cannot disagree about it.
//
// They disagreed anyway, for four days. `@cloudsforge/secrets` was extracted into
// runtime/packages on 2026-08-05 and added to the `allowed=` list in service-ci.yml, and not
// here — so CI passed every service that imported it while `cfctl doctor` failed all of them:
// 36 failures on 2026-08-09, one per manifest, every one of them wrong. A stale allowlist does
// not fail loudly, it fails *usefully-looking*, and 36 identical FAIL lines are indistinguishable
// from a real rule at a glance, which is how they survived a release.
//
// The claim "kept here so they cannot disagree" is now checked rather than asserted:
// test/cfctl.test.ts parses the `allowed=` alternation out of service-ci.yml and requires it to
// be this list, so the next package to be extracted cannot be added to one copy alone.
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
  // Added 2026-08-27, LATE — wave M0 of docs/service-merge-plan.md created the package and had
  // five services adopt it (wallet, settlement, mint, foresight, faucet) without adding it here or
  // to service-ci.yml's `allow-match`. Every one of those five then failed Rule 3 with "not a
  // published contract or runtime package: '@cloudsforge/evm'", which is exactly what the rule is
  // for — the mistake was declaring the package in one place and importing it in five.
  //
  // It qualifies on the list's own test: keccak256 and EIP-55 checksumming, byte-identical
  // implementations that existed five times over, with no service domain in it.
  '@cloudsforge/evm',
  '@cloudsforge/auth',
  '@cloudsforge/db',
  '@cloudsforge/lifecycle',
  '@cloudsforge/secrets',
  '@cloudsforge/policy-client',
  '@cloudsforge/ui',
  '@cloudsforge/ui-charts',
  '@cloudsforge/sdk',
  '@cloudsforge/cli',
  '@cloudsforge/hearth-node',
  // Added 2026-08-10 with the `hearth-wallet-core` row, and NOT as a formality. The three wallet
  // clients each depend on this name, so the moment they became managed rows `cfctl doctor` began
  // reading their manifests — and an undeclared scoped name is a `fail`, not a warning. Leaving it
  // out would have traded five doctor failures for three, which is the shape of fix this file
  // exists to refuse. It qualifies on the list's own test: `micro-hearth-wallet-core` is a
  // `library()` row that publishes exactly this package, as `micro-contracts` publishes the eight
  // above it. Added to service-ci.yml's `allow-match` in the same commit; test/cfctl.test.ts
  // parses that workflow and requires the two to agree.
  '@cloudsforge/hearth-wallet-core',
];
