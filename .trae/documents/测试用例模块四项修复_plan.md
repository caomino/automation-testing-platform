# 测试用例模块四项修复计划（v3 — 基于现有探索模块扩展）

## 目标

修复测试用例模块的 4 个关键问题。核心变更：**基于已有的系统探索能力（stage-explore + McpPlaywrightAdapter），扩展页面级元素探索方法，用探索结果驱动测试用例生成**。

---

## 现有基础设施分析

| 组件 | 已有能力 | 缺少什么 |
|------|----------|----------|
| `McpPlaywrightAdapter` | navigate(), extractSemanticDom(), exploreModules(), runStep() | 缺少：页面级全元素提取（针对功能点页面） |
| `stage-explore` | 模块树遍历、人工补充、覆盖率计算 | 缺少：钻取每个模块页面的表单/按钮细节 |
| `stage-case` | 模板生成3类场景用例（normal/boundary/exception） | 缺少：接受探索数据、用真实元素替代模板文本 |
| `context.tsx` | 管道编排、状态管理 | 缺少：二次探索步骤、探索→用例的数据桥接 |

**关键发现**：
- `ModuleNode` 已有 `url` 字段（type=page 时有值），可用于定位功能点对应的页面
- `exploreModules()` 只提取顶层交互节点，不钻取子页面
- 需要在 `McpPlaywrightAdapter` 上新增方法：给定 URL → 返回该页面的所有交互元素

---

## 问题 1：选择模块弹窗样式问题

**根因**：无弹窗管理层，3 个 Modal 同时 open 互相重叠。

**修复**：
1. 新增 `useModalManager` hook：统一管理弹窗生命周期，同一时刻仅一个弹窗打开
2. "选择模块"从配置弹窗的子弹窗提升为独立一级按钮
3. Meta 编辑改为表格行内编辑（inline edit），移除编辑弹窗
4. 弹窗样式调整：min-width 680px、SearchableSelect 全宽、sticky header

**涉及文件**：
- `packages/app/src/hooks/useModalManager.ts` — **新增**
- `packages/app/src/components.tsx` — 导出 ModalManager
- `packages/app/src/styles.css` — 弹窗样式调整
- `packages/app/src/screens/Case.tsx` — 重构弹窗结构

---

## 问题 2：功能点表格修改后数据自动消失

**根因**：编辑只改本地 state，系统切换/刷新时后端重新加载覆盖未保存修改。

**修复**：
1. `featureUpdateRow` 内自动防抖保存（debounce 1s → 调用 `saveFeatureTable`）
2. `setActiveSystem` 前先 flush 保存当前 featureRows
3. 新增 `featureDirty` flag，保存失败时回滚 + toast
4. `Feature.tsx` 组件卸载前自动保存

**涉及文件**：
- `packages/app/src/context.tsx`

---

## 问题 3：配置数据未按系统保存

**根因**：Meta 无独立持久化接口，仅随 CaseSheet 保存。

**修复**：
1. `dataApi.ts` 新增 `saveMetaConfig(projectId, systemId, meta)` / `getMetaConfig(projectId, systemId)` API
2. `CASE_UPDATE_META` 内自动防抖保存（debounce 800ms）
3. 系统切换时自动加载对应系统的 meta
4. Bootstrap 启动时加载当前系统 meta

**涉及文件**：
- `packages/app/src/services/dataApi.ts`
- `packages/app/src/context.tsx`

---

## 问题 4：测试用例生成集成 MCP 探索（核心）

### 4.1 问题诊断

现有流程：
```
系统探索(stage-explore) → 模块树(ModuleNode[]) → 功能点(stage-feature) → 功能点表(FeatureRow[][])
                                                                                    ↓
                                                                          测试用例(stage-case) ← 纯模板，空对空
```

缺少：功能点 → 二次探索页面元素 → 用真实数据生成用例

### 4.2 新增：页面级元素提取方法

在 `McpPlaywrightAdapter` 上新增方法 `extractPageElements(url)`：

```typescript
// engine-mcp/src/mcp-adapter.ts
async extractPageElements(url: string): Promise<ExploredElement[]>
```

实现逻辑：
1. 调用 `browser_navigate` 导航到指定 URL
2. 调用 `browser_snapshot` 获取 accessibility tree
3. 解析 snapshot，提取所有 role 为 button/textbox/combobox/link/checkbox/radiogroup 的元素
4. 返回每个元素的 `ref`、`role`、`label`

### 4.3 新增：探索结果类型

在 `engine-mcp/src/types.ts` 新增：

```typescript
interface ExploredElement {
  ref: string;      // MCP snapshot ref (e.g., e23)
  role: string;      // accessibility role
  label: string;     // element 标签/文本
  tag?: string;      // HTML tag
  type?: string;     // input type
}

interface FeatureExplorationResult {
  featureId: string;              // 测试点标识
  featureName: string;            // 功能点名称
  subModule: string;              // 子模块
  pageUrl: string;                // 探索的页面 URL
  elements: ExploredElement[];   // 页面交互元素列表
  exploredAt: number;             // 探索时间戳
  success: boolean;               // 探索是否成功
  error?: string;                 // 失败原因
}
```

### 4.4 新增：功能点二次探索服务

在 `stage-case` 包（或 `services/pipeline.ts`）中新增二次探索逻辑：

```typescript
async reExploreFeatures(
  systemUrl: string,
  featureRows: FeatureRow[],
  moduleTree: ModuleNode[],
  engine: McpEngine
): Promise<FeatureExplorationResult[]>
```

逻辑：
1. 从模块树中查找每个功能点对应的页面 URL（通过子模块/主模块匹配 `ModuleNode.label`）
2. 若无匹配 URL，使用 `systemUrl + 子模块路径推断`（如 `systemUrl/subModule`）
3. 对每个功能点：
   a. 调用 `engine.extractPageElements(pageUrl)` 获取页面元素
   b. 记录探索结果（含成功/失败状态）
4. 返回所有功能点的探索结果

### 4.5 修改：`stage-case` 生成逻辑

修改 `stage-case/src/index.ts` 的 `run()` 函数：

**输入扩展**（通过 service 层注入，不改 contracts 冻结接口）：
```typescript
// CaseInput 不变，explorationData 通过上下文传入
// stage-case 的 run 函数增加可选参数
run(input: CaseInput, explorationData?: FeatureExplorationResult[]): Promise<CaseOutput>
```

**`scenarioContent` 函数改造**：
- 有探索数据时：用真实元素生成操作步骤
  ```
  访问[pageUrl]页面
  → 点击[button: "保存"](ref=e23)
  → 录入[textbox: "用户名"](ref=e45) 数据
  → 点击[button: "提交"](ref=e67) 提交
  ```
- 无探索数据时：降级为现有模板生成（保持兼容）

### 4.6 修改：Case.tsx UI

1. 新增"探索并生成"按钮：先二次探索 → 再生成用例
2. 新增"仅生成"按钮：使用上次探索数据或模板降级
3. 展示探索状态（进度、成功/失败统计）
4. 探索结果可查看（哪些功能点探索成功，哪些失败）

### 4.7 数据流集成

```
用户点击"探索并生成"
  ↓
context.runPipelineCase(input)
  ↓
1. 检查 system.url 可用性
2. 若可用 → 调用 reExploreFeatures() 获取 FeatureExplorationResult[]
3. 将 explorationData 传入 stage-case.run(input, explorationData)
4. stage-case 使用真实元素生成用例
5. 用例结果保存到 state + 后端
```

---

## 修复步骤与文件清单

### Step 1：修复弹窗管理层

| 文件 | 类型 | 改动 |
|------|------|------|
| `packages/app/src/hooks/useModalManager.ts` | 新增 | ModalManager hook |
| `packages/app/src/components.tsx` | 修改 | 导出 ModalManager |
| `packages/app/src/styles.css` | 修改 | 弹窗样式 |
| `packages/app/src/screens/Case.tsx` | 修改 | 重构弹窗结构 |

### Step 2：功能点表格自动保存

| 文件 | 类型 | 改动 |
|------|------|------|
| `packages/app/src/context.tsx` | 修改 | FEATURE_UPDATE_ROW 防抖保存、featureDirty flag |

### Step 3：Meta 配置持久化

| 文件 | 类型 | 改动 |
|------|------|------|
| `packages/app/src/services/dataApi.ts` | 修改 | saveMetaConfig/getMetaConfig |
| `packages/app/src/context.tsx` | 修改 | CASE_UPDATE_META 防抖保存 |

### Step 4：MCP 二次探索 + 用例生成

| 文件 | 类型 | 改动 |
|------|------|------|
| `packages/engine-mcp/src/types.ts` | 新增 | ExploredElement / FeatureExplorationResult 类型 |
| `packages/engine-mcp/src/mcp-adapter.ts` | 修改 | 新增 extractPageElements() 方法 |
| `packages/engine-mcp/src/index.ts` | 修改 | 导出新类型 |
| `packages/stage-case/src/index.ts` | 修改 | run() 接受 explorationData、改造 scenarioContent() |
| `packages/app/src/services/pipeline.ts` | 修改 | 新增 reExploreFeatures()、修改 runStageCase |
| `packages/app/src/context.tsx` | 修改 | runPipelineCase 增加二次探索步骤 |
| `packages/app/src/screens/Case.tsx` | 修改 | "探索并生成"按钮、探索状态展示 |

### Step 5：验证

1. `pnpm typecheck` — 0 error
2. `pnpm lint` — 0 error
3. `pnpm test` — 全绿
4. 手动验证 4 个问题点

---

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 弹窗重构影响交互 | 中 | 保持现有 API，仅重构内部状态 |
| 自动保存竞态 | 低 | debounce + dirty flag |
| 二次探索页面可能失败 | 高 | 降级方案：单页失败不阻塞其他，整体失败用模板生成 |
| 功能点与页面 URL 映射不准 | 中 | 通过模块树 url 字段匹配 + 路径推断兜底 + 手动覆盖 |
| contracts 冻结不可改 | — | 探索数据通过 service 层传入，不改 CaseInput/Output |

---

## 不在本次范围

- AI 辅助生成（后续阶段）
- 5 层复杂逻辑检测完整实现
- 执行阶段 MCP 集成
- 后端持久化实现（前端 mock API 对接）
