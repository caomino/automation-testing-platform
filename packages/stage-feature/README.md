# @test-platform/stage-feature

> 自动化测试平台 — 功能点生成阶段

## 职责

stage-feature 是测试平台五阶段流水线的**第三阶段**，核心职责：

1. **功能点表生成**：基于探索阶段产出的模块树，自动生成九列功能点表（序号/测试类型/需求章节/系统名称/主模块/子模块/功能点/测试点/测试点标识）。
2. **测试点标识生成**：为每个功能点生成唯一的 `testPointId`（格式：`{system}_{main}_{sub}_{NN}`），作为后续用例生成的绑定键。
3. **人工补充追踪**：通过 `provenance` 追踪每个功能点的来源（explore / ai_generated / manual），支持 `confirmedOnly` 过滤。

---

## 九列功能点表结构

| 列 | 字段 | 说明 |
|----|------|------|
| 0 | 序号 | 行内序号（1-N） |
| 1 | 测试类型 | 默认为 `功能性测试` |
| 2 | 需求章节 | X.Y.Z 占位格式（如 `1.0.0`） |
| 3 | 系统名称 | 被测系统名称 |
| 4 | 主模块 | 父模块标签 |
| 5 | 子模块 | 子系统标签 |
| 6 | 功能点 | 父模块-节点 组合（如 `检查室管理-查询`） |
| 7 | 测试点 | 节点标签（如 `查询`） |
| 8 | 测试点标识 | 唯一 ID（如 `QYYX_JCS_JCX_01`） |

---

## 接口文档

### `FeatureInput`

```typescript
interface FeatureInput {
  moduleTree: ModuleNode[];
  systemName: string;
  confirmedOnly?: boolean;
}
```

### `FeatureOutput`

```typescript
interface FeatureOutput {
  featureTable: FeatureRow[][];
  provenance: FeatureProvenance[];
}
```

---

## 使用示例

```typescript
import { run } from '@test-platform/stage-feature';

const output = await run({
  moduleTree: exploreOutput.moduleTree,
  systemName: '区域影像系统',
  confirmedOnly: false,
});

for (const sheet of output.featureTable) {
  for (const row of sheet) {
    console.log(row[8], row[6], row[7]);
    // 测试点标识, 功能点, 测试点
  }
}
```

---

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@test-platform/contracts` | workspace:* | 提供 `FeatureInput` / `FeatureOutput` / `FeatureRow` 类型及 Zod 校验 |

---

## 迭代指南

### 7.1 扩展点

#### 扩展功能点表列
在 `FeatureRow` 类型中添加新列，同时更新表生成逻辑：
```typescript
type FeatureRow = [string, string, string, string, string, string, string, string, string, string?];
```

#### 自定义测试点标识规则
修改 `generateTestPointId()` 函数，支持不同的命名规范：
```typescript
function generateTestPointId(system: string, main: string, sub: string, index: number): string;
```

#### 添加 AI 辅助生成
集成 AI 模块，在功能点生成过程中提供智能建议。

### 7.2 常见修改场景

#### 调整需求章节格式
修改 `chapter` 字段的生成逻辑，支持不同的编号规范（如 1.0、V1.0、REQ-001 等）。

#### 扩展测试类型
在 `type` 字段中支持更多测试类型（如性能测试、安全测试、兼容性测试等）。

### 7.3 测试要点
- 功能点表结构正确性测试
- 测试点标识唯一性测试
- provenance 追踪准确性测试
- confirmedOnly 过滤逻辑测试

### 7.4 注意事项
- **标识唯一性**：确保 `testPointId` 在同一系统中唯一
- **数据完整性**：功能点表的所有行都应有完整的 9 列数据
- **人工干预**：支持人工添加/修改功能点，并正确记录 provenance
