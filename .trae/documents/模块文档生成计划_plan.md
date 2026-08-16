# 模块文档生成计划

## 一、需求分析

### 用户需求
- 查看项目所有内容
- 每个模块下面都有一个把**项目逻辑、结果、入参出参**说清楚的文档
- 能够支撑按照模块进行迭代

### 现状分析
当前项目包含 14 个模块，大部分已有 README 文件，但内容不够详细：
- 缺少完整的入参/出参字段说明
- 缺少模块间数据流关系图
- 缺少迭代开发的具体指引
- 缺少关键逻辑的详细描述

### 目标
为每个模块生成一份完整的模块文档，包含：
1. **模块概述** - 职责说明、在整体架构中的位置
2. **核心逻辑** - 详细的执行流程、关键算法说明
3. **接口文档** - 完整的入参（Input）和出参（Output）字段定义
4. **数据流转** - 上下游模块的数据流关系
5. **依赖关系** - 依赖的其他模块和外部库
6. **迭代指南** - 如何基于现有模块进行扩展和迭代

---

## 二、模块清单与文档模板

### 2.1 完整模块清单

| 模块 | 路径 | 类别 | 现有 README |
|------|------|------|-------------|
| contracts | packages/contracts | 契约层 | 无 |
| engine-mcp | packages/engine-mcp | 引擎层 | 有（较完整） |
| orchestrator | packages/orchestrator | 编排层 | 无 |
| infra-ai | packages/infra-ai | 基础设施层 | 有（较完整） |
| infra-cred | packages/infra-cred | 基础设施层 | 有（较完整） |
| infra-logger | packages/infra-logger | 基础设施层 | 有（较完整） |
| infra-store | packages/infra-store | 基础设施层 | 有（较完整） |
| stage-login | packages/stage-login | 阶段层 | 有（较完整） |
| stage-explore | packages/stage-explore | 阶段层 | 有（较完整） |
| stage-feature | packages/stage-feature | 阶段层 | 有（较完整） |
| stage-case | packages/stage-case | 阶段层 | 有（较完整） |
| stage-execute | packages/stage-execute | 阶段层 | 有（较完整） |
| stage-defect | packages/stage-defect | 阶段层 | 有（较完整） |
| app | packages/app | 应用层 | 无 |

### 2.2 文档模板

每个模块文档将遵循以下结构：

```markdown
# @test-platform/{module-name}

## 1. 模块概述
- 职责说明
- 在整体架构中的位置
- 设计原则

## 2. 核心逻辑
### 2.1 执行流程
### 2.2 关键算法/机制
### 2.3 状态流转（如适用）

## 3. 接口文档
### 3.1 输入参数（Input）
| 字段 | 类型 | 必填 | 说明 |
### 3.2 输出结果（Output）
| 字段 | 类型 | 说明 |
### 3.3 核心方法

## 4. 数据流转
### 4.1 上游输入来源
### 4.2 下游输出去向
### 4.3 数据格式转换

## 5. 依赖关系
### 5.1 内部依赖
### 5.2 外部依赖
### 5.3 版本要求

## 6. 迭代指南
### 6.1 扩展点
### 6.2 常见修改场景
### 6.3 测试要点
### 6.4 注意事项
```

---

## 三、各模块文档详细内容

### 3.1 contracts 模块（契约层）

**路径**: `packages/contracts`
**状态**: 无现有 README，需创建

#### 模块概述
- 职责：定义全局类型、接口契约、Zod 校验 Schema，是所有模块的基础
- 设计原则：冻结接口（Frozen v1.0）、Contract-first、单向数据流

#### 核心逻辑
- 导出所有阶段的 Input/Output 类型
- 提供 Zod Schema 用于运行时校验
- 提供 Mock 数据供开发测试

#### 接口文档
- **类型导出**：ModuleNode, FeatureRow, CaseRow, CaseSheet, SystemConfig 等
- **阶段契约**：LoginContract, ExploreContract, FeatureContract, CaseContract, ExecuteContract, DefectContract
- **Schema 导出**：各阶段的输入/输出校验 Schema
- **工具函数**：validateLoginInput/Output, validateExploreInput/Output 等

#### 数据流转
- 为所有模块提供类型定义
- 作为模块间通信的唯一契约来源

#### 依赖关系
- 外部依赖：zod ^3.23.8
- 内部依赖：无（最底层模块）

#### 迭代指南
- 接口冻结，仅允许加可选字段
- 修改需同步更新所有消费方

---

### 3.2 engine-mcp 模块（引擎层）

**路径**: `packages/engine-mcp`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：封装浏览器控制、DOM 语义抽象、会话复用
- 核心接口：McpEngine, SessionCapableEngine
- 实现类：McpPlaywrightAdapter（默认）、PlaywrightEngine（fallback）

#### 核心逻辑
- 浏览器生命周期管理（launch/close）
- DOM 语义抽象（extractSemanticDom/exploreModules）
- 会话捕获与注入（getSessionCookies/Headers/Tokens/applySession）
- 只读探索模式（readOnly 配置）

#### 接口文档
- **生命周期方法**：launch(), close()
- **导航与 DOM**：navigate(url), extractSemanticDom(rootSelector?), exploreModules()
- **命令执行**：runStep(cmd), runCase(row), screenshot(path)
- **会话复用**：getSessionCookies(), getSessionHeaders(), getSessionTokens(), applySession(state)

#### 数据流转
- 输入：BrowserCommand, CaseRow
- 输出：SemanticNode[], ModuleNode[], ScreenshotRef, SessionHandle

#### 依赖关系
- 内部依赖：contracts（ModuleNode, CaseRow, ExecutionStepResult, ScreenshotRef）
- 外部依赖：@playwright/mcp, playwright ^1.49.0

#### 迭代指南
- 新增浏览器类型：实现 McpEngine 接口
- 扩展 DOM 语义：修改 DOM_WALK 脚本
- 新增会话字段：修改 SessionState 类型

---

### 3.3 orchestrator 模块（编排层）

**路径**: `packages/orchestrator`
**状态**: 无现有 README，需创建

#### 模块概述
- 职责：统一管理浏览器引擎实例，按顺序调度所有 Stage 模块
- 数据流：Login → Explore → Feature → Case → Execute → Defect

#### 核心逻辑
- 初始化基础设施（Logger, Store, Engine Factory）
- 按 Pipeline 顺序调度各阶段
- 处理跨 Stage 数据流转（Output → Input Mapping）
- 维护全局会话状态

#### 接口文档
- **OrchestratorConfig**: loggerConfig, engineConfig, logger, store, engineFactory
- **PipelineInput**: login, explore?, feature?, case?, execute?, defect?
- **PipelineResult**: project, login, explore, feature, case, execute, defect, session
- **核心方法**: run(input), runStage(stageName, input), createProject(input)

#### 数据流转
```
LoginOutput.sessionHandle → ExploreInput.sessionHandle
ExploreOutput.moduleTree  → FeatureInput.moduleTree
FeatureOutput.featureTable → CaseInput.featureTable
CaseOutput.caseWorkbook   → ExecuteInput.caseWorkbook
ExecuteOutput.executionReport → DefectInput.executionReport
```

#### 依赖关系
- 内部依赖：contracts, infra-logger, infra-store, engine-mcp, stage-*（6个阶段包）

#### 迭代指南
- 新增阶段：实现 stage 接口，在 run() 中添加调度
- 修改阶段顺序：调整 run() 中的调用顺序
- 注入依赖：通过 OrchestratorConfig 注入自定义实现

---

### 3.4 infra-ai 模块（AI 配置层）

**路径**: `packages/infra-ai`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：AI 模型配置的抽象与多厂商支持
- 核心设计：配置与代码分离、多厂商中立、可插拔提供者

#### 核心逻辑
- AIClient 接口（complete 方法）
- AIProviderConfig 配置管理
- 提供者的注册/切换/查询

#### 接口文档
- **AIClient**: complete(req: AIRequest) → Promise<AIResponse>
- **AIRequest**: prompt, system?, temperature?
- **AIResponse**: text, usage?
- **提供者管理**: addProvider, getProvider, setDefault, getDefault, listProviders

#### 数据流转
- 输入：AIRequest（prompt, system, temperature）
- 输出：AIResponse（text, usage）

#### 依赖关系
- 外部依赖：zod（可选），标准 fetch API

#### 迭代指南
- 新增 AI 厂商：在 AIVendor 联合类型中添加，实现对应 API 适配
- 扩展配置项：在 AIProviderConfig 中添加可选字段
- 更换默认模型：修改 createAIClient 工厂函数

---

### 3.5 infra-cred 模块（凭证层）

**路径**: `packages/infra-cred`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：凭证的加密存储与检索
- 加密算法：AES-256-GCM
- 设计原则：绝不明文落盘、篡改检测、加密隔离

#### 核心逻辑
- 凭证加密存储（scrypt 密钥派生 + AES-256-GCM 加密）
- 凭证检索与解密
- safeStorage 切换点（Web → Electron）

#### 接口文档
- **CredentialStore**: save(username, password) → ref, get(ref) → { username, password } | null, delete(ref), list() → CredentialRecord[]
- **CredentialRecord**: id, username, secretRef, createdAt
- **CredConfig**: dir, masterKey

#### 数据流转
- 输入：username, password（明文）
- 输出：credentialRef, CredentialRecord[]

#### 依赖关系
- 外部依赖：node:crypto, node:fs/path

#### 迭代指南
- 切换到 Electron safeStorage：实现 SafeStorageCredProvider
- 新增加密算法：在 encrypt/decrypt 函数中添加算法分支
- 迁移策略：提供一次性迁移脚本

---

### 3.6 infra-logger 模块（日志层）

**路径**: `packages/infra-logger`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：业务/运行日志的外部化存储
- 日志格式：JSON-lines（一行一条 JSON）
- 核心能力：按级别/范围/时间过滤、文件滚动、过期清理

#### 核心逻辑
- 日志写入（info/warn/error）
- 日志查询（query 按 filter 过滤）
- 文件滚动（超限时自动轮转）
- 过期清理（按 retentionDays）

#### 接口文档
- **Logger**: info(scope, message, meta?), warn(scope, message, meta?), error(scope, message, meta?), query(filter?) → LogEntry[], flush(), cleanup() → number
- **LoggerConfig**: dir, retentionDays, maxFileSize?
- **QueryFilter**: scope?, level?, since?

#### 数据流转
- 输入：LogEntry（ts, level, scope, message, meta?）
- 输出：LogEntry[], 删除文件数

#### 依赖关系
- 外部依赖：node:fs/path

#### 迭代指南
- 扩展日志级别：在 LogLevel 类型中添加
- 新增过滤维度：扩展 QueryFilter 接口
- 更换存储后端：实现新的日志存储 Provider

---

### 3.7 infra-store 模块（持久化层）

**路径**: `packages/infra-store`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：业务数据外部化落库
- 当前实现：内存存储（InMemoryProjectStore）
- 后续实现：SQLite / 文件存储 / 远程数据库

#### 核心逻辑
- 项目 CRUD（createProject/listProjects/getProject/updateProject/deleteProject）
- 功能点表、用例表、执行报告的存取
- 激活系统管理（setActiveSystem）

#### 接口文档
- **ProjectStore**（12 个方法，冻结 v1.0）：
  - createProject(input), listProjects(), getProject(id), updateProject(id, patch), deleteProject(id)
  - setActiveSystem(projectId, systemId)
  - saveFeatureTable(systemId, table), saveCaseTable(systemId, sheets), saveExecution(systemId, report)
  - getFeatureTable(systemId), getCaseTable(systemId), getExecution(systemId)

#### 数据流转
- 输入：NewProjectInput, FeatureRow[][], CaseSheet[], ExecutionResult[]
- 输出：Project, ProjectSummary[], FeatureRow[][], CaseSheet[], ExecutionResult[]

#### 依赖关系
- 内部依赖：contracts
- 外部依赖：node:crypto

#### 迭代指南
- 切换到 SQLite：实现 SqliteProjectStore，在 createStore() 中切换
- 新增存储方法：需更新冻结接口文档
- 迁移数据：提供从内存到 SQLite 的迁移脚本

---

### 3.8 stage-login 模块（登录阶段）

**路径**: `packages/stage-login`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：测试平台五阶段流水线的第一阶段
- 三种登录模式：no-login / credential / manual-takeover
- 核心输出：SessionHandle（跨阶段会话复用）

#### 核心逻辑
- no-login 模式：直接返回 ok 会话
- credential 模式：取凭证 → 启动浏览器 → 导航 → 填账号密码 → 点击登录 → 捕获会话
- manual-takeover 模式：启动可见浏览器 → 导航 → 等待人工操作 → 轮询检测登录成功

#### 接口文档
- **LoginInput**: systemUrl, mode('no-login'|'credential'|'manual-takeover'), credentialRef?, parentPortalUrl?
- **LoginOutput**: success, sessionHandle, loginUrl
- **SessionHandle**: sessionId, systemId, loginStatus, cookies, headers, tokens, expiresAt
- **核心方法**: run(input), createLoginStage(deps), reuseSession(handle, targetSystemId, engine)

#### 数据流转
- 输入：LoginInput（含凭证引用）
- 输出：LoginOutput（含 SessionHandle）
- 下游消费：SessionHandle 传递给 stage-explore

#### 依赖关系
- 内部依赖：contracts, engine-mcp, infra-cred

#### 迭代指南
- 新增登录模式：在 LoginMode 联合类型中添加，实现对应 runXxx 函数
- 扩展会话字段：在 SessionHandle 中添加可选字段
- 支持更多认证方式：扩展 detectLoginState 函数的检测规则

---

### 3.9 stage-explore 模块（探索阶段）

**路径**: `packages/stage-explore`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：测试平台五阶段流水线的第二阶段
- 核心能力：模块树遍历、人工补充合并、覆盖率计算、断点续跑

#### 核心逻辑
- 会话注入：将 LoginOutput.sessionHandle 注入引擎上下文
- 模块树遍历：调用 engine.exploreModules() 获取初始模块树
- 断点续跑：合并已保存断点的已探索节点
- 人工补充：合并 ManualSupplement 到模块树
- 覆盖率计算：统计 visited/total/frontier

#### 接口文档
- **ExploreInput**: systemUrl, subsystemId, sessionHandle, resumeFrom?, manualSupplement?
- **ExploreOutput**: moduleTree, coverage, needsReview, checkpoint
- **核心方法**: run(input, engine?), mergeManualSupplement(tree, supplement, subsystemId), computeCoverage(tree), buildCheckpoint(tree, frontier)

#### 数据流转
- 输入：ExploreInput（含 SessionHandle）
- 输出：ExploreOutput（含 ModuleNode[]）
- 下游消费：moduleTree 传递给 stage-feature

#### 依赖关系
- 内部依赖：contracts, engine-mcp

#### 迭代指南
- 扩展遍历深度：修改 engine.exploreModules() 的深度限制
- 新增节点类型：在 ModuleNode 类型中添加 type 枚举值
- 支持批量补充：扩展 ManualSupplement 接口支持多条 clickPath

---

### 3.10 stage-feature 模块（功能点阶段）

**路径**: `packages/stage-feature`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：测试平台五阶段流水线的第三阶段
- 核心能力：基于模块树生成九列功能点表、测试点标识生成、人工补充追踪

#### 核心逻辑
- 功能点表构建：buildFeatureTable() 从 ModuleNode[] 生成 FeatureRow[][]
- 测试点标识生成：按规则生成 testPointId（base_NN 格式）
- 溯源追踪：通过 provenance 追踪每个功能点的来源
- 过滤：confirmedOnly 参数控制是否仅返回已确认功能点

#### 接口文档
- **FeatureInput**: moduleTree, systemName, confirmedOnly?
- **FeatureOutput**: featureTable, featureIds, provenance
- **核心方法**: run(input), buildFeatureTable(tree, systemName, confirmedOnly), deriveProvenance(nodeId)

#### 数据流转
- 输入：FeatureInput（含 ModuleNode[]）
- 输出：FeatureOutput（含 FeatureRow[][]）
- 下游消费：featureTable 传递给 stage-case

#### 依赖关系
- 内部依赖：contracts

#### 迭代指南
- 扩展功能点表列：修改 FeatureRow 接口和 DEFAULT_FEATURE_COLUMNS
- 新增标识规则：修改 testPointId 生成逻辑
- 支持更多溯源类型：在 FeatureProvenance 中添加新的 source 枚举值

---

### 3.11 stage-case 模块（用例阶段）

**路径**: `packages/stage-case`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：测试平台五阶段流水线的第四阶段
- 核心能力：八列用例表生成、复杂逻辑检测、多 Sheet 输出

#### 核心逻辑
- 用例生成：每个功能点生成 3 条场景用例（normal/boundary/exception）
- 复杂逻辑检测：功能点≥5 或跨 3+ 子系统时标记
- 范围过滤：scope='all'|'selected_modules'
- 多 Sheet 输出：一子系统一 sheet

#### 接口文档
- **CaseInput**: featureTable, scope, selectedModuleIds?, metaConfig, aiConfig?
- **CaseOutput**: caseWorkbook, caseRows, metaHeader, qualityGateIssues, complexLogicDetected
- **核心方法**: run(input), detectComplexLogic(featureTable), generateCaseRowsForFeature(row, precondition)

#### 数据流转
- 输入：CaseInput（含 FeatureRow[][]）
- 输出：CaseOutput（含 CaseSheet[]）
- 下游消费：caseWorkbook 传递给 stage-execute

#### 依赖关系
- 内部依赖：contracts, infra-ai（可选）

#### 迭代指南
- 新增场景类型：在 ScenarioKey 中添加，实现对应模板
- 扩展用例列：修改 CaseRow 接口和 CASE_COLUMN_WIDTHS
- 接入 AI 辅助：实现 aiConfig 分支的生成逻辑
- 调整复杂逻辑阈值：修改 detectComplexLogic 中的判断条件

---

### 3.12 stage-execute 模块（执行阶段）

**路径**: `packages/stage-execute`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：测试平台五阶段流水线的第五阶段
- 核心能力：用例逐步骤执行、浏览器×OS 矩阵、数据隔离验证

#### 核心逻辑
- 范围过滤：filterByScope() 按 scope 过滤用例
- 矩阵执行：browserOSMatrix × 用例 笛卡尔积执行
- 步骤聚合：全 passed→passed，含 failed→failed
- 数据隔离：执行前后快照比对，验证数据隔离红线

#### 接口文档
- **ExecuteInput**: caseWorkbook, scope, selectedModuleIds?, browserOSMatrix
- **ExecuteOutput**: executionReport, dataSnapshotBefore, dataSnapshotAfter, isolationVerified
- **核心方法**: run(input, deps?), executeCaseInEnv(row, env, engine), computeIsolationVerified(before, after, ownerTaskId)

#### 数据流转
- 输入：ExecuteInput（含 CaseSheet[]）
- 输出：ExecuteOutput（含 ExecutionResult[]）
- 下游消费：executionReport 传递给 stage-defect

#### 依赖关系
- 内部依赖：contracts

#### 迭代指南
- 新增浏览器/OS：在 BrowserOS 联合类型中添加
- 扩展快照机制：实现新的 SnapshotProvider
- 调整超时配置：修改 DEFAULT_CASE_TIMEOUT_MS
- 支持并行执行：扩展 run() 支持并发执行

---

### 3.13 stage-defect 模块（缺陷阶段）

**路径**: `packages/stage-defect`
**状态**: 有现有 README（较完整），需补充迭代指南

#### 模块概述
- 职责：测试平台五阶段流水线的第六阶段
- 核心能力：缺陷派生、环境归一化、缺陷分级

#### 核心逻辑
- 缺陷派生：仅 status='failed' 的用例计入缺陷
- 模块分组：按 deriveModule(caseNo) 分组
- 环境归一化：normalizeEnv() 将浏览器/OS 归一化为标准化格式
- 缺陷分级：deriveLevel() 根据失败描述推断严重程度

#### 接口文档
- **DefectInput**: executionResults, caseRows, environment
- **DefectOutput**: defects, summary
- **核心方法**: run(input), createDefect(params), deriveModule(caseNo), deriveLevel(description), normalizeEnv(env)

#### 数据流转
- 输入：DefectInput（含 ExecutionResult[]）
- 输出：DefectOutput（含 DefectRow[]）
- 消费方：前端展示、导出 Excel

#### 依赖关系
- 内部依赖：contracts

#### 迭代指南
- 新增缺陷级别：在 DefectLevel 联合类型中添加
- 扩展环境信息：在 Environment 接口中添加字段
- 调整分级规则：修改 deriveLevel() 的判断条件

---

### 3.14 app 模块（应用层）

**路径**: `packages/app`
**状态**: 无现有 README，需创建

#### 模块概述
- 职责：前端应用层，仅编排不实现业务逻辑
- 技术栈：React + TypeScript + Vite
- 核心页面：工作台、项目管理、探索、功能点、用例、执行、缺陷、AI 配置、日志、知识库

#### 核心逻辑
- 状态管理：context.tsx 提供全局状态（projects, systems, features, cases 等）
- 屏幕导航：screen 状态控制当前显示的页面
- 数据 API：dataApi.ts 封装与后端的 HTTP 通信
- 流水线调度：pipeline.ts 协调各阶段的执行

#### 接口文档
- **Context 状态**：projects, currentProject, systems, features, cases, executions, defects, aiConfig, logs 等
- **Actions**: setScreen, addProject, updateProject, deleteProject, runPipeline 等
- **数据 API**: fetchProjects, createProject, saveFeatureTable, saveCaseTable 等

#### 数据流转
- 输入：用户操作、后端 API 响应
- 输出：UI 展示、API 请求
- 上游：与 orchestrator 通信
- 下游：无（最上层）

#### 依赖关系
- 内部依赖：contracts, engine-mcp, orchestrator, stage-*, infra-*
- 外部依赖：React ^18.3.0, Vite ^5.4.0

#### 迭代指南
- 新增页面：在 screens/ 下创建新组件，添加到 App.tsx
- 扩展状态：在 context.tsx 中添加新的 state 和 actions
- 对接新 API：在 dataApi.ts 中添加新的 API 调用

---

## 四、实施步骤

### 步骤 1：补充现有 README（6 个模块）
更新以下模块的 README，补充迭代指南和更详细的接口文档：
1. engine-mcp
2. infra-ai
3. infra-cred
4. infra-logger
5. infra-store
6. stage-login
7. stage-explore
8. stage-feature
9. stage-case
10. stage-execute
11. stage-defect

### 步骤 2：创建缺失 README（3 个模块）
为以下模块创建完整的 README：
1. contracts
2. orchestrator
3. app

### 步骤 3：验证与完善
- 检查所有文档的格式一致性
- 确保接口文档与代码实现一致
- 验证模块间数据流描述的正确性

---

## 五、风险与注意事项

### 风险点
1. 接口文档可能与实际实现有差异，需仔细核对代码
2. contracts 包已冻结，接口定义不可修改
3. 部分模块依赖外部服务，文档中需说明

### 注意事项
1. 严格按照模板格式编写
2. 使用中文编写文档
3. 代码示例需要可运行
4. 数据流转图使用文字描述即可

---

## 六、输出物

完成后，每个模块目录下都有一份完整的 README.md，包含：
- 模块概述
- 核心逻辑
- 接口文档（入参出参表格）
- 数据流转关系
- 依赖关系
- 迭代指南

这些文档将作为模块迭代开发的参考手册。
