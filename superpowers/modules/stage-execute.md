# modules/stage-execute.md · 执行模块简报（样例）

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。
> 这是"拆分"的样例：每个模块一份这种小文件，窗口只看自己的那一份。

---

## 1. 这个模块是干嘛的（职责）
阶段⑤**执行**：用 Playwright 直连（非 LLM，确定性）执行用例，产出 `ExecutionReport`。
红线：**数据隔离**——只新增 `owner=本任务` 的数据；读历史/他人数据只读；回滚只删本任务新增行；执行前后快照比对断言无历史变更。

## 2. 它要遵守的契约（去 docs 看细节）
- 输入 `ExecuteInput` / 输出 `ExecuteOutput`，zod 定义在 `packages/contracts/src/schemas/ExecuteSchema.ts`
- 接口签名：`run(input): Promise<Output>`
- 详见 `docs/模块接口契约与开发规范.md` 的「执行」章节、`docs/自动化测试平台-主规格.md` 阶段⑤

## 3. 当前进度（看你这个窗口从哪接手）
- **19 个 .ts**（实测，非原写 11），后端最完整模块。
- 待确认：是否覆盖数据隔离快照比对 / 异常场景（错误输入、不存在数据、越权）。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | [Major] 缺陷引用：上移 `DEFECT_REF_PREFIX` 为共享常量或委托，消除手拼 defectRef 与跨包重复 | `src/constants.ts`、`src/executeCase.ts:75` | `src/__tests__/execute.verify.ts` 断言「defectRef 生成语义正确、无跨包 import」 |
| T2 | [Minor] 引擎按 env 隔离（不同环境不串） | `src/run.ts:36` | 断言「不同 env 会话隔离」 |
| T3 | 补测试：多次 run 不串味 + 引擎失败边界 | `src/__tests__/isolation.test.ts`、`executeCase.test.ts` | `pnpm --filter @test-platform/stage-execute verify` 全绿 |
| T4 | 数据隔离红线复核（快照比对 + 回滚只删本任务） | `src/isolation.ts`、`src/executeCase.ts` | 断言「快照前后无历史变更」「回滚只删 owner=本任务」 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`
- 不依赖其他 `stage-*`
- 被依赖：`app`（经 IPC / mock provider 调用，不直接 import 内部）

## 6. 本窗口的纪律（防卡死）
- 只改 `packages/stage-execute/**` 源码；不碰 `node_modules`、不碰 `contracts`、不跑 `pnpm *`。
- 校验交给集成窗口/人工串行跑。
- 改完通知进度，等待 merge 回 main。
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
