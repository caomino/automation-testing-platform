# modules/engine-mcp.md · 引擎/MCP 模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
Playwright 单例可见浏览器 + MCP 适配器 + **DOM 语义抽象层**（按 role/text/label/位置识别，不依赖框架类名）+ 会话复用（getSessionCookies/Headers/Tokens/applySession）+ iframe/Shadow DOM/路由变化处理。

## 2. 契约要点（去 docs 看细节）
- 类型：`SemanticNode` / `DomNode` / `McpEngine` 接口，定义在 `packages/contracts/src/types/*`
- 接口签名：`run(input): Promise<Output>`
- DOM 抽象层规范见 `design.md §6`；断点②会话复用 4 方法已落地（playwright-engine.ts）

## 3. 当前进度
- **9 个 .ts**（实测，非原写 3），`McpEngine` 接口已含会话复用 4 方法，playwright 实现已接。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | DOM 语义抽象：iframe 同源可读/跨域标 FRAME_ACCESS_DENIED、open Shadow DOM 可读、closed 标 Out-of-Scope | `src/playwright-engine.ts` | `verify/engine.verify.ts` 断言「跨域 iframe 标 FRAME_ACCESS_DENIED」「closed Shadow 标 Out-of-Scope」 |
| T2 | 路由变化检测 + 动态加载等待 + 分页/虚拟滚动适配 | `src/playwright-engine.ts` | 断言「路由变化后重取 DOM」「动态加载等待完成」 |
| T3 | 会话复用四方法（getSessionCookies/getSessionHeaders/getSessionTokens/applySession）正确实现并有断言 | `src/playwright-engine.ts`、`src/types.ts` | 断言「applySession 注入 cookies/headers/tokens 生效」 |
| T4 | 70 项兼容矩阵逐项映射（对齐 95% 覆盖，S5≥85 分）；补 README + coverage≥80% | `README.md`、`verify/engine.verify.ts` | `pnpm --filter @test-platform/engine-mcp verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`
- **被 login/explore/execute 共同依赖**（接口须先稳定）

## 6. 本窗口纪律（防卡死）
- 只改 `packages/engine-mcp/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/engine-mcp verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
