# 前端流程打通修复计划

## 根因分析（已通读全部代码）

### 断裂点 1：server.mjs 缺少 Store CRUD 路由
`server.mjs`（实际运行的构建产物）只有：
- `POST /api/stage`
- `POST /api/full-pipeline`  
- `GET /health`

**缺失**：`/api/store/bootstrap`、`/api/store/projects` 及所有 CRUD、`/api/store/projects/:id/feature-table` 等。

前端 `context.tsx` 的 `useEffect` 启动时调 `dataApi.loadBootstrap()` → 必然 404 → bootstrap 失败 → 永远显示空数据。

### 断裂点 2：登录会话未保存
- `LoginModal` 调 `runPipelineLogin`，后端返回 `cookies`、`expiresAt`
- 但 `SET_LOGIN_STATUS` 只改 `loginStatus` 字段，**不改 `sessionState`**
- 后续探索阶段需要 `sessionHandle`（含 cookies），永远是 undefined

### 断裂点 3：Workbench 按钮传空数组
```typescript
// 探索按钮
sessionHandle: (system as any).sessionState?.cookies ? { ... } : undefined
// ↑ sessionState 永远是空，所以 sessionHandle 永远是 undefined

// 功能点按钮  
moduleTree: [],  // 空数组，不用 state.moduleTree

// 用例按钮
featureTable: [],  // 空数组，不用 state.featureRows

// 执行按钮
caseWorkbook: [],  // 空数组

// 缺陷按钮
executionReport: [],  // 空数组
```

原因：缺少 view→contract 的反向转换函数。前端 state 存的是 view 类型，后端要求 contract 类型。

### 断裂点 4：Pipeline 结果不持久化
各 stage 完成后只更新 React state，不调 `dataApi.save*()`。刷新即丢。

---

## 修复步骤

### Step 1: 修复 server.mjs — 补全 Store 路由
**文件**: `packages/orchestrator/server.mjs`
在现有 route handler 中增加 Store CRUD 路由，对齐 `server.ts` 的实现。

### Step 2: 修复登录会话保存
**文件**: `packages/app/src/context.tsx`
- 新增 `SET_SESSION_STATE` action
- 修改 `runPipelineLogin`：登录成功后保存 cookies/expiresAt 到 `system.sessionState`
- 修改 Topbar "连接系统"（`App.tsx`）改为触发 LoginModal

### Step 3: 新增反向转换函数
**文件**: `packages/app/src/services/pipeline.ts`
- `fromModuleView(nodes): ModuleNode[]` 
- `fromFeatureView(rows): string[][]`
- `fromCaseView(rows, meta): CaseSheet[]`
- `fromExecView(matrix, modules): ExecutionResult[]`

### Step 4: 修复 Workbench 数据链
**文件**: `packages/app/src/screens/Workbench.tsx`
5 个按钮改为从 state 读取真实数据 + 反向转换后传给 pipeline。

### Step 5: Pipeline 结果持久化
**文件**: `packages/app/src/context.tsx`
各 stage 成功后调 `dataApi.save*()` 持久化到后端。

### Step 6: 增强 bootstrap
**文件**: `packages/app/src/context.tsx`
bootstrap 成功后，同步后端已存的 featureTable/caseTable/execution 数据到 state。

---

## 修改文件

| 文件 | 改动 |
|------|------|
| `packages/orchestrator/server.mjs` | 增加 Store CRUD 路由 |
| `packages/app/src/context.tsx` | 登录会话保存 + Pipeline 持久化 + bootstrap 增强 |
| `packages/app/src/services/pipeline.ts` | 4 个反向转换函数 |
| `packages/app/src/screens/Workbench.tsx` | 5 个按钮数据链修复 |
| `packages/app/src/App.tsx` | Topbar 登录改为真实调用 |

无新文件。不引入假数据。