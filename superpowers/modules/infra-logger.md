# modules/infra-logger.md · 日志模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
外部日志：业务/运行日志外部化（落 `D:\test-platform-data\logs\`，按 任务/项目 分目录），不落项目工作空间。

## 2. 契约要点（去 docs 看细节）
- 接口：结构化日志（level/message/context）
- 详见 plan.md §4.2、`docs/自动化测试平台-主规格.md` §7（日志外部化）

## 3. 当前进度
- **4 个 .ts**（实测，非原写 1），骨架+部分实现。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | 结构化日志接口（info/warn/error + context），签名与 contracts 对齐，不擅自变更 | `src/index.ts` | `verify/logger.verify.ts` 断言「三级别 + context 透传」 |
| T2 | 外部化落盘：`D:\test-platform-data\logs\` 按 任务/项目 分目录，不落工作空间 | `src/index.ts` | 断言「路径落在 test-platform-data 而非项目根」 |
| T3 | 补 README（职责/接口/示例/依赖）+ 补测试到 coverage≥80% | `README.md`、`verify/logger.verify.ts` | `pnpm --filter @test-platform/infra-logger verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`
- 被所有 stage + app 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/infra-logger/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/infra-logger verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
