# modules/stage-case.md · 用例模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
阶段④**测试用例**：八列用例 + meta 头 + 编号绑定（用例编号 === 功能点.测试点标识 4 段）+ 模板引擎 + round-trip 金标准保真。

## 2. 契约要点（去 docs 看细节）
- 输入 `CaseInput` / 输出 `CaseOutput`（八列 + meta），zod 在 `packages/contracts/src/schemas/CaseSchema.ts`
- 接口签名：`run(input): Promise<Output>`
- 八列口径/列宽 `[18,16,8,34,34,14,14,12]` 见 `GLOBALS.md §3`；详见 `docs/模块接口契约与开发规范.md`「用例」章节

## 3. 当前进度
- **4 个 .ts**（实测，非原写 1），骨架+部分实现。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | [Minor] 修三场景共号致用例编号不唯一 | `src/index.ts:84` | `verify/case.verify.ts` 断言「用例编号全局唯一」 |
| T2 | [Minor] 清 `ScenarioContext` 死字段 | `src/index.ts:73` | 编译通过 + 无死字段 |
| T3 | [Minor] 修 `metaHeader` 引用别名（round-trip 不得污染输入） | `src/index.ts:152` | 断言「round-trip 后输入 meta 不变」 |
| T4 | 复杂逻辑识别接口占位（`complexLogicDetected` 语义明确、类型完整），真实算法标 P1 后续 | `src/index.ts` | 断言「complexLogicDetected 字段存在且类型正确」 |
| T5 | 补八列逐字段 + 边界测试 | `verify/case.verify.ts` | `pnpm --filter @test-platform/stage-case verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`（可能 `@test-platform/stage-feature` 输入、Excel 库）
- 不依赖其他 stage；被 execute/defect 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-case/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-case verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
