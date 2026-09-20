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

## Directory conventions (目录规范)

**根目录只允许放「代码 / 原型 / 文档」三类内容；其余一律归位，禁止散落根目录。** 这是硬约束，新增任何文件前先判断类别。

### 根目录合法项
- 构建/配置：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig*.json`、`eslint.config.js`、`.prettierrc.json`、`vite.config.ts`、`vitest.scripts.config.ts`、`playwright.config.ts`、`.env.example`、`.gitignore`
- 入口：`index.html`（被 `server.ts` 的 Vite 中间件引用，`<script src="/src/main.tsx">`）、`src/`（**dev 模式前端源码，被 `server.ts` 直接服务，禁止移动**）、`server.ts`、`server.mjs`、`*.bat`
- 代码包与资产：`packages/`（六阶段 + contracts/infra）、`prototype/`（HTML 原型）、`docs/`（唯一全局文档根）、`scripts/`、`config/`、`e2e/`、`tests/`、`logs/`、`dist/`（gitignored）、`node_modules/`
- 隐藏运行时/工具目录：`.credentials/`、`.data/`、`.git/`、`.workbuddy/`、`.turbo/`、`.codegraph/`、`.omo/`、`.opencode/`、`.trae/`

### 禁止出现在根目录（违规即清理）
- 一次性诊断/调试脚本：`__*.cjs`、`_*.cjs`、`test-*.cjs`、`test-*.mjs`、`dump*.ts`、`_repro*.mts`、`_seed*.mjs`、`_send_case.mjs`、`run_*.ts`、`run_*.mjs`、`unified-test.mjs`
- 调试数据转储：`_*.json`、`debug_*.json`、`final_output.json`、`_fa.json`、`batch.json`、`metadata.json`、各类 `*.log` / `.service-*.log`
- 草稿笔记：`*.txt`（`fix-*.txt`、`test-module-*.txt`、`speed-test-brief.txt` 等）
- 多余锁文件：`bun.lock`、`package-lock.json`（本项目只用 pnpm）
- 运行产物目录：`shots/`、`test-screenshots/`、`test-results/`、`playwright-report/`

### 去处
- 临时/垃圾产物统一放 `D:\test-platform-smoke\`（或仓库内 `tmp/archive-YYYY-MM-DD/`，可随时删除），**不得提交、不得留在根目录**。
- 设计/计划/审查类 `.md` 文档只许放 `docs/`（可建 `designs/`、`plans/`、`superpowers/` 子目录），根目录不得出现文档文件。
- 凭证/运行时状态 `.credentials/`、`.data/` 保持原位，gitignored，禁止提交。

### 红线
- 代码进 `packages/*` 或对应包/src；文档进 `docs/`；原型进 `prototype/`；临时探索产物进 `tmp/` 或 `D:\test-platform-smoke\`。
- 根目录出现 `__*` / `_*` / `*.log` / `dump*` / `test-*` 等即视为违规。
