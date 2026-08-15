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

## 4. 任务清单（来自 plan.md）
- [ ] 八列用例生成 + 编号绑定（硬断言：用例编号===测试点标识 4 段）
- [ ] 模板引擎 + 分 sheet（选中模块/全部）
- [ ] 金标准 round-trip diff=空（九列/八列/meta/合并/截图行）
- [ ] 正反向覆盖 + Reviewer 两关

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`（可能 `@test-platform/stage-feature` 输入、Excel 库）
- 不依赖其他 stage；被 execute/defect 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-case/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-case verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
