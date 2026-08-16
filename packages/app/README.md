# @test-platform/app

## 1. 模块概述

### 1.1 职责说明
app 是自动化测试平台的**前端应用层**，负责：

1. **用户界面展示**：提供工作台、项目管理、探索、功能点、用例、执行、缺陷等可视化页面
2. **全局状态管理**：通过 React Context 管理应用状态（项目、系统、功能点、用例等）
3. **后端通信**：通过 HTTP API 与 orchestrator 后端进行数据交换
4. **数据流适配**：在 contracts 类型和前端 View 类型之间进行转换

### 1.2 在整体架构中的位置
```
┌─────────────────────────────────────────────────────┐
│                     app (前端)                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐           │
│  │  screens │  │ context  │  │ services │           │
│  │ (页面)   │  │ (状态)   │  │ (API)    │           │
│  └─────────┘  └──────────┘  └──────────┘           │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP API (/api)
                        ▼
┌─────────────────────────────────────────────────────┐
│              orchestrator (后端)                     │
│  ┌─────────────────────────────────────────────┐    │
│  │           PipelineOrchestrator              │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 1.3 技术栈
- **框架**：React ^18.3.0
- **构建工具**：Vite ^5.4.0
- **语言**：TypeScript ^5.7.2
- **样式**：CSS（原生）

### 1.4 设计原则
- **纯前端适配层**：不实现业务逻辑，仅负责 UI 展示和数据转换
- **类型安全**：严格的 TypeScript 类型检查
- **单向数据流**：通过 Reducer 模式管理状态更新
- **Mock/Real 双模式**：支持 mock 数据调试和真实后端调用

---

## 2. 核心逻辑

### 2.1 模块结构
```
app/
├── src/
│   ├── screens/           # 页面组件
│   │   ├── Workbench.tsx      # 工作台（首页）
│   │   ├── ProjectMgmt.tsx    # 项目管理
│   │   ├── Explore.tsx        # 探索
│   │   ├── Feature.tsx        # 功能点
│   │   ├── Case.tsx           # 用例
│   │   ├── Execute.tsx        # 执行
│   │   ├── Defect.tsx         # 缺陷
│   │   ├── AIConfig.tsx       # AI 配置
│   │   ├── Logs.tsx           # 日志
│   │   └── Knowledge.tsx      # 知识库
│   ├── services/          # 服务层
│   │   ├── pipeline.ts        # Pipeline 服务（类型转换 + 后端通信）
│   │   ├── dataApi.ts         # 数据 API
│   │   └── __tests__/         # 测试
│   ├── context.tsx        # 全局状态管理
│   ├── App.tsx            # 主应用组件
│   ├── components.tsx     # 共享组件
│   ├── styles.css         # 样式
│   └── main.tsx           # 入口
├── index.html
├── vite.config.ts
└── package.json
```

### 2.2 状态管理

#### AppState 结构
```typescript
interface AppState {
  // 项目与系统
  project: ProjectInfo;
  system: SystemInfo;
  projects: ProjectInfo[];
  systems: SystemInfo[];
  
  // 导航与 UI
  activeScreen: string;
  toastMsg: string;
  
  // 探索阶段
  moduleTree: ModuleNodeView[];
  pendingTree: PendingTreeItem[];
  selectedModuleId: string | null;
  treeChecked: string[];
  
  // 功能点阶段
  featureRows: FeatureRowView[];
  featureConfirmed: boolean;
  
  // 用例阶段
  caseRows: CaseRowView[];
  metaHeader: MetaHeader;
  caseSelectedModules: string[];
  caseAiOn: boolean;
  
  // 执行阶段
  execModules: ExecModuleState[];
  execBrowsers: string[];
  execMatrix: ExecMatrixRow[];
  execCheckedModules: string[];
  execIsolationPassed: boolean;
  
  // 缺陷阶段
  defectRows: DefectRowView[];
  defectFilter: string;
  
  // AI 配置
  aiConfigs: AiConfigView[];
  aiCurrentDefault: string;
  
  // 日志
  logPolicy: LogPolicy;
  logFiles: LogFileView[];
  
  // 知识库
  knowledge: KnowledgeEntry[];
  
  // 活动记录
  activities: ActivityItem[];
  
  // Pipeline 状态
  pipelineLoading: boolean;
  pipelineStage: string | null;
  pipelineError: string | null;
  pipelineMode: 'mock' | 'real';
  
  // 启动状态
  bootstrapping: boolean;
}
```

#### 核心 Action 类型
| Action 类型 | 说明 |
|------------|------|
| `SET_SCREEN` | 切换当前页面 |
| `SET_PROJECT` / `ADD_PROJECT` / `UPDATE_PROJECT` / `REMOVE_PROJECT` | 项目管理 |
| `SET_SYSTEM` / `ADD_SYSTEM` / `UPDATE_SYSTEM` / `REMOVE_SYSTEM` | 系统管理 |
| `FEATURE_ADD_ROW` / `FEATURE_UPDATE_ROW` / `FEATURE_REMOVE_ROW` | 功能点行操作 |
| `CASE_ADD_ROW` / `CASE_UPDATE_ROW` / `CASE_REMOVE_ROW` | 用例行操作 |
| `EXEC_RUN` / `EXEC_TOGGLE_MODULE` / `EXEC_VERIFY_ISOLATION` | 执行操作 |
| `DEFECT_ADD` / `DEFECT_UPDATE` / `DEFECT_REMOVE` | 缺陷管理 |
| `PIPELINE_SET_LOADING` / `PIPELINE_SET_ERROR` | Pipeline 状态 |
| `BOOTSTRAP_DONE` | 启动完成 |

### 2.3 数据转换

#### Contract → View（前端展示）
```typescript
// 功能点表转换
function toFeatureView(table: string[][]): FeatureRowView[];

// 用例表转换
function toCaseView(sheets: CaseSheet[]): { rows: CaseRowView[]; meta: MetaHeader };

// 执行结果转换
function toExecView(report: ExecutionResult[], browsers: string[]): ExecMatrixRow[];

// 缺陷表转换
function toDefectView(defectOutput: DefectOutput): DefectRowView[];

// 模块树转换
function toModuleView(nodes: ModuleNode[]): ModuleNodeView[];
```

#### View → Contract（后端请求）
```typescript
// 模块树反向转换
function fromModuleView(nodes: ModuleNodeView[]): ModuleNode[];

// 功能点表反向转换
function fromFeatureView(rows: FeatureRowView[]): string[][][];

// 用例表反向转换
function fromCaseView(rows: CaseRowView[], meta: MetaHeader): CaseSheet[];

// 执行结果反向转换
function fromExecView(matrix: ExecMatrixRow[], modules: ExecModuleState[]): ExecutionResult[];
```

### 2.4 后端通信

#### PipelineService 接口
```typescript
interface PipelineService {
  launchEngine(): Promise<void>;
  closeEngine(): Promise<void>;
  runStageLogin(input: LoginInput): Promise<LoginOutput>;
  runStageExplore(input: ExploreInput): Promise<ExploreOutput>;
  runStageFeature(input: FeatureInput): Promise<FeatureOutput>;
  runStageCase(input: CaseInput): Promise<CaseOutput>;
  runStageExecute(input: ExecuteInput): Promise<ExecuteOutput>;
  runStageDefect(input: DefectInput): Promise<DefectOutput>;
  runFullPipeline(input: any): Promise<any>;
}
```

#### API 端点
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/stage` | POST | 执行单个阶段 |
| `/api/full-pipeline` | POST | 执行完整流水线 |
| `/health` | GET | 健康检查 |

---

## 3. 接口文档

### 3.1 前端 View 类型

#### ProjectInfo
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 项目 ID |
| name | string | 项目名称 |
| type | SystemType | 系统类型 |
| description | string | 描述 |
| systemCount | number | 系统数量 |
| caseCount | number | 用例数量 |
| createdAt | string | 创建时间 |
| lastActive | string | 最后活跃时间 |
| status | '活跃' \| '空闲' | 状态 |

#### SystemInfo
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 系统 ID |
| name | string | 系统名称 |
| type | SystemType | 系统类型 |
| url | string | 系统 URL |
| captured | boolean | 是否已捕获 |
| parent | string | 父系统 |
| loginMode | LoginMode | 登录方式 |
| loginStatus | LoginStatus | 登录状态 |
| parentPortalId? | string | 父门户 ID |
| capturedUrl? | string | 捕获的 URL |
| username? | string | 用户名 |
| passwordRef? | string | 密码引用 |
| sessionState? | SessionState | 会话状态 |
| navigationPath? | string[] | 导航路径 |

#### FeatureRowView（9列）
| 字段 | 类型 | 说明 |
|------|------|------|
| seq | string | 序号 |
| type | string | 测试类型 |
| chapter | string | 需求章节 |
| system | string | 系统名称 |
| mainModule | string | 主模块 |
| subModule | string | 子模块 |
| feature | string | 功能点 |
| testPoint | string | 测试点 |
| testPointId | string | 测试点标识 |
| needsReview? | boolean | 待审查标记 |
| merge? | boolean | 合并标记 |

#### CaseRowView（8列）
| 字段 | 类型 | 说明 |
|------|------|------|
| caseNo | string | 用例编号 |
| content | string | 测试内容 |
| step | string | 步骤 |
| operation | string | 操作说明 |
| expected | string | 预期结果 |
| firstResult | string | 首次测试结果 |
| regressionResult | string | 回归测试结果 |
| conclusion | string | 结论 |

#### DefectRowView
| 字段 | 类型 | 说明 |
|------|------|------|
| seq | number | 序号 |
| description | string | 缺陷描述 |
| screenshot? | string | 截图引用 |
| level | '高' \| '中' \| '低' | 严重程度 |
| qualityAttribute | string | 质量属性 |
| environment | string | 环境信息 |

### 3.2 辅助函数

| 函数 | 签名 | 说明 |
|------|------|------|
| nextSeq | () => string | 生成下一个序号 |
| nextCaseNo | (prefix: string) => string | 生成下一个用例编号 |
| removeFromArray | <T>(arr: T[], predicate: Function) => T[] | 从数组移除元素 |
| insertInArray | <T>(arr: T[], index: number, item: T) => T[] | 在数组插入元素 |
| updateInArray | <T>(arr: T[], predicate: Function, patch: Partial<T>) => T[] | 更新数组元素 |

---

## 4. 数据流转

### 4.1 前端数据流
```
用户操作 → Action Dispatch → Reducer → 新 State → UI 渲染
                │
                │ (需要后端)
                ▼
          PipelineService.callBackend()
                │
                ▼
          后端 API (orchestrator)
                │
                ▼
          返回数据 → 类型转换 → Dispatch 更新 State
```

### 4.2 页面数据流

| 页面 | 输入 | 输出 |
|------|------|------|
| Workbench | projects, systems | 项目/系统选择、状态展示 |
| ProjectMgmt | projects | 项目 CRUD |
| Explore | moduleTree, pendingTree | 模块树展示、人工补充 |
| Feature | featureRows | 功能点编辑、确认 |
| Case | caseRows, metaHeader | 用例编辑、AI 辅助 |
| Execute | execMatrix, execModules | 执行矩阵展示 |
| Defect | defectRows | 缺陷列表、筛选 |
| AIConfig | aiConfigs | AI 配置 CRUD |
| Logs | logFiles, logPolicy | 日志查看、清理 |
| Knowledge | knowledge | 知识库编辑 |

---

## 5. 依赖关系

### 5.1 内部依赖
| 依赖 | 用途 |
|------|------|
| `@test-platform/contracts` | 提供业务类型定义 |
| `@test-platform/engine-mcp` | 浏览器引擎（类型引用） |
| `@test-platform/orchestrator` | 后端编排器（HTTP 调用） |
| `@test-platform/stage-*` | 各阶段模块（类型引用） |

### 5.2 外部依赖
| 依赖 | 版本 | 用途 |
|------|------|------|
| `react` | ^18.3.0 | UI 框架 |
| `react-dom` | ^18.3.0 | DOM 渲染 |
| `vite` | ^5.4.0 | 构建工具 |
| `typescript` | ^5.7.2 | 类型系统 |

### 5.3 版本要求
- Node.js >= 18
- 后端服务运行在端口 3001

---

## 6. 迭代指南

### 6.1 扩展点

#### 新增页面
1. 在 `src/screens/` 下创建新组件
2. 在 `App.tsx` 中添加新页面路由
3. 在 `context.tsx` 中添加新的 state 和 action（如需要）
4. 在导航组件中添加入口

#### 扩展状态
1. 在 `AppState` 接口中添加新字段
2. 在 `initialState` 中添加默认值
3. 添加新的 Action 类型
4. 在 reducer 中处理新 Action

#### 对接新 API
1. 在 `services/pipeline.ts` 的 `PipelineService` 接口中添加新方法
2. 实现该方法的类型转换逻辑
3. 添加后端 API 端点调用

### 6.2 常见修改场景

#### 修改类型转换逻辑
编辑 `services/pipeline.ts` 中的转换函数：
- `toFeatureView()` / `fromFeatureView()`
- `toCaseView()` / `fromCaseView()`
- `toExecView()` / `fromExecView()`
- `toDefectView()`
- `toModuleView()` / `fromModuleView()`

#### 调整 UI 交互
编辑 `screens/` 下的页面组件和 `components.tsx` 中的共享组件。

### 6.3 测试要点
- `context.test.ts`：状态管理单元测试
- `services/pipeline.test.ts`：类型转换函数测试
- E2E 测试：完整流水线冒烟测试

### 6.4 注意事项
- **类型一致性**：View 类型和 Contract 类型的转换必须双向一致
- **错误处理**：API 调用失败应有友好的错误提示
- **加载状态**：长时间操作应显示 loading 状态
- **数据校验**：用户输入应有前端校验
