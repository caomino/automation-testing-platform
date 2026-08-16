# 系统探索模块修复计划

## 一、代码位置清单

### 1.1 系统探索模块文件分布

| 层级 | 文件路径 | 作用 |
|------|----------|------|
| **前端UI** | `packages/app/src/screens/Explore.tsx` | 系统探索页面组件 |
| **前端状态** | `packages/app/src/context.tsx` | 全局状态管理（reducer + useApp hook） |
| **前端API** | `packages/app/src/services/pipeline.ts` | 前后端通信适配层 |
| **前端数据** | `packages/app/src/services/dataApi.ts` | 数据持久化API |
| **后端桥接** | `packages/orchestrator/server.ts` | HTTP服务器，API路由 |
| **后端编排** | `packages/orchestrator/src/index.ts` | PipelineOrchestrator 探索阶段调度 |
| **探索核心** | `packages/stage-explore/src/index.ts` | 探索阶段业务逻辑（run/merge/dedupe/coverage） |
| **引擎MCP** | `packages/engine-mcp/src/mcp-adapter.ts` | McpPlaywrightAdapter（@playwright/mcp封装） |
| **引擎直连** | `packages/engine-mcp/src/playwright-engine.ts` | PlaywrightEngine（直连模式） |
| **引擎工厂** | `packages/engine-mcp/src/index.ts` | createEngine 工厂函数 |
| **快照转换** | `packages/engine-mcp/src/snapshot-converter.ts` | browser_snapshot → SemanticNodes 转换 |
| **引擎类型** | `packages/engine-mcp/src/types.ts` | McpEngine/SessionCapableEngine 接口定义 |
| **契约定义** | `packages/contracts/src/stages/ExploreContract.ts` | ExploreInput/Output 冻结契约 |
| **类型定义** | `packages/contracts/src/types/ModuleNode.ts` | ModuleNode 类型定义 |

---

## 二、问题根因分析

### 2.1 核心问题：前端UI层与后端探索逻辑未对接

```
┌─────────────────────────────────────────────────────────────────────┐
│                    数据流链路（完整）                                  │
│                                                                     │
│  Explore.tsx ──→ context.tsx(runPipelineExplore)                     │
│       ↓                 ↓                                           │
│    [未调用!]     pipeline.ts(runStageExplore)                        │
│                          ↓                                          │
│                   callBackend('explore', input)                      │
│                          ↓                                          │
│                   POST /api/stage {stage:'explore', input}           │
│                          ↓                                          │
│                   server.ts → orchestrator.runStage('explore')       │
│                          ↓                                          │
│                   stage-explore/src/index.ts → run(input, engine)     │
│                          ↓                                          │
│                   engine-mcp → createEngine → navigate → exploreModules│
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 问题清单

| # | 位置 | 问题描述 | 严重度 |
|---|------|----------|--------|
| 1 | `Explore.tsx:168` | "开始/继续探索"按钮 **没有 onClick**，点击无反应 | 🔴 严重 |
| 2 | `Explore.tsx:28-46` | `useApp()` 解构时 **未获取** `runPipelineExplore` | 🔴 严重 |
| 3 | `Explore.tsx:130-158` | `handleManualAdd()` 用 **setTimeout 模拟**，无真实后端调用 | 🟡 中等 |
| 4 | `Explore.tsx` 全页面 | 人工补充、模块CRUD等功能 **全部无效**（仅改前端状态） | 🔴 严重 |
| 5 | `context.tsx:955-982` | `runPipelineExplore` 已实现但 **未被UI调用** | 🔴 严重 |
| 6 | `Explore.tsx` 全页面 | 切换系统后没有自动加载该系统的已有数据 | 🟡 中等 |

---

## 三、修复方案

### 3.1 修改文件列表

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `packages/app/src/screens/Explore.tsx` | **重点修改** | 接通探索按钮、人工补充、CRUD持久化 |
| `packages/app/src/context.tsx` | **小改** | 添加加载已有模块树功能 |
| `packages/app/src/services/dataApi.ts` | **小改** | 添加模块树保存/加载API |
| `packages/orchestrator/server.ts` | **小改** | 添加模块树持久化路由 |
| `packages/infra-store/src/index.ts` | **小改** | 添加模块树存储方法 |

### 3.2 修改步骤

#### 步骤1：接通"开始/继续探索"按钮

**文件**: `packages/app/src/screens/Explore.tsx`

```
1.1 在 useApp() 解构中添加 runPipelineExplore, pipelineLoading, pipelineError
1.2 为"开始/继续探索"按钮绑定 onClick：
    - 检查是否已登录（system.loginStatus === 'logged_in'）
    - 构造 ExploreInput：
        {
            sessionHandle: system.sessionState,
            subsystemId: system.id,
            systemUrl: system.url,
            resumeFrom: 已有 checkpoint（如有）
        }
    - 调用 runPipelineExplore(input)
    - 处理成功/失败/loading 状态
1.3 添加 loading 状态提示（按钮禁用 + 文案切换）
1.4 添加错误处理和 toast 提示
```

#### 步骤2：实现真实的人工补充功能

**文件**: `packages/app/src/screens/Explore.tsx`

```
2.1 将 handleManualAdd() 改为调用后端 API
    - 打开人工补充弹窗（已有UI）
    - 用户填写路径/模块/置信度后提交
    - 调用 runPipelineExplore 并传入 manualSupplement 参数
    - ManualSupplement 结构：
        {
            clickPath: [{ steps: [...], inferredModule: '...' }],
            insertPosition: 'below',
            relativeToNodeId: selectedModuleId
        }
2.2 保留两段式工作流UI，但接入真实后端
```

#### 步骤3：系统切换后自动加载已有数据

**文件**: `packages/app/src/screens/Explore.tsx` + `context.tsx`

```
3.1 监听 system.id 变化（useEffect）
3.2 切换系统时：
    - 清空当前 moduleTree
    - 从后端加载该系统已保存的模块树
    - 更新前端状态
```

#### 步骤4：添加模块树持久化

**文件**: `packages/app/src/services/dataApi.ts` + `orchestrator/server.ts` + `infra-store`

```
4.1 dataApi.ts 添加：
    - saveModuleTree(projectId, systemId, moduleTree)
    - getModuleTree(projectId, systemId)
4.2 server.ts 添加路由：
    - PUT /api/store/projects/:id/module-tree
    - GET /api/store/projects/:id/module-tree
4.3 infra-store 添加 saveModuleTree / getModuleTree 方法
```

#### 步骤5：确保探索逻辑正确性

**文件**: `packages/stage-explore/src/index.ts`（只读检查，不需修改）

```
5.1 确认 run() 函数完整流程：
    - 输入验证 ✅
    - 引擎创建/复用 ✅
    - 会话衔接（applySession）✅
    - 导航到目标URL ✅
    - exploreModules() 获取模块树 ✅
    - 断点续跑 ✅
    - 人工补充合并 ✅
    - 覆盖率计算 ✅
    - 输出生成 ✅
5.2 引擎 exploreModules() 逻辑：
    - McpPlaywrightAdapter → browser_snapshot → findInteractiveNodes
    - 返回 ModuleNode[] 列表
```

#### 步骤6：前端CRUD与后端同步

**文件**: `packages/app/src/screens/Explore.tsx` + `context.tsx`

```
6.1 模块CRUD操作后自动持久化到后端
6.2 新增/编辑/删除模块后调用 dataApi.updateProject
6.3 全部入树/批量操作后同步保存
```

---

## 四、风险与注意事项

### 4.1 契约冻结约束
- `contracts` 包已冻结，**不可修改**
- `ExploreInput`、`ExploreOutput`、`ModuleNode` 类型保持不变
- `engine-mcp` 的 `SessionCapableEngine` 接口已冻结

### 4.2 引擎依赖风险
- `@playwright/mcp` 需要通过 npm 安装
- MCP 协议通过 stdio 传输，需要 Node.js 环境
- 如 MCP 引擎不可用，系统会 fallback 到 PlaywrightEngine（direct 模式）

### 4.3 数据兼容性
- 现有前端状态结构 `ModuleNodeView` 与后端 `ModuleNode` 需要正确转换
- `pipeline.ts` 中的 `toModuleView()` / `fromModuleView()` 已实现转换

### 4.4 用户体验
- 探索过程可能耗时较长，需要 loading 状态
- 错误需要友好提示（网络问题、引擎启动失败、登录失效等）
- 切换系统需要确认操作

---

## 五、预期效果

修复后，系统探索模块的完整工作流：

1. **用户选择系统** → 自动加载已有模块树
2. **用户点击"开始/继续探索"** → 调用后端真实探索
3. **后端执行** → 创建引擎 → 应用会话 → 导航 → exploreModules → 返回模块树
4. **前端展示** → 模块树渲染 → 覆盖率统计
5. **用户CRUD操作** → 修改状态 → 自动持久化
6. **人工补充** → 填写路径 → 入树 → 持久化
7. **数据保存** → 所有操作自动同步到后端
