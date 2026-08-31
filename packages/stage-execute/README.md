# @test-platform/stage-execute

执行 stage：Playwright 直连 + **浏览器×OS 矩阵** + **数据隔离红线**。

## 职责

用 engine-mcp 在真实浏览器中按用例逐步骤执行，产出执行报告，并比对执行前后数据快照验证数据隔离。

## 接口（冻结 v1.0）

```typescript
run(input: ExecuteInput, deps?: ExecuteDeps): Promise<ExecuteOutput>
```

- `ExecuteInput`：用例工作簿 `caseWorkbook`、范围 `scope`（`selected_modules`/`all`）、`selectedModuleIds`、`browserOSMatrix`
- `ExecuteOutput`：`executionReport`(ExecutionResult[])、`dataSnapshotBefore/After`(DataSnapshot)、`isolationVerified`(boolean)

`deps` 为可选依赖（**不改动冻结签名**），用于解耦：

- `engine`：复用单个已配置引擎
- `engineFactory`：按环境创建引擎（真实多浏览器矩阵）
- `snapshotProvider`：数据快照提供者（默认返回空快照；真实环境由 app 注入读取表哈希）
- `ownerTaskId`：本任务归属 ID（新增数据归属 + 隔离校验）
- `caseTimeoutMs`：单用例超时（默认 30s）

## 关键逻辑

1. **scope 过滤**（`scope.ts`）：`all` 全量；`selected_modules` 仅保留 `sheetName ∈ selectedModuleIds` 的 sheet。
2. **矩阵执行**（`run.ts`）：`browserOSMatrix × 用例` 笛卡尔积，每条用例调 `engine.runCase(row)` 产出 `ExecutionStepResult[]`；单用例超时/异常不崩溃，转 `failed`。
3. **步骤聚合**（`executeCase.ts`）：全 passed→`passed`，含 failed→`failed`，空→`skipped`；failed 带 `defectRef`。
4. **数据隔离红线**（`isolation.ts`，纯函数）：执行前/后各捕一次快照；校验
   - 历史数据未被修改/删除（before 行哈希在 after 中原样存在）
   - 新增数据须归属本任务（`after.ownerTaskId === ownerTaskId`）
   - 违反 → `isolationVerified=false`（记录不崩溃）。

## 测试

- `src/__tests__/execute.verify.ts`：契约验证（矩阵执行、聚合、隔离、scope、空用例）
- `src/__tests__/isolation.test.ts`：`computeIsolationVerified` 纯函数
- `src/__tests__/executeCase.test.ts`：`deriveStatus` / 超时守卫 / 边界

命令：`pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm verify`

## 已知限制

- 引擎与浏览器启动由 app 编排层负责（ExecuteInput 不含 URL/凭证）；本包默认复用注入引擎，多浏览器矩阵经 `engineFactory` 注入。
- 默认 `snapshotProvider` 返回空快照（无法读被测系统 DB）；真实数据隔离需 app 注入读取表哈希的实现。

---

## 迭代指南

### 7.1 扩展点

#### 扩展浏览器矩阵
在 `BrowserOSMatrix` 中添加新的浏览器/OS 组合，并在 `engineFactory` 中实现对应的引擎创建逻辑。

#### 自定义超时策略
在 `ExecuteDeps` 中添加分级超时配置：
```typescript
interface ExecuteDeps {
  caseTimeoutMs?: number;
  stepTimeoutMs?: number;
  engineTimeoutMs?: number;
}
```

#### 扩展数据隔离规则
在 `isolation.ts` 中添加新的隔离校验规则（如字段级校验、关联数据校验等）。

### 7.2 常见修改场景

#### 调整执行并发
修改矩阵执行的并发策略，支持串行/并行/混合执行模式。

#### 添加重试机制
对失败的步骤添加自动重试逻辑，提高执行稳定性。

### 7.3 测试要点
- 矩阵执行正确性测试
- 步骤聚合逻辑测试
- 数据隔离校验测试
- 超时/异常处理测试

### 7.4 注意事项
- **资源管理**：引擎实例应正确创建和销毁，避免资源泄漏
- **隔离红线**：数据隔离校验是硬性要求，不可跳过
- **超时保护**：所有执行路径都应有超时保护
- **结果追踪**：每个步骤的结果都应完整记录
