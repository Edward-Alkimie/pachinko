<!-- Generated: 2026-11-26 | Files scanned: 183 | Token estimate: ~750 -->
# Data

The source of truth for rounds and money is **on-chain** (Sui objects + events). Django stores only accounts.

## On-chain objects (contracts/pachinko)
```
AdminCap      owned (deployer)                 id
OperatorCap   owned (issued by admin)          id
Game          shared singleton                 next_round_id, config_version, submit_window_ms
Round         shared, one per bet              round_id, player, config_version, seed[32], bet: Balance,
                                               status u8, submit_window_ms, submit_deadline_ms
  └ df SubmissionKey → Submission              house: ID, operator, outcomes: vector<u16>, result_hash,
                                               deadline_ms, operator_bond, challenger?, challenger_bond
  └ df DisputeKey → Dispute (while CHALLENGED) deadline_ms, excluded[3], committee[3], votes[{voter, hash}]
House         shared (admin)                   treasury, multipliers_bps[pockets], balls_per_round,
                                               operator_bond, challenger_bond, challenge_window_ms,
                                               vote_window_ms, pool: Pool
  └ Pool                                       stake, members: vector<address>,
                                               verifiers: Table<address, {stake, open_duties}>
```
TS mirrors: chain/src/objects.ts (`RoundBcs`, `SubmissionBcs`, `DisputeBcs`, `HouseBcs`). Field order must match Move.

## On-chain events (chain/src/events.ts)
round: `RoundCreated`, `SeedDrawn`, `Refunded`
verification: `ResultSubmitted`, `Challenged`, `CommitteeSelected`, `Voted`, `Resolved`, `Finalized`
committee: `VerifierJoined`, `VerifierLeft`, `VerifierSlashed`
Readers: `findFinalized`, `findResolved`, `findCommitteeVotes`, `findRoundByNumber`, `fetchRoundHistory`.

## Shared encodings (docs/SPEC.md)
- Seed: 32 bytes, hex in the UI/API.
- Launch bytes: `HMAC-SHA256(seed, u64 roundId ‖ u32 ballId ‖ u8 event)`.
- Result hash: `sha256("PACHINKO-RESULT-V1" ‖ u16 len ‖ version ‖ seed ‖ u64 roundId ‖ u32 n ‖ i16 outcome×n)` (BE).
- Outcome: pocket id, or `-1` (physics) = `0xFFFF` (on-chain u16), mapped in chain/src/outcomes.ts.
- u64 values travel as decimal strings in JSON.

## Deployment records
`chain/src/deployments/<name>.json` (committed, public ids): packageId, gameId, houseId, adminCapId, operatorCapId, house settings. Written by `scripts/deploy.ts`, validated by `parseDeployment`.

## Django database (SQLite dev / PostgreSQL 16 via docker-compose)
| Table | Model | Migration |
|---|---|---|
| users_user | `apps.users.User(AbstractUser)` | 0001_initial |
| auth / sessions / admin / contenttypes | Django built-ins | — |
Planned (stubs only): `rounds.Round`, `results.RoundResult` (client vs server outcomes, mismatches).
`database/init/` is mounted as Postgres init scripts (empty).
