<!-- Generated: 2026-11-26 | Files scanned: 183 | Token estimate: ~750 -->
# Architecture

npm-workspaces monorepo (`physics`, `chain`, `frontend`, `physics-service`, `scripts`) + Django `backend/` + Sui Move `contracts/pachinko`.
Provably fair pachinko: Sui draws the seed, everyone replays the same deterministic physics, and bonds and challenges punish a false result.
Detailed flows: docs/ARCHITECTURE.md · byte formats: docs/SPEC.md · contract design: docs/CONTRACTS.md.
Other codemaps: backend.md · frontend.md · data.md · dependencies.md.

## Boundaries
```
                 physics/  (@pachinko/physics: ONLY place with machine rules)
                 seed → launches → Rapier sim → outcomes[] + resultHash
                    ▲ import            ▲ import              ▲ import
   frontend/ (React)          physics-service/ (Node)       scripts/ (CLI)
   wallet bet, replay,        operator · arbiter ·          deploy, bet, verifiers:setup
   challenge, Verify view     verifier · HTTP /verify
        │   └──── chain/ (@pachinko/chain: tx builders, BCS readers, events) ────┘
        │                          │
        │ /api (Vite proxy)        ▼ gRPC (testnet)
        ▼                   contracts/pachinko (Sui Move)
   backend/ (Django)        round · verification · committee
   accounts only            holds bets, treasury, bonds, stakes
   (SQLite / Postgres)
```

## Round lifecycle (on-chain status)
```
create_round ─▶ BET_LOCKED(0) ─draw_seed (sui::random)─▶ SEEDED(1)
  SEEDED ─submit_result (operator bond, hash checked)─▶ SUBMITTED(2)
  SEEDED ─refund_unsubmitted (after submit window)───▶ REFUNDED(5)
  SUBMITTED ─finalize (window over)──────────────────▶ FINALIZED(4)
  SUBMITTED ─challenge (challenger bond)─▶ CHALLENGED(3)
     └ select_committee (random 3) → vote ×2 match ─▶ FINALIZED
     └ vote deadline passes → resolve_by_admin ─────▶ FINALIZED
```

## Who does what
| Actor | Runs | Signs |
|---|---|---|
| Player | browser / `bet:testnet` | create_round, challenge, refund |
| Operator | `npm run operator` | draw_seed, submit_result, finalize |
| Arbiter (AdminCap) | same process when key holds AdminCap | resolve_by_admin |
| Verifiers | `npm run verifier` | select_committee, vote |
| Admin | `deploy:testnet` | publish, create_house, fund_house |

## Trust model
- Seed: Sui randomness, drawn in a tx after the bet, so the player can't choose it.
- Result: the contract checks only `hash(outcomes) == result_hash`. Truth is enforced by challenge + bonds.
- Determinism: `@dimforge/rapier2d-deterministic-compat`, fixed tick order, config `version` bound into the hash.

## Entry points
- frontend/src/main.tsx → App.tsx
- physics-service/src/server.ts (HTTP), operator/main.ts, verifier/main.ts, cli.ts (replay)
- scripts/src/{deploy,bet,verifiersSetup}.ts
- backend/manage.py → config/urls.py
- contracts/pachinko/sources/{round,verification,committee}.move
