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
| P1 · controls that do not work | 10 | ~14.5 |
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
| [#533](https://github.com/cloudsforge-online/micro-org/issues/533) | non-func | Testnet reconciliation stopped on 2026-08-25 — ledger + alert **shipped**; the indexer half remains | 1d |
| [#534](https://github.com/cloudsforge-online/micro-org/issues/534) | functional | ~~Six services still store a person and are neither registered for erasure nor exempt~~ — **closed 2026-09-02**: all six shipped, and `check-erasure-register.py` reports 24 of 24 | done |
| [#474](https://github.com/cloudsforge-online/micro-org/issues/474) | functional | **No erasure handler reaches more than one database** — 191 rows naming a person sit in seven testnet databases | 2d |
| [#517](https://github.com/cloudsforge-online/micro-org/issues/517) | non-func | The restore drill reports a mismatch on a healthy run | 1d |
| [micro-agora#11](https://github.com/cloudsforge-online/micro-agora/pull/11) | functional | **A GDPR erasure has been failing for everyone who owns a Homestead** — eight events retrying continuously since at least 2026-08; the person asked to be erased and was not being. **Fixed** (micro-agora#11) | done |
| [#541](https://github.com/cloudsforge-online/micro-org/issues/541) | non-func | One failing route fires twenty-four SLO alerts — the merged pod labels one counter with twenty service names, so nineteen are false and a real per-module breach would be diluted twentyfold | 1.5d |
| [#539](https://github.com/cloudsforge-online/micro-org/issues/539) | non-func | Eleven `BeaconTargetDown` alerts and not one surface is down — **closed 2026-09-02**, and the cause was three REQUIRED sibling checkouts missing from the node | done |
| [#538](https://github.com/cloudsforge-online/micro-org/issues/538) | functional | The conformance corpus records Ninety Days After as a draft, and it went live — a reviewed re-record, not a code change | 0.5d |
| [#537](https://github.com/cloudsforge-online/micro-org/issues/537) | non-func | The conformance runner was left behind by the Kubernetes migration — **closed 2026-09-01**, corpus replaying and `ConformanceCorpusStale` clear on every suite | done |
| [#443](https://github.com/cloudsforge-online/micro-org/issues/443) | non-func | The conformance runner borrows the monitor's journey account — now a **requirement of #537** rather than a separate item; there is no runner to borrow it | — |
| [#503](https://github.com/cloudsforge-online/micro-org/issues/503) | functional | Testnet EMBER frozen since 2026-08-15, constant reconciliation drift | 2d |
| [#472](https://github.com/cloudsforge-online/micro-org/issues/472) | functional | The testnet identity issues tokens no testnet service will accept | 1d |
| [#518](https://github.com/cloudsforge-online/micro-org/issues/518) | owner · functional | The testnet faucet has never been funded — 0 EMBER; the log spam is fixed, the float is a treasury call | — |
| [#207](https://github.com/cloudsforge-online/micro-org/issues/207) | non-func | The backup disk exposes no SMART | 1d |
| [#499](https://github.com/cloudsforge-online/micro-org/issues/499) | non-func | estate-ci: the ledger account-key resolver is one over budget — **fixed**, and it was never a blind spot; see the changelog | done |

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
- **2026-09-02, later** — **the merge dropped a compliance handler, and the checker was reading the
  copy that still had it.** `worlds/src/erasure.ts` was written for micro-org#491, reviewed, and
  corrected on 2026-09-01 — that day's commit fixes a leak of the user id into
  `reward_grants.idempotency_key`. Commit `078e799` then copied **twenty-seven** files out of
  `worlds/src` into `agora/src/worlds/` and copied neither `erasure.ts` nor `erasure.test.ts`.
  `check-erasure-register.py` globs every service's `src/migrations.ts` under the estate root, so
  it reads the STANDALONE checkout, which still has the handler; the register said worlds erases,
  the standalone code did erase, and the running module 202-ignored 101 delivered erasure events.
  I then wrote a second handler and **reproduced the exact leak the first one had already fixed**
  — the cost of the dropped file, stated precisely. Both files restored verbatim;
  `check-absorption-carried-every-file.py` compares every absorbed module against its own
  checkout, with a `--self-test` that builds a fixture with one file left behind and asserts the
  check fails on it. Twenty-two absorbed services, all now carrying every file.
  (micro-org#543, micro-deploy#304, micro-agora#16, release 2026.8.113)
- **2026-09-02, later** — **#534: six services with no erasure handler become four, and the
  expensive half of the issue turned out not to exist.** `agora/src/server.ts` already recorded
  the condition under which one webhook may serve several modules — ONE KEY, NOT THREE — and
  `agora`, `studio`, `foresight` and `wallet` all verify with the estate-wide
  `OUTBOX_SIGNING_SECRET`, exactly as the three titles do behind emberkin's fan-out. So studio and
  foresight needed **no new route, no new ingest secret, no deploy provisioning and no fourth
  subscription row**: the square's webhook verifies once and fans out, and `InboundSink` moved to
  the process root because a host importing a type from one of its modules is the layering
  inverted. Both handlers sweep every plane from their own selector, from their first line.
  studio DELETES everything, including the row that looks financial and is not — `credit_accounts`
  is a spending cap, nobody is owed the remainder, no ledger entry references it, which is exactly
  what separates it from `billing`. foresight RETAINS and narrows, and needed **migration 14**
  first: `custodial_stakes_money_is_immutable` refused any change of `subject`, which is the
  second time in two days a trigger has blocked an erasure the same way tessera's Homestead guard
  did. `positions.staker` is deliberately not erased — it is a chain address mirrored from Hearth,
  public whatever this database says, and not a subject the estate assigned.
  (micro-agora#17/#18, micro-deploy#306/#307, release 2026.8.114)
- **2026-09-02, last** — **the owner answered the question, and #534 closes.** The four services
  still failing `check-erasure-register.py` were the four micro-org#534 said needed a decision
  rather than code: `wallet`, `ledger`, `custody`, `pool`. The question was one question for all
  four — *what does the estate do with a balance, a deposit address, a key and a payout owed to a
  person who has asked to be forgotten?* The answer, in the owner's words: **when a person needs
  to forget, everything will be anonymised.** It is recorded in full in the header of
  `deploy/erasure/register.psv`, together with the clause that keeps the already-shipped
  delete-based handlers legal: deletion stays available where it leaves LESS behind than
  anonymisation would, because it is then the strictly stronger form of the same outcome. Free
  text the person wrote is neutralised as well as the identifier.

  Three of the four anonymise and one deletes, and **each handler argues its own case in its own
  file** rather than deferring to the register:

  * `ledger` — a journal you can delete a party out of is not a record. Delete an account and every
    posting referencing it is a debit with no counterpart. `accounts.subject` is the only column
    here that names a person, so ONE UPDATE covers the service, and `erasure.test.ts` asserts that
    from `information_schema` rather than trusting the reading — a migration that denormalises the
    subject for a reporting query turns the test red instead of leaking quietly.
  * `custody` — the row is half of a key controlling money on a public chain and the other half is
    the chain, which nobody can edit. Deleting it destroys the only route back to an address that
    still holds coins. **The status column is deliberately untouched**, and that is the subtle
    part: `gates.ts` refuses to sign for a non-active key, so retiring a departed person's deposit
    address would not stop deposits — it would stop the estate MOVING what arrives. Anonymising
    strands the identity; retiring would strand the money.
  * `wallet` — the same argument one level up, and the cheapest of the four to deliver: no route,
    no subscription row, no secret, no deploy provisioning. It joins studio and foresight as an
    `InboundSink` on the square's existing webhook, on the ONE KEY, NOT THREE condition.
  * `pool` — DELETES. `pool_account_links` is the only place a person appears — migration 3
    refused to put a nullable `user_id` on `pool_workers` precisely so it would stay that way —
    and anonymising would leave `erased:<uuid> -> <account>`, a row whose only content is that
    somebody who no longer exists mined under that label. Deleting also lands on a path
    `payouts.ts` already handles: null from `userForAccount` is its NORMAL answer, because most
    pool accounts are a firmware miner's own payout address with no estate user at all.

  **The catalogue sweep found what a reading of the schema would not**, for the second time in two
  days: `wallet.idempotency_keys.key` is `<userId>:<route>:<clientKey>` — the person embedded
  verbatim in a text PRIMARY KEY — and `custody_keys.idempotency_key` is caller-supplied text with
  no defined shape at all. Both handlers' tests now walk `information_schema` and sweep every
  text, jsonb and uuid column for the raw id.

  Two limits are **recorded rather than papered over**: nothing settles a departing person's
  balance before the identifier goes, and a firmware miner's payout address cannot be erased on
  this event because nothing links it to a user id. A handler that refused the erasure until the
  balance was zero would be an erasure that never completes, which is the failure this whole
  subscription exists to end.
  (micro-ledger#28, micro-custody#22, micro-pool#33, micro-agora#19, micro-deploy#309)
- **2026-09-02** — **#541 was not the app labelling a metric; it was a stale scrape list, and
  the merge's own CNAMEs made the staleness green.** The kernel emits ONE unlabelled
  `http_requests_total` and `merged.test.ts` forbids a `module=` label on it, so two of the
  issue's three proposed fixes were solutions to a problem the process does not have. The
  `service` label comes from the target — and the deployed target file held **twenty-one
  entries pointing at the same agora pod**, because every absorbed service keeps an
  ExternalName CNAME onto its absorber and a target aimed at one is `up`, fast, and returns
  the absorber's page. The generated list was never wrong: rendered against 2026.8.109 it
  emits **seven**. It had been rendered on 2026-08-19 and never refreshed, because
  `release-deploy.sh` re-rendered the scrape list on every compose deploy and `k8s-deploy.sh`,
  which replaced it, did not render it at all. Deploy now refreshes the telemetry plane from
  the release it applies; `check-prometheus-target-aliases.py` refuses two targets that resolve
  to one workload, reading the cluster and not the checkout. 28 service labels → 8 within a
  minute. (micro-deploy#299, micro-org#541 closed)
- **2026-09-02** — **#474 closed: every deletion request since the k8s migration erased the
  mainnet rows and left the testnet ones.** The issue was filed about a routing problem that
  the consolidation dissolved — there is no second estate to reach — but the property it
  described was still true in a new form. `identity`'s relay sends no `CF-Network`, so every
  handler's `ctx.sql` was the pod's own plane, and `agora` alone carries twenty-two
  `*_DATABASE_URL_TESTNET` variables. Measured: 78 erasure events on mainnet, 24 on testnet,
  **zero in common**, testnet stopping dead on 2026-08-19. Twelve ingest paths now sweep the
  module's selector through `eraseEveryPlane`; four deliberately do not, because an audit row,
  a sale and a feed entry belong to the estate they happened in and a person does not.
  Repaired by clearing 1,616 delivery rows and 101 outbox rows so the relay re-sent everything:
  **every registered service now holds all 101 events on both planes.** Three releases and
  three replays, because the census found two more defects the code review had not.
  (micro-agora#12/#14/#15, releases 2026.8.110–.112)
- **2026-09-02** — **the replay found a service that was registered for erasure and had no
  handler.** `worlds` is in `erasure/register.psv` as `mixed`, `check-erasure-register.py`
  reported it `ok`, and micro-org#491 was closed as fixed. 101 deliveries succeeded, 0 failed,
  and its inbox held **0** rows on both planes — every one took the `202 {status: 'ignored'}`
  branch, which is the right answer for a topic a service is not subscribed to. A register row
  is not a handler, and nothing compared the two. Its handler now exists, with the per-table
  matrix beside the code: `reward_grants` is retained and anonymised because `journal_entry_id`
  names a ledger posting and `seasons_within_budget` holds the sum of those rows.
  (micro-org#543 closed, micro-agora#13)
- **2026-09-02** — **three of eighteen register rows had no subscription at all**, and one
  named a URL that resolves to a 410. `worlds` was subscribed at `http://worlds:4000/v1/events`
  — a name that resolves, through the merge's CNAME, onto agora's deliberate tombstone for the
  bare path — while `agora`, `worlds` and `analytics` had no row in
  `identity.event_subscriptions` whatsoever. Two more were subscribed through alias names that
  work until a CNAME is tidied away. Repaired live; the register is fixed; and
  `check-erasure-subscriptions-live.py` now POSTs an unsigned body to every subscription URL
  and refuses a 404/405/410 — a check that cannot live in CI, because whether a URL is answered
  by a handler or by a tombstone is a property of the running process. (micro-deploy#300)
- **2026-09-02** — **#539 closed, and the cause was a layer below the probes.** The eleven alerts
  were stale probe rows, but the reason they were stale is that the seeder that writes them
  *cannot run on the node*: `contracts`, `ui` and `agora` — three checkouts
  `provision-siblings.sh` marks **REQUIRED** — were missing from the k3s VM, and there was no Node
  binary either. `estate-bootstrap.sh` has checked the siblings since micro-org#350, but the k8s
  estate is not brought up with `estate-bootstrap.sh`, so on the cluster node **nothing had ever
  checked them**. Provisioned; `node-tool.sh` fetched its pinned tarball first time; the seeder
  repointed all eleven at the apex mounts and gave `agora`, `exchange` and `journal` a probe they
  had never had. `estate-verify.sh` now runs the check itself, as a failure and not a note
  (micro-deploy#296) — both halves of that are this estate's own history.
- **2026-09-02** — **the twenty-four SLO alerts were one failing route, and the route was a GDPR
  erasure.** Chasing them found `POST /v1/events/tessera` 500ing continuously — 2,962 of the last
  4,000 lines of agora's log — on a Postgres refusal: *"parcel … is a Homestead — it is not
  tradeable"*. `eraseUser` repoints every retained row onto an `erased:` placeholder, and
  `tessera_guard_homestead` refuses **any** change of a Homestead's owner. The handler does not
  catch it, so no inbox row is written and the relay redelivers for ever. **A Homestead is the free
  starter parcel**, so this is the erasure failing for approximately everybody. Migration 16 admits
  exactly one transition, one-way. The fixtures never held a Homestead — and the author of that
  file had anticipated the *other* trigger on the same UPDATE and defeated it deliberately, which
  is the sharpest possible statement of why the common row belongs in a fixture. (micro-agora#11)
- **2026-09-02** — #541 filed: **nineteen of those twenty-four alerts named services that had done
  nothing.** Every module in the merged pod labels one shared `http_requests_total` with its own
  service name, so twenty services report the same 2.84 req/s to five decimal places and one
  route's 500s appear under ten of them. Three of the false ones page. The inverse is worse than
  the noise: a module that really is failing is diluted twentyfold by nineteen that are fine.
- **2026-09-02** — and the last firing family was the **inverse** of everything above:
  `BackupNeverRun` on a testnet runner that does not exist, about databases that *are* backed up —
  54 dumps in the 2026-09-01 set, 22 of them `*_testnet`, because the two Postgres clusters became
  one. An alert that says a control is missing when it is present teaches the same lesson as a
  false green. Removed with its scrape job (micro-deploy#297). **Mainnet's firing-alert count went
  from 40 to 1 today**, and the one that remains is true: micro-org#538.
- **2026-09-01** — #537 closed, and the estate has a conformance gate with an input again. The
  runner shipped as an image (micro-conformance#10) and a **CronJob** (micro-deploy#292) — not a
  translation of the Deployment, because a container that sleeps for a day is a container whose
  failure to wake up nothing notices. First real pass: **8/8 suites published**,
  `ConformanceCorpusStale` from 8 firing to **zero**, and `HearthConformanceVectorsFailing` from
  two (20 vectors in `chain`, 12 in `health`) to one — because those thirty-two were a fortnight-old
  measurement, and `chain` and `health` now pass. **Each of the first three runs found a fault, and
  each failed by blaming something else:** the apply script's image check used `docker manifest
  inspect` on a node with no docker; a Secret volume gave the pod a directory it could list and
  files it could not open, reported as a MISSING secret rather than a permissions one; and I left
  out the trust bundle on an argument the harness refused — *"every scenario would skip on a
  handshake failure that reads like a dead estate"* — which is right, and weakening that check to
  fit the deployment would have been the move these checks exist to prevent. Five orphaned suite
  rows withdrawn with README §2c's own predicate (`DELETE 5`); one real difference left, #538.
- **2026-09-01** — #539 filed while verifying the above, and it is the third thing this week that
  was firing correctly at nobody. Eleven `BeaconTargetDown` alerts on mainnet, and **not one of the
  eleven surfaces is down** — they 301 to the apex mounts and answer 200 there. The probe is right
  to call a 301 down (`redirect: 'manual'`, deliberately); the probe ROW is stale. The surface
  registry already records all eleven as apex mounts and the seeder derives every URL from it, so
  the fix is `estate-seed.mjs --only beacon` — except **the node cannot run it**: `~/dev/cloudsforge`
  holds deploy, org, runtime and miner-keys, and `provision-siblings.sh` marks `ui` REQUIRED for
  exactly this seeder. That half is the durable one.
- **2026-09-01** — #499 closed, and neither of the two numbers it failed on measured anything
  real. It read **9 places against a budget of 8**, then **19** after the service merge, while
  the estate did not get less readable either time. The ninth place was `wallet/src/money.ts`'s
  exchange desk — a named constant and two plain string literals — reported as "purpose not
  static" only because ledger migration 18 added `inventory` to `accounts_purpose_chk` and
  conformance's hand-copied mirror of that constraint was never touched. `vocabularyDrift` now
  reads both constraints out of the migrations and refuses on drift in either direction; the
  **retired** direction is the one to fear, because a word left behind after the ledger drops it
  would let the sweep bless a value the check constraint rejects. The other ten were one service
  counted twice: the merge moved twenty services into `agora/src/<name>/` and deleted no
  repository. And underneath both, the merge had **quietly weakened the resolver** — one resolver
  per repository stopped being one per service the moment `agora` became sixteen of them, which
  is the exact cross-service guess `repoResolver`'s docstring forbids. `BASELINE_UNRESOLVED`
  stays 8 and the eight places are the same eight its header already described. (micro-conformance#8)
- **2026-09-01** — the same merge fault had broken **three more estate-ci sections**, and running
  the job rather than reading it is what found them. The **body scan** was green at its ratchet
  of 38/32 on 18 August and read **178/172** today, because `agora` absorbed `wallet`, wallet has
  a secret-bearing column, and sixteen services' 662 routes joined the key-material gate. Judging
  the *service* rather than the repository it shares puts it back on 38/32 with the identical
  split — 18 identity, 10 notify, 4 devplatform — which is the evidence nothing was lost.
  **derive-grants** had six failures, five of them gap entries keyed on paths that no longer
  matched a file; fixing it exposed the one that mattered, that `hub-api` and `admin-api` were
  attributed to `agora` itself, **a grant widening dressed up as a derivation**. And **two
  canaries** were planting injections into checkouts the checkers no longer read, so both
  accused a checker of a fault that was in the canary; they now ask where the checker reads
  rather than knowing. (micro-conformance#9, micro-deploy#291, micro-agora#10, micro-org#536)
- **2026-09-01** — #537 filed, and it is why #443 stops being its own item. The conformance
  runner exists only as a compose service and **was never translated into a Kubernetes
  workload** — no Deployment, no CronJob, no Job in any namespace. `conformance_runs` stops on
  2026-08-18, the day of the migration, and `ConformanceCorpusStale` has been firing on every
  suite for fourteen days saying exactly the right thing: *"Find the runner, not the
  divergence."* `HearthConformanceVectorsFailing` is firing beside it on an input that stopped a
  fortnight ago. #443 reports that the runner borrows beacon's eighth journey account; there is
  no runner to borrow it, so that shared-fate defect becomes a requirement of rebuilding it.
- **2026-09-01** — #455 closed (micro-org#535). The check moved ahead of the write: an
  unresolved digest now refuses and names which entries, instead of emitting a file the org
  suite rejects two steps later after a PR has been merged. The escape hatch is kept —
  `--allow-missing-digests` — because the existing argument for it is right: GHCR publishes
  minutes after the push. What changed is the default. The bug was never logic, it was
  **ordering**: the check ran after the write, so the only way it could fail was as somebody
  else's problem.
- **2026-09-01** — #474 re-measured, and the consolidation changed its shape rather than
  fixing it. The mechanism it describes — subscription URLs resolving only inside the mainnet
  compose network — is gone. What replaced it is the same defect one layer down: **not one
  erasure handler in the estate reaches more than one database**, because they run on
  `ctx.sql` and an inbound event carries no `CF-Network` header, so it resolves to the
  `singleNetwork` fallback. Seven testnet databases hold **191 rows** naming a person that no
  erasure can reach. Fixed for worlds in micro-worlds#21 — including the handler I had merged
  an hour earlier, which had the same fault. `networkSql.each` was already the right
  primitive and was simply unused on this path.
- **2026-09-01** — #491 closed (micro-worlds#20, micro-deploy#289): an erasure handler with a
  table-by-table matrix and the lawful basis for each retained row, plus the register row
  without which it would have been correct and unreachable — identity had ten subscriptions
  and worlds was not one. **The catalogue sweep found a real leak on its first run**:
  `rewardIdempotencyKey` embeds the user id verbatim in `reward_grants.idempotency_key`, two
  columns to the right of the one I had anonymised, where a per-table assertion would have
  passed. Replaced in the band by #534 — `check-erasure-register.py` was already failing for
  **seven** services, not one; six remain, and five of those are financial, where retention is
  probably right and the decision needs writing down rather than coding quickly.
- **2026-09-01** — #515 closed: no scratch database exists among the 53 on the cluster, and
  the runner has run daily since, so a leak would be visible. Largest is `indexer` at 17 GB,
  which is legitimate. #518 re-classified **owner**: nothing is broken — the faucet holds
  the queue correctly and says so — it has simply never been funded, and the float is a
  treasury decision with no runbook. What I did fix is micro-faucet#15: it was re-announcing
  the dry condition every two seconds, ~43,000 lines a day behind as many `eth_getBalance`
  calls, duplicating a `faucet_dry` gauge that already carried the level.
- **2026-09-01** — #512 closed (micro-deploy#288). Took the "correct the claim" option:
  `policy.yml` asserted an edge `/internal` rule generated by `gen.py` and diffed by CI, and
  every clause described a topology that had been replaced — so that paragraph reproduced,
  inside the file that names the failure, the failure it names. `check-tunnel-ingress.py`
  now reads the connector's own running config (no Cloudflare credentials) and already
  finds the stale `savvanis.life` rule twice. **I misread the 502 on `/internal` first** as
  "no refusal at all"; it IS the refusal — `cf-refuse` points at `http://127.0.0.1:1`
  deliberately. Verified: every bypass shape refuses, `/internalx` correctly does not.
- **2026-09-01** — #533's ledger and alerting halves shipped (micro-ledger#27,
  micro-deploy#287): `LEDGER_RECONCILE_NETWORK` is a list, the job key carries the network,
  the handler resolves its database from the payload and refuses a network it has no DSN
  for, every series gains a `network` label, and `LedgerReconciliationStale` fires on
  `time() - last_run > 3600`. **Correction to my own filing:** I wrote it up as though the
  ledger were the whole fix. The indexer stopped following testnet on the same day and has
  no `INDEXER_CHAINS` at all, so enabling the sweep first would freeze every testnet asset
  for want of an observation — the exact row already in `ledger_testnet`. The manifest is
  deliberately untouched; the indexer goes first.
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
