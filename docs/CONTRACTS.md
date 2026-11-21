# Contracts: one pachinko round on Sui

Move package `contracts/pachinko/` (edition 2024, Sui testnet only). Two modules:

| Module | Owner | Does |
|---|---|---|
| `round` | Kevin (first version written by Kiana, for Kevin to review) | Lock a bet, draw the seed with `sui::random`, hold the `Round` object and its status |
| `verification` | Kiana | Submit result (hash checked on-chain), challenge window, admin arbitration, finalize, payout |

Boundary (project plan §6): `round` ends at "Round with seed". Everything after the seed is
`verification`. `verification` changes the round status only through `public(package)`
transition functions in `round`, so the state machine is written in one place.

Shared interface (object fields, events, signatures): `docs/SPEC.md` §7.

---

## 1. Flow

```
player            anyone            operator (OperatorCap)       anyone / AdminCap
──────            ──────            ──────────────────────       ─────────────────
create_round ──▶  draw_seed  ──▶    run runRound(seed) off-chain
(bet locked)      (sui::random,     submit_result(outcomes, hash, bond)
                   later tx)          └─ sha2_256 checked on-chain
                                      └─ window starts (sui::clock)
                                                │
                       ┌────────────────────────┴───────────────────────┐
                 no challenge                                   challenge(bond) in window
                 window over                                             │
                       ▼                                                 ▼
                  finalize ──▶ pay player,                   resolve_by_admin(correct outcomes)
                               operator bond back             ├─ hash equal  → operator honest
                                                              ├─ hash differs → operator forged
                                                              └─ loser's bond → winner, pay player
```

## 2. State machine (`Round.status`)

```
 BET_LOCKED(0) ──draw_seed──▶ SEEDED(1) ──submit_result──▶ SUBMITTED(2) ──finalize (now ≥ deadline)──▶ FINALIZED(4)
                                                                │
                                                     challenge (now < deadline)
                                                                ▼
                                                          CHALLENGED(3) ──2 matching votes / admin fallback──▶ FINALIZED(4)

 SEEDED(1) ──refund_unsubmitted (now ≥ submit_deadline, no result)──▶ REFUNDED(5)
```

- There is no cancel function: once a bet is locked, the round can only move forward (fairness rule 3).
  The one way back is the refund when the operator never submits, and its window is fixed per round
  before the seed exists (§11.4), so the player cannot use it to undo a losing round.
- Every transition asserts the current status and aborts with a named error (`ESeedAlreadyDrawn`,
  `ENotSeeded`, `ENotSubmitted`, `ENotChallenged`); the ones `verification` drives are `public(package)`.

## 3. Objects

| Object | Module | Kind | Fields |
|---|---|---|---|
| `AdminCap` | round | owned (publisher) | `id` |
| `Game` | round | shared, one per package | `id`, `next_round_id: u64` (starts at 1), `config_version: String`, `submit_window_ms: u64` (starts at 120 000) |
| `Round` | round | shared, one per round | `id`, `round_id: u64`, `player: address`, `config_version: String`, `seed: vector<u8>` (empty until drawn, then 32 bytes), `bet: Balance<SUI>`, `status: u8`, `submit_window_ms: u64` (copied from `Game`), `submit_deadline_ms: u64` (set by `draw_seed`) |
| `OperatorCap` | verification | owned (issued by admin) | `id` |
| `House` | verification | shared (created by admin) | `id`, `treasury: Balance<SUI>`, `multipliers_bps: vector<u64>` (one per pocket), `balls_per_round: u64`, `operator_bond: u64`, `challenger_bond: u64`, `challenge_window_ms: u64`, `vote_window_ms: u64`, `pool: Pool` |
| `Pool` | committee | inside `House` | `stake: u64`, `members: vector<address>`, `verifiers: Table<address, Verifier { stake, open_duties }>` |
| `Dispute` | committee | dynamic field on a challenged `Round` (key `DisputeKey`, removed when settled) | `deadline_ms: u64`, `excluded: vector<address>`, `committee: vector<address>`, `votes: vector<Vote { voter, result_hash }>` |
| `Submission` | verification | dynamic field on `Round` (key `SubmissionKey`) | `house: ID`, `operator: address`, `outcomes: vector<u16>`, `result_hash: vector<u8>`, `deadline_ms: u64`, `operator_bond: Balance<SUI>`, `challenger: Option<address>`, `challenger_bond: Balance<SUI>` |

- `Submission` stays on the round after finalizing (bonds withdrawn), so the final result can be read on-chain.
  If a challenge succeeds, it holds the corrected outcomes and hash.
- On-chain outcomes are `u16`, and `0xFFFF` means "never landed" (`-1` in physics). These are exactly the
  `i16 BE` bytes in the SPEC, so `sha2_256` on-chain equals `hashRoundResult` off-chain.

## 4. Functions

`round`
| Function | Who | From → to |
|---|---|---|
| `create_round(game, bet: Coin<SUI>, ctx)` | player | — → BET_LOCKED (shares `Round`) |
| `entry draw_seed(round, r: &Random, clock, ctx)` (non-public) | anyone | BET_LOCKED → SEEDED (starts the submit window) |
| `refund_unsubmitted(round, clock, ctx)` | anyone (bet goes to the player) | SEEDED → REFUNDED, now ≥ `submit_deadline_ms` |
| `set_config_version(&AdminCap, game, version)` / `set_submit_window(&AdminCap, game, ms)` | admin | — (new rounds use them) |

`verification`
| Function | Who | From → to |
|---|---|---|
| `issue_operator_cap(&AdminCap, recipient, ctx)` | admin | — |
| `create_house(&AdminCap, multipliers_bps, balls_per_round, operator_bond, challenger_bond, challenge_window_ms, verifier_stake, vote_window_ms, ctx)` | admin | — (shares `House`) |
| `join_pool(house, stake, ctx)` / `leave_pool(house, ctx): Coin<SUI>` | verifier | — |
| `fund_house(house, coin)` / `withdraw_house(&AdminCap, house, amount, ctx): Coin<SUI>` | anyone / admin | — |
| `submit_result(&OperatorCap, round, house, outcomes, result_hash, bond, clock, ctx)` | operator | SEEDED → SUBMITTED |
| `challenge(round, house, bond, clock, ctx)` | anyone | SUBMITTED → CHALLENGED (opens the `Dispute`) |
| `entry select_committee(round, house, r: &Random, clock, ctx)` (non-public) | anyone | CHALLENGED (draws 3 verifiers) |
| `vote(round, house, outcomes, clock, ctx)` | drawn verifier | CHALLENGED → FINALIZED on the 2nd matching vote |
| `resolve_by_admin(&AdminCap, round, house, correct_outcomes, clock, ctx)` | admin, after the vote deadline | CHALLENGED → FINALIZED |
| `finalize(round, house, clock, ctx)` | anyone | SUBMITTED → FINALIZED |

Checks in `submit_result`: `outcomes.length() == balls_per_round`, each outcome `< pockets` or `0xFFFF`,
bond `== operator_bond`, `result_hash == sha2_256(SPEC layout)`.
The window is `[submitted, deadline_ms)`: `challenge` needs `now < deadline_ms`, `finalize` needs `now ≥ deadline_ms`.
Each function runs the status transition first, so a call in the wrong state aborts with the
`round` status error; any later check that fails reverts the whole transaction.

Reads: `result_hash(config_version, seed, round_id, outcomes)` (SPEC §3 hash, same bytes as
`hashRoundResult`), `submitted_hash(round)`, `treasury_value(house)`, `pool(house)`, `dispute(round)`.

**Arbitration.** The committee's `vote` and the admin's `resolve_by_admin` both end in one internal
`resolve(round, house, correct_outcomes, by_committee)`. The correct outcomes are posted, not a verdict:
the verdict comes from comparing hashes, so no arbiter can rule "honest" while posting different outcomes.
`committee::settle` then pays and slashes the drawn verifiers (§11.3).

## 5. Events

One per state change: `RoundCreated`, `SeedDrawn` (+ `submit_deadline_ms`), `Refunded`, `ResultSubmitted`, `Challenged`, `Resolved`
(a settled dispute also emits `Finalized`), `Finalized`, `CommitteeSelected`, `Voted`, and from `committee`
(the pool): `VerifierJoined`, `VerifierLeft`, `VerifierSlashed`. Fields: `docs/SPEC.md` §7.

## 6. Payout (placeholder, one function: `verification::pay_out`)

```
payout = bet × Σ multipliers_bps[outcome_i] / (ball_count × 10_000)      (outcome -1 pays 0)
```

Each ball stakes `bet / ball_count`. The sum is taken in `u128` and divided once at the end, so
nothing is lost to rounding on every ball. Multipliers are capped at `MAX_MULTIPLIER_BPS` (100×) so
the `u128` product cannot overflow.

**Pool (agreed):**
- A bet stays locked in its `Round` until settlement. Then it joins the house treasury, and the payout is paid from the treasury.
- Losing rounds grow the pool, and wins can exceed the bet.
- The admin calls `fund_house` once at setup for starting liquidity, and again whenever the pool runs low.

### Who re-runs the physics: detect, then resolve

The contract only checks that the outcomes match the hash, not that the physics was run. A wrong
result is caught in two separate steps, and both re-run the same `runRound(seed, round_id)` at the
round's `config_version`:

| Step | Who | When | Does |
|---|---|---|---|
| 1. Detect | anyone: the player, or an optional watchdog | every submitted round, inside the challenge window | replays the public seed and compares its hash with the submitted one; on a mismatch, calls `challenge` with a bond |
| 2. Resolve | a committee of 3 staked verifiers drawn at random (§11); the `AdminCap` arbiter only as fallback | only after a challenge | re-run the round and vote; 2 matching votes settle it (`resolve`); the dishonest side loses its bond |

Step 1 is needed: with no replay there is no challenge, and a forged result finalizes after the
window. The player decides how to replay: the page (it already replays every round to draw it),
`npm run replay`, or their own code. The page compares hashes once its replay has played to the end
and shows a **Challenge** button while the window is open (anyone may challenge; on a match it warns
that the bond would be lost). `npm run bet:testnet` does the same check in the terminal. A watchdog
process (its own key, not built yet) would do it when no player is watching. Because the simulation is
deterministic, every dispute has one correct answer.

## 7. Open decisions

| # | Question | Placeholder now |
|---|---|---|
| 1 | Real multipliers / RTP per pocket (Phase 4 odds) | admin-set `multipliers_bps`; pool funding agreed (§6) |
| 2 | Payout cap, and checking that the house can cover a bet when it is placed | none: `finalize` aborts (`EHouseInsolvent`) until the house is funded |
| 3 | `withdraw_house` can take funds that pending rounds need | admin is trusted for now |
| 4 | Timeout if the operator never submits, or the arbiter never resolves (Phase 3 fallback) | operator: refund after the round's submit window (§11.4, built in Move). Arbiter never resolving after a failed committee: still waits |
| 5 | Committee of staked verifiers (2-of-3) replacing `AdminCap` arbitration | built in Move (§11); verifier node, page and testnet run next |
| 8 | Who detects wrong results (§1, step 1): player, plus an optional watchdog | the player: the page and `bet:testnet` compare hashes and challenge; no watchdog yet |
| 6 | Bond sizes and challenge window length | admin sets them per `House` |
| 7 | Upgrade policy for the package (`UpgradeCap`) | kept by the publisher |

## 8. How to run

Setup and running a round: root `README.md`. Build, test, keys and troubleshooting:
`contracts/pachinko/README.md`.

## 9. Scripts and testnet runs (`scripts/`)

| File | Does |
|---|---|
| `src/deploy.ts` | `npm run deploy:testnet`: `deploy`, then saves `chain/src/deployments/<PACHINKO_DEPLOYMENT>.json` |
| `src/verifiersSetup.ts` | `npm run verifiers:setup`: funds each `VERIFIER_PRIVATE_KEYS` key from the main key (stake + 0.05 SUI gas) and joins it to the pool; skips keys already in it |
| `src/bet.ts` | `npm run bet:testnet`: player side only: `createRound`, then follow the round's status until FINALIZED. At SUBMITTED it replays the seed and compares hashes (§1 step 1); on a mismatch it challenges. Prints the verdict (if challenged) and the payout. Needs `npm run operator` running |
| `src/steps.ts` | the steps the scripts sign (`@pachinko/chain` transactions): `deploy` (publish → create house → fund house) · `createRound` · `challenge` · `fund` · `joinPool`. The operator's steps (seed, submit, finalize), the arbiter's and the verifiers' live in `physics-service/src/` |
| `src/sui.ts` | `SuiGrpcClient` (testnet JSON-RPC is off), `execute` (sign, print digest + Suiscan link, fail on abort, wait for indexing), created-object and BCS-event readers, `buildPackage` (`sui move build --dump-bytecode-as-base64`) |
| `src/env.ts` | settings from the repo-root `.env`; only `SUI_PRIVATE_KEY` is required |

`createRound` checks that the round's `config_version` equals the local physics version before the
player follows it. The two runs below from 2026-11-17 were made with the former one-process scripts
`round:testnet` and `forged:testnet` (removed 2026-11-21; the operator, the page and `bet:testnet` cover both).

Deployments: each teammate has their own (`PACHINKO_DEPLOYMENT` in `.env` picks
`chain/src/deployments/<name>.json`), so tests on one machine never touch another person's rounds.
`kiana`: package `0x3a6d1d421d136457f51d746df6f5bdcd8c926ec2382032957be70bdb409a0ebb` (2026-11-21, with the committee and
the refund timeout; earlier `0x3738…0bb0`). After a contract change every teammate runs `npm run deploy:testnet` again:
new structs can't be a package upgrade.
The first two runs below are from earlier one-off publishes.

### Testnet run: honest round (2026-11-17)

Package `0x66cfd09be5180747c3b9a86fa3976b1f2b746c278f9de87aeef46bdd79dc5cbd`, round object
`0x88a8c4fef0be35eee3b8e9ac1c9f9048df871027f86545acebb9f7629283380b` (round 1, final status 4).

| Step | Digest |
|---|---|
| publish | `J7LPak7x1RWG8agvS4pvfXTaRsXeSTB67iL9HjwyHnGE` |
| create house | `Ejm6oJtrM6QAAkGk3ftVcknQ9bGPF9tv7ddtczeMAD6d` |
| fund house | `8C1oAuaR3Zp7FCrecg9wquT861E35PpQsZcoztgypgJB` |
| create round | `6DvVNyh7GCaqoBhzYMcU6hHeSUbRBr9A2SCSXikLAFYz` |
| draw seed | `5QLMc74DRhZww1NjJBji9tBQv3vNeynKrY5gARgDQnoP` |
| submit result | `UV5112TbWdDCEB13k9nbVji3DjHWRtT3qjZBPga5HzC` |
| finalize | `3Ubwwnz5kKnSSdY6H6Hnm467N3gTz3iRnzHEA5Y7gzr3` |

- Seed: `ae32903f0b9717c2b94d375c43c9e3a02baf04f5208156504a9d03b315d966c3`.
- Result hash: `d1d588a40a15250c4afdd054174c87f7bce72ae107455684e2e687741db759d7`. `npm run replay -- <seed> 1` gives the same hash.
- Bet 0.01 SUI, payout 0.01 SUI (flat 1× placeholder multipliers).
- View any digest at `https://suiscan.xyz/testnet/tx/<digest>`.

### Testnet run: forged result caught (2026-11-17)

Package `0x1ae062c5b55d9efff887159b7a3151279cbd1b865db978c4026a0248b9347a57`, round object
`0xe432defe0988193e4b4ebbb5bf8f4bd596213b17fa6c9d7aee045dd8fc3d7e17` (round 1, final status 4).

| Step | Digest |
|---|---|
| publish | `A31zLdzESY1MDok6sXyPsTcHip9a4pqZaHvEoUDjXCr6` |
| create house | `gi1K2rvyEqZ79uGPmFWQKZBwtUZ9NBJgn2JbN8r5yvo` |
| fund house | `9uNqWMMcJtB8kn6JrZgpRRquH5HSCNnA6wG8e6T2YzhD` |
| create round | `5BpPAAGKw8srkRsbhGaAsMHdFAb9UUdCvZq7ch68NaVg` |
| draw seed | `CGrpuy7wggvz9aAoUobPjacfUsm5TD35CeWLq86cWUYZ` |
| submit (forged) | `4QKEKDBtKh2dtKbTBcvF9q9opjTZxwj2Nk8AXNErr3xx` |
| challenge | `9Bi8YWUaCknPUgbBFLnRWDLYpoHbNkBxnauxojz9WfmL` |
| resolve (admin) | `2sWH9XnrCdnXoC2H6Fo8TYohKHuF5qnerD518zheoo6j` |

- **Forged vs true:** the operator claimed all 100 balls in pocket 0. The true physics result was pockets `13 11 16 21 18 10 11`, hash `71a11496…1ed6`.
- **`Resolved` event:** `operator_honest = false`, and the winner (the challenger) got both bonds (0.02 SUI).
- **Stored result:** the stored and finalized result hash is the true one.
- **Same key both sides:** this run had no `CHALLENGER_PRIVATE_KEY`, so the challenger was the main address.
- **Same payout:** with the flat 1× placeholder, the forged and true payouts are equal (0.01 SUI). Real multipliers make the forged claim pay more.


## 10. Connection plan (draft)

Goal: a player clicks **Play on-chain** in the frontend, signs one transaction, and the rest
happens without a terminal. The contracts don't change. Django is not involved yet: the chain
is the source of truth, and Django can mirror rounds later for history.

```
frontend (player wallet)           Sui testnet                     operator (physics-service)
"Play on-chain" → sign ─────────▶ create_round → BET_LOCKED ─────▶ sees RoundCreated
                                                                   draw_seed          → SEEDED
poll Round: seed appears ◀─────── Round.seed ◀───────────────────── runRound(seed, round_id)
runRound(seed) locally → animate                                   submit_result      → SUBMITTED
poll Round: status / deadline ◀── window (anyone may challenge)
show payout ◀──────────────────── Finalized ◀───────────────────── after deadline: finalize → FINALIZED
```

**Decision: the operator draws the seed.** The player signs once, only `create_round`.
`draw_seed` stays callable by anyone, so if the operator stalls, the frontend can later offer
"draw seed" as a fallback (see open decision 4).

### Steps (one commit each)

| # | What | Files | Owner area |
|---|---|---|---|
| 1 ✅ | **Shared chain package** `chain/` (`@pachinko/chain`): BCS event layouts, transaction builders that return an unsigned `Transaction` (`createRound`, `drawSeed`, `submitResult`, `finalize`, …), `-1 ↔ 0xFFFF`, gRPC client factory. `scripts/` switches to it. | new `chain/`; `scripts/src/*`; root `package.json` (workspace) | shared |
| 2 ✅ | **Deploy once:** `npm run deploy:testnet` publishes + creates and funds the House, then writes the ids to `chain/src/deployments/<name>.json` (one per teammate, chosen with `PACHINKO_DEPLOYMENT`; public ids, committed). Scripts, operator and frontend all read it. Scripts reuse it instead of publishing. | `scripts/`, `chain/` | shared |
| 3 ✅ | **Operator loop:** polls `RoundCreated` events for the deployed package; for each round reads its status and does the next step: draw seed → `runRound` → submit → wait for the deadline → finalize. It skips challenged rounds (the arbiter resolves those). Reading the status first makes it safe to restart. Operator key: `OPERATOR_PRIVATE_KEY` in `.env`. | **new files only:** `physics-service/src/operator/*.ts`; `physics-service/package.json` (`npm run operator`, deps) | Kevin's package |
| 4 ✅ | **Frontend on-chain play:** wallet connect (`@mysten/dapp-kit-react` + `dapp-kit-core` hooks with a small `WalletPanel`; the kit's prebuilt connect button didn't receive its instance under React 19, so it isn't used), the player signs `create_round`, the page polls the Round until the seed appears, then plays it with the existing `useRound.start(seed, round_id)`, then shows status and payout until `Finalized`. Local Start / Replay stay as they are. | **new:** `hooks/useOnchainRound.ts`, `components/WalletPanel.tsx`, `components/OnchainPanel.tsx` (+ `.css`), `onchain/deployment.ts`, `onchain/dappKit.ts`; **edited:** `App.tsx` (one panel), `vite.config.ts` (`envDir: '..'`), `frontend/package.json`. `main.tsx` is unchanged: no provider needed | Kevin's game frontend + shared wallet |
| 5 | **Docs:** `SPEC.md` §7.3 (chain package + deployment file), `ARCHITECTURE.md` flow, this file, READMEs | docs | shared |

Kevin's existing files that change: `physics-service/package.json`, `frontend/package.json`,
`frontend/src/App.tsx`, `frontend/vite.config.ts`. Everything else is new files.

### To check while building
- How the operator finds new rounds: GraphQL event query by type (`…::round::RoundCreated`) with a cursor, or a gRPC equivalent if one exists.
- Whether the public testnet gRPC-web endpoint accepts browser (CORS) requests. If not, the frontend reads through GraphQL.
- The player needs a wallet with testnet SUI (faucet). The demo needs the House funded and the operator running.

### Testnet run: connected round with the operator (2026-11-17)

`npm run operator` in one terminal, `npm run bet:testnet` in another (package `0x3738…0bb0`):
the player signed only `create_round` (`Gcn2VLxU…`). The operator then drew the seed (`E6geqMKw…`),
submitted after `runRound` (`2U8ydHXB…`), and finalized 34 s later (`8UE77GBs…`).
From BET_LOCKED to FINALIZED took 41 s; most of that is the 30 s window.

### Testnet run: full round from the browser (2026-11-17)

On deployment `kiana`, with `npm run operator` running, the browser wallet `0x53d1…f332` signed only the bet
(**Play on-chain**). The operator drew the seed, submitted and finalized round 4. The page played seed
`be6542ca…388a` on the board and showed hash `d34c7a9d…0c8c` and the payout (0.01 SUI, flat 1×), matching
the on-chain `Round` and `Submission`.

### Testnet run: player catches a shortchange (2026-11-21)

Deployment `kiana`, `npm run operator` with `OPERATOR_CHEAT=shortchange` (arbiter on), and `npm run bet:testnet`
as the player. Round 10: bet (`9DR2e4ZA…`), seed (`C5g1nyBX…`), forged submit with every ball "never landed"
(`HeyYskGm…`). The player's replay hash `5fc1093c…` did not match the submitted `0b7523a4…`, so it challenged
3 s later (`GgGqT5vr…`). The arbiter re-ran the round and resolved it (`2x33LDw2…`): operator forged, both bonds
(0.02 SUI) to the challenger, and the player was paid from the true outcomes (0.01 SUI, not the forged 0).
The same run in honest mode (round 11) matched (`3deef717…`) and finalized after the window (`DvKtGAnk…`).

### Testnet run: browser challenge (2026-11-21)

Deployment `kiana`, `npm run operator` with `OPERATOR_CHEAT=shortchange` (arbiter on), the page played from the
Slush wallet `0x53d1…f332` (a different address from the operator `0x7584…0663`).

| Round 19 (forged result caught) | Digest |
|---|---|
| bet (wallet) | `AAguVFmc8xk75bnMB8GnN4WPwNErN8AZAxzACJKaZP9p` |
| draw seed (operator) | `Basz5B3hZP5zihnUbfcPeckrnGxMzKf9moHoVhaYYRay` |
| submit, forged (operator) | `CcYu3Lu7T3Ufq88sNfeKMGUw5sn7Fiuno6cA4oWbjiHc` |
| challenge (wallet) | `BjP1YKvhcdexkiBvgtRoZcrf2GieuAzDYb9UauPYtfx` |
| resolve (arbiter) | `3mYmz9sA1Z25PU5f2NVQDAWYG76JDWWqBGqhY29YzaBd` |

- **Check on the page:** submitted hash `308530a7…f43e` did not match the page's replay; the arbiter's true hash
  was `aad81bd5…9bc6`.
- **Verdict:** operator forged. Both bonds (0.02 SUI) went to the wallet, and it was paid 0.01 SUI from the true
  outcomes instead of the forged 0: net +0.01 SUI for the wallet.
- **Challenging an honest result (round 18):** the wallet challenged (`F927rQiM…n4z5`) although the hashes matched
  (`11e91546…217f`). The arbiter found the operator honest (`AA2ZKTom…cGkX`): both bonds went to the operator,
  so the wallet lost its 0.01 SUI bond. Rounds 12, 14 and 15 were further forged results caught the same way.

## 11. Committee and timeout (design 2026-11-21; both built in Move)

Replaces the single admin arbiter (step 2 of §1, "resolve") with a committee of staked verifiers drawn at
random after a challenge, and adds a timeout for an operator who never submits. Decided with Kiana:
**3 drawn, 2 must agree · plain votes · wrong and missed votes are slashed · admin resolves only if the
committee fails**. Everything below this line is a proposal to review (with Kevin for §11.4).

### 11.1 Flow

```
SUBMITTED ── challenge(bond) ──▶ CHALLENGED, dispute deadline = now + vote_window_ms
                                   │
          select_committee(Random) │  separate tx (anyone; like draw_seed), draws 3 verifiers
                                   │  from the pool, excluding the operator and the challenger
                                   ▼
               vote(outcomes) ×N   each drawn verifier re-runs the round and posts its outcomes;
                                   │  the contract hashes them
                 ┌─────────────────┴──────────────────────┐
     2 votes with the same hash                 deadline passes without 2 agreeing votes
     (before the deadline)                                │
                 ▼                                         ▼
   resolve(those outcomes)                     resolve_by_admin (fallback only) → resolve
   → rewards and slashing (§11.3)              → the drawn verifiers who did not vote are slashed
                 └───────────────────▶ FINALIZED ◀────────┘
```

Why the draw is its own transaction: if `challenge` drew the committee in the same call, a challenger
could abort whenever the draw didn't suit them (test-and-abort, the same reason `draw_seed` is separate).

### 11.2 New state

| Where | What |
|---|---|
| `House` (new fields) | `verifier_stake` (exact amount to register), `vote_window_ms`, `submit_window_ms` (§11.4), and the pool: `verifiers: vector<address>` (drawn by index) + `stakes: Table<address, Verifier>` |
| `Verifier` (in the table) | `stake: Balance<SUI>`, `open_duties: u64` (disputes it is drawn for and has not finished; it cannot leave the pool while > 0) |
| `Dispute` (dynamic field on the `Round`, key `DisputeKey()`) | `deadline_ms`, `excluded` (operator, challenger, player, set at the challenge), `committee: vector<address>` (empty until drawn), `votes: vector<Vote { voter, result_hash }>` (the deciding vote's outcomes are the verdict, so votes keep only the hash) |

### 11.3 Functions, rewards and slashing

| Function | Who | Does |
|---|---|---|
| `register_verifier(house, stake)` | anyone | joins the pool; `stake` must equal `verifier_stake` |
| `leave_pool(house)` | verifier | returns the stake; aborts while `open_duties > 0` |
| `challenge(...)` (changed) | anyone | as today, plus creates the `Dispute` with its deadline |
| `entry select_committee(round, house, r: &Random)` | anyone | CHALLENGED, no committee yet, pool has ≥ 3 eligible: draws 3 distinct verifiers, `open_duties += 1` each |
| `vote(round, house, outcomes)` | a drawn verifier | before the deadline, once each; checks outcomes like `submit_result`, stores the hash; on the 2nd vote with the same hash, settles |
| `resolve_by_admin(...)` (changed) | `AdminCap` | only after the deadline and only if the committee has not settled |

Money when the committee settles (defaults; easy to change):

- **Winning side** (operator or challenger): its own bond back + half of the loser's bond.
- **Majority voters**: the other half of the loser's bond, plus the slashed stake, split equally.
- **Minority voters** (voted, different hash): lose half their stake and leave the pool (the rest is refunded).
- **The drawn verifier who had not voted yet** when 2 agreed: no reward, no slash (its vote was not needed).
- **Committee fails** (no 2 agreeing votes by the deadline): drawn verifiers who did not vote lose half their
  stake and leave the pool; the admin fallback settles the bonds as today (winner takes both).
- **A verifier drawn for two disputes** and slashed in one has left the pool; when the other settles it is
  neither slashed again nor freed (and a verifier that rejoined meanwhile never drops below 0 duties).
- The player is always paid from the correct outcomes, as today.

New events: `CommitteeSelected { round, committee, deadline_ms }`, `Voted { round, voter, result_hash }`
(verification), `VerifierJoined`, `VerifierLeft`, `VerifierSlashed { verifier, amount }` (committee).
`Resolved` gains `by_committee: bool`.

### 11.4 Timeout: the operator never submits (`round` module, agreed with Kevin)

- **Never seeded:** no timeout needed. `draw_seed` is open to anyone, so the player can draw the seed.
- **Seeded, never submitted:** `draw_seed` sets `submit_deadline_ms = now + submit_window_ms`. After it,
  anyone may call `round::refund_unsubmitted(round, clock)`: the bet goes back to the player, status
  `REFUNDED` (5), event `Refunded`. There is no operator bond to take yet (it is posted at submit), so a
  stalling operator only loses the round. A late result is still accepted as long as nobody has refunded.
- **The window is fixed per round, before the seed.** The admin sets `submit_window_ms` on the `Game`
  (`set_submit_window`, starts at 2 minutes), and `create_round` copies it into the `Round`. The first draft
  read the window from a `House` passed to the refund, but a round is not tied to a House until a result is
  submitted: a player could pass their own House with a 1 ms window, see the public seed, simulate it, and
  refund only losing rounds. Copying the window at bet time closes that.
- **Limit (for the report):** a colluding operator could still stall on purpose on a colluding player's losing
  rounds. Today operator and House are the same party, so it has no reason to; a split operator would need a
  penalty for missing the window.

### 11.5 Off-chain pieces (verifier node and setup built; page next)

- **Verifier node** (`physics-service`, `npm run verifier`, own `VERIFIER_PRIVATE_KEY`): on `Challenged`,
  calls `select_committee` if nobody has; on `CommitteeSelected` naming its address, runs `runRound` and
  calls `vote`. Same loop shape as the operator and arbiter.
- **Arbiter** (in `npm run operator`): becomes the fallback only; it waits for the dispute deadline.
- **Page:** after a challenge, shows the drawn committee and the votes as they arrive, then the verdict.
- **Demo:** 3 verifier keys funded from the main address (stake + gas each), e.g. `npm run verifiers:setup`
  to create, fund and register them.

### 11.6 Cost and limits (for the report)

- **Interface change:** new `House` fields and `create_house` arguments, new functions and events, the new
  `Round` field and status. Struct changes can't be a package upgrade, so every teammate redeploys
  (`npm run deploy:testnet`) and the frontend and operator move to the new package.
- **Pool honesty:** on testnet the whole pool is ours, so random selection protects nothing here. It only
  helps when the pool is large and independent and the stake is worth more than a bribe.
- **Copying votes:** with plain votes a lazy verifier can copy an earlier on-chain vote instead of
  re-running; commit-reveal would stop that (not chosen, for time).
- **Admin fallback** keeps one trusted party as a last resort when the committee fails.

### Testnet runs: refund timeout and admin fallback (2026-11-21)

Deployment `kiana`, package `0x3a6d…0ebb` (committee + timeout), no verifiers in the pool yet.

| Run | What happened | Digests |
|---|---|---|
| Round 1, honest | operator + `bet:testnet`: hashes matched (`e137840f…258b`), finalized after the window | seed `5NiQ3jGd…`, submit `CPWwobY8…`, finalize `2fVUt6Mg…` |
| Round 2, refund | no operator: bet + seed, waited out the 2-minute submit window, `refund_unsubmitted` → status 5, 0.01 SUI back to the player | bet `A7Xs3ocF…`, seed `HZXSzxh2…`, refund `6V7o6VrG…` |
| Round 3, admin fallback | operator shortchanged, `bet:testnet` challenged (`4XwWqqiZ…`); no committee could be drawn, so 63 s later (vote window + 3 s margin) the arbiter resolved it (`B2Z3hHcy…`): operator forged, `by_committee = false`, both bonds (0.02 SUI) to the challenger, player paid from the true outcomes | seed `8krfNUxG…`, submit `FiwEKdnP…` |

### Testnet run: committee settles a forged round (2026-11-21)

Deployment `kiana` (`0x3a6d…0ebb`), 3 verifiers registered with `npm run verifiers:setup`, `npm run operator` with
`OPERATOR_CHEAT=shortchange`, `npm run verifier`, and `npm run bet:testnet` as the player.

| Step (round 4) | Who | Digest |
|---|---|---|
| bet | player | `BULwoXLB7Kw1CdzCG6ZfZqAe3jWN4Pm5157vUUfXM5My` |
| draw seed | operator | `3MZN9srroF1GvVV4MHRYMHHKZvzuLtpEuoyaybQWQJzZ` |
| submit, forged (every ball "never landed") | operator | `75kuWRsxvcc55J4tdVAUiT29W9JqqVCYM4Tasvk69etS` |
| challenge (replay `80e450ec…` ≠ submitted `f67ac0f2…`) | player | `9tEvPt2i4cRg8gAtZnmenzijLWQFaLQRypbkBazWqoPx` |
| select committee (`sui::random`) | verifier `0x941b…2071` | `6Aw1AzzSTUBs88Ujm1uhVGa3vki2sFuBD9wUto8KXZhS` |
| vote | verifier `0x941b…2071` | `GY8ZCRMfCpdKu99k2JNEwyEkoPNuZHhpsQzps9XFvZkz` |
| vote (2nd matching: settles) | verifier `0x312d…555d` | `aRtrKWQ6NV867ujKBZKfTw2EstbCW3iBEwoVqtBheXk` |

- **Verdict:** operator forged, `by_committee = true`, 4 s after the challenge. The challenger got 0.015 SUI (own
  bond + half the operator's), the two voters split the other 0.005, and the player was paid from the true outcomes.
- **Third verifier** (`0xc87c…3a12`): its vote arrived after the round was settled and aborted (`ENoDispute`); it is
  freed without reward or slash, as designed. The node now stops voting once a vote settles the round.
