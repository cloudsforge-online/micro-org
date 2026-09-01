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
| P0 · live exposure | 9 | ~14 + 2 decisions |
| P1 · controls that do not work | 13 | ~16 |
| P2 · cost paid repeatedly | 12 | ~15 |
| P3 · capability and unfinished product | 23 | ~103 |

---

## P0 — Live exposure

Secrets that are out, keys concentrated where one compromise takes the money, and the
legal question that decides whether the custody product may exist at all. Every one is
worse tomorrow than today, and two are not engineering.

| ref | class | item | est | status |
|---|---|---|---|---|
| [#25](https://github.com/cloudsforge-online/micro-org/issues/25) | non-func | The custody master secret is readable in public git history | 3d | **in progress** |
| [#161](https://github.com/cloudsforge-online/micro-org/issues/161) | owner · non-func | Whether the platform may lawfully custody third-party crypto-assets at all | — | open |
| #209 (task) | owner · non-func | Revoke the exposed Azure Foundry key | 0.5d | open |
| [#473](https://github.com/cloudsforge-online/micro-org/issues/473) | non-func | The mainnet multisig's three keys all live on the chain host | 3d | open |
| [#206](https://github.com/cloudsforge-online/micro-org/issues/206) | non-func | Miner coinbase keys plaintext on disk, controlling 9,332 EMBER | 2d | open |
| #210 (task) | non-func | Rotate the mainnet outbox and ingest secrets | 2d | open |
| [#423](https://github.com/cloudsforge-online/micro-org/issues/423) | non-func | 227 testnet custody keys and 224 wallet rows in the mainnet databases | 2d | open |
| [#510](https://github.com/cloudsforge-online/micro-org/issues/510) | functional | `custody_seeds` unique on (user_id, family) without network | 1.5d | open |
| [#508](https://github.com/cloudsforge-online/micro-org/issues/508) | non-func | The testnet custody keyring was never rotated with the estate's | 1.5d | open |

## P1 — Controls that do not work

Safety nets that report success without doing their job, and correctness defects a user
meets. These rank above capability because each makes the estate *look* healthier than
it is — and two are GDPR obligations rather than preferences.

| ref | class | item | est |
|---|---|---|---|
| [#431](https://github.com/cloudsforge-online/micro-org/issues/431) | non-func | The estate does not survive a reboot of the app host, and nothing inside it can tell us | 3d |
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
2. **#25**, because the public secret is the only item here a stranger can act on today.
3. **The key-concentration block** — #473, #206, #423, #510, #508 — as one piece, since
   they share context and a single deploy.
4. **P1, starting with #431.** Everything else in that band assumes the estate comes back
   after a reboot, and nothing has proven it does.

The consolidation is deliberately absent: it closed cleanly, and what it left behind is
three P2 maintainability items rather than a tail of defects.

## Changelog

- **2026-09-01** — compiled.
