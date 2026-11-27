<!-- Generated: 2026-11-26 | Files scanned: 183 | Token estimate: ~900 -->
# Backend (Django + physics-service + Move)

## Django HTTP (backend/, session-cookie auth, DRF)
```
GET  /api/auth/csrf      → CsrfView      (sets csrftoken)
POST /api/auth/register  → RegisterView  → RegisterSerializer (NFKC name, validate_password) → create_user → login
POST /api/auth/login     → LoginView     → LoginSerializer → authenticate → login   (same 400 for any failure)
POST /api/auth/logout    → LogoutView    → 204
GET  /api/auth/me        → MeView        → {id, username}   (403 when anonymous)
/api/rounds/, /api/results/ → empty stubs (models/views not built yet)
/admin/                  → Django admin
```
Middleware: Security → Session → Common → Csrf → Auth → Messages → XFrame.
Register/login: AllowAny + `csrf_protect` + ScopedRateThrottle(`auth`, 10/min, per-process cache).
Settings from env: `DJANGO_SECRET_KEY` (required), DEBUG, ALLOWED_HOSTS, CSRF_TRUSTED_ORIGINS, NUM_PROXIES, POSTGRES_* (SQLite if no host).

## physics-service HTTP (node:http, port 8100)
```
GET  /health → {status, configVersion}
POST /verify → readBody(≤16 KiB) → parseVerifyRequest → version check (409) → initPhysics → verifyRound
               → {ok, mismatches[], serverOutcomes, resultHash, seed, roundId}
```
src/app.ts (routing) · verify.ts (pure check) · parse.ts (seed/roundId parsers) · replay.ts + cli.ts (`npm run replay`).

## physics-service daemons (poll every 2 s, one tx at a time)
```
operator/main.ts  ─ checks OperatorCap owner, starts Operator (+ Arbiter if same key owns AdminCap)
operator/operator.ts  RoundCreated feed → nextAction(round) →
     BET_LOCKED: drawSeedTx · SEEDED: runRound → submitResultTx · SUBMITTED: wait → finalizeTx
operator/arbiter.ts   Challenged feed → arbiterAction → after vote deadline: runRound → resolveByAdminTx
operator/cheat.ts     OPERATOR_CHEAT=shortchange → all outcomes -1 (demo forgery)
operator/roundFeed.ts listEvents cursor → round object ids
verifier/main.ts + verifier.ts  Challenged feed → verifierAction →
     no committee: selectCommitteeTx · drawn & not voted: runRound → voteTx
```
State is re-read from chain every tick; a failed step is retried after 30 s.

## Move entry points (contracts/pachinko/sources)
| Module | Function | Caller |
|---|---|---|
| round | `create_round(game, bet)` | player |
| round | `draw_seed(round, random, clock)` (entry) | anyone |
| round | `refund_unsubmitted(round, clock)` | anyone |
| round | `set_config_version`, `set_submit_window` | AdminCap |
| verification | `issue_operator_cap`, `create_house`, `withdraw_house` | AdminCap |
| verification | `fund_house`, `join_pool`, `leave_pool` | anyone / verifier |
| verification | `submit_result(cap, round, house, outcomes, hash, bond, clock)` | OperatorCap |
| verification | `challenge(round, house, bond, clock)` | anyone |
| verification | `select_committee(round, house, random, clock)` (entry) | anyone |
| verification | `vote(round, house, outcomes, clock)` | drawn verifier |
| verification | `finalize(round, house, clock)` | anyone |
| verification | `resolve_by_admin(cap, round, house, outcomes, clock)` | AdminCap |
| committee | `join/leave/draw/record_vote/settle` (package-only) | via verification |

Payout (placeholder): `bet × Σ multipliers_bps[pocket] / (balls × 10_000)`; unlanded ball = 0.
Bonds on dispute: committee → winner gets own + ½ loser's, majority voters split ½; admin → winner takes both.

## Key files
contracts/pachinko/sources/verification.move (514) · committee.move (228) · round.move (242)
physics-service/src/operator/operator.ts (110) · arbiter.ts (83) · verifier/verifier.ts (95)
backend/apps/users/views.py (73) · serializers.py · config/settings.py (127)
