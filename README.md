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

## Run (backend) — needs Python 3.12+ and PostgreSQL

```bash
cp .env.example .env              # then edit values
docker compose --env-file .env up -d   # or use a local Postgres
cd backend && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate && python manage.py runserver
```
