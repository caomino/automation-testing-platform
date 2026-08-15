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

## 4. 任务清单（来自 plan.md）
- [ ] MCP 遍历（菜单/链接/tab/面包屑/分页可点；数据类按钮标 needs_review）
- [ ] 模块树 CRUD + 人工补录
- [ ] 只读探索开关 `readonlyExplore`（S5 强制）
- [ ] 正反向覆盖 + Reviewer 两关

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`、`@test-platform/engine-mcp`（DOM 抽象）
- 不依赖其他 stage；被 feature 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-explore/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-explore verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
