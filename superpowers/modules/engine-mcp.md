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

## 4. 任务清单（来自 plan.md）
- [ ] DOM 语义抽象完善（iframe 同源可读/跨域标 FRAME_ACCESS_DENIED、open Shadow DOM 可读、closed 标 Out-of-Scope）
- [ ] 路由变化检测 + 动态加载等待 + 分页/虚拟滚动适配
- [ ] 70 项兼容矩阵逐项映射（对齐 95% 覆盖，S5≥85 分）
- [ ] 正反向覆盖 + Reviewer 两关

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`
- **被 login/explore/execute 共同依赖**（接口须先稳定）

## 6. 本窗口纪律（防卡死）
- 只改 `packages/engine-mcp/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/engine-mcp verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
