# modules/stage-feature.md · 功能点模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
阶段③**功能点审核**：九列功能点表 + 测试点标识（base_NN，4 段，按子系统从 01 递增）+ 合并 + 增删 + 整体确认。

## 2. 契约要点（去 docs 看细节）
- 输入 `FeatureInput` / 输出 `FeatureOutput`（九列），zod 在 `packages/contracts/src/schemas/FeatureSchema.ts`
- 接口签名：`run(input): Promise<Output>`
- 九列口径见 `GLOBALS.md §3`；详见 `docs/模块接口契约与开发规范.md`「功能点」章节

## 3. 当前进度
- **10 个 .ts**（实测，非原写 4），部分实现。

## 4. 任务清单（来自 plan.md）
- [ ] 九列功能点生成 + `base_NN` 子系统递增主键
- [ ] 合并 / 增删 / 整体确认
- [ ] AI 辅助生成（注入知识库指令，见 design.md §8）
- [ ] 正反向覆盖 + Reviewer 两关

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`（可能 `@test-platform/infra-ai` 用于 AI 生成）
- 不依赖其他 stage；被 case 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-feature/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-feature verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
