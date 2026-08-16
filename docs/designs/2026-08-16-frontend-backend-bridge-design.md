---
design_type: feature
created_at: 2026-08-16
---

# 前后端数据链路打通设计

## Intent Contract
- **intent**: 修复前端页面流程不通、全靠假数据的问题，打通前端 → 后端的完整数据链路
- **constraints**: 不引入假数据；保持现有模块化结构；contracts 包的类型定义不变；infra-store 接口冻结
- **success_criteria**: 从登录 → 探索 → 功能点 → 用例 → 执行 → 缺陷，每一步的输入都来自上一步的真实输出，结果持久化到后端，刷新不丢失
- **risk_level**: high（涉及数据一致性和登录态安全）

## Verification Contract
- **verify_steps**:
  - 启动后端 server，验证 13 个 Store API 均可达（curl 测试）
  - 启动前端，验证 bootstrap 成功加载项目列表
  - 手动走一遍完整 pipeline，每步 state 更新正确且持久化到后端
  - 刷新页面，验证数据仍在（从后端重新加载）
- **check**: 页面不再显示任何 initialState 假数据；Pipeline 按钮输入均非空
- **confirm**: 完整流程（登录→探索→功能点→用例→执行→缺陷）无断点

## Governance Contract
- **approval_gates**: 后端 API 实现完成后需人工确认接口对齐；前端数据链修复完成后需人工走一遍流程
- **rollback**: 每个模块独立修改，可单独回滚
- **ownership**: 本次修改全部由 AI 代理执行，用户审批

## Scope

### In
| # | 内容 | 模块 |
|---|------|------|
| 1 | 补全 Store CRUD 路由 | `orchestrator/server.mjs` |
| 2 | 新增 4 个反向转换函数 | `app/src/services/pipeline.ts` |
| 3 | 修复登录会话保存 | `app/src/context.tsx` |
| 4 | 修复 Workbench 5 个按钮数据链 | `app/src/screens/Workbench.tsx` |
| 5 | Pipeline 结果持久化 | `app/src/context.tsx` |
| 6 | 清空 initialState 假数据 | `app/src/context.tsx` |

### Out
- 不修改 contracts 包的类型定义
- 不修改 infra-store 接口
- 不修改各 stage 的业务逻辑
- 不引入数据库（当前用内存 Store，后续可替换 SQLite）

## Decisions

| # | 决定 | 选择 | 理由 |
|---|------|------|------|
| 1 | 修改 server.mjs 还是 server.ts | 同时修改 mjs（运行时）和 ts（源码） | mjs 是运行时必须改；ts 是源码，保持一致性 |
| 2 | 反向转换放 pipeline.ts 还是新建文件 | 放 pipeline.ts | 已存在正向转换函数，保持内聚 |
| 3 | Pipeline 结果在前端持久化还是后端自动保存 | 前端持久化 + 后端也自动保存（双重保障） | orchestrator.run() 已自动保存；单阶段执行时前端需主动保存 |
| 4 | sessionState 存什么 | 存 LoginOutput 完整对象（cookies, expiresAt, loginStatus） | 后续探索阶段需要完整 sessionHandle |

## Surface

### 后端 API（新增）
在 `server.mjs` 增加以下路由，操作 `PipelineOrchestrator` 内部的 `ProjectStore` 实例：

```
GET    /api/store/bootstrap                    → { projects: ProjectSummary[] }
GET    /api/store/projects                     → ProjectSummary[]
POST   /api/store/projects                     → Project
GET    /api/store/projects/:id                  → Project | null
PUT    /api/store/projects/:id                 → Project
DELETE /api/store/projects/:id                 → void
POST   /api/store/projects/:id/active-system   → void
PUT    /api/store/projects/:id/feature-table   → void
GET    /api/store/projects/:id/feature-table   → FeatureRow[][] | null
PUT    /api/store/projects/:id/case-table      → void
GET    /api/store/projects/:id/case-table      → CaseSheet[] | null
PUT    /api/store/projects/:id/execution      → void
GET    /api/store/projects/:id/execution       → ExecutionResult[] | null
```

### 前端反向转换（新增 4 个函数）

```typescript
// pipeline.ts
export function fromModuleView(nodes: ModuleNodeView[]): ModuleNode[]
export function fromFeatureView(rows: FeatureRowView[]): string[][]
export function fromCaseView(rows: CaseRowView[], meta: MetaHeader): CaseSheet[]
export function fromExecView(matrix: ExecMatrixRow[], modules: ExecModuleState[]): ExecutionResult[]
```

### 前端 State 变更

`context.tsx` 新增 action：
- `SET_SESSION_STATE` — 保存登录返回的 cookies/expiresAt

`initialState` 清空：
- `featureRows: []`
- `caseRows: []`
- `moduleTree: []`
- `execMatrix: []`
- `execModules: []`

### Workbench 按钮修复

每个按钮从 state 读取数据并通过反向转换传给后端：
- 探索：`system.sessionState` → `sessionHandle`
- 功能点：`state.moduleTree` → `fromModuleView()` → `moduleTree`
- 用例：`state.featureRows` → `fromFeatureView()` + `state.metaHeader` → `featureTable`
- 执行：`state.caseRows` + `state.metaHeader` → `fromCaseView()` → `caseWorkbook`
- 缺陷：`state.execMatrix` + `state.execModules` → `fromExecView()` → `executionReport`

## Risks & Open Questions

| # | 风险 | 应对 |
|---|------|------|
| 1 | server.mjs 是构建产物，修改后重新构建会被覆盖 | 同步修改 server.ts 源文件，构建时重新生成 |
| 2 | 反向转换时 view 数据可能不完整（用户未编辑过） | 做 null/empty 检查，空数据时传空数组给后端 |
| 3 | 登录 sessionHandle 结构与后端 ExploreInput 要求可能不完全匹配 | 仔细对齐 contract 定义；必要时在转换层做适配 |
| 4 | Pipeline 结果双重保存可能不一致 | 以 orchestrator 自动保存为准，前端保存仅做补充 |
