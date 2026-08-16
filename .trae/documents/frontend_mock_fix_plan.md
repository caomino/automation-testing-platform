# 前端流程修复计划 — 打通真实数据链

## 代码级诊断结果

### 根因 1：Workbench 按钮传空数据（Workbench.tsx#L322-L378）

每个快速操作按钮硬编码空数组，完全没用到 state 里的真实数据：

| 按钮 | 实际传给后端 | 应该传 |
|------|-------------|--------|
| 🔍 探索 | `sessionHandle: 可能为 undefined` | 从 `state.system.sessionState` 构建 `SessionHandle` |
| 📋 功能点 | `moduleTree: []` | `state.moduleTree`（view）→ 转成 `ModuleNode[]`（contract） |
| 🧪 用例 | `featureTable: []` | `state.featureRows`（view）→ 转成 `FeatureRow[][]`（contract） |
| ▶ 执行 | `caseWorkbook: []` | `state.caseRows`（view）→ 转成 `CaseSheet[]`（contract） |
| 🐛 缺陷 | `executionReport: []` | 执行结果 → 转成 `ExecutionResult[]`（contract） |

### 根因 2：pipeline.ts 缺少反向转换函数

有 contract → view 的转换：`toFeatureView`, `toCaseView`, `toExecView`, `toDefectView`, `toModuleView`

**缺少** view → contract 的反向转换：需要 `fromFeatureView`, `fromCaseView`, `fromModuleView`, `fromExecView`

### 根因 3：initialState 硬编码假数据

`context.tsx#L309-L416` 中 `featureRows`, `caseRows`, `execModules`, `execMatrix`, `defectRows`, `moduleTree` 全部预填假数据。页面永远显示这批假数据，pipeline 成功也不会被注意到。

### 根因 4：pipelineMode 是死代码

`state.pipelineMode` 存在但 `createPipelineService()` 从不检查它。`getPipelineService()` 永远返回同一个 HTTP 服务。

---

## 修复计划

### 文件清单

| 文件 | 操作 | 改动量 |
|------|------|--------|
| `packages/app/src/services/pipeline.ts` | **改造** | +4 个反向转换函数 |
| `packages/app/src/context.tsx` | **改造** | 清空 initialState 假数据 + 修复 getPipelineService |
| `packages/app/src/screens/Workbench.tsx` | **改造** | 修复 5 个按钮的数据传递 |
| `packages/app/src/services/__tests__/pipeline.test.ts` | **更新** | 对齐新增函数 |

---

### Step 1: pipeline.ts — 新增 4 个反向转换函数

```
fromModuleView(nodes: ModuleNodeView[]): ModuleNode[]
fromFeatureView(rows: FeatureRowView[]): FeatureRow[][]
fromCaseView(rows: CaseRowView[], meta: MetaHeader, systemName: string): CaseSheet[]
fromExecView(matrix: ExecMatrixRow[], browsers: string[]): ExecutionResult[]
```

每个函数的职责：将前端 view 类型转回 contracts 包要求的 contract 类型，使其能作为下一个 pipeline stage 的输入。

### Step 2: context.tsx — 清空 initialState + 修复 service 创建

**2a. 清空 initialState 假数据**

将以下字段改为空数组/默认值：
- `featureRows: []`
- `caseRows: []`
- `defectRows: []`
- `moduleTree: []`
- `pendingTree: []`
- `execModules: []`
- `execMatrix: []`

保留：`projects`, `systems`, `project`, `system`（这些是项目配置数据，不是 pipeline 产出）

**2b. getPipelineService 支持 pipelineMode**

```typescript
const getPipelineService = useCallback(() => {
  if (pipelineServiceRef.current) return pipelineServiceRef.current;
  const svc = createPipelineService();
  pipelineServiceRef.current = svc;
  return svc;
}, [state.pipelineMode]);  // mode 变化时重建
```

并在 `setPipelineMode` 时重置 ref：`pipelineServiceRef.current = null`

### Step 3: Workbench.tsx — 修复按钮数据传递

**3a. 探索按钮**

```typescript
// 从 system.sessionState 构建 SessionHandle
const sessionHandle = system.sessionState?.cookies 
  ? { sessionId: system.id, systemId: system.id, loginStatus: 'ok' as const, cookies: system.sessionState.cookies, expiresAt: Date.now() + 3600000 }
  : undefined;
await runPipelineExplore({ sessionHandle, subsystemId: system.id });
```

**3b. 功能点按钮**

```typescript
import { fromModuleView } from '../services/pipeline';
await runPipelineFeature({
  moduleTree: fromModuleView(moduleTree),
  systemName: system.name,
  confirmedOnly: false,
});
```

**3c. 用例按钮**

```typescript
import { fromFeatureView } from '../services/pipeline';
await runPipelineCase({
  featureTable: fromFeatureView(featureRows),
  scope: 'all',
  metaConfig: { /* 从 metaHeader 构建 */ },
});
```

**3d. 执行按钮**

```typescript
import { fromCaseView } from '../services/pipeline';
await runPipelineExecute({
  caseWorkbook: fromCaseView(caseRows, metaHeader, system.name),
  scope: 'all',
  browserOSMatrix: execBrowsers.map(b => parseBrowserOS(b)),
});
```

**3e. 缺陷按钮**

```typescript
import { fromExecView } from '../services/pipeline';
await runPipelineDefect({
  executionReport: fromExecView(execMatrix, execBrowsers),
});
```

### Step 4: 更新测试

更新 `pipeline.test.ts` 测试新增的反向转换函数。

---

## 风险

| 风险 | 缓解 |
|------|------|
| contracts 类型与 view 类型字段不完全对应 | 反向转换时做字段映射，缺失字段给合理默认值 |
| SessionHandle 结构可能与后端预期不完全匹配 | 参考 LoginContract 定义，确保字段齐全 |
| initialState 清空后 UI 空状态 | 各 Screen 组件已有空状态展示（"暂无数据"等） |
| 后端未启动时 pipeline 调用仍会失败 | 现有 try/catch + toast 错误提示已覆盖此场景 |

## 不改动的范围

- **contracts 包**：contracts 接口冻结，不修改
- **orchestrator 包**：后端编排器已正确串联数据流，不修改
- **各 stage 包**：stage-login, stage-explore 等不修改
- **数据结构**：不改变 view 类型或 contract 类型定义
