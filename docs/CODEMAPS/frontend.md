<!-- Generated: 2026-11-26 | Files scanned: 183 | Token estimate: ~800 -->
# Frontend (frontend/, React 19 + Vite, port 5180)

## Views (hash routing, onchain/verify.ts parseRoute)
```
''            → Play view
#verify       → Verify view (empty)
#verify/<n>   → Verify view for round n (shareable)
```
Both views stay mounted, so switching never stops an on-chain round being followed.

## Component tree
```
main.tsx → <App>                       (App.tsx: useAuth, useRound, claims map, route)
  ├ <PachinkoCanvas config balls>      game/: drawBoard + drawBalls, DPR sizing, theme.ts
  ├ Play:
  │   ├ <AuthPanel>                    ← useAuth (services/auth.ts)
  │   └ <OnchainPanel onSeed onClaim>  ← useOnchainRound, getDAppKit
  │        ├ <WalletPanel>             dApp Kit ConnectButton
  │        ├ <RoundSteps>              onchain/roundSteps.ts
  │        ├ <ResultHashes>            replay vs submitted vs paid
  │        └ <ReplayCommand>/<CopyValue>
  ├ Verify:
  │   ├ <VerifyPanel>                  ← useVerifyRound; verdictOf
  │   └ <SeedInput onReplay>           lib/validation.ts (checkSeed, checkRoundId)
  └ <ResultPanel>                      tally, board hash, operator claim
```

## State flow
```
useRound(config).start(seed, roundId)
  status idle → simulating (initPhysics + runRound, recordEvery 2) → playing (rAF, tickAt @120 Hz) → done
  App derives: frameIndexAt(tick) → balls · tallyAt(...) → tally · done → resultHash
  start() resolves with the result → playReplay returns resultHash to callers

useOnchainRound(deployment, dAppKit, onSeed)
  play(): wallet signs createRoundTx(0.01 SUI) → RoundCreated event → follow() polls fetchRound every 1.5 s
  phase: signing → waitingSeed → waitingResult → verifying → [challenged] → final | refunded | error
  seed seen → onSeed (board replay) → replayHash
  replayCheck(replayHash vs submittedHash) → match | mismatch → challenge() offered
  canRefund (past submit deadline) → refund()
  stageOf() holds chain results back while the balls are still falling
  settlement() → bet / bond / payout / award lines and net

useVerifyRound: findRoundByNumber → fetchRound + fetchRoundHistory → replayOnBoard → verdictOf
  verdicts: verified | caught | upheld | unchallenged | paidMismatch | refunded | inProgress

useAuth: mount → fetchMe → anonymous | authenticated; login/register/logout via services/auth.ts
```

## Integration
- API: `services/api.ts` API_URL = `VITE_API_URL ?? <base>api`, proxied by Vite to `BACKEND_URL` (rewrites Origin).
- CSRF: `services/auth.ts` reads `csrftoken` cookie (GET /auth/csrf if missing) → `X-CSRFToken` header.
- Chain: `onchain/dappKit.ts` lazy `createDAppKit` (testnet, gRPC); `onchain/deployment.ts` globs `chain/src/deployments/*.json`, picks `VITE_PACHINKO_DEPLOYMENT`.
- Env: `envDir: '..'`; only `VITE_*` values reach the page.

## Key files
hooks/useOnchainRound.ts (414) · components/OnchainPanel.tsx (286) · VerifyPanel.tsx (276)
App.tsx (153) · services/auth.ts (152) · hooks/useRound.ts (119) · game/drawBoard.ts (103)
Tests: colocated `*.test.ts(x)` (vitest + Testing Library).
