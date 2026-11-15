# Database

PostgreSQL 16. Tables are created by Django migrations (`python manage.py migrate`),
not by hand-written SQL.

- Start locally: `docker compose --env-file .env up -d` (from the repo root)
- `init/` runs once on first container start (optional extra setup, e.g. extensions).

## Planned tables (from Django apps)

| Table | App | Purpose |
|---|---|---|
| `rounds_round` | rounds | round id, seed, config version, status, timestamps |
| `results_roundresult` | results | client vs server outcomes per ball, verified flag |
