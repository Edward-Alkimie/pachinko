# Pachinko Spec (v0 — draft)

Shared contract between frontend, physics-service, backend and verifier.

## 1. Machine config (`physics/src/config.ts`, version `pachinko-v0.1.0`)
- Units: centimetres, seconds. Origin top-left, **y points down**, gravity `(0, 500)`.
- Board 48 × 64; ball radius 0.55; pin radius 0.2; 14 staggered pin rows (15 / 14 pins), spacing 3.
- 7 pockets covering x = 0–48: `[0,6) [6,13) [13,20) [20,28) [28,35) [35,42) [42,48]`, depth 6.
- Launcher: x = 24 ± 6, y = 3, horizontal speed within ± 20 (both from the seed).
- Timing: 120 Hz, a ball every 12 ticks (10/s), 100 balls, `maxTicks` = 7200 (60 s).
- Pin positions come from `buildPins(config)` (pure arithmetic). `validateConfig` must return `[]`.
- Any value change ⇒ bump `version`.

## 2. Seed derivation (`physics/src/seed.ts`)
- Seed: 32 bytes, written as 64 hex chars (optional `0x`). Real rounds: from `sui::random`.
- `bytes = HMAC-SHA256(key = seed, msg)` where `msg` (13 bytes) =
  `round_id` u64 big-endian ‖ `ball_id` u32 big-endian ‖ `event_id` u8.
- `event_id`: `0x01` = launch. (Other ids reserved.)
- `unit(k) = u32_be(bytes[4k..4k+4]) / 2^32` ∈ [0, 1).
- Launch of ball `i`: `tick = i · launchIntervalTicks`,
  `x = launcher.x + (2·unit(0) − 1)·spreadX`, `vx = (2·unit(1) − 1)·maxVx`, `y = launcher.y`, `vy = 0`.
- Test vector: seed `000102…1e1f`, round 1, ball 0 → `x = 23.16981352865696`, `vx = 15.677450075745583`.

## 3. Round simulation and output (`physics/src/runRound.ts`, `hash.ts`)
- Engine: `@dimforge/rapier2d-deterministic-compat` **0.21.0** exactly. `dt = 1 / tickHz`. Balls use CCD.
- Static colliders: walls + dividers (cuboids), pins (balls), all with pin restitution/friction.
- Each tick, in this order: (1) spawn balls whose `tick` == now, ball-id order; (2) `world.step()`;
  (3) ball-id order: ball with `y > board.height − pocketDepth + ball.radius` has landed →
  pocket = the one with `xMin ≤ x < xMax` (x = width → last pocket), ball removed.
- Ends when all balls landed, or at `maxTicks`; unlanded balls → outcome `-1`.
- `outcomes: number[]` — pocket id per ball, in ball-id order.
- `resultHash = SHA-256(
    "PACHINKO-RESULT-V1" ‖ u16 BE len(version) ‖ version ‖ seed (32) ‖ u64 BE round_id
    ‖ u32 BE ball_count ‖ i16 BE outcome × ball_count)`, lowercase hex.
- Golden fixture (v0.1.0): seed `000102…1e1f`, round 1 → `endTick 1422`,
  hash `06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151`. Every platform must match.

## 4. Backend check
Backend re-runs `runRound(seed)` with the same physics version and compares each
ball's outcome. Backend outcome is authoritative on mismatch.

## 5. Accounts API (`backend/apps/users`, v0)
Base path `/api/auth/`. Session-cookie auth. JSON in and out.

| Method + path | Body | Success | Errors |
|---|---|---|---|
| `GET csrf` | — | 200, sets `csrftoken` cookie | — |
| `POST register` | `{username, password}` | 201 `{id, username}`, signed in | 400 `{username: [..]}` / `{password: [..]}`, 429 |
| `POST login` | `{username, password}` | 200 `{id, username}` | 400 `{detail}` (same for bad user or bad password), 429 |
| `POST logout` | — | 204 | — |
| `GET me` | — | 200 `{id, username}` | 403 when signed out |

- Every POST needs header `X-CSRFToken` = value of the `csrftoken` cookie (403 otherwise).
- Usernames: Django rules (≤ 150 chars, letters/digits/`@.+-_`), NFKC-normalized.
- Passwords: Django's 4 standard validators (length ≥ 8, not common, not all digits,
  not like the username). Never returned.
- Rate limit on register + login: `AUTH_THROTTLE_RATE` (default `10/min`) per client IP.
- Other apps (rounds, verification) use the same session: `request.user` is the account.

## 6. Physics check API (`physics-service`, v0)
Node service on `PHYSICS_SERVICE_PORT` (default 8100). Called by Django `apps/results`;
Kiana's verifier can call it or reuse the same comparison.

`GET /health` → 200 `{ status: "ok", configVersion }` (the physics version this service runs).

`POST /verify` — request:
```json
{ "seed": "<64 hex, optional 0x>", "roundId": "1",
  "configVersion": "pachinko-v0.1.0", "outcomes": [0, 6, 4, ...] }
```
- `roundId`: decimal string (preferred, u64) or a safe-integer number.
- `outcomes`: exactly `ballsPerRound` (100) integers, each `-1` … `pockets − 1`.

Response 200 (also when balls differ):
```json
{ "ok": false, "configVersion": "pachinko-v0.1.0", "seed": "…", "roundId": "1",
  "resultHash": "<SHA-256 of the SERVER outcomes>", "serverOutcomes": [ ... ],
  "mismatches": [ { "ballId": 0, "client": 3, "server": 0 } ] }
```
- `ok` = no mismatches. `serverOutcomes` / `resultHash` are authoritative (§4).

Errors: 400 `{error}` bad JSON or field · 409 `{error}` `configVersion` differs from the
service's · 413 body over 16 KiB · 404 other routes · 500 `{error: "internal error"}`.

Replay CLI: `npm run replay -- <seed> [roundId]` prints end tick, `resultHash`, pocket
tally and outcomes for one round (exit code 2 on bad arguments).

