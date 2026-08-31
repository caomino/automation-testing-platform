# @test-platform/stage-defect

> 自动化测试平台 — 缺陷生成阶段

## 职责

stage-defect 是测试平台五阶段流水线的**第五阶段**，核心职责：

1. **缺陷派生**：基于执行阶段的结果（通过/失败/阻塞），自动生成缺陷记录，包含环境信息、严重程度、质量属性等。
2. **环境归一化**：将浏览器/OS/版本等环境信息归一化为标准化格式，确保缺陷描述中的环境字段可追溯。
3. **缺陷分级**：根据失败描述自动推断严重程度（critical/major/minor/trivial）和质量属性（functionality/reliability/usability 等）。

---

## 接口文档

### `DefectInput`

```typescript
interface DefectInput {
  executionResults: ExecutionResult[];
  caseRows: CaseRow[][];
  environment: Environment;
}
```

### `DefectOutput`

```typescript
interface DefectOutput {
  defects: DefectRow[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    passRate: number;
  };
}
```

### `DefectRow`

| 列 | 字段 | 说明 |
|----|------|------|
| 0 | 序号 | 缺陷序号 |
| 1 | 描述 | 缺陷详细描述 |
| 2 | 截图引用 | `ScreenshotRef` 指向执行阶段的截图 |
| 3 | 严重程度 | critical / major / minor / trivial |
| 4 | 质量属性 | functionality / reliability / usability 等 |
| 5 | 环境 | OS·Browser·Version·CaseNo·Step |

---

## 使用示例

```typescript
import { run } from '@test-platform/stage-defect';

const output = await run({
  executionResults: executionOutput.results,
  caseRows: caseOutput.caseRows,
  environment: { os: 'Windows', browser: 'Chrome', version: '120' },
});

console.log(`通过率: ${output.summary.passRate.toFixed(1)}%`);
for (const defect of output.defects) {
  console.log(`[${defect.level}] ${defect.description}`);
}
```

---

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@test-platform/contracts` | workspace:* | 提供 `DefectInput` / `DefectOutput` / `DefectRow` 类型及 Zod 校验 |

---

## 迭代指南

### 7.1 扩展点

#### 扩展缺陷字段
在 `DefectRow` 类型中添加新字段（如修复版本、负责人、关联需求等），同时更新缺陷生成逻辑。

#### 自定义严重程度规则
实现新的缺陷分级算法，根据失败类型、影响范围等因素自动推断严重程度。

#### 集成缺陷管理系统
扩展 `DefectOutput`，支持将缺陷同步到外部缺陷管理系统（如 Jira、Bugzilla 等）。

### 7.2 常见修改场景

#### 调整环境归一化规则
修改 `normalizeEnvironment()` 函数，支持更多环境信息的归一化处理。

#### 添加缺陷去重逻辑
在生成缺陷时，对相似缺陷进行合并去重，避免重复提交。

### 7.3 测试要点
- 缺陷派生逻辑测试
- 环境归一化正确性测试
- 严重程度推断准确性测试
- 通过率计算测试

### 7.4 注意事项
- **缺陷可追溯性**：每个缺陷都应能追溯到具体的执行步骤
- **环境准确性**：环境信息必须准确，便于复现
- **分级合理性**：严重程度分级应符合团队规范
- **数据完整性**：缺陷记录应包含足够的信息用于问题定位
