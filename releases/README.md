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

With one repository per service there is no shared version at all. Forty-three repositories have
forty-three independent histories, and nothing that names one of them can name the others.

## What replaces it

A **manifest**: a generated file that names exactly which image of each service is in this
release. It is the only thing a deployment reads.

```bash
cfctl release 2026.08.0            # generate micro/org/releases/2026.08.0.yaml
cfctl release --verify 2026.08.0   # every image it names actually exists
```

```yaml
version: "2026.08.0"
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

1. **Rollback is checking out the previous manifest.** `git log releases/` is the deployment
   history, with the diff between any two releases being exactly the set of services that moved.
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

## Rules

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
