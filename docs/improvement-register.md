# The estate improvement register

**Compiled 2026-09-01, against release 2026.8.108.** Every open defect, decision and
capability gap, banded by **what it costs to leave alone** rather than by how it was
filed. 47 tracker issues plus six findings from the consolidation audit and the one
flagged merge.

Published view: <https://claude.ai/code/artifact/47e55a4c-d3d4-4e3e-a8e1-54e8e5c06d73>

> **This file is the source of truth and the artifact is a view of it.** Update this
> first, then republish. An item closes here only with the evidence that closed it —
> the same rule the tracker itself uses.

## How to read the estimates

Engineer-days, where a day is one focused working session including its tests. Anything
touching the cluster carries an extra day for deploy and verification, and that is
already in the number. **They are rough** — good to roughly ±40% within a band, and
worse for P3, where several items are gated on a decision rather than on work.

`owner` marks items that cost near-zero engineering and cannot start without the owner.

| band | items | days |
|---|---|---|
| P0 · live exposure | 7 | ~12 + 2 decisions |
| P1 · controls that do not work | 13 | ~15 |
| P2 · cost paid repeatedly | 12 | ~15 |
| P3 · capability and unfinished product | 23 | ~103 |

---

## P0 — Live exposure

Secrets that are out, keys concentrated where one compromise takes the money, and the
legal question that decides whether the custody product may exist at all. Every one is
worse tomorrow than today, and two are not engineering.

**Working this band turned up a defect nobody had filed, and it is now the worst item in
it.** The backup runner writes an artefact called `miner-coinbase-mainnet` every day and
records it as written. It contains a *different key on a different host* — the estate has
two EMBER miners, the runner can only see the cluster's, and it encrypts what it finds
under the name of what it was asked for. The chain host's coinbase holds **112,011
EMBER**, is also multisig owner #1 and the EOA holding the Forge Exchange LP tokens, and
exists only as two files on one machine while the backup reports success. That is
[#532](https://github.com/cloudsforge-online/micro-org/issues/532), and it is the second
time this exact artefact has silently backed up nothing useful — `run.ts` carries a
comment about the first.

**Three of the nine closed on 2026-09-01 without a line of the work they asked for** —
#423, #510 and #508. All three described a pre-consolidation estate, and the
consolidation either removed their premise or resolved them by a better route than the
one they proposed. What came out of working them is one real defect they were all
standing next to, now fixed in
[micro-custody#21](https://github.com/cloudsforge-online/micro-custody/pull/21): the
address index counter was per SEED, while a seed derives under as many BIP-44 paths as
it serves chains and networks, so the indexes interleaved and left every path with
holes. Twenty consecutive holes is the gap limit at which a wallet restoring from the
user's own exported phrase stops finding their addresses.

| ref | class | item | est | status |
|---|---|---|---|---|
| [#25](https://github.com/cloudsforge-online/micro-org/issues/25) | non-func | The custody keyring has no automated off-host copy — losing the host loses every custodied key | 2d | **items 1–2 closed 2026-09-01, item 3 open** |
| [#161](https://github.com/cloudsforge-online/micro-org/issues/161) | owner · non-func | Whether the platform may lawfully custody third-party crypto-assets at all | — | open |
| #209 (task) | owner · non-func | Revoke the exposed Azure Foundry key | 0.5d | open |
| [#473](https://github.com/cloudsforge-online/micro-org/issues/473) | non-func | The mainnet multisig's three keys all live on the chain host | 3d | open |
| [#532](https://github.com/cloudsforge-online/micro-org/issues/532) | non-func | The daily backup named `miner-coinbase-mainnet` holds the **other host's** key — 112,011 EMBER is unbacked and the run goes green | 2d | **filed 2026-09-01** |
| [#206](https://github.com/cloudsforge-online/micro-org/issues/206) | non-func | Miner coinbase keys plaintext on disk — now 112,011 EMBER, not 9,332; confidentiality half closed, durability half is #532 | 0.5d | open |
| #210 (task) | non-func | Rotate the mainnet outbox and ingest secrets | 2d | open |

## P1 — Controls that do not work

Safety nets that report success without doing their job, and correctness defects a user
meets. **#431 closed on 2026-09-01** — the Kubernetes migration was its own option 3,
"the only one that removes the class of failure rather than the instance", and every link
in the boot chain now starts without a human. Its replacement at the top of this band,
[#533](https://github.com/cloudsforge-online/micro-org/issues/533), is the third control
this week found reporting on a value while saying nothing about whether it measured at
all — after the backup runner (#532) and the miner-key artefact. That is now a pattern
worth naming: **every alert in this estate should be paired with one that fires on the
absence of its own input.** These rank above capability because each makes the estate *look* healthier than
it is — and two are GDPR obligations rather than preferences.

| ref | class | item | est |
|---|---|---|---|
| [#533](https://github.com/cloudsforge-online/micro-org/issues/533) | non-func | Testnet reconciliation stopped on 2026-08-25, and no alert can see a sweep that *stopped* | 2d |
| [#491](https://github.com/cloudsforge-online/micro-org/issues/491) | functional | micro-worlds has no erasure handler at all, and it stores user_id | 2d |
| [#474](https://github.com/cloudsforge-online/micro-org/issues/474) | functional | Shared identity delivers events to mainnet only — testnet never hears `identity.user.deleted` | 1.5d |
| [#517](https://github.com/cloudsforge-online/micro-org/issues/517) | non-func | The restore drill reports a mismatch on a healthy run | 1d |
| [#443](https://github.com/cloudsforge-online/micro-org/issues/443) | non-func | The conformance runner borrows the monitor's journey account | 1d |
| [#512](https://github.com/cloudsforge-online/micro-org/issues/512) | non-func | The tunnel has no `/internal` refusal rule, though policy.yml says it is the first | 1d |
| [#503](https://github.com/cloudsforge-online/micro-org/issues/503) | functional | Testnet EMBER frozen since 2026-08-15, constant reconciliation drift | 2d |
| [#472](https://github.com/cloudsforge-online/micro-org/issues/472) | functional | The testnet identity issues tokens no testnet service will accept | 1d |
| [#518](https://github.com/cloudsforge-online/micro-org/issues/518) | functional | The testnet faucet has never dispensed — balance 0, drips queued since 2026-08-07 | 0.5d |
| [#515](https://github.com/cloudsforge-online/micro-org/issues/515) | non-func | The backup runner leaves its 8.8 GB verification scratch database behind | 0.5d |
| [#207](https://github.com/cloudsforge-online/micro-org/issues/207) | non-func | The backup disk exposes no SMART | 1d |
| [#455](https://github.com/cloudsforge-online/micro-org/issues/455) | non-func | `cfctl release` writes a manifest with empty digests instead of refusing | 0.5d |
| [#499](https://github.com/cloudsforge-online/micro-org/issues/499) | non-func | estate-ci: the ledger account-key resolver is one over budget | 1d |

## P2 — Cost you pay repeatedly

Nothing here is on fire. Each is a tax charged on every future change, and three are
direct fallout of the consolidation.

| ref | class | item | est |
|---|---|---|---|
| [#358](https://github.com/cloudsforge-online/micro-org/issues/358) | non-func | Nothing compares the estate's own prose against the running estate | 3d |
| #207 (task) | non-func | Converge sixteen copies of `resolveApiBase` onto `apiBaseFor` | 2d |
| #206 (task) | non-func | Split the `AGORA_` prefix | 2d |
| [#479](https://github.com/cloudsforge-online/micro-org/issues/479) | non-func | identity and notify have no dynamic body scan | 1.5d |
| [#446](https://github.com/cloudsforge-online/micro-org/issues/446) | functional | Testnet sends mail from mainnet's domain | 1d |
| [#450](https://github.com/cloudsforge-online/micro-org/issues/450) | functional | `consumed_at` means both "the user clicked" and "a resend superseded it" | 1d |
| [#436](https://github.com/cloudsforge-online/micro-org/issues/436) | non-func | Chain host: remove the docker-bridge RPC binds and prove the boot path | 1d |
| [#448](https://github.com/cloudsforge-online/micro-org/issues/448) | functional | Every email's button says "Open CloudsForge" | 0.5d |
| [#502](https://github.com/cloudsforge-online/micro-org/issues/502) | functional | hub-web /security blanks the whole page while it re-reads after a revoke | 0.5d |
| [#498](https://github.com/cloudsforge-online/micro-org/issues/498) | functional | exchange-web builds every explorer link from `hosts()` | 0.5d |
| [#500](https://github.com/cloudsforge-online/micro-org/issues/500) | non-func | Two LTC RPC credential files sit unreferenced on the chain host | 0.5d |
| #205 (task) | functional | Decide the operator-console timestamp locale | 1d |

## P3 — Capability and unfinished product

Real work with real value, and none should start before P0 clears. Several are gated on
a decision rather than on effort; their estimates assume the decision went the enabling
way.

| ref | class | item | est |
|---|---|---|---|
| [#333](https://github.com/cloudsforge-online/micro-org/issues/333) | functional | Credit a `TOKEN:` deposit — USDT/USDC support | 10d |
| [#494](https://github.com/cloudsforge-online/micro-org/issues/494) | functional | Forge Exchange is two venues and neither is finished | 8d |
| [#209](https://github.com/cloudsforge-online/micro-org/issues/209) | functional | Observe BTC and LTC natively | 8d |
| [#373](https://github.com/cloudsforge-online/micro-org/issues/373) | functional | bitcoind finished IBD and BTC is still first-class nowhere | 6d |
| [#458](https://github.com/cloudsforge-online/micro-org/issues/458) | functional | Merge-mine EMBER against Litecoin (AuxPoW) — the 51% fix | 6d |
| [#344](https://github.com/cloudsforge-online/micro-org/issues/344) | functional | What has to be true before `TRADE_EXCHANGE_ENABLED` goes on | 5d |
| [#451](https://github.com/cloudsforge-online/micro-org/issues/451) | functional | Browser mining is solo, so a small miner gets a lottery | 4d |
| M5e (flagged) | owner · non-func | Merge custody and settlement into `vault` | 4d |
| [#302](https://github.com/cloudsforge-online/micro-org/issues/302) | functional | micro-pool records what a miner is owed and can pay nobody | 3d |
| [#214](https://github.com/cloudsforge-online/micro-org/issues/214) | non-func | Backup and restore visible in the admin panel | 3d |
| [#407](https://github.com/cloudsforge-online/micro-org/issues/407) | functional | The platform cannot honestly issue its own brand assets | 3d |
| [#368](https://github.com/cloudsforge-online/micro-org/issues/368) | functional | trade-web marks bot equity at an administered price and says nothing | 2d |
| [#457](https://github.com/cloudsforge-online/micro-org/issues/457) | owner · functional | Hardware stratum has no reachable endpoint | — |
| [#165](https://github.com/cloudsforge-online/micro-org/issues/165) [#33](https://github.com/cloudsforge-online/micro-org/issues/33) [#316](https://github.com/cloudsforge-online/micro-org/issues/316) | owner · non-func | The legal set: acceptable use, the privacy notice, account suspension | — |
| [#34](https://github.com/cloudsforge-online/micro-org/issues/34) | owner · functional | Custodial staking — no funded platform address exists | — |

---

## The order I would take them in

1. **The two owner-only P0 items**, because they cost minutes and are accruing: revoke
   the Azure key (#209), and start the counsel conversation on #161.
2. **#532 first**, ahead of everything else in P0. It is the only item where the estate is
   actively reporting a safety net as working while it is not, over the single largest
   money-bearing key it owns. Everything else in this band is a risk; this one is a risk
   plus a false reassurance, and the false reassurance is what stops it being noticed.
3. **The key-concentration remainder** — **#473 and #206**, the other three having closed
   on 2026-09-01. Both are now decisions about where a key is allowed to physically live,
   not engineering, and #473 should be decided knowing that two of the three multisig
   owners are live miner coinbases holding real balances.
4. **#25 item 3**, which is now an availability problem rather than a confidentiality
   one, and needs a design decision about *where* the keyring copy lives before any
   code is written.
5. **P1, starting with #431.** Everything else in that band assumes the estate comes back
   after a reboot, and nothing has proven it does.

The consolidation is deliberately absent: it closed cleanly, and what it left behind is
three P2 maintainability items rather than a tail of defects.

## Corrections to this register

**#25 was mis-ranked when this was compiled, and the correction matters more than the
item.** I banded it top of P0 as "the only item a stranger can act on today". Working it
turned up `micro-deploy docs/DISCLOSURE-custody-master-secret-v1.md`, written 2026-08-13,
which had already decided item 1 — and which records that the disclosed value is
`estate-only-custody-master-secret-v1-0000`, a **zero-entropy placeholder, not a key**.
It would fail `assertMasterSecret` today. Confirmed live: 325 custody keys and 254 seeds,
all at `key_version 4`, and the keyring holds V4 alone.

So there is no readable secret in public history — there is a public *placeholder*. The
real remaining risk is item 3, and it is the opposite kind: the vault is backed up and
the key that decrypts it is not, which the backup manifest states as
`custodyKeyringIncluded: false`. **Availability, not confidentiality.** It stays in P0
because it is the only single point of unrecoverable loss in the estate, but it is not
urgent in the way "a secret is public" is urgent, and nothing external is ticking.

The lesson for the rest of this register: an issue's own title is evidence of what was
true when it was filed, not of what is true now. #504 was the same shape, and so were
all three of #423, #510 and #508 — which is now four out of the first five items worked.

**That is a pattern, not a run of luck, and it changes how the rest of this should be
read.** Every one of those issues was filed against an estate with two of everything.
The consolidation did not just close them; in two cases it inverted them. #423 asks for
a decision about testnet rows "in the mainnet estate's databases" and proposes deleting
them — there is one estate now, those rows are the live testnet data, and deleting them
would have destroyed it. #510 proposes splitting the custody seed per network, which
would give every user two mnemonics per family and still not fix the thing that was
actually broken.

So the rule I am applying to the remaining items: **measure the estate before believing
the ticket**, and treat a proposed remedy as the most perishable part of any issue. The
defect described may survive a re-architecture; the fix almost never does.

## Changelog

- **2026-09-01** — compiled.
- **2026-09-01** — #431 closed with evidence (k3s `enabled`, cf-k8s
  `AutomaticStartAction=Start`, chain-host daemons and snap docker `enabled`, uptime
  workflow outside the blast radius, no micro-site test making a network call). #533 filed
  in its place: testnet reconciliation has not run since 2026-08-25 because the merged
  `ledger` takes a single `LEDGER_RECONCILE_NETWORK`, and the one reconciliation alert
  fires on `drift != 0`, which a stopped sweep never produces. Two testnet assets are
  frozen with nothing able to clear them. #512 confirmed open — `/internal` returns 502,
  i.e. forwarded to an absent origin rather than refused.
- **2026-09-01** — #532's engineering half shipped as micro-deploy#286:
  `BACKUP_MINER_EXPECTED_ADDRESS`, which refuses rather than writing, so the existing
  `MinerCoinbaseKeyUnbacked` alert becomes true instead of staying silent. Left
  **unconfigured on purpose** — both possible values change behaviour and choosing which
  key the estate leaves uncovered is the owner's call. Also found: **the k8s VM has not
  mined since 2026-08-10**, so the key being backed up daily is not merely the wrong one,
  it is a dormant one, while the host that is actually mining has no coverage.
- **2026-09-01** — **#532 filed and banded top of P0.** The daily `miner-coinbase-mainnet`
  artefact has been encrypting the k8s VM's miner key, not the chain host's, across at
  least 17 sets; the chain host's key holds 112,011 EMBER and is in no backup at all.
  Found by checking `backup_artefacts.public_ref` against the address #206 names, rather
  than by trusting either the issue or the green run.
- **2026-09-01** — #206 re-estimated 2d → 0.5d and #473 re-scoped. #206's confidentiality
  half is closed: the miner is pinned to `HEARTH_COINBASE_SOURCE=keystore`, so the
  remaining plaintext is unread, and it was proven redundant by address comparison rather
  than assumed. #473 confirmed on-chain (`required()=2`, all three owners current) and
  widened: two of the three owners are live miner coinbases holding 112,011 and 19,641
  EMBER, so the issue's "the wallet holds feeToSetter only" bounds the wallet but not the
  keys.
- **2026-09-01** — #423, #510 and #508 closed with evidence, none needing the work they
  asked for; the key-concentration block is now #473 and #206 alone. The defect found
  underneath them — one address-index counter shared across a seed's several derivation
  paths — is fixed in micro-custody#21, with a regression test that mints interleaved
  across BTC/LTC/DOGE and asserts each path stays contiguous. Two existing tests changed
  with it: both had pinned an index that only held because the shared counter produced
  it, and both now demonstrate the coin-type separation they were written for.
- **2026-09-01** — #25 items 1 and 2 closed. Item 2 shipped
  (`runbooks/runbook-custody-master-secret.md`, cited by five documents and never
  written); item 1 found already closed by the 2026-08-13 disclosure. Item 3 re-framed
  and re-estimated 3d → 2d. Band order updated.
