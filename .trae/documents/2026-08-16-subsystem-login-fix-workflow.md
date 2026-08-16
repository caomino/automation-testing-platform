---
intent: 修复子系统（如管理中心）登录失败问题，确保其能正确复用父门户（RD）的登录会话进行跳转
success_criteria: 子系统登录时，浏览器先导航到父门户 URL，用户完成登录后，系统能正确捕获会话并跳转子系统
risk_level: high
auto_approve: false
---

## 子系统登录修复计划

### 问题分析

当前子系统（如“管理中心”）登录报错，无法正常跳转。核心原因是：
1.  **数据映射问题**：前端 `context.tsx` 动态构建 `parentPortalPath` 的逻辑可能存在时序或引用问题。
2.  **URL 传递问题**：`Workbench.tsx` 中传递给后端的 `parentPortalUrl` 可能为空。
3.  **后端登录逻辑**：`stage-login` 模块的 `runNoLogin` 函数之前未处理 `parentPortalUrl`，已在上一轮修复。

### 修复步骤

- [ ] **Step 1: 诊断前端数据映射**
action: 在 `packages/app/src/context.tsx` 中添加诊断日志，打印 `systemMap` 内容和子系统的 `parentPortalPath` 值，确认父门户 URL 被正确解析
loop: false
max_iterations: 1
verify: 检查控制台输出，确认 `parentPortalPath` 包含正确的父门户 URL
gate: human

- [ ] **Step 2: 验证 Workbench 传值**
action: 在 `packages/app/src/screens/Workbench.tsx` 的 `handleLogin` 中添加日志，打印传递给后端的 `parentPortalUrl` 值
loop: false
max_iterations: 1
verify: 检查浏览器控制台，确认 `parentPortalUrl` 参数不为空
gate: human

- [ ] **Step 3: 确认后端登录逻辑完整性**
action: 检查 `packages/stage-login/src/index.ts` 中所有登录函数（`runNoLogin`, `runCredential`, `runManualTakeover`），确保它们都使用 `const entryUrl = parentPortalUrl ?? systemUrl;` 逻辑
loop: false
max_iterations: 1
verify: 代码审查，确认三处函数均已正确实现
gate: auto

- [ ] **Step 4: 构建并重启服务**
action: 执行构建命令并重启后端服务
loop: false
max_iterations: 1
verify: 后端服务正常启动，无错误
gate: auto

- [ ] **Step 5: 端到端测试**
action: 启动前端应用，测试子系统（管理中心）的登录流程，观察是否成功跳转
loop: until success
max_iterations: 3
verify: 手动测试，确认子系统登录成功并能跳转子系统页面
gate: human

### 文件修改清单

1.  `d:\newTest\packages\app\src\context.tsx` - 添加诊断日志
2.  `d:\newTest\packages\app\src\screens\Workbench.tsx` - 添加诊断日志
3.  `d:\newTest\packages\stage-login\src\index.ts` - 已修复 `runNoLogin` 函数（上一轮完成）

### 风险处理

- 如果 `parentPortalId` 与父系统 `id` 不匹配，需要在数据库中修正
- 如果父门户 URL 本身配置错误，需要用户在项目管理中重新配置
