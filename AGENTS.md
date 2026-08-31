# AGENTS.md — test-platform

pnpm monorepo (ESM, TypeScript strict, Node >=20, pnpm 9.15.9). A commercial automated-testing platform: a pipeline turns a logged-in system into feature tables, test cases, execution reports, and defect tables.

## Architecture (contracts-first, stages decoupled)

- `packages/contracts` — **single source of truth** for all stage I/O: zod schemas (`src/schemas`, `src/stages`), types, constants. Other packages import from it, so it must build first (`pnpm build` builds it before dependents).
- `packages/engine-mcp` — Playwright browser engine abstraction (`McpEngine`, `createEngine`). Wraps all browser actions.
- `packages/infra-*` — `infra-logger`, `infra-store`, `infra-cred` (AES-256-GCM credential store), `infra-ai`.
- `packages/stage-*` — pipeline stages, run in fixed order:
  `login → explore → feature → case → execute → defect`. Each stage's output feeds the next via the orchestrator.
- `packages/orchestrator` — `PipelineOrchestrator` that runs the full pipeline (`run`) or a single stage (`runStage`). `server.ts` is its backend entrypoint.
- `packages/app` — React + Vite frontend. **Excluded from `pnpm build`** (see commands).

## Commands

```bash
pnpm install                 # pnpm only — do not use npm
pnpm build                   # builds ALL packages EXCEPT app (filter=!app)
pnpm build:frontend          # builds the app (Vite) — needed for the frontend server
pnpm typecheck / lint / test / verify   # recursive across packages
pnpm server                  # backend dev server via `tsx server.ts` (NO build needed)
node scripts/restart.mjs restart   # full deploy: build app + start backend(3001) + static frontend(5173)
node scripts/restart.mjs stop | status | build
npx playwright test          # e2e in ./e2e (needs services running first)
pnpm madge                   # circular-dependency check across packages/*/src
```

Per-package / focused runs:
```bash
pnpm --filter @test-platform/stage-login test          # one package
pnpm --filter @test-platform/stage-login test -- src/foo.test.ts   # one test file
```

## Backend entrypoints (two, don't confuse)

- `pnpm server` → `orchestrator` `server` script = `tsx server.ts`. Use this for dev — no build required.
- Root `server.mjs` (the HTTP bridge: `/api/stage`, `/api/full-pipeline`, `/api/credentials`, `/api/capture/*`) imports the **built** `@test-platform/orchestrator` dist. Requires `pnpm build` first. Listens on port **3001**; frontend static server is **5173**.

## Conventions & quirks

- **ESLint is zero-warning**: `eslint src --max-warnings 0` (warnings fail). `@typescript-eslint/consistent-type-imports` is an error; unused vars/locals error unless prefixed `_`.
- **Prettier `endOfLine: lf`** — set your editor to LF, not CRLF (Windows default breaks diffs).
- Packages build with plain `tsc` to `dist/` (declarations + maps). No bundlers for library packages; only `app` uses Vite.
- **Credentials**: `infra-cred` encrypts at rest. Env: `TEST_PLATFORM_CRED_DIR`, `TEST_PLATFORM_MASTER_KEY` (defaults to insecure `'dev-insecure-master-key'` — set a real key outside dev).
- **Browser session rule (old bug)**: cookies/headers/tokens cannot be injected on `about:blank`; navigate to the http(s) system URL first, then `applySession`, or it throws.
- **Browsers are intentionally never closed** after execute/capture — kept visible. Don't add `engine.close()` there.
- Stage `case`/`explore` do a **secondary exploration** (auto `extractPageElements`) when no `exploredElements` is supplied; this triggers real browser work, so unit tests should pass `exploredElements` to stay offline.
- E2E (`playwright.config.ts`) runs `workers: 1`, `fullyParallel: false`, `baseURL: http://localhost:5173`; flaky if backend isn't up.
- `orchestrator` `verify` = `vitest run --config vitest.verify.config.ts`; `contracts` also has a separate `vitest.verify.config.ts`.

## Docs

Design/PRD docs are in `docs/` (Chinese). No CI workflow present (no `.github`). Local task runner is the root `*.bat` scripts (`start.bat`, `stop.bat`, `check.bat`) which wrap `restart.mjs`.
