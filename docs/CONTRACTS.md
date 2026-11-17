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
                                                          CHALLENGED(3) ──resolve_by_admin──▶ FINALIZED(4)
```

- There is no cancel function: once a bet is locked, the round can only move forward (fairness rule 3).
- Every transition is one `public(package)` function in `round` that asserts the current
  status and aborts with a named error (`ESeedAlreadyDrawn`, `ENotSeeded`, `ENotSubmitted`, `ENotChallenged`).

## 3. Objects

| Object | Module | Kind | Fields |
|---|---|---|---|
| `AdminCap` | round | owned (publisher) | `id` |
| `Game` | round | shared, one per package | `id`, `next_round_id: u64` (starts at 1), `config_version: String` |
| `Round` | round | shared, one per round | `id`, `round_id: u64`, `player: address`, `config_version: String`, `seed: vector<u8>` (empty until drawn, then 32 bytes), `bet: Balance<SUI>`, `status: u8` |
| `OperatorCap` | verification | owned (issued by admin) | `id` |
| `House` | verification | shared (created by admin) | `id`, `treasury: Balance<SUI>`, `multipliers_bps: vector<u64>` (one per pocket), `balls_per_round: u64`, `operator_bond: u64`, `challenger_bond: u64`, `challenge_window_ms: u64` |
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
| `entry draw_seed(round, r: &Random, ctx)` (non-public) | anyone | BET_LOCKED → SEEDED |
| `set_config_version(&AdminCap, game, version)` | admin | — (new rounds use it) |

`verification`
| Function | Who | From → to |
|---|---|---|
| `issue_operator_cap(&AdminCap, recipient, ctx)` | admin | — |
| `create_house(&AdminCap, multipliers_bps, balls_per_round, operator_bond, challenger_bond, challenge_window_ms, ctx)` | admin | — (shares `House`) |
| `fund_house(house, coin)` / `withdraw_house(&AdminCap, house, amount, ctx): Coin<SUI>` | anyone / admin | — |
| `submit_result(&OperatorCap, round, house, outcomes, result_hash, bond, clock, ctx)` | operator | SEEDED → SUBMITTED |
| `challenge(round, house, bond, clock, ctx)` | anyone | SUBMITTED → CHALLENGED |
| `resolve_by_admin(&AdminCap, round, house, correct_outcomes, ctx)` | admin | CHALLENGED → FINALIZED |
| `finalize(round, house, clock, ctx)` | anyone | SUBMITTED → FINALIZED |

Checks in `submit_result`: `outcomes.length() == balls_per_round`, each outcome `< pockets` or `0xFFFF`,
bond `== operator_bond`, `result_hash == sha2_256(SPEC layout)`.
The window is `[submitted, deadline_ms)`: `challenge` needs `now < deadline_ms`, `finalize` needs `now ≥ deadline_ms`.
Each function runs the status transition first, so a call in the wrong state aborts with the
`round` status error; any later check that fails reverts the whole transaction.

Reads: `result_hash(config_version, seed, round_id, outcomes)` (SPEC §3 hash, same bytes as
`hashRoundResult`), `submitted_hash(round)`, `treasury_value(house)`.

**Arbitration, ready for the committee.** `resolve_by_admin` only checks the `AdminCap` and then calls one
internal `settle_dispute(round, house, correct_outcomes)`. The arbiter posts the correct outcomes, and the
verdict comes from comparing hashes, so the arbiter cannot rule "honest" while posting different outcomes.
The 2-of-3 committee will call the same `settle_dispute` once two votes agree on a result.

## 5. Events

One per state change: `RoundCreated`, `SeedDrawn`, `ResultSubmitted`, `Challenged`, `Resolved`
(`resolve_by_admin` also emits `Finalized`), `Finalized`. Fields: `docs/SPEC.md` §7.

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

## 7. Open decisions

| # | Question | Placeholder now |
|---|---|---|
| 1 | Real multipliers / RTP per pocket (Phase 4 odds) | admin-set `multipliers_bps`; pool funding agreed (§6) |
| 2 | Payout cap, and checking that the house can cover a bet when it is placed | none: `finalize` aborts (`EHouseInsolvent`) until the house is funded |
| 3 | `withdraw_house` can take funds that pending rounds need | admin is trusted for now |
| 4 | Timeout if the operator never submits, or the arbiter never resolves (Phase 3 fallback) | none: the round waits |
| 5 | 2-of-3 committee replacing `AdminCap` arbitration | `settle_dispute` is the single entry point it will reuse |
| 6 | Bond sizes and challenge window length | admin sets them per `House` |
| 7 | Upgrade policy for the package (`UpgradeCap`) | kept by the publisher |

## 8. How to run

`contracts/pachinko/README.md` has build, test, the one-time testnet key setup (`.env`) and
`npm run round:testnet`.

## 9. End-to-end script (`scripts/`)

| File | Does |
|---|---|
| `src/deploy.ts` | `npm run deploy:testnet`: `deploy`, then saves `chain/src/deployments/<PACHINKO_DEPLOYMENT>.json` |
| `src/bet.ts` | `npm run bet:testnet`: player side only: `createRound`, then follow the round's status until FINALIZED and print the payout. Needs `npm run operator` running |
| `src/onchainRound.ts` | `npm run round:testnet`: honest round on the saved deployment. `seededRound` → `submitResult` → wait until `deadline_ms` + 3 s → `finalize` |
| `src/forgedRound.ts` | `npm run forged:testnet`: `seededRound` → operator submits a forged jackpot (every ball in the best pocket, with the matching hash) → `challenge` (optional second key) → `resolveByAdmin` with the true outcomes |
| `src/steps.ts` | one function per on-chain step (signs a `@pachinko/chain` transaction): `deploy` (publish → create house → fund house) · `createRound` · `drawSeed` · `seededRound` (those three + `runRound`) · `submitResult` · `challenge` · `resolveByAdmin` · `finalize` · `waitForDeadline` |
| `src/sui.ts` | `SuiGrpcClient` (testnet JSON-RPC is off), `execute` (sign, print digest + Suiscan link, fail on abort, wait for indexing), created-object and BCS-event readers, `buildPackage` (`sui move build --dump-bytecode-as-base64`) |
| `src/env.ts` | settings from the repo-root `.env`; only `SUI_PRIVATE_KEY` is required |

The script checks that the round's `config_version` equals the local physics version before it
plays. It reads the seed and the deadline from the `SeedDrawn` and `ResultSubmitted` events.

Deployments: each teammate has their own (`PACHINKO_DEPLOYMENT` in `.env` picks
`chain/src/deployments/<name>.json`), so tests on one machine never touch another person's rounds.
`kiana`: package `0x3738a27bc8e378210400ab634bf905cd75b43545db72f279f41ed72693c30bb0` (2026-11-17).
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
| 2 ✅ | **Deploy once:** `npm run deploy:testnet` publishes + creates and funds the House, then writes the ids to `chain/src/deployments/<name>.json` (one per teammate, chosen with `PACHINKO_DEPLOYMENT`; public ids, committed). Scripts, operator and frontend all read it. `round:testnet` reuses it instead of publishing. | `scripts/`, `chain/` | shared |
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

