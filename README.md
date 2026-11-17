# Project Pachinko

Physics-decided, replay-verifiable pachinko. See `docs/` for the spec and plan.

## Layout

| Folder | What | Stack |
|---|---|---|
| `physics/` | Shared deterministic physics (`runRound`) used by frontend and backend | TypeScript, Rapier 2D (deterministic) |
| `frontend/` | Game UI: runs the round locally and draws it | React, TypeScript, Vite |
| `physics-service/` | Backend copy of the physics: re-runs a seed, checks each ball's outcome | Node, TypeScript |
| `backend/` | Rounds, seeds, result storage, API | Django, DRF |
| `database/` | PostgreSQL setup notes and init scripts | PostgreSQL |
| `contracts/` | Sui Move package (later) | Move |
| `docs/` | Spec and project plan | Markdown |

## Run (Node parts)

```bash
npm install
npm test                    # all workspace tests
npm run dev                 # frontend (code-server: http://<host>/absproxy/5180/)
npm run dev:physics-service # physics service on :8100 (POST /verify)
npm run replay -- <seed> [roundId]  # re-run one round, print outcomes + hash
```

## Start the backend

First time only (from the repo root):

```bash
~/.local/bin/uv venv --python 3.12 backend/.venv
~/.local/bin/uv pip install --python backend/.venv -r backend/requirements.txt
cp .env.example .env    # then set DJANGO_SECRET_KEY in .env to a long random string
```

Every time:

```bash
cd backend
set -a && . ../.env && set +a      # load .env
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

The API runs at `http://127.0.0.1:8000`. Stop it with `Ctrl+C`.

## Run everything for development

Start the backend (above) in one terminal and `npm run dev` in another, then open
`http://<host>/absproxy/5180/`.

## Who owns what

Kevin: `physics/`, game frontend, `physics-service/`, `backend/apps/users` + `apps/rounds`,
Move `round` module. Kiana: verifier, Verify page, `backend/apps/verification`
(`/api/verification/`), Move `verification` module. Shared: `docs/SPEC.md`,
`backend/apps/results`. Details: `docs/ARCHITECTURE.md` §5.
