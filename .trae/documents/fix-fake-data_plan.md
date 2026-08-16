# 前端对接真实业务修复计划

## 诊断结论

**根本原因有三层：**

### 1. `initialState` 全是硬编码假数据
[context.tsx#L309-L416](file:///d:/newTest/packages/app/src/context.tsx#L309-L416) 中的 `initialState` 包含了所有业务数据的假数据：
- 3 个项目、5 个系统
- 7 条功能点、5 条用例、4 条缺陷
- 3 个模块树节点、3 条待入树
- 4 个 AI 配置、5 个日志文件、3 条知识条目、3 条活动

应用启动时立即展示这些假数据，用户看不到"空状态"。

### 2. 所有 CRUD 操作是"假删除/假更新"
reducer 中的 `ADD_PROJECT` / `REMOVE_SYSTEM` / `FEATURE_REMOVE_ROW` / `CASE_UPDATE_ROW` / `DEFECT_REMOVE` 等操作只修改 React 本地状态，从不调用后端 API 持久化。刷新页面后数据丢失。

### 3. 后端无数据持久化层
[orchestrator/server.ts](file:///d:/newTest/packages/orchestrator/server.ts) 仅提供 `/api/stage`（运行阶段）和 `/api/full-pipeline`（全流水线）两个端点，没有 CRUD API。缺少：
- 项目/系统配置的增删改查
- 流水线结果（功能点/用例/缺陷）的持久化存储
- AI 配置的管理

---

## 修复方案

### 第一层：清理假数据（前端）

| 文件 | 修改内容 |
|------|----------|
| `context.tsx` | 将 `initialState` 中的所有业务数据字段改为空初始值：`featureRows: []`, `caseRows: []`, `defectRows: []`, `moduleTree: []`, `pendingTree: []`, `execModules: []`, `execMatrix: []`, `activities: []`, `logFiles: []`, `knowledge: []`, `aiConfigs: []`。保留 1 个默认项目和 1 个默认系统供流水线使用。 |
| `context.tsx` | 删除 `pipelineMode: 'real'` 字段（不再需要） |

### 第二层：新增后端数据服务（持久化）

| 文件 | 修改内容 |
|------|----------|
| `packages/orchestrator/server.ts` | 新增 REST API 端点：`/api/projects`, `/api/systems`, `/api/features`, `/api/cases`, `/api/defects`, `/api/ai-configs`。所有数据存储在 JSON 文件（`data/store.json`）中。 |
| `packages/app/src/services/dataApi.ts` | 新增数据 API 客户端，封装所有 CRUD 操作的 HTTP 调用。 |

### 第三层：对接真实 CRUD（前端）

| 文件 | 修改内容 |
|------|----------|
| `context.tsx` | AppProvider 中添加 `useEffect` 在启动时从后端加载所有数据。 |
| `context.tsx` | 所有 `ADD_*` / `UPDATE_*` / `REMOVE_*` 操作改为：先调用后端 API（async），成功后再更新本地状态。失败则回滚并 toast 报错。 |
| `context.tsx` | `runPipeline*` 操作完成后，将结果持久化到后端。 |

### 第四层：Vite 配置

| 文件 | 修改内容 |
|------|----------|
| `vite.config.ts` | 确保 proxy 覆盖 `/api` 和数据端点 |

---

## 实施步骤

### Step 1: 创建数据存储层
- 在 `packages/orchestrator/` 下创建 `data/store.json`（初始空结构）
- 扩展 `server.ts` 添加 CRUD REST API

### Step 2: 创建前端数据客户端
- 在 `packages/app/src/services/` 下创建 `dataApi.ts`
- 提供 `fetchProjects`, `saveProject`, `deleteProject` 等函数

### Step 3: 清空 initialState
- 将所有假数据改为空数组/空对象
- 保留最小默认值（1 个默认项目 + 1 个默认系统）

### Step 4: 对接 CRUD 到后端
- 修改 `context.tsx` 中的 reducer 逻辑
- 所有增删改操作先调用 API，成功后 dispatch

### Step 5: 添加启动加载逻辑
- 在 AppProvider 中添加初始化加载
- 添加全局 loading 状态

### Step 6: 添加持久化流水线结果
- `runPipelineFeature` 等操作完成后自动保存到后端
- 下次打开可恢复上次的流水线产物

### Step 7: 验证
- TypeScript typecheck 通过
- 启动前后端，验证完整流程

---

## 风险与注意事项

1. **后端必须先启动**：前端启动时会尝试加载数据，若后端未启动需有降级处理（显示"后端未连接"状态）
2. **JSON 文件存储**：使用 JSON 文件而非数据库，适合开发阶段。后续可替换为 SQLite/PostgreSQL
3. **并发安全**：简单的 JSON 文件读写，单用户场景足够
4. **类型对齐**：后端 JSON 存储的字段需与前端 TypeScript 类型一致
5. **渐进式对接**：可先接项目/系统配置的 CRUD，再接流水线结果的持久化

## 数据结构（store.json）

```json
{
  "projects": [...],
  "systems": [...],
  "featureRows": [...],
  "caseRows": { rows: [...], meta: {...} },
  "execModules": [...],
  "execMatrix": [...],
  "defectRows": [...],
  "moduleTree": [...],
  "pendingTree": [...],
  "aiConfigs": [...]
}
```

---

## 涉及的文件

### 新增
- `d:\newTest\packages\orchestrator\data\store.json`
- `d:\newTest\packages\app\src\services\dataApi.ts`

### 修改
- `d:\newTest\packages\orchestrator\server.ts` — 添加 CRUD API
- `d:\newTest\packages\app\src\context.tsx` — 清空假数据 + 对接后端 CRUD + 启动加载
- `d:\newTest\packages\app\src\services\pipeline.ts` — 保存流水线结果到后端
