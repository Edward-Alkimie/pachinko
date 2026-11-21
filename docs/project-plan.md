# Project Pachinko — Project Plan

> **The outcome is determined by physics. The randomness is cryptographically generated. The result can be independently verified.**
> 让物理决定结果，让密码学保护随机性，让玩家能够验证公平性。

Team: **Kevin** (physics & game) · **Kiana** (verification) · Demo: **Dec 6, 2026** · Network: **Sui testnet only**

---

## 1. Overview

Project Pachinko is an online pachinko game where **a real physics simulation decides each ball's result**, and anyone can **replay a round from its seed** to check it.

Traditional online slots pick the result with a random number first, then play an animation. Players can't see or check the logic. Here the order is reversed:

```
random seed → ball launch parameters → physics (pins + ball-to-ball collisions) → landing pocket → result
```

- The machine auto-fires balls (10 per second). Players don't aim.
- Balls collide with pins, walls and **each other**, so balls affect one another.
- A round's seed comes from **Sui on-chain randomness**. Physics rules, machine config and engine version are public and fixed.
- After a round, anyone can re-run `runRound(seed, config)` and get the same outcome for every ball.

**Scope note:** the first version gives *public replay verification*, which means trust is backed by an off-chain re-run plus an on-chain challenge process. Trustless on-chain proof of the physics (e.g. ZK execution proofs) is future work.

---

## 2. Key design decisions

| Decision | Choice | Why |
|---|---|---|
| Physics engine | **Rapier 2D, deterministic build** (`@dimforge/rapier2d-deterministic-compat`, pinned to an exact version) | Cross-platform determinism mode; one WASM binary runs in every browser and in Node |
| Physics language | **TypeScript** in one shared package `physics/` | Frontend, physics-service and Kiana's verifier all import the *same code + same binary*, so no Rust-vs-WASM drift |
| Frontend/backend sync | **None during play** | A round is fully determined by `(seed, config)`, and players give no input mid-round. The frontend simulates and draws on its own |
| Backend check | **Per-ball outcome comparison** | Backend re-runs the seed with the same physics version and compares `outcomes[i]` for every ball. **Backend outcome is authoritative** on mismatch |
| Rounds | **Fixed rounds**: 100 balls, 10 s of firing | One seed request per round, clear start/end for settlement |
| Players | **Independent machines** (20 concurrent target) | Players' balls never interact, so it's simple and scales by adding servers |
| Randomness | **One Sui seed per round** → HMAC-SHA256 derivation per ball | Many reproducible values from one on-chain request |
| Settlement | **Optimistic verification** (submit → challenge window → final → payout) | Move cannot re-run physics on-chain, so disputes are settled by challenge + arbitration |

> Changed from the original overview: the physics server was planned in Rust. It is now Node/TypeScript using the same Rapier WASM as the browser, so there is one binary everywhere.

---

## 3. Architecture

```
┌────────────────────┐   new round / seed    ┌──────────────────┐     ┌──────────────┐
│ frontend           │ ────────────────────▶ │ backend (Django) │ ──▶ │ PostgreSQL   │
│ React + TS + Vite  │ ◀──────────────────── │ rounds, results  │     └──────────────┘
│ runs physics/ +    │   client outcomes     └────────┬─────────┘
│ draws the round    │                                │ POST /verify {seed, outcomes}
└────────────────────┘                                ▼
          ▲                                  ┌──────────────────┐
          │ same @pachinko/physics           │ physics-service  │
          └──────────────────────────────────│ Node + TS        │
                                             └──────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ Sui (Move): round module (Kevin) → seed via sui::random → Round object       │
│             verification module (Kiana) → submit, challenge, finalize, payout│
└──────────────────────────────────────────────────────────────────────────────┘
```

### Repository layout

| Folder | Purpose | Owner |
|---|---|---|
| `physics/` | Shared deterministic physics: config, seed derivation, `runRound`, result hash | Kevin |
| `frontend/` | Game UI, local simulation and drawing, Verify page (later) | Kevin (game), Kiana (verify UI) |
| `physics-service/` | Backend copy of physics: `POST /verify` per-ball check, replay CLI | Kevin |
| `backend/` | Django + DRF: rounds, results, history/stats API | Both |
| `database/` | PostgreSQL setup; tables come from Django migrations | Both |
| `contracts/pachinko/` | Move package: `round.move` (Kevin), `verification.move` (Kiana) | Both |
| `docs/` | `SPEC.md` (interfaces), this plan | Both |

### Round flow (MVP, before Sui)

1. Frontend asks the backend for a new round and gets `{ roundId, seed }`.
2. Frontend runs `runRound(seed, config)` and plays the balls on a canvas.
3. Frontend sends its `outcomes[]` to the backend.
4. Backend calls physics-service `/verify`, which re-runs the seed and compares each ball.
5. Backend stores the round, both outcome lists and any mismatches in PostgreSQL.

### Round flow (with Sui)

`place bet (locked) → round module draws seed with sui::random → Round object + event → physics-service computes and calls submit_result → challenge window (verifiers re-run) → final → payout`

---

## 4. Game mechanics

| Parameter | Value |
|---|---|
| Physics tick rate | 120 Hz fixed timestep |
| Launch rate | 1 ball every 12 ticks (10 balls/s) |
| Balls per round | 100 (10 s of firing) |
| Round end | All balls in a pocket, or `MAX_TICKS` reached |
| Stuck / timed-out ball | Outcome `-1` (counts as no-win) |
| Display | ~60 FPS playback, adapts to device |
| Per-ball randomness | Small launch variation (speed/angle) from HMAC of the seed |

Collisions modeled: gravity, ball to pin, **ball to ball**, ball to wall, friction and restitution, pocket detection.

---

## 5. Randomness & fairness

**Derivation:** `value = HMAC-SHA256(key = seed, msg = round_id ‖ ball_id ‖ event_id)`. The exact byte layout is fixed in `docs/SPEC.md`.

Fairness rules:

1. Bets and round config are **locked before** the seed is revealed.
2. The seed comes from `sui::random`. The operator cannot choose it.
3. A committed round **cannot be cancelled** after the seed is known.
4. Derivation rules, physics version and machine config are **public and fixed**.
5. A revealed seed is never reused for a new, unlocked bet.
6. Every round has defined settlement and exception rules (timeouts, server offline).

Move notes: the function that uses `Random` must be a **non-public `entry`** function to avoid composition/test-and-abort attacks. Move only offers `hmac_sha3_256`, which is fine while derivation stays off-chain.

---

## 6. Roles

| Area | Kevin | Kiana | Together |
|---|---|---|---|
| Physics | Rapier sim, determinism, odds, physics-service | — | — |
| Contracts | `round` module (bets, seed, Round object) | `verification` module (submit, challenge, arbitration, payout) | Package structure, shared objects |
| Frontend | Game view, reusable board component | Verify page, pending/final states | App shell, wallet connection |
| Verification | Help integrate physics into the verifier | Verifier agent, cheat-mode tests | — |
| Other | — | — | Spec, pool/payout rules, Django, report, demo |

**Contract boundary:** Kevin's `round` module ends at "Round object with seed created". Everything after that (submit result, challenge window, arbitration, payout) belongs to Kiana's `verification` module.

---

## 7. Roadmap

### MVP (Kevin, now): functional physics game

| Step | Deliverable | Test that proves it |
|---|---|---|
| 1 ✅ | Project structure: npm workspaces, Vite app, physics-service skeleton, Django skeleton | Tests, typecheck and build pass; dev server works in code-server |
| 2 | Board config (`physics/src/config.ts`) | Config validation tests |
| 3 | Seed derivation (`seed.ts`) | Fixed known HMAC values |
| 4 | `runRound` + result hash | Same seed gives same outcomes; different seeds differ; all 100 balls resolve |
| 5 | Canvas playback, result panel, replay-seed input | Round plays in the browser; hash matches Node |
| 6 | physics-service `/verify` + replay CLI | Matching outcomes pass; tampered outcomes show the exact mismatched balls |
| 7 | Django rounds/results API + PostgreSQL | API tests; round stored with verification result |

### Team phases

| Phase | Dates | Goal | Done when |
|---|---|---|---|
| 0: Spec | Nov 10–12 | Agree on config format, seed bytes, `runRound` output, Round object/events, Move package layout | `docs/SPEC.md` agreed by both |
| 1: Foundations | Nov 10–16 | Kevin: 100-ball round + determinism test. Kiana: Move basics, verifier skeleton with fake `runRound` | Determinism passes; verifier compares fake results on testnet |
| 2: One full round | Nov 14–20 | `round` module + physics-service submit + first game view; honest flow on testnet | Bet → seed → compute → submit → challenge window → payout works end to end. ✅ Contracts + a scripted honest round on testnet (Nov 17, see `docs/CONTRACTS.md` §9); ✅ operator in physics-service (`npm run operator`: seed → physics → submit → finalize); ✅ game view plays on-chain rounds (wallet bet → operator → payout, Nov 17) |
| — | **Nov 18** | **Scoped plan due**, with determinism results and flow progress | |
| 3: Verification | Nov 19–27 | Challenges with bond, timeout fallback submit, admin then 2-of-3 committee arbitration, cheat scripts. Real physics in verifier (~Nov 20) | Demos pass: honest round, forged jackpot caught, server offline handled. ✅ Bonded challenge + admin arbitration in Move (unit-tested), player-side replay check + **Challenge** on the page and in `bet:testnet`, arbiter in `npm run operator`, operator cheat mode; forged results caught on testnet from the browser (Nov 21); ⏳ timeout, committee, watchdog |
| 4: Odds & Verify page | Nov 25–30 | Offline sims (probability and RTP per pocket), Verify page, payout cap, pool rules, minimal Django history | Odds published; any round verifiable on the Verify page |
| 5: Polish & demo | Dec 1–6 | Final determinism re-run, 2+ demo rehearsals, report | Demo ready (Dec 6 is buffer) |

Nov 26 is Thanksgiving; Phase 3 has an extra day for it.

**Determinism test (Phase 1):** 1,000+ seeds on Node, Chrome, Firefox, Safari and mobile, comparing outcome hashes. Share results with Kiana right away, because verification depends on it.

How to run it: `npm run determinism` (Node; `-- <rounds>` to change the default 1000) and
`determinism.html` on the dev server in each browser (`npm run dev -- --host` to reach it from a phone).
Corpus: seed_i = SHA-256("PACHINKO-DETERMINISM-V1" ‖ u32 BE i), round id i + 1; digest = SHA-256 over all
result hashes in order, with a checkpoint every 100 rounds (`physics/src/determinism.ts`).

| Platform | Rounds | Digest | Result |
|---|---|---|---|
| Node 26.10 · macOS arm64 (Kiana, 2026-11-21) | 1000 | `b89c0d0f4ff8e69d264544967bad90df52671573a0bbb98d7026398ce0d08330` | reference |
| Node · Windows (Kevin) | 1000 | | ⏳ |
| Chrome 158 · macOS arm64 (headless, 2026-11-21) | 1000 | `b89c0d0f4ff8e69d264544967bad90df52671573a0bbb98d7026398ce0d08330` | ✅ match |
| VS Code built-in browser (Electron 43, Chromium 150) · macOS (2026-11-21) | 1000 | `b89c0d0f4ff8e69d264544967bad90df52671573a0bbb98d7026398ce0d08330` | ✅ match (every checkpoint) |
| Safari 26.6 · macOS (JavaScriptCore, 2026-11-21) | 1000 | `b89c0d0f4ff8e69d264544967bad90df52671573a0bbb98d7026398ce0d08330` | ✅ match (every checkpoint) |
| Firefox · macOS | 1000 | | ⏳ |
| Phone browser | 1000 | | ⏳ |

---

## 8. Capacity estimate (target: 20 players)

- 20 players × 10 balls/s = 200 balls/s launched
- ~3 s per ball → ~30 active balls per player, ~600 in total
- 120 Hz → ~72,000 ball-state updates/s, plus collision detection and solving
- Suggested test machine: 4 vCPU / 8 GB RAM, with Django and physics-service on the same host

This is a starting point for load testing, not a guarantee. Because the frontend simulates locally, the server only re-runs rounds to verify them, not to stream positions.

---

## 9. Risks

| Level | Risk | Mitigation |
|---|---|---|
| High | Floating-point differences across browsers or devices | Deterministic Rapier build, exact version pin, golden-hash seed corpus, test early (Phase 1) |
| High | Disputes need a trusted admin or committee (Move can't re-run physics) | Bonded challenges, slashing, 2-of-3 committee; stated openly in the report |
| High | Spec drift between Kevin and Kiana | Freeze `docs/SPEC.md`; shared fixture of seed → expected outcomes |
| Med | Balls stuck or rounds never ending | `MAX_TICKS` cap; stuck ball = `-1` |
| Med | Misuse of `sui::random` | Non-public `entry` function; bets locked in an earlier transaction |
| Med | Tooling not installed (Python, Postgres/Docker, Sui CLI) | Install before backend and contract steps |
| Low | Real-money use raises gambling-licensing issues | Testnet and test tokens only |

---

## 10. Future work

- Customizable machines (pin layouts, obstacles, parameters) with published odds
- Public verification explorer: round ID → seed, machine version, trajectories, result
- Developer platform for third-party machines after safety and odds review
- Continuous (non-round) play
- Cryptographic execution proofs for trustless on-chain settlement
- Related work for the report: Cartesi, RIVES, UMA, Mysten Plinko, YieldBall; the verifier's dilemma
