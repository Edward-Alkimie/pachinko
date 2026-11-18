# Project Pachinko

Physics-decided, replay-verifiable pachinko on Sui. See `docs/` for the spec and plan
(`docs/ARCHITECTURE.md` maps how the parts connect).

## Layout

| Folder | What | Stack |
|---|---|---|
| `physics/` | Shared deterministic physics (`runRound`) used by frontend and backend | TypeScript, Rapier 2D (deterministic) |
| `frontend/` | Game UI: plays on-chain rounds, replays any seed, and draws the round | React, TypeScript, Vite |
| `physics-service/` | Backend copy of the physics (re-runs a seed, checks outcomes) + the testnet operator | Node, TypeScript |
| `backend/` | Rounds, seeds, result storage, API | Django, DRF |
| `database/` | PostgreSQL setup notes and init scripts | PostgreSQL |
| `contracts/` | Sui Move package: `round` (bet + seed), `verification` (submit, challenge, payout) | Move (Sui testnet) |
| `chain/` | Shared Sui code: transaction builders, event/object readers, testnet deployment ids | TypeScript, Sui TS SDK |
| `scripts/` | Testnet tooling: deploy, play one full on-chain round | TypeScript, Sui TS SDK |
| `docs/` | Spec and project plan | Markdown |

## Setup (first time only)

All commands run from the repo root.

### 1. Node and `.env`

```bash
npm install
cp .env.example .env
```

### 2. Backend

```bash
~/.local/bin/uv venv --python 3.12 backend/.venv
~/.local/bin/uv pip install --python backend/.venv -r backend/requirements.txt
```

Set `DJANGO_SECRET_KEY` in `.env` to a long random string.

### 3. Sui testnet

Each teammate has their own deployment (contracts + House), picked by name in `.env`.
Details and troubleshooting: `contracts/pachinko/README.md`.

1. `sui client active-address`, switch to testnet, and get test SUI from the faucet (about 0.2 SUI is enough).
2. `sui keytool export --key-identity <your address>` → copy the `suiprivkey1…` value.
3. Add to `.env`:
   ```bash
   SUI_PRIVATE_KEY=suiprivkey1...
   PACHINKO_DEPLOYMENT=<name>        # e.g. kevin
   VITE_PACHINKO_DEPLOYMENT=<name>   # e.g. kevin
   ```
4. `npm run deploy:testnet` → writes `chain/src/deployments/<name>.json`. Commit it (public ids only).

## Run

### Play a round on testnet

1. Terminal 1: `npm run operator` (keep it running; it draws seeds, runs physics, submits, finalizes).
2. Terminal 2: `npm run dev` → open `http://<host>/absproxy/5180/`.
3. Under **On-chain play**, connect a wallet (e.g. Slush, on testnet, with some test SUI) → **Play on-chain**.

No browser? `npm run bet:testnet` bets and follows the round in the terminal.

### Backend

```bash
cd backend
set -a && . ../.env && set +a      # load .env
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

The API runs at `http://127.0.0.1:8000`. Stop it with `Ctrl+C`.

## Commands

| Command | What it does |
|---|---|
| `npm test` | All workspace tests |
| `npm run dev` | Frontend (code-server: `http://<host>/absproxy/5180/`) |
| `npm run dev:physics-service` | Physics service on :8100 (`POST /verify`) |
| `npm run replay -- <seed> [roundId]` | Re-run one round, print outcomes + hash |
| `npm run deploy:testnet` | Publish your contracts + House → `chain/src/deployments/<PACHINKO_DEPLOYMENT>.json` |
| `npm run operator` | Operator: draws seeds, runs physics, submits, finalizes |
| `npm run bet:testnet` | Player side only: bet, then follow the round (needs the operator) |
| `npm run round:testnet` | One full round from a script, playing both sides |
| `npm run forged:testnet` | Same, but the operator forges a jackpot and a challenge catches it |

## Who owns what

Kevin: `physics/`, game frontend, `physics-service/`, `backend/apps/users` + `apps/rounds`,
Move `round` module. Kiana: verifier, Verify page, `backend/apps/verification`
(`/api/verification/`), Move `verification` module. Shared: `docs/SPEC.md`,
`backend/apps/results`. Details: `docs/ARCHITECTURE.md` §5.
