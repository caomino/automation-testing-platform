# @test-platform/orchestrator

## 1. 模块概述

### 1.1 职责说明
orchestrator 是自动化测试平台的**系统级编排器**，核心职责：

1. **初始化基础设施**：Logger、Store、Engine Factory
2. **统一管理浏览器引擎实例**：创建和复用 McpEngine
3. **按顺序调度所有 Stage 模块**：Login → Explore → Feature → Case → Execute → Defect
4. **处理跨 Stage 数据流转**：Output → Input Mapping
5. **维护全局会话状态**：SessionHandle 在各阶段间传递

### 1.2 在整体架构中的位置
```
app (前端应用层)
    ↓ 调用
orchestrator (编排层)
    ↓ 调度
├── stage-login (登录阶段)
├── stage-explore (探索阶段)
├── stage-feature (功能点阶段)
├── stage-case (用例阶段)
├── stage-execute (执行阶段)
└── stage-defect (缺陷阶段)
    ↓ 依赖
contracts (契约层)
infra-logger (日志层)
infra-store (存储层)
engine-mcp (引擎层)
```

### 1.3 设计原则
- **单向数据流**：数据从 Login → Explore → Feature → Case → Execute → Defect 单向流动
- **解耦阶段**：各阶段通过 run(input): Promise<output> 接口通信
- **依赖注入**：通过 OrchestratorConfig 注入自定义实现
- **日志追踪**：每个阶段都有详细的日志记录

---

## 2. 核心逻辑

### 2.1 执行流程

#### 完整流水线执行
```
1. 初始化
   ├── 创建 Logger 实例
   ├── 创建 Store 实例
   ├── 配置 Engine Factory
   └── 创建项目（可选）

2. Login 阶段
   ├── 获取 LoginInput
   ├── 调用 stage-login.run(input)
   └── 捕获 LoginOutput.sessionHandle

3. Explore 阶段
   ├── 注入 sessionHandle 到 engine
   ├── 调用 stage-explore.run(input, engine)
   └── 捕获 ExploreOutput.moduleTree

4. Feature 阶段
   ├── 使用 moduleTree 构建 FeatureInput
   ├── 调用 stage-feature.run(input)
   └── 捕获 FeatureOutput.featureTable

5. Case 阶段
   ├── 使用 featureTable 构建 CaseInput
   ├── 调用 stage-case.run(input)
   └── 捕获 CaseOutput.caseWorkbook

6. Execute 阶段
   ├── 使用 caseWorkbook 构建 ExecuteInput
   ├── 调用 stage-execute.run(input)
   └── 捕获 ExecuteOutput.executionReport

7. Defect 阶段
   ├── 使用 executionReport 构建 DefectInput
   ├── 调用 stage-defect.run(input)
   └── 捕获 DefectOutput

8. 持久化结果
   ├── 保存功能点表
   ├── 保存用例表
   └── 保存执行报告
```

#### 单阶段执行
```
runStage(stageName, input)
├── login: stage-login.run(input)
├── explore: stage-explore.run(input, engine)
├── feature: stage-feature.run(input)
├── case: stage-case.run(input)
├── execute: stage-execute.run(input)
└── defect: stage-defect.run(input)
```

### 2.2 数据流转映射

```typescript
// LoginOutput → ExploreInput
ExploreInput = {
  sessionHandle: loginOutput.sessionHandle,
  subsystemId: input.explore?.subsystemId ?? input.login.systemId,
  // ...
}

// ExploreOutput → FeatureInput
FeatureInput = {
  moduleTree: exploreOutput.moduleTree,
  systemName: input.feature?.systemName ?? input.login.systemId,
  // ...
}

// FeatureOutput → CaseInput
CaseInput = {
  featureTable: featureOutput.featureTable,
  scope: input.case?.scope ?? 'all',
  // ...
}

// CaseOutput → ExecuteInput
ExecuteInput = {
  caseWorkbook: caseOutput.caseWorkbook,
  browserOSMatrix: input.execute?.browserOSMatrix ?? [defaultEnv],
  // ...
}

// ExecuteOutput → DefectInput
DefectInput = {
  executionReport: executeOutput.executionReport,
  // ...
}
```

### 2.3 状态管理
- **会话状态**：SessionHandle 在 Login 阶段生成，传递给后续所有阶段
- **项目状态**：Project 在编排开始时创建，用于绑定本次流水线
- **执行状态**：每个阶段的执行结果都记录在 PipelineResult 中

---

## 3. 接口文档

### 3.1 OrchestratorConfig（配置接口）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| loggerConfig | LoggerConfig | 否 | 日志配置（未提供时使用默认值） |
| engineConfig | EngineConfig | 否 | 引擎配置（未提供时使用 headless: true） |
| logger | Logger | 否 | 注入 Logger 实例（用于测试） |
| store | ProjectStore | 否 | 注入 Store 实例（用于测试） |
| engineFactory | (config: EngineConfig) => McpEngine | 否 | 注入引擎工厂函数 |

### 3.2 PipelineInput（流水线输入）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| login | LoginInput | 是 | 登录阶段输入 |
| explore | Partial<Omit<ExploreInput, 'sessionHandle'>> | 否 | 探索阶段输入（缺省自动生成） |
| feature | Partial<Omit<FeatureInput, 'moduleTree' \| 'systemName'>> & { systemName?: string } | 否 | 功能点阶段输入 |
| case | Partial<Omit<CaseInput, 'featureTable'>> | 否 | 用例阶段输入 |
| execute | Partial<Omit<ExecuteInput, 'caseWorkbook'>> & { browserOSMatrix?: BrowserOS[] } | 否 | 执行阶段输入 |
| defect | Partial<Omit<DefectInput, 'executionReport'>> | 否 | 缺陷阶段输入 |

### 3.3 PipelineResult（流水线输出）

| 字段 | 类型 | 说明 |
|------|------|------|
| project | Project \| null | 绑定的项目 |
| login | LoginOutput | 登录阶段结果 |
| explore | ExploreOutput | 探索阶段结果 |
| feature | FeatureOutput | 功能点阶段结果 |
| case | CaseOutput | 用例阶段结果 |
| execute | ExecuteOutput | 执行阶段结果 |
| defect | DefectOutput | 缺陷阶段结果 |
| session | SessionHandle | 会话句柄（供后续复用） |

### 3.4 PipelineOrchestrator 类方法

| 方法 | 签名 | 说明 |
|------|------|------|
| constructor | (config?: OrchestratorConfig) | 创建编排器实例 |
| createProject | (input: { name: string; description?: string; type?: SystemType }) => Promise<Project> | 创建项目 |
| run | (input: PipelineInput) => Promise<PipelineResult> | 运行整条流水线 |
| runStage | (stageName: string, input: Record<string, any>) => Promise<any> | 单阶段执行 |
| getLogger | () => Logger | 获取 Logger 实例 |
| getStore | () => ProjectStore | 获取 Store 实例 |

### 3.5 使用示例

```typescript
import { PipelineOrchestrator } from '@test-platform/orchestrator';

// 创建编排器
const orchestrator = new PipelineOrchestrator({
  engineConfig: { headless: true },
});

// 创建项目
const project = await orchestrator.createProject({
  name: '测试项目',
  description: '区域影像系统测试',
  type: 'portal',
});

// 运行完整流水线
const result = await orchestrator.run({
  login: {
    systemUrl: 'https://portal.example.com',
    mode: 'credential',
    credentialRef: 'cred_admin',
    systemId: 'sys_portal',
  },
  explore: {
    subsystemId: 'sys_portal',
  },
  feature: {
    systemName: '区域影像系统',
  },
  case: {
    scope: 'all',
  },
  execute: {
    scope: 'all',
    browserOSMatrix: [{ os: 'Windows', browser: 'Chrome', version: '120' }],
  },
});

// 获取结果
console.log('功能点数:', result.feature.featureTable.flat().length);
console.log('用例数:', result.case.caseWorkbook.flatMap(s => s.rows).length);
console.log('执行结果:', result.execute.executionReport);
console.log('缺陷数:', result.defect.defectTable.flat().length);

// 单阶段执行
const loginResult = await orchestrator.runStage('login', {
  systemUrl: 'https://oa.example.com',
  mode: 'no-login',
  systemId: 'sys_oa',
});
```

---

## 4. 数据流转

### 4.1 完整数据流图
```
                    ┌─────────────────┐
                    │  PipelineInput  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  stage-login    │
                    │  LoginInput     │
                    └────────┬────────┘
                             │ LoginOutput
                    ┌────────▼────────┐
                    │  stage-explore  │
                    │  ExploreInput   │◄─ sessionHandle
                    └────────┬────────┘
                             │ ExploreOutput
                    ┌────────▼────────┐
                    │  stage-feature  │
                    │  FeatureInput   │◄─ moduleTree
                    └────────┬────────┘
                             │ FeatureOutput
                    ┌────────▼────────┐
                    │  stage-case     │
                    │  CaseInput      │◄─ featureTable
                    └────────┬────────┘
                             │ CaseOutput
                    ┌────────▼────────┐
                    │  stage-execute  │
                    │  ExecuteInput   │◄─ caseWorkbook
                    └────────┬────────┘
                             │ ExecuteOutput
                    ┌────────▼────────┐
                    │  stage-defect   │
                    │  DefectInput    │◄─ executionReport
                    └────────┬────────┘
                             │ DefectOutput
                    ┌────────▼────────┐
                    │ PipelineResult  │
                    └─────────────────┘
```

### 4.2 数据格式转换
每个阶段的 Output 自动映射为下一阶段的 Input：

| 阶段 | Output 字段 | 下一阶段 Input 字段 |
|------|-------------|---------------------|
| Login | sessionHandle | Explore.sessionHandle |
| Explore | moduleTree | Feature.moduleTree |
| Feature | featureTable | Case.featureTable |
| Case | caseWorkbook | Execute.caseWorkbook |
| Execute | executionReport | Defect.executionReport |

---

## 5. 依赖关系

### 5.1 内部依赖
| 依赖 | 用途 |
|------|------|
| `@test-platform/contracts` | 提供所有类型定义和 Schema |
| `@test-platform/infra-logger` | 日志记录 |
| `@test-platform/infra-store` | 数据持久化 |
| `@test-platform/engine-mcp` | 浏览器引擎 |
| `@test-platform/stage-login` | 登录阶段 |
| `@test-platform/stage-explore` | 探索阶段 |
| `@test-platform/stage-feature` | 功能点阶段 |
| `@test-platform/stage-case` | 用例阶段 |
| `@test-platform/stage-execute` | 执行阶段 |
| `@test-platform/stage-defect` | 缺陷阶段 |

### 5.2 外部依赖
| 依赖 | 版本 | 用途 |
|------|------|------|
| `typescript` | ^5.7.2 | 编译 |
| `vitest` | ^2.1.8 | 测试框架 |

### 5.3 版本要求
- Node.js >= 18
- 需要 pnpm workspaces 环境

---

## 6. 迭代指南

### 6.1 扩展点

#### 新增阶段
1. 在 `packages/` 下创建新的 stage 包
2. 实现 `run(input): Promise<output>` 接口
3. 在 orchestrator 的 `run()` 方法中添加调度
4. 更新 PipelineInput/PipelineResult 类型

#### 修改阶段顺序
在 `run()` 方法中调整各阶段的调用顺序即可。

#### 注入自定义实现
通过 `OrchestratorConfig` 注入自定义的 Logger、Store 或 Engine Factory：

```typescript
const orchestrator = new PipelineOrchestrator({
  logger: customLogger,
  store: customStore,
  engineFactory: (config) => customEngine,
});
```

### 6.2 常见修改场景

#### 添加阶段间转换逻辑
在 `run()` 方法中，阶段调用之间添加转换逻辑：

```typescript
// 示例：在 Login 和 Explore 之间添加转换
const loginOutput = await loginStage.run(input.login);
const transformed = transformLoginOutput(loginOutput);  // 新增转换
const exploreOutput = await stageExplore.run(transformed, engine);
```

#### 添加并行执行
对于可以并行的阶段（如不同子系统的探索），可以使用 `Promise.all`：

```typescript
// 并行探索多个子系统
const exploreResults = await Promise.all(
  subsystems.map(sub => stageExplore.run({
    ...baseInput,
    subsystemId: sub.id,
  }))
);
```

### 6.3 测试要点
- `PipelineOrchestrator.run()` 完整流程测试
- `PipelineOrchestrator.runStage()` 单阶段测试
- 依赖注入测试（注入 Mock 的 Logger、Store、Engine）
- 数据流转映射正确性测试

### 6.4 注意事项
- **错误处理**：任何阶段失败都会中断流水线，应实现重试或降级策略
- **资源清理**：引擎实例需要在使用后正确关闭
- **日志完整性**：每个关键步骤都应有日志记录
- **数据一致性**：持久化操作应在流水线成功完成后执行
