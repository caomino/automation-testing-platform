# @test-platform/contracts

## 1. 模块概述

### 1.1 职责说明
contracts 是自动化测试平台的**契约层**，负责定义全局类型、接口契约和 Zod 校验 Schema。它是所有模块的基础，为模块间通信提供统一的类型约束和运行时校验能力。

### 1.2 在整体架构中的位置
```
contracts (最底层，所有模块依赖它)
├── infra-logger
├── infra-ai
├── infra-cred
├── infra-store
├── engine-mcp
├── stage-login
├── stage-explore
├── stage-feature
├── stage-case
├── stage-execute
├── stage-defect
└── app (最上层)
```

### 1.3 设计原则
- **冻结接口（Frozen v1.0）**：接口一旦合并，只允许加可选字段，不允许删/改类型
- **Contract-first**：先定接口（Zod Schema），后写实现
- **单向数据流**：数据从 stage A → stage B 单向流动
- **只通过 contracts 传值**：模块间不直接 import 对方的内部实现

---

## 2. 核心逻辑

### 2.1 模块结构
```
contracts/
├── src/
│   ├── types/           # 基础类型定义
│   │   ├── SystemConfig.ts    # 系统配置、会话句柄
│   │   ├── ModuleNode.ts      # 模块节点
│   │   ├── FeatureRow.ts      # 功能点行（9列）
│   │   ├── CaseRow.ts         # 用例行（8列）
│   │   ├── CaseSheet.ts       # 用例工作簿
│   │   ├── ManualSupplement.ts # 人工补充
│   │   └── shared.ts          # 共享类型（BrowserOS, ExecutionResult 等）
│   ├── stages/          # 阶段契约定义
│   │   ├── LoginContract.ts
│   │   ├── ExploreContract.ts
│   │   ├── FeatureContract.ts
│   │   ├── CaseContract.ts
│   │   ├── ExecuteContract.ts
│   │   └── DefectContract.ts
│   ├── schemas/         # Zod Schema 定义（运行时校验）
│   │   ├── LoginSchema.ts
│   │   ├── ExploreSchema.ts
│   │   ├── FeatureSchema.ts
│   │   ├── CaseSchema.ts
│   │   ├── ExecuteSchema.ts
│   │   └── DefectSchema.ts
│   ├── constants/       # 常量定义
│   │   └── ErrorCodes.ts
│   ├── mock/            # Mock 数据
│   │   └── index.ts
│   └── index.ts         # 统一导出
└── package.json
```

### 2.2 核心功能
1. **类型导出**：提供所有模块需要的基础类型
2. **Schema 校验**：提供各阶段 Input/Output 的 Zod Schema
3. **校验工具函数**：`validateXxxInput/Output` 函数用于运行时校验
4. **Mock 数据**：提供各阶段的 Mock 输入输出数据

---

## 3. 接口文档

### 3.1 基础类型

#### SystemConfig 类型
| 类型 | 说明 |
|------|------|
| `SystemType` | `'portal' \| 'standalone' \| 'subsystem'` |
| `CredentialMode` | `'no-login' \| 'credential' \| 'manual-takeover'` |
| `SessionHandle` | 会话句柄，含 sessionId、systemId、loginStatus、cookies、headers、tokens、expiresAt |
| `SubsystemConfig` | 子系统配置 |

#### ModuleNode 类型
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 节点唯一 ID |
| label | string | 节点标签 |
| parentId | string \| null | 父节点 ID |
| subsystemId | string | 所属子系统 ID |
| type | ModuleNodeType | 节点类型（page/action/form/module/container） |
| status | NodeStatus | 节点状态（covered/needs_review/unexplored） |
| children | ModuleNode[] | 子节点 |
| depth | number | 深度 |
| manuallyAdded | boolean | 是否人工添加 |

#### FeatureRow 类型（9列）
| 列索引 | 字段名 | 说明 |
|--------|--------|------|
| 0 | 序号 | 行内序号 |
| 1 | 测试类型 | 默认"功能性测试" |
| 2 | 需求章节 | X.Y.Z 格式 |
| 3 | 系统名称 | 被测系统名称 |
| 4 | 主模块 | 父模块标签 |
| 5 | 子模块 | 子系统标签 |
| 6 | 功能点 | 组合名称 |
| 7 | 测试点 | 节点标签 |
| 8 | 测试点标识 | 唯一 ID（base_NN 格式） |

#### CaseRow 类型（8列）
| 字段 | 类型 | 说明 |
|------|------|------|
| caseNo | string | 用例编号（testPointId_NN） |
| content | string | 测试内容 |
| step | string | 步骤 |
| operation | string | 操作说明 |
| expected | string | 预期结果 |
| firstResult | string | 首次测试结果 |
| regressionResult | string | 回归测试结果 |
| conclusion | string | 结论 |

#### CaseSheet 类型
| 字段 | 类型 | 说明 |
|------|------|------|
| sheetName | string | Sheet 名称（子系统名） |
| meta | MetaHeader | Meta 头信息 |
| rows | CaseRow[] | 用例行列表 |
| colWidths | number[] | 列宽配置 |

#### Shared 类型
| 类型 | 说明 |
|------|------|
| `BrowserOS` | 浏览器×OS 环境（browser, os, version?） |
| `DataSnapshot` | 数据快照（capturedAt, rowHashes, ownerTaskId） |
| `ExecutionResult` | 执行结果（caseNo, status, steps, defectRef?） |
| `ExecutionStepResult` | 单步执行结果（step, operation, expected, actual, result） |
| `DefectRow` | 缺陷行（sequence, description, screenshotRef?, level, qualityAttribute, environment） |
| `ScreenshotRef` | 截图引用（id, fileName, caseNo?, path） |
| `QualityGateIssue` | 质量门问题（caseRowId, type, message, blocking） |
| `AIConfigRef` | AI 配置引用（configId, enabled） |
| `McpExplorationCheckpoint` | 探索断点（checkpointId, visitedNodeIds, frontier, savedAt） |

### 3.2 阶段契约

#### LoginContract - 登录阶段
**输入 LoginInput**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| systemUrl | string | 是 | 系统 URL |
| mode | 'no-login' \| 'credential' \| 'manual-takeover' | 是 | 登录方式 |
| credentialRef | string | 条件必填（mode≠no-login） | 凭证引用 ID |
| parentPortalUrl | string | 否 | 父门户 URL（子系统类型时使用） |
| engineConfig | EngineConfig | 否 | 引擎配置 |

**输出 LoginOutput**：
| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 登录是否成功 |
| sessionHandle | SessionHandle | 会话句柄 |
| loginUrl | string | 登录 URL |

#### ExploreContract - 探索阶段
**输入 ExploreInput**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| systemUrl | string | 是 | 系统 URL |
| subsystemId | string | 是 | 子系统 ID |
| sessionHandle | SessionHandle | 是 | 会话句柄 |
| resumeFrom | string | 否 | 断点续跑 ID |
| manualSupplement | ManualSupplement | 否 | 人工补充数据 |

**输出 ExploreOutput**：
| 字段 | 类型 | 说明 |
|------|------|------|
| moduleTree | ModuleNode[] | 模块树 |
| coverage | CoverageInfo | 覆盖率（visited/total/frontier） |
| needsReview | string[] | 待审查节点 ID 列表 |
| checkpoint | McpExplorationCheckpoint | 断点信息 |

#### FeatureContract - 功能点阶段
**输入 FeatureInput**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| moduleTree | ModuleNode[] | 是 | 模块树 |
| systemName | string | 是 | 系统名称 |
| confirmedOnly | boolean | 否 | 仅返回已确认功能点 |

**输出 FeatureOutput**：
| 字段 | 类型 | 说明 |
|------|------|------|
| featureTable | FeatureRow[][] | 功能点表（按模块分组） |
| featureIds | string[] | 测试点标识列表 |
| provenance | FeatureProvenance[] | 溯源元数据 |

#### CaseContract - 用例阶段
**输入 CaseInput**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| featureTable | FeatureRow[][] | 是 | 功能点表 |
| scope | 'selected_modules' \| 'all' | 是 | 生成范围 |
| selectedModuleIds | string[] | 条件必填（scope=selected_modules） | 选中模块 ID |
| metaConfig | MetaHeader | 是 | Meta 头配置 |
| aiConfig | AIConfigRef | 否 | AI 配置引用 |

**输出 CaseOutput**：
| 字段 | 类型 | 说明 |
|------|------|------|
| caseWorkbook | CaseSheet[] | 用例工作簿 |
| caseRows | CaseRow[][] | 用例数据 |
| metaHeader | MetaHeader | Meta 头 |
| qualityGateIssues | QualityGateIssue[] | 质量门问题 |
| complexLogicDetected | boolean | 是否检测到复杂逻辑 |

#### ExecuteContract - 执行阶段
**输入 ExecuteInput**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| caseWorkbook | CaseSheet[] | 是 | 用例工作簿 |
| scope | 'selected_modules' \| 'all' | 是 | 执行范围 |
| selectedModuleIds | string[] | 条件必填（scope=selected_modules） | 选中模块 ID |
| browserOSMatrix | BrowserOS[] | 是 | 浏览器×OS 矩阵 |

**输出 ExecuteOutput**：
| 字段 | 类型 | 说明 |
|------|------|------|
| executionReport | ExecutionResult[] | 执行结果 |
| dataSnapshotBefore | DataSnapshot | 执行前数据快照 |
| dataSnapshotAfter | DataSnapshot | 执行后数据快照 |
| isolationVerified | boolean | 数据隔离验证结果 |

#### DefectContract - 缺陷阶段
**输入 DefectInput**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| executionResults | ExecutionResult[] | 是 | 执行结果 |
| caseRows | CaseRow[][] | 是 | 用例行数据 |
| environment | Environment | 是 | 环境信息 |

**输出 DefectOutput**：
| 字段 | 类型 | 说明 |
|------|------|------|
| defects | DefectRow[] | 缺陷列表 |
| summary | DefectSummary | 统计摘要 |

### 3.3 核心导出函数

| 函数 | 说明 |
|------|------|
| `validateLoginInput(input)` | 校验登录输入 |
| `validateLoginOutput(output)` | 校验登录输出 |
| `validateExploreInput(input)` | 校验探索输入 |
| `validateExploreOutput(output)` | 校验探索输出 |
| `validateFeatureInput(input)` | 校验功能点输入 |
| `validateFeatureOutput(output)` | 校验功能点输出 |
| `validateCaseInput(input)` | 校验用例输入 |
| `validateCaseOutput(output)` | 校验用例输出 |
| `validateExecuteInput(input)` | 校验执行输入 |
| `validateExecuteOutput(output)` | 校验执行输出 |
| `validateDefectInput(input)` | 校验缺陷输入 |
| `validateDefectOutput(output)` | 校验缺陷输出 |

---

## 4. 数据流转

### 4.1 作为契约层的数据流
```
contracts 为所有模块提供类型定义和 Schema 校验
├── stage-login 使用 LoginInput/Output/Schema
├── stage-explore 使用 ExploreInput/Output/Schema
├── stage-feature 使用 FeatureInput/Output/Schema
├── stage-case 使用 CaseInput/Output/Schema
├── stage-execute 使用 ExecuteInput/Output/Schema
└── stage-defect 使用 DefectInput/Output/Schema
```

### 4.2 校验流程
```
模块 run(input) 调用
    ↓
validateXxxInput(input)  // Zod Schema 校验输入
    ↓
执行业务逻辑
    ↓
validateXxxOutput(output)  // Zod Schema 校验输出
    ↓
返回结果
```

---

## 5. 依赖关系

### 5.1 内部依赖
无（最底层模块）

### 5.2 外部依赖
| 依赖 | 版本 | 用途 |
|------|------|------|
| `zod` | ^3.23.8 | 运行时类型校验 |

### 5.3 版本要求
- TypeScript ^5.7.2
- Node.js >= 18

---

## 6. 迭代指南

### 6.1 扩展点
1. **新增类型**：在 `src/types/` 下创建新文件，导出类型
2. **新增阶段契约**：在 `src/stages/` 下创建新文件，定义 Input/Output 接口
3. **新增 Schema**：在 `src/schemas/` 下创建新文件，定义 Zod Schema
4. **新增 Mock 数据**：在 `src/mock/index.ts` 中添加 Mock 数据

### 6.2 常见修改场景
1. **添加可选字段**：在现有接口中添加可选字段（向后兼容）
2. **扩展枚举值**：在现有联合类型中添加新值
3. **增加校验规则**：修改现有 Zod Schema 的校验规则

### 6.3 测试要点
- 所有 Schema 校验函数必须有对应的单元测试
- Mock 数据必须能通过对应的 Schema 校验
- 验证类型导出的正确性

### 6.4 注意事项
- **接口冻结规则**：
  - 加可选字段 → PATCH 版本，无需迁移
  - 加必填字段 → MINOR 版本，需提供默认值或迁移脚本
  - 删字段 → MAJOR 版本，必须迁移脚本
  - 改字段类型 → MAJOR 版本，必须迁移脚本
- **修改流程**：
  1. 修改类型定义
  2. 修改对应 Schema
  3. 更新校验函数
  4. 更新 Mock 数据
  5. 通知所有消费方更新
