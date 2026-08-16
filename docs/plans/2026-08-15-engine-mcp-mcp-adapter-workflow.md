---
intent: 将 engine-mcp 从自研 McpEngine 改为基于微软 @playwright/mcp 的标准 MCP 适配器
success_criteria: engine-mcp 通过 MCP 工具执行浏览器操作，所有测试通过
risk_level: medium
auto_approve: true
---

## Steps

- [ ] **Step 1: 安装 @playwright/mcp 和 MCP SDK 依赖**
action: 在 packages/engine-mcp/package.json 中添加 "@playwright/mcp" 和 "@modelcontextprotocol/sdk" 依赖，运行 pnpm install 安装
loop: false
verify:
  type: shell
  command: pnpm --filter engine-mcp typecheck

- [ ] **Step 2: 安装 Playwright Chromium 浏览器**
action: 运行 npx playwright install chromium 确保浏览器可执行
loop: false
verify:
  type: shell
  command: npx playwright install chromium --dry-run

- [ ] **Step 3: 创建 MCP 适配器类型定义**
action: 在 src/types.ts 中添加 MCP 相关类型（McpToolName, McpToolCallResult 等），扩展 EngineConfig 支持 mcp 模式
loop: false
verify:
  type: shell
  command: pnpm --filter engine-mcp typecheck

- [ ] **Step 4: 创建 browser_snapshot → SemanticNode 转换工具**
action: 创建 src/snapshot-converter.ts，实现 parseSnapshotToSemanticNodes() 函数，将 @playwright/mcp 的 browser_snapshot 返回格式转换为 SemanticNode[]
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run snapshot-converter

- [ ] **Step 5: 创建 McpPlaywrightAdapter 核心类**
action: 创建 src/mcp-adapter.ts，实现 McpEngine 接口。内部通过 MCP 客户端连接 @playwright/mcp Server，将 McpEngine 方法映射到 MCP 工具调用
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter

- [ ] **Step 6: 实现 launch() 和 close() 方法**
action: McpPlaywrightAdapter.launch() 启动 MCP Server 子进程并初始化 MCP 客户端连接；close() 关闭连接和子进程
loop: false
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter-lifecycle

- [ ] **Step 7: 实现 navigate() 和 screenshot() 方法**
action: navigate() 调用 browser_navigate 工具；screenshot() 调用 browser_take_screenshot 工具
loop: false
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter-navigate

- [ ] **Step 8: 实现 extractSemanticDom() 方法**
action: 调用 browser_snapshot() 获取无障碍快照，通过 snapshot-converter 转换为 SemanticNode[] 返回
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter-dom

- [ ] **Step 9: 实现 exploreModules() 方法**
action: 基于 browser_snapshot 结果提取模块树（ModuleNode[]），识别交互式元素作为模块节点
loop: false
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter-explore

- [ ] **Step 10: 实现 runStep() 方法**
action: 将 BrowserCommand（click/fill/select/press/wait/navigate/screenshot/dom）映射到对应 MCP 工具，每次操作前先 browser_snapshot 获取 ref
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter-runstep

- [ ] **Step 11: 实现 runCase() 方法**
action: 解析 CaseRow 的 step/operation 字段为 BrowserCommand 序列，逐步调用 runStep()，返回 ExecutionStepResult[]
loop: false
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter-runcase

- [ ] **Step 12: 实现四个会话方法**
action: getSessionCookies()/getSessionHeaders()/getSessionTokens() 通过 browser_cookies/browser_localstorage 工具获取；applySession() 通过对应 set 工具注入
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter engine-mcp test -- --run mcp-adapter-session

- [ ] **Step 13: 更新工厂函数 createEngine()**
action: 修改 src/index.ts，createEngine() 默认返回 McpPlaywrightAdapter；保留 PlaywrightEngine 作为 fallback（通过 config.engineType 切换）
loop: false
verify:
  type: shell
  command: pnpm --filter engine-mcp typecheck

- [ ] **Step 14: 保留原 PlaywrightEngine 不删除**
action: src/playwright-engine.ts 保持不变，作为 engineType: 'direct' 的 fallback 选项
loop: false
verify:
  type: artifact
  path: packages/engine-mcp/src/playwright-engine.ts
  assert:
    kind: exists

- [ ] **Step 15: 全量测试通过**
action: 运行 engine-mcp 全部测试 + verify，确保无回归
loop: false
verify:
  - type: shell
    command: pnpm --filter engine-mcp test
  - type: shell
    command: pnpm --filter engine-mcp verify

- [ ] **Step 16: 下游依赖包测试通过**
action: 运行 stage-login, stage-explore, stage-execute 测试，确保 McpEngine 接口变化不影响下游
loop: false
verify:
  - type: shell
    command: pnpm --filter stage-login test
  - type: shell
    command: pnpm --filter stage-explore test
  - type: shell
    command: pnpm --filter stage-execute test

- [ ] **Step 17: 全项目类型检查**
action: 运行 pnpm -r typecheck 确保无类型错误
loop: false
verify:
  type: shell
  command: pnpm -r typecheck

- [ ] **Step 18: MCP 浏览器冒烟测试**
action: 编写脚本实际启动 @playwright/mcp Server，通过 MCP 客户端调用 browser_navigate → browser_snapshot → browser_click 完整链路
loop: false
gate: human
verify:
  type: shell
  command: node -e "import('@playwright/mcp').then(m => console.log('MCP package OK'))"
