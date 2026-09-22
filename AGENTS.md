# AGENTS.md — test-platform

## ⛔ HARD RULE #0 — NEVER HARDCODE ！（永远不要写死代码）

> **This is a commercial product that MUST adapt to ANY management system, for ANY client. Hardcoding a specific system is the single worst failure mode in this repo. It is a release blocker — no exceptions, no "just this once", no "temporary patch", no "will clean up later".**

**写死 = 发布阻断项。遇到"某个系统不工作"时，唯一允许的修法是加通用判据，不是加这个系统的特征。**

### ❌ 明令禁止（任一条出现即违规）

1. **禁止**把某系统/框架的 **class 名、ID、裸标签** 当作识别判据写入白名单/黑名单。
   已清除的历史违规（不得复活）：`#page-wrapper`、`.page-wrapper`、`.el-main`、`.ant-layout-content`、`*main-content`、`*page-container`、**裸 `nav`**、`top-links`、`navbar-right`、`navbar-top`、`top-bar`、`welcome-message`、`messages-menu|notifications-menu|tasks-menu|user-menu|user-panel|sidebar-toggle|logo|brand`。
2. **禁止**把中英文 UI 文案当过滤清单（如按字面跳过 `全屏/锁屏/消息/在线/首页`）。文案只允许用于**通用语义**判断（危险操作拦截），不得当系统指纹。
3. **禁止**在逻辑里出现 **系统名 / 域名 / 厂商名**（如 `ruoyi`、`adminlte`、`bpms`）的条件分支。
4. **禁止**"哪个系统坏了就给哪个系统加一个 selector"的补丁式修复 —— **类名清单本身就是写死**，清单永远追不完。
5. **禁止**为了通过某个系统的验收而放宽/绕过通用判据。

### ✅ 唯一允许的判据类型（任何系统都成立的性质）

| 维度 | 判据 | 权重 |
|---|---|---|
| **行为** | 点击后是否**真的导航**（主 URL 变化 / 内容区变化）或**新出下级项** | ★★★★★ |
| **结构** | 层级深度 ≥2；同构兄弟项 ≥5；子项同级同 class 模式 | ★★★★ |
| **几何** | 容器宽/高占视口比；是否贴边（侧栏窄、顶栏矮且横贯）；是否位于主体内容区 | ★★★ |
| **语义** | 仅用于通用危险操作拦截（退出/删除/清空）——与系统无关的动词 | ★★ |

> 反例（负分项，通用形态）：横向排布 ＋ 项数 ≤8 ＋ 无层级 ＋ icon-only/头像/铃铛 ⇒ 是部件条，不是菜单。

### 为什么（2026-09-20 真实事故）

为支持 OA，把**裸 `nav`** 列入菜单容器。结果：

| 系统 | 顶栏 `<nav class="navbar …">` 里装什么 | 需要 |
|---|---|---|
| OA (AdminLTE) | **一级菜单**（我的办公 / 项目管理 …） | 必须**收** |
| ruoyi | **部件**（文档 / 锁屏 / 全屏 / 消息 / 若依） | 必须**排** |

**结构同构、语义相反** ⇒ "命中 nav 就收"必然在其中一个系统上出错。上一轮补丁瞄的是 `navbar-right` / `top-links`，而它们长在**内部 `ul`** 上、容器自身是 `navbar-static-top` ⇒ 补丁**静默失效**（时灵时不灵）。
**结论：改好 A 就弄坏 B，是写死路线的必然结果，不是巧合。**

### 验证门槛（未全绿不得宣称完成）

必须在**真实项目上实跑**，覆盖：

| # | 系统 | 形态 | 通过标准 |
|---|---|---|---|
| 1 | OA bpms | AdminLTE 顶栏一级菜单 + 侧栏 + iframe | 5 个一级菜单、URL 100%、部件 0 |
| 2 | ruoyi | Vue2 侧栏纯菜单 + 顶栏部件 | 层级正确、**顶栏部件 0**、URL ≥95% |
| 3 | fantastic-admin | Vue3 hash 路由 SPA | 四层嵌套、action 0、URL 100% |
| 4 | 人大政务 | 自研 SPA | 无部件混入 |
| 5 | 任意新/未知系统 | 占位自研 | 不降级、层级不塌缩 |

另需逐项验证：**页面 / 按钮 / 数据（落库）/ 报错（日志与控制台）**。任一出现"部件混入"或"真实菜单缺失" = 不合格，继续排查。

## ⛔ HARD RULE #1 — 交付纪律（提交 / 测试 / 实跑验证）

> **每次改动都必须可追踪、可验证、可回滚。没有 commit、没有测试、没有实跑验证的改动，一律不得交付。**

三条铁律（任一条缺失即违规）：

1. **改动即提交**：每次完成一处改动（无论大小），都必须创建一个对应的 Git commit，commit message 需说明「改了什么、为什么」。目的：便于后续追踪与随时回滚。
2. **改动即补测试**：每次改动后，都必须编写或更新相关测试（单元 / `vitest` / `playwright` e2e），保证改动被覆盖。无测试支撑的改动不得交付。
3. **交付前必须实跑验证**：交付给用户前，必须实际运行项目，并**逐项验证**：页面（渲染正常）、按钮（可点击、行为正确）、数据（正确落库）、报错（服务日志与浏览器控制台无异常）。**只有全部通过，才能告知用户「任务完成」；否则继续排查，不得提前宣称完成。**

> 与 HARD RULE #0 的「验证门槛」一致：探索类改动还要覆盖 OA / ruoyi / fantastic-admin / 人大政务 等验收矩阵；任何功能改动都要跑 `pnpm typecheck / lint / test / verify` 全绿。

---

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
