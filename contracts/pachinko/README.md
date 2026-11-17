# pachinko (Move package)

Sui Move 2024 package for one on-chain round. Modules: `round` (bet + seed), `verification`
(result, challenge, payout). Design, state machine and open decisions: `docs/CONTRACTS.md`.
Shared interface: `docs/SPEC.md` §7.

Needs the Sui CLI (`sui --version`). Run from this folder:

```bash
sui move build --lint      # compile; must print no warnings
sui move test --lint       # unit tests (test_scenario)
```
