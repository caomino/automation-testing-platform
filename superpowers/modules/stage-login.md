# modules/stage-login.md · 登录模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
阶段①**登录跨域**：三模式（免登录 / 账号密码 / 人工接管）产出 `SessionHandle`，供后续探索/执行复用会话（断点②会话复用：getSessionCookies/Headers/Tokens/applySession）。

## 2. 契约要点（去 docs 看细节）
- 输入 `LoginInput` / 输出 `LoginOutput`，zod 在 `packages/contracts/src/schemas/LoginSchema.ts`
- 接口签名：`run(input): Promise<Output>`
- 详见 `docs/模块接口契约与开发规范.md`「登录」章节、`docs/自动化测试平台-主规格.md` 阶段①

## 3. 当前进度
- **4 个 .ts**（实测，非简报原写 1），骨架+部分实现；⚠️ **开工前先修 review.md 2 个 Critical**（子系统不读 parentPortalUrl / reuseSession 是 stub，见 GLOBALS §9），否则接口被 explore/execute 依赖会传导错误。

## 4. 任务清单（来自 plan.md）
- [ ] 实现三模式登录（免登录 / 账号密码 / 人工接管）
- [ ] `SessionHandle` 产出 + 会话复用 4 方法（与 engine-mcp 协同）
- [ ] 正反向覆盖（错误密码 / 空查询 / 越权正确报错）
- [ ] 自验 `build/lint/typecheck` + Reviewer 两关

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`、`@test-platform/engine-mcp`（会话/浏览器）
- 不依赖其他 stage；被 explore/execute 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/stage-login/**`；不碰 `node_modules`、不碰 `contracts`、不跑 `pnpm install`
- 校验用本 worktree 的 `pnpm --filter @test-platform/stage-login verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
