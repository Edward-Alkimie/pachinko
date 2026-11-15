# Project Pachinko — notes for Claude

- Read `docs/ARCHITECTURE.md` first: it maps how data flows between the major functions.
- When you add, rename or remove a major function, or change a data flow, **update
  `docs/ARCHITECTURE.md` in the same change** (diagram + function index + status).
  `physics/tests/docs.test.ts` enforces this for `@pachinko/physics` exports.
- Shared interfaces (config values, seed bytes, outcome format) live in `docs/SPEC.md`.
- Only `physics/` contains machine rules; frontend and physics-service import it.
- Test each step (tests, typecheck, build) before moving on.
- Dev server in code-server: `npm run dev` → `http://<host>/absproxy/5180/`.
