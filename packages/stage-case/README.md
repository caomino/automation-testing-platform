# @test-platform/stage-case

> 自动化测试平台 — 用例生成阶段

## 职责

stage-case 是测试平台五阶段流水线的**第四阶段**，核心职责：

1. **八列用例表生成**：基于功能点表，为每个功能点生成三组场景用例（正常路径/边界值/异常输入），形成八列用例工作簿。
2. **复杂逻辑检测**：自动检测功能点表是否涉及复杂业务逻辑（≥5 个功能点或跨 3+ 子系统），并在 `qualityGateIssues` 中给出建议。
3. **多 Sheet 输出**：每个子系统独立生成一个 Sheet，支持 `scope: 'all' | 'selected_modules'` 范围过滤。
4. **质量门问题**：输出 `qualityGateIssues` 列表，供前端展示告警并决定是否需要 AI 辅助生成。

---

## 八列用例表结构

| 列 | 字段 | 说明 |
|----|------|------|
| 0 | 用例编号 | 格式：`{testPointId}_N{scene}` |
| 1 | 功能点 | 父模块-节点 组合 |
| 2 | 用例标题 | 简洁描述测试场景 |
| 3 | 前置条件 | 执行前置条件说明 |
| 4 | 操作步骤 | 详细操作步骤（含 selector） |
| 5 | 预期结果 | 期望的系统行为 |
| 6 | 优先级 | P0/P1/P2 |
| 7 | 测试点标识 | 绑定到功能点表的 testPointId |

---

## 接口文档

### `CaseInput`

```typescript
interface CaseInput {
  featureTable: FeatureRow[][];
  scope: 'selected_modules' | 'all';
  selectedModuleIds?: string[];
  metaConfig: MetaHeader;
  aiConfig?: AIConfigRef;
}
```

### `CaseOutput`

```typescript
interface CaseOutput {
  caseWorkbook: CaseSheet[];
  caseRows: CaseRow[][];
  metaHeader: MetaHeader;
  qualityGateIssues: QualityGateIssue[];
  complexLogicDetected: boolean;
}
```

---

## 使用示例

```typescript
import { run } from '@test-platform/stage-case';

const output = await run({
  featureTable: featureOutput.featureTable,
  scope: 'all',
  metaConfig: { version: 'v1.0', author: 'test' },
});

if (output.complexLogicDetected) {
  console.warn('检测到复杂逻辑:', output.qualityGateIssues);
}

for (const sheet of output.caseWorkbook) {
  console.log(`Sheet: ${sheet.sheetName}, 用例数: ${sheet.rows.length}`);
}
```

---

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@test-platform/contracts` | workspace:* | 提供 `CaseInput` / `CaseOutput` / `CaseRow` / `QualityGateIssue` 类型及 Zod 校验 |

---

## 迭代指南

### 7.1 扩展点

#### 扩展用例表列
在 `CaseRow` 类型中添加新列，同时更新用例生成逻辑：
```typescript
type CaseRow = [string, string, string, string, string, string, string, string, string?];
```

#### 新增用例生成策略
实现新的用例生成算法（如基于状态机、基于决策表等），在 `run()` 函数中切换。

#### 扩展质量门规则
在 `QualityGateIssue` 中添加新的规则类型，并在 `detectComplexLogic()` 中实现检测逻辑。

### 7.2 常见修改场景

#### 调整场景数量
修改 `generateScenes()` 函数，控制每个功能点生成的用例数量（默认 3 组）。

#### 自定义优先级规则
根据业务规则自动设置用例优先级（P0/P1/P2）。

### 7.3 测试要点
- 用例表结构正确性测试
- 多 Sheet 输出测试
- 质量门检测准确性测试
- scope 过滤逻辑测试

### 7.4 注意事项
- **用例编号唯一性**：确保同一 testPointId 下的用例编号唯一
- **数据完整性**：所有用例行都应有完整的 8 列数据
- **绑定关系**：用例必须正确绑定到对应的 testPointId
