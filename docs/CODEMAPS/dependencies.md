<!-- Generated: 2026-11-26 | Files scanned: 183 | Token estimate: ~550 -->
# Dependencies

## Internal packages
```
@pachinko/physics  ← frontend, physics-service, scripts
@pachinko/chain    ← frontend, physics-service, scripts      (`/node` subpath: deployment files, Node only)
physics-service    ← backend (HTTP /verify, planned client in apps/results/physics_client.py)
```

## External services
| Service | Used by | How |
|---|---|---|
| Sui testnet full node | chain, frontend, physics-service, scripts | gRPC `fullnode.testnet.sui.io:443` (JSON-RPC is off) |
| Sui GraphQL | config only | `SUI_GRAPHQL_URL` in .env |
| Sui wallets (Slush etc.) | frontend | `@mysten/dapp-kit-react` |
| suiscan.xyz | logs/UI links | explorer URLs in chain/src/deployment.ts |
| PostgreSQL 16.4 | backend (optional) | docker-compose `db` |

## Third-party libraries (pinned)
| Package | Version | Where | Purpose |
|---|---|---|---|
| @dimforge/rapier2d-deterministic-compat | 0.21.0 | physics | cross-platform deterministic 2D physics (WASM) |
| @noble/hashes | 1.8.0 | physics | SHA-256, HMAC |
| @mysten/sui | 2.39.1 | chain, frontend, service, scripts | tx building, BCS, gRPC client, keypairs |
| @mysten/dapp-kit-core / -react | 1.6.43 / 2.1.45 | frontend | wallet connect + signing |
| react / react-dom | ^19.1.0 | frontend | UI |
| vite, vitest, eslint, typescript ~5.8 | dev | all TS | build / test / lint |
| tsx | ^4.19 | physics-service, scripts | run TS directly |
| Django | 5.2.4 | backend | web framework (behind several 5.2.x security releases) |
| djangorestframework | 3.16.0 | backend | API views, throttling |
| psycopg[binary] | 3.2.9 | backend | Postgres driver |
| requests | 2.32.4 | backend | physics-service client (planned) |
| Sui framework (Move) | Move.toml / Move.lock | contracts | `sui::random`, `clock`, `balance`, `table`, `dynamic_field` |

## Secrets / config (.env at repo root, see .env.example)
`DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`, `SUI_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY`, `VERIFIER_PRIVATE_KEYS` (server-side only).
`VITE_PACHINKO_DEPLOYMENT`, `VITE_API_URL` (exposed to the page).
