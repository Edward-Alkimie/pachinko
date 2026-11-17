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
| `fund_house(house, coin)` / `withdraw_house(&AdminCap, house, amount, ctx)` | anyone / admin | — |
| `submit_result(&OperatorCap, round, house, outcomes, result_hash, bond, clock, ctx)` | operator | SEEDED → SUBMITTED |
| `challenge(round, house, bond, clock, ctx)` | anyone | SUBMITTED → CHALLENGED |
| `resolve_by_admin(&AdminCap, round, house, correct_outcomes, ctx)` | admin | CHALLENGED → FINALIZED |
| `finalize(round, house, clock, ctx)` | anyone | SUBMITTED → FINALIZED |

Checks in `submit_result`: `outcomes.length() == balls_per_round`, each outcome `< pockets` or `0xFFFF`,
bond `== operator_bond`, `result_hash == sha2_256(SPEC layout)`.
The window is `[submitted, deadline_ms)`: `challenge` needs `now < deadline_ms`, `finalize` needs `now ≥ deadline_ms`.

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
nothing is lost to rounding on every ball. The bet goes into the house treasury, and the payout is paid
from it. Multipliers are capped at `MAX_MULTIPLIER_BPS` (100×) so the `u128` product cannot overflow.

## 7. Open decisions

| # | Question | Placeholder now |
|---|---|---|
| 1 | Pool rules: real multipliers / RTP per pocket (Phase 4 odds) | admin-set `multipliers_bps`, paid from a `House` the admin funds |
| 2 | Payout cap, and checking that the house can cover a bet when it is placed | none: `finalize` aborts (`EHouseInsolvent`) until the house is funded |
| 3 | `withdraw_house` can take funds that pending rounds need | admin is trusted for now |
| 4 | Timeout if the operator never submits, or the arbiter never resolves (Phase 3 fallback) | none: the round waits |
| 5 | 2-of-3 committee replacing `AdminCap` arbitration | `settle_dispute` is the single entry point it will reuse |
| 6 | Bond sizes and challenge window length | admin sets them per `House` |
| 7 | Upgrade policy for the package (`UpgradeCap`) | kept by the publisher |

## 8. How to run

See `contracts/pachinko/README.md` (build, test, publish) and §9 for the end-to-end script.

## 9. End-to-end script (`scripts/`)

`npm run round:testnet` publishes the package and runs one round, printing every digest
(details added with the script).
