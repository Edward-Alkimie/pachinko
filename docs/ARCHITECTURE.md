# Architecture: how data flows

How information moves between the major functions. **Keep this file updated**:
`physics/tests/docs.test.ts` fails if a public function of `@pachinko/physics`
isn't mentioned here.

Status: ✅ built · 🚧 next · ⏳ later

---

## 1. Big picture

```
                      docs/SPEC.md  (the shared contract)
                                │
              ┌─────────────────▼──────────────────┐
              │ physics/  (@pachinko/physics)      │  ← single source of truth
              │ config · geometry · seed · runRound│     same code everywhere
              └───────┬──────────────────┬─────────┘
          import      │                  │      import
        ┌─────────────▼──┐           ┌───▼──────────────┐
        │ frontend/      │           │ physics-service/ │◀── Kiana's verifier
        │ draw + play    │           │ re-run + check   │    (same package)
        └───────┬────────┘           └───▲──────────────┘
                │ HTTP                   │ HTTP POST /verify
                ▼                        │
        ┌────────────────────────────────┴─┐      ┌─────────────┐
        │ backend/ (Django)                │─────▶│ PostgreSQL  │
        │ rounds · results                 │      └─────────────┘
        └──────────────────────────────────┘
                ▲ seed (later from Sui: contracts/pachinko round.move)
```

Rule: **only `physics/` knows the rules of the machine.** Everyone else imports it.

---

## 2. Flow A: drawing the board ✅

> During play, `PachinkoCanvas` also calls `drawBalls` with the current frame (see Flow D).

```
DEFAULT_CONFIG ──┬─▶ buildPins(config)      ─▶ pin centres ─┐
(config.ts)      ├─▶ buildWalls(config)     ─▶ wall boxes  ─┤
                 ├─▶ buildDividers(config)  ─▶ divider boxes┼─▶ drawBoard(ctx, config, scale)
                 └─▶ pocketCentres(config)  ─▶ label points ┘        (frontend/src/game)
                                                                          │
App.tsx ─▶ <PachinkoCanvas config> ─▶ sets canvas size/DPR ─▶ calls ──────┘
```

`validateConfig(config)` checks the config is playable (returns `[]` when valid).
`ballsPerSecond(config)` is a helper for display and tests.

---

## 3. Flow B: one round (seed → outcomes) ✅

```
seed hex ─▶ parseSeed ─▶ 32 bytes ─┐                         ✅
roundId (bigint) ──────────────────┼─▶ deriveRoundLaunches(seed, roundId, config)
                                   │     └─ for each ball: deriveLaunch
                                   │          └─ deriveBytes = hmacSha256(seed, encodeMessage(round, ball, EVENT_LAUNCH))
                                   │          └─ bytesToUnit → x, vx
                                   ▼
                        Launch[] {ballId, tick, x, y, vx, vy}
                                   │
                                   ▼                          ✅
              initPhysics() once, then runRound(seed, roundId, config, { recordEvery })
                ├─ build Rapier world from buildWalls / buildDividers / buildPins
                ├─ every tick: add balls whose launch.tick == tick, world.step()
                ├─ ball below pocket line → outcome = pocket id
                └─ tick == maxTicks → remaining balls = -1
                                   │
                                   ▼
              { outcomes[], landedAtTick[], endTick, resultHash = hashRoundResult(...), frames[] }
```

Helpers: `randomSeedHex()` (local seeds until Sui), `seedToHex()`, `SEED_BYTES`.

---

## 3b. Flow D: playing a round in the browser ✅

```
Start button ─▶ randomSeedHex()            Replay form ─▶ checkSeed / checkRoundId
       └──────────────┬───────────────────────────────┘
                      ▼
          useRound.start(seedHex, roundId)
            status = simulating
            initPhysics() → runRound(seed, roundId, config, { recordEvery: 2 })
            status = playing; requestAnimationFrame loop:
              tick = tickAt(now − startedAt, 120)          (stops at endTick → done)
                      │
        App derives from { result, tick }:
          frameIndexAt(tick) → frames[i].balls ─▶ <PachinkoCanvas balls> → drawBoard + drawBalls
          tallyAt(outcomes, landedAtTick, tick) ─▶ <ResultPanel tally>
          status == done ─▶ show resultHash
```

## 3c. Flow E: accounts (backend) ✅

```
frontend                                     Vite dev proxy           backend/apps/users
App ─ useAuth() ─▶ services/auth.ts ──▶ <base>api/* ──▶ :8000/api/* (Django + DRF, session cookie)
        │            fetchMe / login / register / logout   (sets Origin = backend)
        └▶ <AuthPanel state + actions>: form when signed out, "Signed in as …" when signed in

calls                                        backend view
GET  /api/auth/csrf      ──────────▶ CsrfView      sets csrftoken cookie
POST /api/auth/register  ──────────▶ RegisterView  RegisterSerializer → validate_password → create_user → login
POST /api/auth/login     ──────────▶ LoginView     authenticate → login   (bad user/password: same 400)
POST /api/auth/logout    ──────────▶ LogoutView    204
GET  /api/auth/me        ──────────▶ MeView        { id, username }  (403 when logged out)
```

- Writes send header `X-CSRFToken: <csrftoken cookie>`. Register/login are CSRF-checked
  and rate-limited per client IP (`AUTH_THROTTLE_RATE`, default `10/min`, scope `auth`;
  `DJANGO_NUM_PROXIES` = trusted proxies, 0 ignores `X-Forwarded-For`).
- Usernames are Unicode-normalized (NFKC) before the uniqueness check and on login.
- Passwords: Django hashing + the 4 standard password validators. Responses never include them.
- Database: SQLite (`backend/db.sqlite3`) unless `POSTGRES_HOST` is set, then PostgreSQL.
- `services/auth.ts` adds `X-CSRFToken` from the cookie on every POST (gets the cookie from
  `/auth/csrf` first if missing); backend errors become `ApiError {status, message, fieldErrors}`.
- Playing a round does not need an account yet.
- Contract for other code: `docs/SPEC.md` §5.
- Not yet: Sui wallet link / balance. Note for later: JSON-RPC is **off** on public testnet
  full nodes (checked 2026-11-17); use GraphQL `https://graphql.testnet.sui.io/graphql`
  (`address(address){ balance(coinType:"0x2::sui::SUI"){ totalBalance } }`) or gRPC.

## 4. Flow C: playing and verifying a round 🚧 (physics-service ✅, backend ⏳)

```
frontend                      backend (Django)              physics-service
────────                      ────────────────              ───────────────
POST /api/rounds/      ──────▶ create Round, seed
                       ◀────── { roundId, seed }
runRound(seed) locally
play frames on canvas
POST /api/results/     ──────▶ store client outcomes ─────▶ POST /verify {seed, roundId,
  { roundId, outcomes }                                          configVersion, outcomes}
                                                              parseVerifyRequest (400/409)
                                                              verifyRound: runRound again
                                                              compareOutcomes per ball
                              store check + mismatches ◀──── { ok, mismatches[],
                                                                serverOutcomes, resultHash }
                       ◀────── verified result
```

Server outcome wins on any mismatch. Contract: `docs/SPEC.md` §6.
Same check offline: `npm run replay -- <seed> [roundId]` prints the outcomes and hash.

---

## 4b. Flow F: one round on Sui testnet ✅ (script; backend/frontend wiring ⏳)

```
scripts/ (deploy.ts once, then onchainRound.ts)   contracts/pachinko (Move)         events read
────────────────────────────────────────────   ─────────────────────────         ───────────
deploy:testnet → chain/src/deployments/<PACHINKO_DEPLOYMENT>.json
  publish (tx.publish)               ──────▶ init: AdminCap, shared Game
  setUpHouse                         ──────▶ issue_operator_cap, create_house; fund_house
round:testnet (reads that file)
createRound(bet coin)                ──────▶ round::create_round      → BET_LOCKED    RoundCreated (round_id, config_version)
drawSeed (separate tx)               ──────▶ round::draw_seed(Random) → SEEDED        SeedDrawn (seed)
runRound(seed, round_id)  (physics/, off-chain)
submitResult(outcomes, hash, bond)   ──────▶ verification::submit_result → SUBMITTED  ResultSubmitted (deadline_ms)
                                              └─ result_hash = sha2_256(SPEC §3 bytes) must match
wait until deadline_ms
finalize                             ──────▶ verification::finalize → pay_out → FINALIZED   Finalized (payout)
```

Dispute path (Move tests + `npm run forged:testnet`): `challenge` before `deadline_ms` → CHALLENGED →
`resolve_by_admin(correct outcomes)` → loser's bond to winner → FINALIZED. Details: `docs/CONTRACTS.md`.

## 4c. Flow G: connected round ✅ (browser wallet → operator → payout)

```
player (OnchainPanel or bet:testnet)            Sui testnet                     physics-service operator (npm run operator)
createRoundTx → sign ──────────────────────▶ create_round → BET_LOCKED ─────▶ tick: listEvents(RoundCreated) → new round
                                                                               nextAction(fetchRound) = drawSeed → drawSeedTx
fetchRound every 2 s: status / seed  ◀─────── SEEDED ◀─────────────────────────  nextAction = submit → runRound(seed) → submitResultTx
                                              SUBMITTED (window) ◀──────────── nextAction = wait until deadline + 3 s
findFinalized → payout  ◀──────────────────── FINALIZED ◀───────────────────── nextAction = finalize → finalizeTx
```

In the browser, `useOnchainRound` passes the seed to the normal `useRound.start(seed, round_id)`, so an on-chain
round plays on the same board as a local one. The wallet signs only the bet.

The operator keeps no state of its own: it reads each round's status before every step, so a restart
picks up where it stopped. Challenged rounds are left to the arbiter.

---

## 5. Function index

### `physics/` (shared)

| Function | File | Input → Output | Used by | Status |
|---|---|---|---|---|
| `DEFAULT_CONFIG` | config.ts | — → `MachineConfig` (frozen) | everything | ✅ |
| `validateConfig` | config.ts | config → `string[]` problems | tests, (later) startup | ✅ |
| `buildPins` | config.ts | config → `Vec2[]` pin centres | drawBoard, runRound | ✅ |
| `ballsPerSecond` | config.ts | config → number | App, tests | ✅ |
| `buildWalls` | geometry.ts | config → `Box[]` (L, R, top, bottom) | drawBoard, runRound | ✅ |
| `buildDividers` | geometry.ts | config → `Box[]` | drawBoard, runRound | ✅ |
| `pocketCentres` | geometry.ts | config → `{id,x,y}[]` | drawBoard | ✅ |
| `parseSeed` / `seedToHex` | seed.ts | hex ⇄ 32 bytes | frontend, service, verifier | ✅ |
| `randomSeedHex` | seed.ts | — → hex seed | frontend (until Sui) | ✅ |
| `encodeMessage` | seed.ts | (round, ball, event) → 13 bytes | deriveBytes | ✅ |
| `hmacSha256` | seed.ts | (key, msg) → 32 bytes | deriveBytes | ✅ |
| `deriveBytes` | seed.ts | (seed, round, ball, event) → 32 bytes | deriveLaunch | ✅ |
| `bytesToUnit` | seed.ts | (bytes, offset) → [0, 1) | deriveLaunch | ✅ |
| `deriveLaunch` | seed.ts | (seed, round, ball, config) → `Launch` | deriveRoundLaunches | ✅ |
| `deriveRoundLaunches` | seed.ts | (seed, round, config) → `Launch[]` | runRound | ✅ |
| `EVENT_LAUNCH`, `SEED_BYTES` | seed.ts | constants | seed.ts, tests | ✅ |
| `initPhysics` | runRound.ts | — → Promise (loads Rapier WASM once) | frontend, service, verifier | ✅ |
| `runRound` | runRound.ts | (seed, roundId, config, {recordEvery}) → `RoundResult` | frontend, service, verifier | ✅ |
| `OUTCOME_NONE` | runRound.ts | constant `-1` (ball never landed) | everyone reading outcomes | ✅ |
| `encodeRoundResult` | hash.ts | {version, seed, roundId, outcomes} → bytes | hashRoundResult, (later) contract | ✅ |
| `hashRoundResult` | hash.ts | same → SHA-256 hex | runRound, backend, verifier | ✅ |

### `frontend/`

| Function / component | File | Does | Status |
|---|---|---|---|
| `App` | App.tsx | AuthPanel, Start (random seed, round 1), replay form, board, results; derives balls + tally from {result, tick} | ✅ |
| `PachinkoCanvas` | game/PachinkoCanvas.tsx | canvas element, DPR, calls drawBoard + drawBalls each frame | ✅ |
| `drawBoard` / `boardPixelSize` | game/drawBoard.ts | paints the static board | ✅ |
| `drawBalls` | game/drawBoard.ts | paints the balls of one frame on top | ✅ |
| `tickAt` / `frameIndexAt` / `tallyAt` | game/playback.ts | real time → tick → frame to show; pocket counts so far | ✅ |
| `useRound` | hooks/useRound.ts | start(seed, roundId): runRound, then rAF playback; status idle → simulating → playing → done / error | ✅ |
| `ResultPanel` | components/ResultPanel.tsx | status, landed count, tally bars, round, seed, hash | ✅ |
| `SeedInput` | components/SeedInput.tsx | replay form; validates with `checkSeed` / `checkRoundId` (lib/validation.ts) | ✅ |
| `BOARD_COLORS` | game/theme.ts | colours | ✅ |
| `API_URL` | services/api.ts | backend base URL: `<base>api` (Vite proxy) unless `VITE_API_URL` | ✅ |
| `fetchMe` / `login` / `register` / `logout` | services/auth.ts | accounts API calls; CSRF header; `ApiError` | ✅ |
| `readCookie` / `ApiError` | services/auth.ts | cookie lookup; failed request (status 0 = unreachable) | ✅ |
| `useAuth` | hooks/useAuth.ts | sign-in state: loading → anonymous / authenticated; login, register, logout, clearError | ✅ |
| `AuthPanel` | components/AuthPanel.tsx | login/register form (two modes) or "Signed in as …" + Log out | ✅ |
| `OnchainPanel` | components/OnchainPanel.tsx | on-chain play: wallet, **Play on-chain (0.01 SUI)**, status, round + bet links, window end, payout; off with a reason when no deployment is set | ✅ |
| `WalletPanel` | components/WalletPanel.tsx | "Connect <wallet>" per Sui wallet (dApp Kit `useWallets`), or address (explorer link) + Copy + Disconnect | ✅ |
| `useOnchainRound` / `phaseFor` | hooks/useOnchainRound.ts | play(): wallet signs `createRoundTx` → poll `fetchRound` → `onSeed` once the seed is on-chain → `fetchSubmission` (deadline) → `findFinalized` (payout); phases idle → signing → waitingSeed → verifying → final / challenged / error | ✅ |
| `ONCHAIN` / `selectDeployment` | onchain/deployment.ts | `VITE_PACHINKO_DEPLOYMENT` → that `chain/src/deployments/*.json` (Vite glob), or off + reason | ✅ |
| `getDAppKit` | onchain/dappKit.ts | dApp Kit instance for testnet (gRPC client, Slush web wallet), created on first use | ✅ |

### `physics-service/`

| Function | File | Does | Status |
|---|---|---|---|
| `createApp` | src/app.ts | HTTP: `GET /health`, `POST /verify` (400 / 409 / 413 checks, 16 KiB body limit) | ✅ |
| `parseVerifyRequest` | src/verify.ts | untrusted body → `VerifyRequest` (seed, roundId, configVersion, 100 outcomes) or error | ✅ |
| `verifyRound` | src/verify.ts | re-run `runRound` on the server → `{ ok, mismatches, serverOutcomes, resultHash }` | ✅ |
| `compareOutcomes` | src/verify.ts | (server, client) → balls that differ `{ballId, client, server}` | ✅ |
| `parseSeedHex` / `parseRoundId` | src/parse.ts | shared input checks (seed hex, u64 round id) → `Parsed<T>` | ✅ |
| `parseReplayArgs` / `replayReport` | src/replay.ts | replay CLI: args → report (end tick, hash, pocket tally, outcomes) | ✅ |
| replay CLI | src/cli.ts | `npm run replay -- <seed> [roundId]` | ✅ |
| `PORT` | src/config.ts | port from `PHYSICS_SERVICE_PORT` (validated) | ✅ |
| `nextAction` | src/operator/nextAction.ts | on-chain `RoundView` (+ deadline) → `drawSeed` / `submit` / `wait` / `finalize` / `drop` (pure) | ✅ |
| `createOperator` → `tick` | src/operator/operator.ts | poll `RoundCreated` events, advance each round one tx at a time, retry failures after 30 s | ✅ |
| operator CLI | src/operator/main.ts | `npm run operator`: checks the key owns the `OperatorCap`, polls every 2 s (Flow G) | ✅ |

### `backend/` (Django)

| Function / view | File | Does | Owner | Status |
|---|---|---|---|---|
| `User` | apps/users/models.py | custom user (AbstractUser; extra fields go here later) | Kevin | ✅ |
| `RegisterSerializer` / `LoginSerializer` / `UserSerializer` | apps/users/serializers.py | request/response shapes; password write-only | Kevin | ✅ |
| `CsrfView` `RegisterView` `LoginView` `LogoutView` `MeView` | apps/users/views.py | `/api/auth/*` (Flow E) | Kevin | ✅ |
| rounds API | apps/rounds/ | create round + seed | Kevin | ⏳ |
| results API + `physics_client.py` | apps/results/ | store outcomes, call physics-service `/verify` | shared | ⏳ |
| verification API | `apps/verification/` (not created) | challenges, arbitration, payout status — URL prefix `/api/verification/` reserved | **Kiana** | ⏳ |

Ownership: Kevin keeps to `apps/users` and `apps/rounds`; Kiana owns anything under
`apps/verification` and `/api/verification/`. `apps/results` is shared — agree on changes first.

### `contracts/pachinko/` (Sui Move) ✅
Design + state machine: `docs/CONTRACTS.md`. Shared interface: `docs/SPEC.md` §7.

| Function | Module | Does | Owner | Status |
|---|---|---|---|---|
| `create_round` | round | lock bet in a new shared `Round` (→ BET_LOCKED), emit `RoundCreated` | Kevin | ✅ |
| `draw_seed` | round | non-public `entry`; 32 bytes from `sui::random` (→ SEEDED), emit `SeedDrawn` | Kevin | ✅ |
| `set_config_version` | round | admin: physics version for new rounds | Kevin | ✅ |
| `mark_submitted` / `mark_challenged` / `finalize_unchallenged` / `finalize_disputed` | round | `public(package)` status transitions used by `verification` | Kevin | ✅ |
| `issue_operator_cap` / `create_house` / `fund_house` / `withdraw_house` | verification | admin setup: operator, payout table, bonds, window, treasury | Kiana | ✅ |
| `submit_result` | verification | operator posts outcomes + hash (checked with `result_hash`), locks bond, starts window (→ SUBMITTED) | Kiana | ✅ |
| `challenge` | verification | anyone locks a bond before `deadline_ms` (→ CHALLENGED) | Kiana | ✅ |
| `finalize` | verification | after the window: `pay_out`, operator bond back (→ FINALIZED) | Kiana | ✅ |
| `resolve_by_admin` → `settle_dispute` | verification | arbiter posts correct outcomes; hash compare decides; loser's bond to winner; `pay_out` (→ FINALIZED) | Kiana | ✅ |
| `pay_out` | verification | placeholder payout rule (one function) | Kiana | ✅ |
| `result_hash` | verification | SPEC §3 bytes → `sha2_256` (same as `hashRoundResult`) | Kiana | ✅ |
| `submitted_hash` / `treasury_value` | verification | reads: stored result hash, house balance | Kiana | ✅ |

### `chain/` (`@pachinko/chain`, shared Sui code)

| Function | File | Input → Output | Used by | Status |
|---|---|---|---|---|
| `parseDeployment` | deployment.ts | JSON → checked `Deployment` (ids + House settings) | everything | ✅ |
| `deploymentName` / `loadDeployment` / `saveDeployment` / `deploymentNames` | node.ts (`@pachinko/chain/node`) | `PACHINKO_DEPLOYMENT` → `deployments/<name>.json` (one per teammate) | scripts, operator | ✅ |
| `createRoundTx` / `drawSeedTx` / `submitResultTx` / `challengeTx` / `resolveByAdminTx` / `finalizeTx` / `setUpHouseTx` / `fundHouseTx` | transactions.ts | deployment + args → unsigned `Transaction` | scripts, operator, (next) frontend | ✅ |
| `fetchRound` / `parseRound` / `fetchSubmission` / `parseSubmission` / `RoundStatus` | objects.ts | object id → `RoundView` / `SubmissionView` (BCS) | operator, (next) frontend | ✅ |
| event layouts + `eventType` | events.ts | BCS event schemas, `0xpkg::module::Name` | scripts, operator | ✅ |
| `toOnchainOutcomes` / `fromOnchainOutcomes` | outcomes.ts | `-1` ↔ `0xFFFF` | transactions, objects | ✅ |
| `signAndExecute` / `readEvent` | execute.ts | keypair + tx → executed tx (throws on abort, waits for indexing); decode one event | scripts, operator | ✅ |
| `findFinalized` | events.ts | round object id → its `Finalized` event (payout) or `null` (ascending scan) | scripts, (next) frontend | ✅ |

### `scripts/` (testnet tooling)

| Function | File | Does | Status |
|---|---|---|---|
| `main` | src/deploy.ts | `npm run deploy:testnet`: `deploy`, saves `chain/src/deployments/<PACHINKO_DEPLOYMENT>.json` | ✅ |
| `main` | src/bet.ts | `npm run bet:testnet`: player side only (create round, follow status, print payout); needs a running operator | ✅ |
| `main` | src/onchainRound.ts | `npm run round:testnet`: honest round (Flow F) on the saved deployment, prints every digest | ✅ |
| `main` / `forgedJackpot` | src/forgedRound.ts | `npm run forged:testnet`: operator forges a jackpot (matching hash) → `challenge` → `resolveByAdmin` with true outcomes | ✅ |
| `deploy` / `createRound` / `drawSeed` / `seededRound` / `submitResult` / `challenge` / `resolveByAdmin` / `finalize` / `waitForDeadline` | src/steps.ts | one function per on-chain step: signs a `@pachinko/chain` transaction, prints the digest, decodes the event (`deploy` = publish + create + fund house) | ✅ |
| `connect` / `execute` | src/sui.ts | gRPC client + signer; sign, print digest, fail on abort, wait for indexing | ✅ |
| `buildPackage` / `publishedPackageId` / `createdObjectId` / `readEvent` | src/sui.ts | compiled modules for publish; ids of created objects; decode BCS events | ✅ |
| `loadEnv` | src/env.ts | settings from `.env` (`SUI_PRIVATE_KEY` required) | ✅ |

---

## 6. Main data shapes

| Shape | Fields | Defined in |
|---|---|---|
| `MachineConfig` | version, board, wallThickness, gravity, ball, pin, pinGrid, pocketDepth, dividerThickness, pockets, launcher, timing | physics/src/config.ts |
| `Box` | x, y, halfWidth, halfHeight (centre + half sizes, like Rapier cuboids) | physics/src/geometry.ts |
| `Launch` | ballId, tick, x, y, vx, vy | physics/src/seed.ts |
| `RoundResult` | outcomes (pocket id per ball, -1 = never landed), landedAtTick, endTick, resultHash, frames | physics/src/runRound.ts |
| `Frame` | tick, balls: {id, x, y}[] (balls still on the board) | physics/src/runRound.ts |

Coordinates everywhere: centimetres, origin top-left, **y down**.
