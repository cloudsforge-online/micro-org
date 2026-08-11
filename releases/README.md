# Release manifests

A release is a file, not a tag.

## Why `CLOUDSFORGE_TAG` cannot survive the split

The current estate deploys with one environment variable, `CLOUDSFORGE_TAG`, applied to fourteen
images built by seven repositories. Because it is one value shared across seven independent
histories:

- **A commit sha can never be used as a pin.** No sha exists in seven repositories, so the value
  has to be a name every repository agrees to create — which means it can only ever be `main`, or
  a tag pushed by hand seven times.
- **A release is seven hand-pushed git tags**, and a release where one of the seven was forgotten
  looks exactly like a release where it was not.
- **Rollback is not expressible.** Setting the variable back moves all fourteen images, including
  the eleven that were fine.

With one repository per service there is no shared version at all. The registry holds **78
repositories, 67 of them managed** (`tools/registry.ts`) — this paragraph read "forty-three" when
it was written — and each has its own history, so nothing that names one of them can name the
others.

## What replaces it

A **manifest**: a generated file that names exactly which image of each service is in this
release. It is the only thing a deployment reads.

```bash
cfctl release 2026.08.22           # generate org/releases/2026.08.22.yaml
cfctl release --verify 2026.08.22   # every image it names actually exists
```

```yaml
version: "2026.08.22"
generated: "2026-07-30T09:00:00.000Z"
generator: cfctl release
services:
  - name: ledger
    repo: micro-ledger
    kind: service
    image: ghcr.io/cloudsforge-online/micro-ledger
    tag: "1.4.2"
    commit: "9f1c0b2a44de"
    digest: "sha256:d82f87dc83bca045a20b5f49fb367b62fa780ce99a2ba696d5546fa7976e4d8b"
absent:
  - market
```

| Field | Why it is there |
| --- | --- |
| `tag` | The image actually deployed. Per service, because there is no shared version to share. |
| `commit` | The source revision that built it. Without this, "what is running" is answerable and "what code is that" is not. |
| `digest` | **The artifact.** `tag` is a name that points at an image and that this estate moves; the digest is the name of the bytes. Without it a manifest records an intention rather than an object — see below. |
| `absent` | Deployables with no image in this release, **listed rather than omitted**. A manifest with a silent hole is how a service gets left on an old image while everything around it moves — the same failure as `pull-all.sh` omitting `crucible`. |

## Why a tag was not enough (micro-org#288)

`publish-image.yml` tags the image at the repository's `package.json` version on every push to
`main` or `release/**`, so the same tag is republished by any later push that carries the same
version. Two ways that happened, both measured on 2026-08-09:

- **A release branch that was never merged.** Six repositories cut `release/2.5.6`, published
  `ghcr:2.5.6` from it and never merged back, so `main` stayed on 2.5.5 and every subsequent merge
  republished the tag `releases/2.5.5.yaml` pins.
  `ghcr.io/cloudsforge-online/micro-network-site:2.5.5` resolves to the image built from `5aa61e4`,
  a merge that landed *after* 2.5.5 was cut.
- **Merging the release branch.** That republishes the tag too, from the merge commit rather than
  the commit the manifest pins. The trees are identical so the content is, but the digest need not
  be — and the estate pulls by tag.

`--verify` could see neither: `docker manifest inspect` establishes that an image *exists*, and
existence is all it establishes. So "rollback is checking out the previous manifest" was buying
less than it looked like, and it was silent in both directions — a rollback that produces a running
estate looks like a rollback that worked.

`digest` is what makes a release name a fixed artifact rather than a pointer to a moving one. It is
the **index** digest, the one `docker pull image@sha256:…` takes, not a per-platform digest.

**Manifests cut before 2026-08-09 have no `digest` field, and that is fine.** They still parse,
still render, and still deploy — rollback is checking out the previous file, so those files *are*
the rollback path and nothing may take it away. `--verify` reports them as `unverifiable` rather
than as verified: the image exists, and nothing can say it is the image that was released.

## The properties this buys

1. **Rollback is checking out the previous manifest.** The diff between any two releases is
   exactly the set of services that moved.

   **But "the previous manifest" is not the previous filename, and it is not `git log releases/`
   either.** See "Naming, and why a name cannot be sorted" below. This bullet used to say
   `git log releases/` *is* the deployment history; that is the belief that produced
   [micro-org#384](https://github.com/cloudsforge-online/micro-org/issues/384). Order by each
   manifest's `generated` field, or ask `release-deploy.sh --list`.
2. **A release is reviewable.** A pull request adding `releases/2026.08.1.yaml` shows, in the
   diff, which services changed and which did not.
3. **A release is verifiable before it is deployed.** `--verify` pulls the manifest for every
   image named, and compares what each tag resolves to now against the digest recorded when the
   release was cut. An image that 403s — the usual cause being a GHCR package that inherited a
   private repository's visibility — is found here rather than at 3am on the deploy host, and a
   tag that has been republished since is a red rather than a silent substitution.
4. **Partial releases are a first-class thing.** Moving one service is a manifest identical to
   the last one but for a line. That is the whole point of the topology, and `CLOUDSFORGE_TAG`
   could not express it.

## Naming, and why a name cannot be sorted

**A release name is `<year>.<month>.<sequence>`.** `2026.08.21` is the **twenty-first release cut
in August 2026**, not 21 August — its `generated` field reads `2026-08-11T13:24:18.096Z`. The
sequence counts releases within the month; it does not track the calendar. `2026.08.1` was cut on
2026-08-04 and `2026.08.9` on 2026-08-05.

**Never sort these names, and never take "the latest" or "the previous" from a directory listing.**
Two independent things break it:

- **The sequence is not zero-padded.** `2026.08.21` sorts *before* `2026.08.6` as a string.
- **This directory holds two incomparable lineages.** `2026.08.1`..`2026.08.11` were cut
  2026-08-04 to 2026-08-06, each service pinned at its own version. `2.3.0`..`2.5.19` were cut
  2026-08-07 to 2026-08-11, after "the first manifest that names one version for the whole estate".
  They are not two branches of one history; they are two answers to the same question, six days
  apart. No comparison of a date-shaped name with a semver-shaped one means anything.

**Order by `generated`.** It is the only field that orders the two lineages against each other,
because it records when a human cut the file rather than what they called it.

### micro-org#384, which is why the rules below gained a fourth entry

`2026.08.12` was cut by copying `2026.08.11` and editing three rows. The other 45 were inherited
unread from a file dated 2026-08-06, and deploying it rolled the estate back from `2.5.19` to the
2026-08-05 builds — the indexer by **87 commits**.

**Nothing failed.** Every container was healthy. Every image existed. `release-deploy.sh --dry-run`
was green. Every digest was a real digest of a real artifact. It was found five days later by
reading `org.opencontainers.image.version` off the running containers and not believing it.

Every guard this estate has around releases asks *is this pin valid*: `--verify` resolves each tag
at GHCR, `check-release-render-pins-profiles.py` proves the renderer pins by digest,
`check-provenance-reads-digest-pins.py` proves a running container traces back to one. **A pin six
days stale passes all three, because it is a completely valid pin.** The question none of them
asked is *is this pin newer than the one it replaces*, and that is the only question that catches a
manifest assembled by copy-and-edit.

`test/release-order.test.ts` now asks it, and a decrease is an error rather than a warning. A
deliberate rollback does not add a manifest — it deploys one that is already here and already
passed — so cutting a *new* manifest that moves a service backwards is either an intentional
revert, worth one line in that file's `ACKNOWLEDGED` map naming the issue, or it is #384 happening
again. There is no third case, and a warning nobody reads is how the first one survived a deploy.

## Rules

- **A release name is `<year>.<month>.<sequence>`, and it is never sorted.** Order by `generated`.
  `2026.08.21` is the twenty-first release of August 2026, and `2026.08.21` sorts before
  `2026.08.6`. See above.
- **No release may put a service on an older image than the release before it.**
  `test/release-order.test.ts` fails the build. An intentional revert is an `ACKNOWLEDGED` entry
  naming the issue, written in the same commit as the manifest — which is the moment to notice you
  did not mean to.
- **A manifest is never assembled by copy-and-edit.** `cfctl release` generates it from the state
  of the repositories. Copying the previous file and editing the rows you meant to move inherits
  every row you did not look at, and those rows are valid, verifiable and wrong.
- **`--verify` cannot see a stale pin.** It establishes that an image exists and that a tag still
  resolves to the recorded digest. It says nothing about whether that digest is current. Do not
  read a green `--verify` as "this release is up to date".
- **Manifests are generated, never hand-edited.** `cfctl release` refuses to overwrite one
  without `--force`, because a manifest is the record of what was deployed and rewriting it
  rewrites history.
- **A dirty checkout cannot be released.** An image tag cannot name a working tree.
- **A manifest is promoted, not rebuilt.** The manifest that passed Beacon's journey suite in
  staging is byte-for-byte the manifest that goes to production (AD-04). If a promotion rebuilds
  anything, the artifact that was tested is not the artifact that ships.
- **Nothing is deployed from a manifest that has not been verified.** `--verify` exits non-zero
  when it cannot check, rather than reporting success it did not establish.
- **A tag that has moved is a failure, not a note.** `--verify` exits non-zero when a recorded
  digest no longer matches, and when a recorded digest cannot be read at all. A manifest with no
  digests exits zero and says, in as many words, that it cannot be verified.
