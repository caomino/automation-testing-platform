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

## 4. 任务清单（来自 plan.md）
- [ ] 六列缺陷生成 + 截图关联
- [ ] 环境规范化覆盖（win/windows/win11/chrome/chromium 等别名）
- [ ] 正反向覆盖 + Reviewer 两关

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`（可能 `@test-platform/infra-store` 存截图路径）
- 不依赖其他 stage；被 app 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-defect/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/stage-defect verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
