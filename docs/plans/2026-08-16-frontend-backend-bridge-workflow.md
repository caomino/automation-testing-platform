---
intent: 修复前端页面流程不通、全靠假数据的问题，打通前端 → 后端的完整数据链路
success_criteria: 从登录 → 探索 → 功能点 → 用例 → 执行 → 缺陷，每一步的输入都来自上一步的真实输出，结果持久化到后端，刷新不丢失
risk_level: high
auto_approve: true
---

## Steps

- [ ] **Step 1: 补全后端 Store CRUD 路由**
action: 在 `packages/orchestrator/server.mjs` 中新增 13 个 Store API 路由
verify:
  type: shell
  command: curl -s http://localhost:3001/api/store/bootstrap | jq .ok
  expected: true

- [ ] **Step 2: 新增反向转换函数**
action: 在 `packages/app/src/services/pipeline.ts` 中新增 fromModuleView, fromFeatureView, fromCaseView, fromExecView 4 个函数
verify:
  type: shell
  command: pnpm --filter @test-platform/app run typecheck
  expected: exit_code=0

- [ ] **Step 3: 修复登录会话保存**
action: 在 `packages/app/src/context.tsx` 中新增 SET_SESSION_STATE action，修改 runPipelineLogin 在登录成功后保存 cookies/expiresAt
verify:
  type: shell
  command: pnpm --filter @test-platform/app run typecheck
  expected: exit_code=0

- [ ] **Step 4: 修复 Workbench 按钮数据链**
action: 在 `packages/app/src/screens/Workbench.tsx` 中修复 5 个按钮，从 state 读取真实数据并通过反向转换传给 pipeline
verify:
  type: shell
  command: pnpm --filter @test-platform/app run typecheck
  expected: exit_code=0

- [ ] **Step 5: Pipeline 结果持久化**
action: 在 `packages/app/src/context.tsx` 中，各 stage 成功后调 dataApi.save*() 持久化到后端
verify:
  type: shell
  command: pnpm --filter @test-platform/app run typecheck
  expected: exit_code=0

- [ ] **Step 6: 清空 initialState 假数据**
action: 在 `packages/app/src/context.tsx` 中将 featureRows, caseRows, moduleTree, execMatrix, execModules 初始值改为空数组
verify:
  type: shell
  command: pnpm --filter @test-platform/app run typecheck
  expected: exit_code=0

- [ ] **Step 7: 人工验证完整流程**
action: 启动后端和前端，手动走一遍登录→探索→功能点→用例→执行→缺陷完整流程
verify:
  type: human-review
  gate: human
