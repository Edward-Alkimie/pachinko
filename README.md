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

## Start the backend (Django API on port 8000)

Python 3.12 via [`uv`](https://docs.astral.sh/uv/), SQLite database by default.
**Run every command below from the repo root** (`~/ProjectFile/pachinko`).

### First time only (setup)

1. **Install `uv`** (skip if `~/.local/bin/uv --version` already works):

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **Create the Python environment** in `backend/.venv` (gitignored) and install packages:

   ```bash
   ~/.local/bin/uv venv --python 3.12 backend/.venv
   ~/.local/bin/uv pip install --python backend/.venv -r backend/requirements.txt -r backend/requirements-dev.txt
   ```

3. **Create `.env`** from the template, with a fresh random secret key
   (`.env` is gitignored — never commit it):

   ```bash
   cp .env.example .env
   KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
   sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$KEY|" .env
   ```

### Every time (start the server)

```bash
cd backend &&
  test -f ../.env || { echo "Missing .env — do the 'First time only' steps"; false; } &&
  set -a && . ../.env && set +a &&
  .venv/bin/python manage.py migrate &&
  .venv/bin/python manage.py runserver 127.0.0.1:8000
```

What each line does:
- `test -f ../.env` — stops with a clear message if `.env` is missing (instead of a Django traceback).
- `set -a && . ../.env && set +a` — loads every variable in `.env` into this shell.
- `migrate` — creates / updates the database tables (safe to run every time).
- `runserver` — starts Django on `http://127.0.0.1:8000`. Leave this terminal open.

**Check it works** (in another terminal):

```bash
curl http://127.0.0.1:8000/api/auth/csrf     # → {"detail":"CSRF cookie set."}
```

**Stop it:** press `Ctrl+C` in the server terminal.

### Run the backend tests

```bash
cd backend && set -a && . ../.env && set +a && .venv/bin/python manage.py test
# with coverage:
.venv/bin/coverage run manage.py test && .venv/bin/coverage report
```

### Common problems

| Error | Fix |
|---|---|
| `Missing required environment variable: DJANGO_SECRET_KEY` | `.env` is missing or wasn't loaded — do step 3, start from the repo root |
| `No such file or directory: .venv/bin/python` | Do step 2 |
| `Error: That port is already in use` | Another server is running: stop it, or use `runserver 127.0.0.1:8001` (then set `BACKEND_URL` in `.env` for the frontend) |
| `DisallowedHost` | Add the host name to `DJANGO_ALLOWED_HOSTS` in `.env` |

**PostgreSQL instead of SQLite:** uncomment `POSTGRES_HOST` (and set the other `POSTGRES_*`)
in `.env`, start the database with `docker compose --env-file .env up -d`, then start the
server as above.

## Run everything for development

Two terminals:
1. Backend — "Every time" command above (Django on `:8000`).
2. Frontend — `npm run dev` from the repo root.

Open `http://<host>/absproxy/5180/`. Vite forwards `<base>api/*` to Django, so sign-in works.
If the sign-in box says "Cannot reach the server", the backend (terminal 1) isn't running.

## Who owns what

Kevin: `physics/`, game frontend, `physics-service/`, `backend/apps/users` + `apps/rounds`,
Move `round` module. Kiana: verifier, Verify page, `backend/apps/verification`
(`/api/verification/`), Move `verification` module. Shared: `docs/SPEC.md`,
`backend/apps/results`. Details: `docs/ARCHITECTURE.md` §5.
