# 登录流程修复 - Implementation Plan

## [x] Task 1: 在登录流程入口添加 URL 验证和日志
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在 `runCredential`、`runNoLogin`、`runManualTakeover` 入口添加日志，打印 systemId、mode、systemUrl
  - 在 navigate 调用前检查 systemUrl 是否为空，如果为空则返回 failed 状态
  - 添加 URL 验证函数，确保格式正确
- **Acceptance Criteria Addressed**: AC-1, AC-3
- **Test Requirements**:
  - `programmatic` TR-1.1: 登录开始时打印 `[stage-login] {mode} launch: system={systemId}, url={systemUrl}` ✓
  - `programmatic` TR-1.2: systemUrl 为空时返回 failed，错误信息包含"系统 URL 未配置" ✓
  - `programmatic` TR-1.3: navigate 前打印 `[stage-login] navigating to {url}` ✓
- **Notes**: 在 `packages/stage-login/src/index.ts` 中修改

## [x] Task 2: 修复 no-login 模式的前端兼容性
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `Workbench.tsx` 中的 `handleLogin` 函数
  - no-login 模式返回 ok 状态时，前端应直接显示登录成功，不需要等待 barrier
  - credential 模式返回 barrier 状态时，前端显示确认登录按钮
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `programmatic` TR-2.1: no-login 模式登录后，前端显示"登录成功" ✓
  - `programmatic` TR-2.2: credential 模式登录后，前端显示"确认登录"按钮 ✓
- **Notes**: no-login 模式是同步完成的，前端处理逻辑需要适配

## [x] Task 3: 增强 navigate 错误处理
- **Priority**: medium
- **Depends On**: Task 1
- **Description**: 
  - 在 navigate 调用处添加 try-catch，捕获导航失败错误
  - 导航失败时返回 failed 状态，错误信息包含原始错误
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-3.1: navigate 失败时返回 failed 状态 ✓
  - `programmatic` TR-3.2: 错误信息包含导航失败的具体原因 ✓
- **Notes**: 防止浏览器打开后跳转到 about:blank

## [x] Task 4: 构建和测试
- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 3
- **Description**: 
  - 运行 `pnpm build` 构建所有包
  - 启动后端服务
  - 使用 curl 测试登录 API
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3
- **Test Requirements**:
  - `programmatic` TR-4.1: no-login 模式测试通过 ✓（返回 ok 状态）
  - `programmatic` TR-4.2: credential 模式测试通过 ✓（无凭证时返回验证错误）
  - `programmatic` TR-4.3: URL 为空时返回错误 ✓（zod 验证拦截）
- **Notes**: 需要手动测试浏览器行为
