# App 前端对接真实业务修复计划

## 目标
去掉前端假数据（mock 模式），与后端 orchestrator 的真实 HTTP API 对接。
后端已完整实现：`server.mjs` 监听 3001 端口，暴露 `/api/stage` 和 `/api/full-pipeline`。

## 架构现状
```
Browser (5173) --/api/*--> Vite proxy --> http://localhost:3001
                                          └── orchestrator.runStage()
                                                ├── stage-login
                                                ├── stage-explore
                                                ├── stage-feature
                                                ├── stage-case
                                                ├── stage-execute
                                                └── stage-defect
```
Vite proxy 已配置：`/api` → `http://localhost:3001`

## 根因分析

### 核心问题：Mock 模式短路
`pipeline.ts` 的 `createPipelineService()` 默认 `mockMode: false`，但 `context.tsx` 的 `initialState.pipelineMode` 为 `'mock'`，导致所有 pipeline 调用走 `createMockOrchestrator()`。
- mock orchestrator 返回的数据结构是假的，且与真实 contracts 不匹配
- 例：`featureTable` 返回 7 列而非 contract 要求的 9 列
- 例：`defect` 返回空数组

### 前端 Bug（导致"页面格式抽"和"跑不动"）

1. **`context.tsx` L870 动态 require** — Vite ESM 不支持，执行按钮崩溃
2. **Table 组件 editable 模式 bug** — `onChange` 传了 `"__edit__" as any`，点击单元格无反应
3. **CSS 缺失** — `SearchableSelect` 和 `Case meta 头` 的样式类未定义

## 修复计划

### Phase 1：切换到真实后端（核心对接）

#### 1.1 修改 `pipeline.ts`
- 删除 `createMockOrchestrator()` 函数（约 100 行假数据）
- 修改 `createPipelineService()`：
  - 移除 `mockMode` 参数，所有 stage 方法直接走 `callBackend()`
  - `launchEngine()` 改为检查 `/health` 并给出清晰提示
- **修正类型转换函数以对齐真实 contracts 输出**：
  - `toFeatureView()` — 后端返回 `FeatureRow[][]`（9 列字符串数组），当前已按列索引取值，只需修正列映射
  - `toCaseView()` — 后端返回 `CaseSheet[]`，需处理 `metaHeader`（新结构：`systemName`/`testPointId`/`testPoint`/`testers`/`clientStaff`/`firstTestDate`/`regressionDate`/`conclusionRule`/`precondition`/`developerStaff`）→ 前端 MetaHeader（简化为 `system`/`testPointId`/`testPoint`/`testers`/`clientStaff`/`times`/`rules`）
  - `toExecView()` — 后端返回 `ExecutionResult[]`，字段 `caseRowId`/`status`/`env.os`/`env.browser`，需适配前端视图
  - `toDefectView()` — 后端返回 `DefectRow[][]`，扁平化，字段映射 `sequence→seq`/`screenshotRef→screenshot`
  - `toModuleView()` — 后端返回 `ModuleNode[]`，字段 `label`/`status`/`children`，对齐前端 ModuleNodeView

#### 1.2 修改 `context.tsx`
- 修复 L870 动态 require → 改为顶部 ESM import
- `initialState.pipelineMode` 改为 `'real'`
- 移除 `createMockOrchestrator` 相关引用
- 更新 `runPipelineX` 方法：传入正确的 LoginInput/ExploreInput/FeatureInput 等参数（对齐 contracts 冻结接口）

#### 1.3 修改 Workbench.tsx
- 登录流程：组装 `LoginInput`（projectId, systemId, mode, systemUrl, credentialRef, parentPortalUrl）传给后端
- 每个"真实"按钮改为：先组装对应 stage 的 Input（从当前 state 取值），调用 pipeline，更新 state，跳转屏幕
- 流程串联：Login 成功 → Explore 需要 sessionHandle → Feature 需要 moduleTree → Case 需要 featureTable

### Phase 2：修复前端 Bug（UI 恢复可用）

#### 2.1 修复 `components.tsx`
- Table editable 模式：修复 onClick 切换编辑态逻辑

#### 2.2 补充 `styles.css`
- 添加 `.meta-row`, `.meta-cell`, `.meta-key`, `.meta-value` 样式
- 添加 `SearchableSelect` 全套样式
- 给 `.toast` 添加过渡动画

#### 2.3 清理
- 删除 4 个遗留 Python 脚本：`_fix_case.py`, `_modify_case.py`, `_modify_explore.py`, `_modify_feature.py`

## 数据映射（contract → 前端 view 类型）

### LoginOutput → State
```
loginOutput.sessionHandle → system.sessionState
loginOutput.loginStatus → system.loginStatus
loginOutput.cookies → system.sessionState.cookies
loginOutput.expiresAt → (仅前端显示)
```

### ExploreOutput → State
```
exploreOutput.moduleTree → moduleTree (直接映射)
exploreOutput.coverage → (显示用)
```

### FeatureOutput → State
```
featureOutput.featureTable (FeatureRow[][], 9列) → featureRows (FeatureRowView[])
featureOutput.featureIds → (用于 case 生成)
```

### CaseOutput → State
```
caseOutput.caseWorkbook (CaseSheet[]) → caseRows (CaseRowView[] 扁平)
caseOutput.metaHeader (MetaHeader) → metaHeader (简化映射)
```

### ExecuteOutput → State
```
executeOutput.executionReport (ExecutionResult[]) → execMatrix (ExecMatrixRow[])
executeOutput.isolationVerified → execIsolationPassed
```

### DefectOutput → State
```
defectOutput.defectTable (DefectRow[][]) → defectRows (DefectRowView[] 扁平)
defectOutput.screenshots → (截图显示)
```

## 文件修改清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/app/src/services/pipeline.ts` | 重写 | 删 mock、改真实 API、修正类型转换 |
| `packages/app/src/context.tsx` | 修改 | 修 require、改 pipelineMode、串联数据 |
| `packages/app/src/screens/Workbench.tsx` | 修改 | 按钮事件传正确参数给后端 |
| `packages/app/src/screens/Explore.tsx` | 小改 | 对接真实 explore 输出 |
| `packages/app/src/screens/Feature.tsx` | 小改 | 对接真实 feature 输出 |
| `packages/app/src/screens/Case.tsx` | 小改 | 对接真实 case 输出 |
| `packages/app/src/screens/Execute.tsx` | 小改 | 对接真实 execute 输出 |
| `packages/app/src/screens/Defect.tsx` | 小改 | 对接真实 defect 输出 |
| `packages/app/src/components.tsx` | 修改 | 修 Table editable |
| `packages/app/src/styles.css` | 补充 | 缺失样式 |
| `packages/app/src/_fix_case.py` 等 4 个 | 删除 | 清理遗留文件 |

## 验收标准

1. ✅ 无 mock 模式残留，默认走真实 API
2. ✅ 后端启动（`pnpm server`）后，前端所有按钮能正常调用后端
3. ✅ 登录 → 探索 → 功能点 → 用例 → 执行 → 缺陷 流程能完整走通
4. ✅ 数据在各 stage 间正确传递和显示
5. ✅ 无浏览器控制台错误
6. ✅ 所有 UI 组件显示正常（表格、选择器、meta 头、toast）
7. ✅ 无遗留 Python 脚本

## 风险与注意

1. **contracts 冻结**：不修改任何 @test-platform/contracts 导出的类型
2. **后端需启动**：`pnpm --filter @test-platform/orchestrator server` 或根目录 `pnpm server`
3. **无后端时的降级**：当后端不可达时，前端显示清晰的错误提示并允许手动编辑数据（纯前端模式）
4. **不引入新依赖**：仅修改现有文件