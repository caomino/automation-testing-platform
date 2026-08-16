# modules/stage-defect.md · 缺陷模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
阶段⑤**缺陷**：六列缺陷表 + 截图 + 环境规范化（Win11/macOS/Linux/Chrome/… 别名归一）。

## 2. 契约要点（去 docs 看细节）
- 输入 `DefectInput` / 输出 `DefectOutput`（六列），zod 在 `packages/contracts/src/schemas/DefectSchema.ts`
- 接口签名：`run(input): Promise<Output>`
- 详见 `docs/模块接口契约与开发规范.md`「缺陷」章节、`docs/自动化测试平台-主规格.md` 阶段⑤

## 3. 当前进度
- **7 个 .ts**（实测，非原写 2），`logic.ts` 的 `deriveEnvironment` 已做环境大小写规范化（③-3 已修）。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | [Minor] 表头列名对齐 docs（问题级别/问题产生环境） | `src/logic.ts:145` | `verify/defect.verify.ts` 断言「列名与 SPEC 一致」 |
| T2 | [Minor] 带 version 环境串用 `·` 三段式（Win11·Chrome·…）而非空格 | `src/logic.ts:133` | 断言「环境串为 · 分隔三段」 |
| T3 | [Minor] screenshots 去重 | `src/index.ts:80` | 断言「重复截图去重」 |
| T4 | [Minor] `moduleFilter` 空串边界 | `src/index.ts:100` | 断言「空串不过滤/正确兜底」 |
| T5 | 补完整列名 + 安全性分支测试 | `verify/defect.verify.ts`、`verify/defect-create.verify.ts` | `pnpm --filter @test-platform/stage-defect verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`（可能 `@test-platform/infra-store` 存截图路径）
- 不依赖其他 stage；被 app 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-defect/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-defect verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
