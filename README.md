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
npm run dev:physics-service # physics service on :8100
```

## Run (backend) — Python 3.12 via `uv`, SQLite by default

First time only — create `.env` (gitignored, never commit it) with a random secret key:

```bash
cp .env.example .env
# Replace DJANGO_SECRET_KEY's placeholder with a fresh random key:
KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$KEY|" .env
```

First time only — Python env (from the repo root):

```bash
cd backend
~/.local/bin/uv venv --python 3.12 .venv
~/.local/bin/uv pip install --python .venv -r requirements.txt -r requirements-dev.txt
```

Every time — from `backend/`. `set -a` exports every variable `.env` defines; the
`test -f` stops early with a clear message instead of a Django traceback if `.env`
is missing:

```bash
test -f ../.env || { echo "Missing .env — see 'First time only' above"; false; } &&
  set -a && . ../.env && set +a &&
  .venv/bin/python manage.py migrate &&
  .venv/bin/python manage.py runserver 127.0.0.1:8000
```

Tests: `.venv/bin/python manage.py test` (coverage: `.venv/bin/coverage run manage.py test && .venv/bin/coverage report`).

PostgreSQL instead of SQLite: set `POSTGRES_HOST` (and the other `POSTGRES_*`) in `.env`,
then `docker compose --env-file .env up -d`.

## Run everything for development

Two terminals: Django (above) on `:8000`, then `npm run dev` for the frontend. Vite
forwards `<base>api/*` to Django, so sign-in works at `http://<host>/absproxy/5180/`.

## Who owns what

Kevin: `physics/`, game frontend, `physics-service/`, `backend/apps/users` + `apps/rounds`,
Move `round` module. Kiana: verifier, Verify page, `backend/apps/verification`
(`/api/verification/`), Move `verification` module. Shared: `docs/SPEC.md`,
`backend/apps/results`. Details: `docs/ARCHITECTURE.md` §5.
