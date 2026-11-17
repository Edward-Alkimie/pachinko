# pachinko (Move package)

Sui Move 2024 package for one on-chain round. Modules: `round` (bet + seed), `verification`
(result, challenge, payout). Design, state machine and open decisions: `docs/CONTRACTS.md`.
Shared interface: `docs/SPEC.md` §7.

## Build and test

Needs the Sui CLI (`sui --version`). Run from this folder:

```bash
sui move build --lint      # compile; must print no warnings
sui move test --lint       # unit tests (test_scenario)
```

Tests (`tests/`): `round_tests` (bet, seed, config version), `verification_tests` (result hash
equals the physics golden fixture; honest round; forged result caught by a challenge; false
challenge loses its bond; wrong state / wrong time / bad input aborts; house insolvency).

## Publish and run one round on testnet

Each teammate tests on **their own deployment** (own package, House, `AdminCap`, `OperatorCap`).
`npm run deploy:testnet` (repo root) publishes this package, creates and funds the House, and saves
the ids to `chain/src/deployments/<name>.json`, where `<name>` is `PACHINKO_DEPLOYMENT` in your `.env`.
Commit your file; the ids are public. The deploying key holds that deployment's caps.

`npm run round:testnet` then plays one full round on that deployment: create round (bet) →
draw seed → `runRound` off-chain → submit result → wait out the challenge window → finalize.
It prints every transaction digest with a Suiscan link. It acts as player and operator, so run
it with the deploying key.

### One-time setup: a testnet key in `.env`

A Sui account is a key pair. The **address** (`0x…`) is public. The **private key** signs
transactions and controls the account's coins. Never share it or commit it.

1. **Have a Sui CLI address.** `sui client active-address` prints it. On a fresh install,
   `sui client` asks to create a config: choose testnet and an `ed25519` key. To get a separate
   key just for this project, run `sui client new-address ed25519`.
2. **Use testnet:** `sui client switch --env testnet` (`sui client envs` shows the active one).
3. **Get free test SUI** (one run uses about 0.1 SUI; the bond comes back):
   `sui client faucet`, or paste your address into https://faucet.sui.io.
   Check with `sui client balance`.
4. **Export the private key.** This only reads your local keystore
   (`~/.sui/sui_config/sui.keystore`) and sends nothing:
   ```bash
   sui keytool export --key-identity <your address>
   ```
   Copy the `exportedPrivateKey` value. It starts with `suiprivkey1`.
5. **Put it in `.env`** at the repo root, with your deployment name. Make sure `.env` stays
   gitignored, so `git status` should never list it:
   ```bash
   cp .env.example .env      # if you don't have one yet
   # then edit .env:
   SUI_PRIVATE_KEY=suiprivkey1...
   PACHINKO_DEPLOYMENT=kevin     # your name: lowercase letters, digits, dashes
   ```
6. **Deploy your copy once:** `npm run deploy:testnet`, then commit `chain/src/deployments/<name>.json`.

### Run

```bash
npm install               # once, from the repo root
npm run deploy:testnet    # once per person, and again after contract changes
npm run round:testnet     # honest round: submit → window → finalize
npm run forged:testnet    # forged jackpot → challenge → resolve_by_admin (true outcomes)
```

**Connected round:** start the operator and leave it running, then place bets as the player.
```bash
npm run operator          # terminal 1: draws seeds, runs physics, submits, finalizes
npm run bet:testnet       # terminal 2: bet, then watch BET_LOCKED → SEEDED → SUBMITTED → FINALIZED
```
The operator key must own your deployment's `OperatorCap` (the key that ran `deploy:testnet`).
Use `OPERATOR_PRIVATE_KEY` in `.env` if it differs from `SUI_PRIVATE_KEY`.

**Play in the browser:** set `VITE_PACHINKO_DEPLOYMENT=<your name>` in `.env`, keep `npm run operator`
running, then `npm run dev` and open the page. In **On-chain play**, connect a Sui wallet set to testnet
(e.g. Slush: browser extension, or the Slush web wallet that the page offers) with some faucet SUI
**on that wallet's address**, then click **Play on-chain**. You sign only the bet; the seed, physics,
submit and finalize happen on the operator. The board plays the on-chain seed, and the payout appears
once the round is final.

`forged:testnet` can use a second address as the challenger, so the bond transfer shows up as a
real transfer. Repeat steps 1, 3 and 4 above for a second address (e.g. `sui client new-address ed25519`),
then set `CHALLENGER_PRIVATE_KEY=` in `.env`. Without it, the main key also challenges.

Optional settings (bet, bonds, house funds, window, multipliers) are listed in `.env.example`.
To check a round off-chain, run `npm run replay -- <seed> <round_id>`: it prints the same
`resultHash` the contract accepted. Open any digest on https://suiscan.xyz/testnet to see its
events and objects.
