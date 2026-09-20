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

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | [Major] 缩写对 UUID/路径哈希/多词元 id 收敛到 3 段（当前 base>3 段） | `src/abbreviation.ts:29` | `verify/feature.verify.ts` 断言「任意 id 收敛 3 段」 |
| T2 | [Major] 中文按 docs R-A-01 转拼音首字母（可引入轻量拼音表，注明依赖待批） | `src/abbreviation.ts:41` | 断言「中文→拼音，符合 QYYX_PZ_JCX 风格」 |
| T3 | [Major] `testPointId` 全局行内唯一（当前仅组内唯一） | `src/featureTable.ts:123` | 断言「全表无重复 testPointId」 |
| T4 | [Minor] 需求章节按 X.Y.Z 合成；修正注释与实现不符 | `src/featureTable.ts:119/26` | 断言「章节为 X.Y.Z 三段」 |
| T5 | 全量跑绿 + 自验 | — | `pnpm --filter @test-platform/stage-feature verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`（可能 `@test-platform/infra-ai` 用于 AI 生成）
- 不依赖其他 stage；被 case 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-feature/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-feature verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
