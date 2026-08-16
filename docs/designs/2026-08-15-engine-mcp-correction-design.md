---
design_type: feature
created_at: 2026-08-15
---

# engine-mcp 纠偏设计：使用 @playwright/mcp 替代自研 McpEngine

## Intent Contract

```
intent: 将 engine-mcp 从自研 McpEngine 接口改为基于微软 @playwright/mcp 的标准 MCP 适配器，使登录+探索阶段通过 MCP 协议操作浏览器，执行阶段保留 Playwright 直连
constraints:
  - 不修改 contracts 包的冻结契约
  - 不修改各 stage 包的 run(input)/output 签名
  - 保留 McpEngine 接口作为适配层（stage-* 不感知底层变化）
  - 执行阶段继续使用 Playwright 直连（确定性执行）
  - 登录+探索改为通过 @playwright/mcp 的 MCP 工具执行
success_criteria:
  - engine-mcp 依赖 @playwright/mcp 而非纯 playwright
  - McpEngine 接口的 navigate/extractSemanticDom/exploreModules/runStep/runCase 方法通过 MCP 工具实现
  - getSessionCookies/getSessionHeaders/getSessionTokens/applySession 通过 MCP 的 storage 工具实现
  - PlaywrightEngine 重命名为 McpPlaywrightAdapter，内部代理 @playwright/mcp 工具调用
  - 所有现有测试通过，类型检查无错误
risk_level: medium
```

## Verification Contract

```
verify_steps:
  - run tests: pnpm --filter engine-mcp test
  - run tests: pnpm --filter engine-mcp verify
  - run tests: pnpm --filter stage-login test
  - run tests: pnpm --filter stage-explore test
  - run tests: pnpm --filter stage-execute test
  - check: @playwright/mcp 包已安装，可通过 npx @playwright/mcp 启动
  - check: engine-mcp 的 McpEngine 实例通过 MCP 工具执行浏览器操作
  - confirm: 登录→探索→执行完整链路使用 MCP 工具（登录/探索）+ Playwright 直连（执行）
```

## Governance Contract

```
approval_gates:
  - @playwright/mcp 安装与浏览器环境需人工确认
  - McpEngine 接口→MCP 工具映射表需人工审阅
rollback:
  - 保留原 PlaywrightEngine 作为 fallback
  - McpEngine 工厂函数支持切换（MCP 模式 / 直连模式）
ownership: engine-mcp 纠偏由执行 agent 负责
```

## Scope

### In Scope

| # | 工作项 | 说明 |
|---|--------|------|
| 1 | 安装 @playwright/mcp | 在 engine-mcp 的 package.json 中添加依赖 |
| 2 | MCP 工具映射 | 将 McpEngine 接口方法映射到 @playwright/mcp 工具 |
| 3 | McpPlaywrightAdapter | 新实现：通过 MCP 工具执行浏览器操作 |
| 4 | 工厂函数更新 | createEngine() 默认返回 McpPlaywrightAdapter |
| 5 | 类型适配 | SemanticNode ↔ browser_snapshot 格式转换 |
| 6 | 会话复用适配 | session 四方法通过 browser_storage_state/cookie 工具实现 |
| 7 | runCase 适配 | 用例步骤通过 MCP 工具（browser_click/browser_fill_form 等）执行 |
| 8 | 保留原实现 | PlaywrightEngine 保留为 fallback，通过配置切换 |

### Out of Scope

| # | 不在范围 | 说明 |
|---|----------|------|
| 1 | 修改 stage-* 包 | stage-login/explore/execute 不做任何修改 |
| 2 | 修改 contracts 包 | 冻结契约 |
| 3 | 修改 app 包 | app 的 PipelineService 对接不变 |
| 4 | 修改 orchestrator 包 | orchestrator 仍通过 McpEngine 接口调用 |
| 5 | 执行阶段改用 MCP | 执行阶段保持 Playwright 直连（文档明确要求） |

## Decisions

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | MCP 集成方式 | 在 engine-mcp 内部代理 @playwright/mcp 工具 | stage-* 不感知 MCP 存在，保持解耦 |
| 2 | McpEngine 接口 | 保留现有接口，内部实现改为 MCP 代理 | 最小侵入，stage-* 无需修改 |
| 3 | 双引擎策略 | McpPlaywrightAdapter（MCP）+ PlaywrightEngine（直连） | 登录/探索走 MCP，执行走直连 |
| 4 | MCP 客户端 | 使用 @modelcontextprotocol/sdk 客户端 | 标准 MCP 协议通信 |
| 5 | browser_snapshot 映射 | 将 MCP accessibility tree 转为 SemanticNode | 统一下游消费格式 |
| 6 | 会话复用 | 通过 MCP 的 browser_cookie/browser_localstorage/browser_storage_state | 复用门户会话到子系统 |

## Surface

### McpEngine 接口 → @playwright/mcp 工具映射表

| McpEngine 方法 | @playwright/mcp 工具 | 说明 |
|---------------|---------------------|------|
| `launch()` | 初始化 MCP 客户端连接 | 启动 MCP Server 子进程 |
| `navigate(url)` | `browser_navigate({ url })` | 导航 |
| `extractSemanticDom()` | `browser_snapshot()` → 转换为 SemanticNode[] | 无障碍快照→语义节点 |
| `exploreModules()` | `browser_snapshot()` + 遍历交互元素 | 从快照提取模块树 |
| `runStep({ kind: 'click', selector })` | `browser_snapshot()` → 找 ref → `browser_click({ ref })` | 先 snapshot 再操作 |
| `runStep({ kind: 'fill', selector, value })` | `browser_snapshot()` → 找 ref → `browser_type({ ref, text })` | 填表 |
| `runStep({ kind: 'navigate', url })` | `browser_navigate({ url })` | 导航 |
| `runStep({ kind: 'wait', selector })` | `browser_wait_for({ text })` | 等待 |
| `runStep({ kind: 'screenshot' })` | `browser_take_screenshot()` | 截图 |
| `runCase(row)` | 解析步骤 → 逐步调用 MCP 工具 | 多步骤用例执行 |
| `screenshot(path)` | `browser_take_screenshot()` | 截图 |
| `getSessionCookies()` | `browser_cookies()` | 获取 Cookie |
| `getSessionHeaders()` | 从 cookie/localStorage 推导 | 获取鉴权头 |
| `getSessionTokens()` | `browser_localstorage_get_all()` | 获取 Token |
| `applySession(state)` | `browser_cookies_set()` + `browser_localstorage_set()` | 注入会话 |
| `close()` | 关闭 MCP 客户端连接 | 关闭 |

### 新增文件

- `packages/engine-mcp/src/mcp-adapter.ts` — McpPlaywrightAdapter 实现
  - 实现 McpEngine 接口
  - 内部通过 MCP 客户端调用 @playwright/mcp 工具
  - browser_snapshot → SemanticNode 转换逻辑
  - 会话状态管理

### 修改文件

- `packages/engine-mcp/package.json` — 添加 @playwright/mcp + @modelcontextprotocol/sdk 依赖
- `packages/engine-mcp/src/index.ts` — createEngine() 改为默认返回 McpPlaywrightAdapter
- `packages/engine-mcp/src/playwright-engine.ts` — 保留原实现（fallback 模式）
- `packages/engine-mcp/src/types.ts` — McpEngine 接口不变，可能需要添加 MCP 相关类型

### 数据转换：browser_snapshot → SemanticNode

```
browser_snapshot 返回格式（示例）：
  button "提交" [ref=e15]
  input "用户名" [ref=e16]

转换为 SemanticNode：
  { tag: 'button', text: '提交', selector: '[data-ref="e15"]', interactive: true, isDataControl: false }
  { tag: 'input', name: '用户名', selector: '[data-ref="e16"]', interactive: true, isDataControl: true }
```

## Risks & Open Questions

| # | 风险 | 缓解 |
|---|------|------|
| 1 | @playwright/mcp 需要浏览器可执行文件 | 确保已安装 chromium：`npx playwright install chromium` |
| 2 | browser_snapshot 格式与 SemanticNode 不完全对应 | 编写稳健的转换层，处理格式差异 |
| 3 | MCP 工具调用增加延迟（进程间通信） | 执行阶段仍用 Playwright 直连；登录/探索阶段 AI 驱动可接受延迟 |
| 4 | MCP Server 子进程管理复杂度 | McpPlaywrightAdapter 封装生命周期，上层无感 |
| 5 | browser_snapshot 的 ref 每次快照可能变化 | 每次操作前先 snapshot 获取最新 ref |

| # | Open Question | 影响 |
|---|---------------|------|
| 1 | app 前端是否支持 Node.js 子进程（MCP Server）？ | Electron 环境支持；纯 Vite dev server 可能有限制 |
| 2 | 是否需要 MCP Server 以独立进程运行？ | 影响部署架构 |
| 3 | browser_snapshot 的无障碍树是否能覆盖所有 70 项兼容矩阵？ | 可能需要补充 DOM 直连作为 fallback |
