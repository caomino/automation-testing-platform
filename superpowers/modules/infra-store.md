# modules/infra-store.md · 持久化模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
SQLite 持久化（零配置、单文件、Node 生态成熟）。存储：Project / System / FeatureTable / CaseTable / ExecutionReport / DefectTable / KnowledgeBase。数据外部化，不落项目工作空间。

## 2. 契约要点（去 docs 看细节）
- 接口冻结：`createProject/listProjects/getProject/updateProject/deleteProject/setActiveSystem/saveFeatureTable/saveCaseTable/saveExecution/...`
- 对应契约 `docs/模块接口契约与开发规范.md` §八/§九
- 详见 `design.md §3`、plan.md §3

## 3. 当前进度
- **4 个 .ts**（实测，非原写 1），骨架+部分实现。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | 冻结接口实现对齐 contracts：createProject/listProjects/getProject/updateProject/deleteProject/setActiveSystem/saveFeatureTable/saveCaseTable/saveExecution/... | `src/index.ts` | `verify/store.verify.ts` 断言「每个冻结接口签名与 contracts 一致」 |
| T2 | SQLite 建表 + CRUD（Project/System/FeatureTable/CaseTable/ExecutionReport/DefectTable/KnowledgeBase），数据外部化不落工作空间 | `src/index.ts` | 断言「CRUD 往返一致」「数据落 test-platform-data」 |
| T3 | 补 README + 补测试到 coverage≥80% | `README.md`、`verify/store.verify.ts` | `pnpm --filter @test-platform/infra-store verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`
- 被所有 stage + app 依赖（共享持久化）

## 6. 本窗口纪律（防卡死）
- 只改 `packages/infra-store/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/infra-store verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
