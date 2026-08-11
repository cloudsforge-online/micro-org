/**
 * No release may put a service back on an older image than the release before it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: micro-org#384, AND IT IS A NAMING ACCIDENT WITH SIX DAYS INSIDE IT.
 *
 * This directory holds two manifest lineages. They are not two branches of one history; they are
 * two answers to the same question, written six days apart:
 *
 *   `2026.08.1` .. `2026.08.11`   2026-08-04 to 2026-08-06, every service pinned at ITS OWN
 *                                 version — identity 1.4.1, wallet 1.4.0, indexer 1.1.0.
 *   `2.3.0` .. `2.5.19`           2026-08-07 to 2026-08-11, after `release(2.3.0): the first
 *                                 manifest that names one version for the whole estate`.
 *
 * `2026.08.12` was cut on 2026-08-11 by copying `2026.08.11` and editing three rows. The other 45
 * were inherited unread from a file dated 2026-08-06, and deploying it rolled the whole estate
 * back from 2.5.19 to the 2026-08-05 builds — the indexer by 87 commits. Nothing failed. Every
 * container was healthy, every image existed, `release-deploy.sh --dry-run` was green, and the
 * digests were real digests of real artifacts. It was found five days later by reading
 * `org.opencontainers.image.version` off the running containers and not believing it.
 *
 * Every guard this estate already has around releases asks IS THIS PIN VALID. `--verify` resolves
 * each tag at GHCR, `check-release-render-pins-profiles.py` proves the renderer pins by digest,
 * `check-provenance-reads-digest-pins.py` proves the running container can be traced back to one.
 * A pin six days stale passes all three, because it is a completely valid pin. The question none
 * of them asks is IS THIS PIN NEWER THAN THE ONE IT REPLACES, and that is the only question that
 * catches a manifest assembled by copy-and-edit.
 *
 * ── WHY ORDER BY `generated` AND NOT BY THE FILENAME ──────────────────────────────────────────
 *
 * The filename is exactly what failed. `2026.08.12` sorts after `2026.08.11` and looks like its
 * successor, and it is — in time. It is also six days behind `2.5.19`, which no comparison of
 * those two names could ever reveal, because they are not comparable: one is a date and one is a
 * semver and the estate used both. `generated` is the one field that orders the two lineages
 * against each other, because it records when a human cut the file rather than what they called
 * it.
 *
 * ── WHY A DECREASE IS AN ERROR AND NOT A WARNING ──────────────────────────────────────────────
 *
 * A deliberate rollback is a real and necessary operation — `releases/README.md` says rollback is
 * checking out the previous file, and that must keep working. But checking out the previous file
 * does not ADD a manifest; it deploys one that is already here and already passed this. Cutting a
 * NEW manifest that moves a service backwards is either an intentional revert, which is worth one
 * line in `ACKNOWLEDGED` naming the issue, or it is #384 happening again. There is no third case,
 * and a warning nobody reads is how the first one survived a deploy.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseManifest } from '../tools/cfctl.ts';

const RELEASES = fileURLToPath(new URL('../releases', import.meta.url));

/**
 * A regression already in the history, and the issue that owns it.
 *
 * Keyed by the manifest that introduced it, so adding an entry means naming the file you are
 * about to commit — which is the moment to notice you did not mean to. An entry is a claim that
 * somebody looked; it is not a way to make the check quiet.
 */
const ACKNOWLEDGED: Record<string, string> = {
  // Cut by copying 2026.08.11 and editing settlement, pool and pool-web. The 45 rows nobody
  // edited were six days old and went to production. See the header of 2026.08.13, which is the
  // release that undid it.
  '2026.08.12': 'micro-org#384',
};

/** Order two dotted numeric versions. Every version this estate has ever shipped is one. */
function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  assert.ok(
    [...a, ...b].every(Number.isInteger),
    `both versions must be dotted integers, got ${left} and ${right}`,
  );
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

interface Cut {
  readonly version: string;
  readonly generated: string;
  readonly tags: ReadonlyMap<string, string>;
}

/**
 * Every manifest in the directory, oldest cut first.
 *
 * `2026.08.0-example.yaml` is documentation of the format rather than a release, and its images
 * do not exist. It is excluded by name — a filter on "has a `generated` that parses" would also
 * silently swallow a real manifest whose header got mangled, which is the class of quiet
 * exclusion this whole file is about.
 */
function readCuts(): Cut[] {
  const files = readdirSync(RELEASES)
    .filter((name) => name.endsWith('.yaml'))
    .filter((name) => name !== '2026.08.0-example.yaml');
  assert.ok(files.length > 10, `expected the release history, found ${files.length} file(s)`);

  const cuts = files.map((name) => {
    const manifest = parseManifest(readFileSync(path.join(RELEASES, name), 'utf8'));
    assert.equal(
      manifest.version,
      name.replace(/\.yaml$/, ''),
      `${name} names a version that is not its own filename`,
    );
    assert.ok(
      !Number.isNaN(Date.parse(manifest.generated)),
      `${name} has no parseable 'generated', so it cannot be ordered against the other lineage`,
    );
    assert.ok(manifest.services.length > 0, `${name} names no services`);
    return {
      version: manifest.version,
      generated: manifest.generated,
      tags: new Map(manifest.services.map((service) => [service.name, service.tag])),
    };
  });

  return cuts.sort((left, right) => Date.parse(left.generated) - Date.parse(right.generated));
}

/**
 * Every service the later cut moves BACKWARDS relative to the earlier one.
 *
 * A service present in one and absent from the other is not a regression — that is a deployable
 * being added or retired, which `absent:` already records and which this must not confuse for a
 * downgrade.
 */
export function regressions(before: Cut, after: Cut): { name: string; from: string; to: string }[] {
  const found: { name: string; from: string; to: string }[] = [];
  for (const [name, to] of after.tags) {
    const from = before.tags.get(name);
    if (from === undefined) continue;
    if (compareVersions(from, to) > 0) found.push({ name, from, to });
  }
  return found;
}

describe('the release history only ever moves forward', () => {
  it('no manifest pins a service behind the manifest cut before it', () => {
    const cuts = readCuts();
    const complaints: string[] = [];

    for (let i = 1; i < cuts.length; i += 1) {
      const before = cuts[i - 1]!;
      const after = cuts[i]!;
      const found = regressions(before, after);
      if (found.length === 0) continue;
      if (ACKNOWLEDGED[after.version] !== undefined) continue;
      const shown = found
        .slice(0, 6)
        .map((one) => `${one.name} ${one.from} -> ${one.to}`)
        .join(', ');
      complaints.push(
        `${after.version} (cut ${after.generated}) moves ${found.length} service(s) back ` +
          `from ${before.version} (cut ${before.generated}): ${shown}` +
          `${found.length > 6 ? ', …' : ''}`,
      );
    }

    assert.deepEqual(
      complaints,
      [],
      `${complaints.length} release(s) roll a service backwards. If that is deliberate, add the ` +
        `manifest version to ACKNOWLEDGED with the issue that explains it.\n  ${complaints.join('\n  ')}`,
    );
  });

  it('the acknowledged regression is still there, so the entry is not a leftover', () => {
    // An ACKNOWLEDGED entry for a regression that no longer exists is a licence sitting open over
    // a file somebody may yet edit. This is what makes the table shrink when history is corrected
    // rather than accumulating exemptions forever.
    const cuts = readCuts();
    for (const version of Object.keys(ACKNOWLEDGED)) {
      const index = cuts.findIndex((cut) => cut.version === version);
      assert.ok(index > 0, `ACKNOWLEDGED names ${version}, which is not a release with a predecessor`);
      assert.ok(
        regressions(cuts[index - 1]!, cuts[index]!).length > 0,
        `ACKNOWLEDGED names ${version}, which no longer moves anything backwards — delete the entry`,
      );
    }
  });

  it('2026.08.13 puts back everything 2026.08.12 took away', () => {
    // The specific repair, asserted specifically. `no regressions` above would go green if
    // 2026.08.13 had simply repeated 2026.08.12's stale pins, because repeating them is not
    // moving backwards. This is the assertion that the estate actually returned to 2.5.x.
    const cuts = readCuts();
    const broken = cuts.find((cut) => cut.version === '2026.08.12')!;
    const repair = cuts.find((cut) => cut.version === '2026.08.13')!;
    const behind = [...repair.tags].filter(([, tag]) => compareVersions(tag, '2.5.19') < 0);
    assert.deepEqual(
      behind,
      [],
      `2026.08.13 still carries pre-2.5.19 pins: ${behind.map(([n, t]) => `${n} ${t}`).join(', ')}`,
    );
    assert.ok(
      regressions(repair, broken).length > 40,
      'the two manifests should differ across most of the estate; if they no longer do, one of ' +
        'them has been edited and this test is measuring nothing',
    );
  });

  it('a manifest that moves one service back is CAUGHT — the check can fail', () => {
    // Without this, the whole file passes on an empty history, on a parser that returns no tags,
    // or on a comparator that answers 0 for everything. Mutating one row of the real newest
    // manifest is the smallest input that reproduces #384, and it must be red.
    const cuts = readCuts();
    const newest = cuts[cuts.length - 1]!;
    const previous = cuts[cuts.length - 2]!;
    assert.deepEqual(regressions(previous, newest), [], 'the real newest pair must be clean');

    const name = [...newest.tags.keys()].find((service) => previous.tags.has(service))!;
    const rolledBack: Cut = {
      version: newest.version,
      generated: newest.generated,
      tags: new Map([...newest.tags, [name, '0.0.1']]),
    };
    assert.deepEqual(regressions(previous, rolledBack), [
      { name, from: previous.tags.get(name)!, to: '0.0.1' },
    ]);
  });
});
