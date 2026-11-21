# pachinko (Move package)

Sui Move 2024 package for one on-chain round. Modules: `round` (bet + seed), `verification`
(result, challenge, payout). Design, state machine and open decisions: `docs/CONTRACTS.md`.
Shared interface: `docs/SPEC.md` §7.

Setup and running a round (key, `.env`, deploy, operator, browser): see the root `README.md`.
This file covers what is specific to the contracts.

## Build and test

Needs the Sui CLI (`sui --version`). Run from this folder:

```bash
sui move build --lint      # compile; must print no warnings
sui move test --lint       # unit tests (test_scenario)
```

Tests (`tests/`): `round_tests` (bet, seed, config version), `verification_tests` (result hash
equals the physics golden fixture; honest round; forged result caught by a challenge; false
challenge loses its bond; wrong state / wrong time / bad input aborts; house insolvency).

## Deployments and keys

`npm run deploy:testnet` (repo root) publishes this package, creates and funds the House, and saves
the ids to `chain/src/deployments/<PACHINKO_DEPLOYMENT>.json`. Each teammate has their own
deployment (package, House, `AdminCap`, `OperatorCap`). The ids are public, so commit the file.
Deploy again after any contract change.

The deploying key holds that deployment's caps, so:

- **Operator:** `npm run operator` must sign with the key that owns the `OperatorCap`. Set
  `OPERATOR_PRIVATE_KEY` in `.env` if that is not `SUI_PRIVATE_KEY`.
- **Arbiter (fallback):** if that key also owns the `AdminCap` (normal: the deploying key), the same
  process settles challenged rounds the committee leaves undecided, after the vote deadline, with
  `resolve_by_admin`. Otherwise it logs `arbiter off`.
- **Challenge demo:** run the operator with `OPERATOR_CHEAT=shortchange`, then play from the page
  (or `bet:testnet`) and challenge the mismatch. A browser wallet is a second address, so the bond
  transfer shows up as a real transfer.

Optional settings (bet, bonds, house funds, window, multipliers) are listed in `.env.example`.

## Troubleshooting

- **No Sui CLI config yet:** `sui client` asks to create one. Choose testnet and an `ed25519` key.
- **Wrong network:** `sui client envs` shows the active one; `sui client switch --env testnet`.
- **Out of test SUI:** `sui client faucet`, or paste your address into https://faucet.sui.io.
  Check with `sui client balance`. One round uses about 0.1 SUI (the bond comes back).
- **Key safety:** `sui keytool export` only reads your local keystore
  (`~/.sui/sui_config/sui.keystore`) and sends nothing. Never share or commit the
  `suiprivkey1…` value, and `git status` should never list `.env`.
- **Browser wallet has no funds:** the bet is paid from the wallet's own address (e.g. Slush),
  which is not your CLI address. Fund that address from the faucet too. You sign only the bet;
  the operator does seed, physics, submit and finalize.
- **Check a round off-chain:** `npm run replay -- <seed> <round_id>` prints the same `resultHash`
  the contract accepted. Open any digest on https://suiscan.xyz/testnet to see its events and objects.
