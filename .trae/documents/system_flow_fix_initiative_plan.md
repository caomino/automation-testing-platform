---
design_type: initiative
created_at: 2026-08-16
---

# 测试平台完整流程修复设计

## Intent Contract

**intent**: 系统性修复测试平台数据流问题，打通从创建项目 → 创建系统 → 登录 → 探索 → 功能点 → 用例生成 → 执行的完整流程

**constraints**: 
- 不修改 contracts 包的类型定义（已冻结）
- 不破坏现有 Stage 业务逻辑
- 保持前后端分层架构

**success_criteria**: 
- 前端创建项目/系统可持久化到后端
- 登录成功后会话状态正确建立和传递
- 探索结果可转换为功能点输入
- 功能点可生成测试用例
- 用例可执行并产出缺陷报告

**risk_level**: high

## Verification Contract

**verify_steps**:
1. 启动后端 server，验证 Store API 全部可达
2. 启动前端，验证创建项目/系统流程
3. 手动走一遍完整 pipeline，每步数据正确传递
4. 刷新页面，验证数据仍在（持久化）
5. 检查数据类型转换无丢失

**check**: 
- 前端不再显示假数据
- 所有 Stage 输入都来自上一 Stage 的真实输出
- 会话状态在各阶段间正确传递

**confirm**: 完整流程（登录→探索→功能点→用例→执行）无断点

## Governance Contract

**approval_gates**: 
- 数据类型映射确认
- API 设计确认
- 流程打通人工验收

**rollback**: 每个模块独立修改，可单独回滚

**ownership**: 本次修改全部由 AI 代理执行，用户审批

---

## 问题分析（5 大类）

### 类别 1：数据类型不匹配

| # | 问题 | 位置 | 影响 | 修复方案 |
|---|------|------|------|----------|
| 1.1 | `MetaHeader.system` vs `MetaHeader.systemName` | 前端 context.tsx / 后端 CaseSheet.ts | 用例 meta 数据传递错误 | 统一字段名为 `systemName` |
| 1.2 | `FeatureRowView`(对象) vs `FeatureRow`(string[]) | 前端 pipeline.ts | 功能点数据格式转换错误 | 修正 `fromFeatureView` 返回 `FeatureRow[][]` |
| 1.3 | `CaseRowView` 丢失元数据 | 前端 pipeline.ts | 用例元信息丢失 | `fromCaseView` 保留必要元数据 |
| 1.4 | `ModuleNodeView.name` vs `ModuleNode.label` | 前端 pipeline.ts | 模块树转换不一致 | 统一为 `label` 字段 |

### 类别 2：Store API 缺失

| # | 缺失 API | 应有功能 | 修复方案 |
|---|----------|----------|----------|
| 2.1 | `POST /api/store/projects/:id/systems` | 添加系统 | 在 server.mjs 新增路由 |
| 2.2 | `PUT /api/store/projects/:id/systems/:sysId` | 更新系统 | 在 server.mjs 新增路由 |
| 2.3 | `DELETE /api/store/projects/:id/systems/:sysId` | 删除系统 | 在 server.mjs 新增路由 |
| 2.4 | `PUT /api/store/projects/:id/systems/:sysId/login-state` | 更新登录状态 | 在 server.mjs 新增路由 |
| 2.5 | `PUT /api/store/projects/:id/systems/:sysId/session-state` | 更新会话状态 | 在 server.mjs 新增路由 |
| 2.6 | `GET /api/store/projects/:id/systems/:sysId/feature-table` | 获取系统功能点表 | 修正现有 GET 路由，支持 systemId 参数 |
| 2.7 | `GET /api/store/projects/:id/systems/:sysId/case-table` | 获取系统用例表 | 修正现有 GET 路由，支持 systemId 参数 |

### 类别 3：会话状态管理缺陷

| # | 问题 | 位置 | 修复方案 |
|---|------|------|----------|
| 3.1 | no-login 模式未自动建立会话 | stage-login / Workbench | 前端检测 no-login 时直接设置登录状态 |
| 3.2 | 会话状态未持久化 | context.tsx runPipelineLogin | 登录成功后调用 `updateSystem` 保存 sessionState |
| 3.3 | sessionHandle 结构与后端不完全匹配 | Workbench.tsx | 修正 sessionHandle 构造，严格遵循 `SessionHandle` 接口 |

### 类别 4：数据转换逻辑错误

| # | 问题 | 位置 | 修复方案 |
|---|------|------|----------|
| 4.1 | `fromFeatureView` 返回 `string[][][]` 应为 `FeatureRow[][]` | pipeline.ts | 修正返回类型为 `FeatureRow[][]` |
| 4.2 | `fromCaseView` 丢失 `CaseRow.id`/`featureId` 等元数据 | pipeline.ts | 保留元数据字段 |
| 4.3 | `fromModuleView` 错误设置 `manuallyAdded: true` | pipeline.ts | 只有真正的人工补充才设为 true |
| 4.4 | `toFeatureView` 字段映射缺少 `testPointId` | pipeline.ts | 补充 testPointId 映射 |

### 类别 5：执行流程断裂

| # | 问题 | 位置 | 修复方案 |
|---|------|------|----------|
| 5.1 | 执行阶段 `browserOSMatrix` 格式错误 | Workbench.tsx | 修正为 `{os, browser, version}` 格式 |
| 5.2 | 执行时未传递 `systemUrl` 给后端 | Workbench.tsx | 在 `ExecuteInput` 中增加 systemUrl |
| 5.3 | 会话 cookies/headers/tokens 未传给执行引擎 | Workbench.tsx | 在执行前正确传递会话数据 |

---

## 修复范围

### In Scope

| # | 模块 | 文件 | 修复内容 |
|---|------|------|----------|
| 1 | 类型对齐 | `packages/app/src/context.tsx` | MetaHeader 字段、类型定义 |
| 2 | 类型对齐 | `packages/app/src/services/pipeline.ts` | 所有转换函数修正 |
| 3 | 类型对齐 | `packages/app/src/services/dataApi.ts` | API 客户端补充 |
| 4 | API 层 | `packages/orchestrator/server.mjs` | 新增系统 CRUD/状态 API |
| 5 | API 层 | `packages/orchestrator/server.mjs` | 修正 feature/case-table GET 路由 |
| 6 | 编排器 | `packages/orchestrator/src/index.ts` | runStage 登录/探索/执行参数处理 |
| 7 | Stage 层 | `packages/stage-login/src/index.ts` | no-login 模式完善 |
| 8 | 前端 UI | `packages/app/src/screens/Workbench.tsx` | 登录/探索/执行按钮修正 |

### Out of Scope

- 不修改 `contracts` 包的类型定义（已冻结）
- 不修改 `stage-feature` 的业务逻辑
- 不修改 `stage-case` 的业务逻辑
- 不修改 `infra-store` 的接口
- 不修改 `engine-mcp` 的实现
- 不引入新的依赖

---

## 修改步骤（按依赖顺序）

### Step 1: 前端类型对齐（context.tsx）

**文件**: `packages/app/src/context.tsx`

修改内容：
```
1. MetaHeader: 将 `system` 改为 `systemName`
2. SystemInfo.sessionState: 补充类型定义
3. AppState: 确保 initialState 正确
4. useApp hook: 修正 session 相关方法
```

### Step 2: 数据转换函数修正（pipeline.ts）

**文件**: `packages/app/src/services/pipeline.ts`

修改内容：
```
1. fromFeatureView: 返回 FeatureRow[][] 而非 string[][][]
2. fromCaseView: 保留 CaseRow 元数据
3. fromModuleView: 修正 manuallyAdded 标记逻辑
4. toFeatureView: 确保正确映射 testPointId
5. runStageLogin/Explore 等: 修正参数传递
```

### Step 3: API 客户端补充（dataApi.ts）

**文件**: `packages/app/src/services/dataApi.ts`

修改内容：
```
1. addSystem: 修正参数结构
2. updateSystem: 增加登录状态/会话更新 API
3. getFeatureTable: 支持 systemId 参数
4. getCaseTable: 支持 systemId 参数
5. 新增 updateSystemLoginState, updateSystemSessionState
```

### Step 4: 后端 Store API 补充（server.mjs）

**文件**: `packages/orchestrator/server.mjs`

修改内容：
```
1. 新增系统 CRUD 路由 (POST/PUT/DELETE /systems)
2. 新增登录状态更新路由 (PUT /systems/:id/login-state)
3. 新增会话状态更新路由 (PUT /systems/:id/session-state)
4. 修正 feature-table GET 支持 systemId 参数
5. 修正 case-table GET 支持 systemId 参数
```

### Step 5: 编排器参数处理修正（orchestrator/src/index.ts）

**文件**: `packages/orchestrator/src/index.ts`

修改内容：
```
1. runStage login: 修正参数解析，支持 LoginInput 字段映射
2. runStage explore: 修正 sessionHandle 传递
3. runStage execute: 修正系统 URL 和会话数据传递
4. PipelineResult: 确保返回结构正确
```

### Step 6: 登录 Stage 完善（stage-login/src/index.ts）

**文件**: `packages/stage-login/src/index.ts`

修改内容：
```
1. no-login 模式: 确保自动建立有效会话
2. credential 模式: 修正 credentialRef 查找逻辑
3. run 函数: 修正输入验证和模式判断
```

### Step 7: Workbench UI 修正（Workbench.tsx）

**文件**: `packages/app/src/screens/Workbench.tsx`

修改内容：
```
1. LoginModal: 修正登录参数传递结构
2. 探索按钮: 修正 sessionHandle 构造
3. 功能点按钮: 修正 moduleTree 转换
4. 用例按钮: 修正 featureTable 和 metaConfig 结构
5. 执行按钮: 修正 browserOSMatrix 格式、会话数据传递
```

---

## 数据流图（修复后）

```
创建项目 → POST /api/store/projects → 返回 Project
    ↓
创建系统 → POST /api/store/projects/:id/systems → 返回 System
    ↓
登录 → POST /api/stage (login) → 返回 LoginOutput + 保存 sessionState
    ↓
探索 → POST /api/stage (explore) → ExploreInput{ sessionHandle, systemUrl, subsystemId }
    ↓  ExploreOutput{ moduleTree }
功能点 → POST /api/stage (feature) → FeatureInput{ moduleTree, systemName }
    ↓  FeatureOutput{ featureTable: FeatureRow[][] }
用例 → POST /api/stage (case) → CaseInput{ featureTable, scope, metaConfig }
    ↓  CaseOutput{ caseWorkbook: CaseSheet[] }
执行 → POST /api/stage (execute) → ExecuteInput{ caseWorkbook, browserOSMatrix }
    ↓  ExecuteOutput{ executionReport }
缺陷 → POST /api/stage (defect) → DefectInput{ executionReport }
    ↓  DefectOutput{ defectTable }
```

---

## 风险处理

| # | 风险 | 概率 | 影响 | 应对 |
|---|------|------|------|------|
| 1 | 修改 contracts 类型导致连锁问题 | 低 | 高 | contracts 已冻结，不修改 |
| 2 | 后端 API 变更导致前端调用失败 | 中 | 高 | 前后端同步修改，每步验证 |
| 3 | 数据转换逻辑错误 | 中 | 中 | 增加类型验证，null 检查 |
| 4 | 现有测试用例失效 | 高 | 低 | 同步更新测试 |
| 5 | 执行引擎不可用 | 中 | 高 | 保留 fallback 逻辑，不阻塞流程 |

---

## 验收检查清单

- [ ] 前端创建项目 → 后端持久化成功
- [ ] 前端创建系统 → 后端持久化成功
- [ ] 登录成功 → 会话状态建立并持久化
- [ ] 探索 → 模块树生成
- [ ] 功能点 → 九列表格生成
- [ ] 用例 → 八列表格生成
- [ ] 执行 → 执行报告生成
- [ ] 缺陷 → 缺陷表生成
- [ ] 刷新页面 → 数据从后端重新加载
- [ ] 各阶段数据类型无丢失
- [ ] 后端 Store API 全部可达
- [ ] 无控制台错误
