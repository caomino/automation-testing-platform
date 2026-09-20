# modules/stage-explore.md · 探索模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
阶段②**探索**：MCP 遍历 + 模块树 CRUD + 人工补录；**只读探索模式**（导航类可点、数据类默认不操作标 needs_review，S5 强制 ON）。

## 2. 契约要点（去 docs 看细节）
- 输入 `ExploreInput` / 输出 `ExploreOutput`（`ModuleNode` 递归），zod 在 `packages/contracts/src/schemas/ExploreSchema.ts`
- 接口签名：`run(input): Promise<Output>`
- 详见 `docs/模块接口契约与开发规范.md`「探索」章节、`docs/自动化测试平台-主规格.md` 阶段②

## 3. 当前进度
- **5 个 .ts**（实测，非原写 2），部分实现。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | [Major] `run()` 把 `sessionHandle` 注入引擎（登录→探索会话衔接） | `src/index.ts:187` | `verify/explore.verify.ts` 断言「引擎收到 sessionHandle」 |
| T2 | [Major] 实现 `resumeFrom` 断点续跑（当前 no-op） | `src/index.ts:191` | 断言「resumeFrom 从 checkpoint 恢复」 |
| T3 | [Minor] 同 target 批量 above/below 插入顺序修正；补去重与父节点校验；清理 `countNodes` 孤儿导出 | `src/index.ts:119/94/34` | 断言「插入顺序」「重复节点拒绝」「父节点非法拒绝」 |
| T4 | 补会话衔接/兄弟插入/边界测试 | `verify/explore.verify.ts`、`src/index.test.ts` | `pnpm --filter @test-platform/stage-explore verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`、`@test-platform/engine-mcp`（DOM 抽象）
- 不依赖其他 stage；被 feature 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-explore/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-explore verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
