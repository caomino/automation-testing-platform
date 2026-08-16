# pipeline.ts 改造计划

## 目标
修改 `d:\newTest\packages\app\src\services\pipeline.ts`，在保持现有功能的同时增加分组视图（`CaseGroupView`）支持。

## 背景
- `context.tsx` 中已定义 `CaseStepView` 和 `CaseGroupView` 类型
- `context.tsx` 中的 `MetaHeader` 已更新为新字段（`developerStaff`, `firstTestDate`, `regressionDate`, `conclusionRule`, `precondition`）
- `pipeline.ts` 中的 `toCaseView` 和 `fromCaseView` 仍使用旧的扁平结构和旧的 MetaHeader 字段

## 变更清单

### 1. 添加新类型导入
在现有 import 块（第34行）之后添加：
```typescript
import type { CaseStepView, CaseGroupView } from "../context";
```

### 2. 更新 `toCaseView` 函数（第60-90行）
- **返回类型**：从 `{ rows: CaseRowView[]; meta: MetaHeader }` 改为 `{ rows: CaseRowView[]; groups: CaseGroupView[]; meta: MetaHeader }`
- **meta 初始值**：使用新字段（`developerStaff`, `firstTestDate`, `regressionDate`, `conclusionRule`, `precondition`）替代旧的 `times` 和 `rules`
- **meta 构建**：使用 `sheet.meta` 的新字段名（`systemName` → `system`，`firstTestDate`/`regressionDate` 直接赋值，`conclusionRule` → `conclusionRule`，新增 `precondition`）
- **新增分组逻辑**：在遍历 sheet.rows 时，同时构建 `Map<string, CaseGroupView>` 按 caseNo 分组
  - 每个 group 包含：groupId（`group-${caseNo}`）、caseNo、content、moduleName（取自 sheet.sheetName）、precondition（取自 meta.precondition）、steps
  - 每个 step 包含：stepId（`step-${index}`）、stepNumber、operation、expected、firstResult、regressionResult、conclusion
- **返回值**：`{ rows, groups, meta }`

### 3. 更新 `fromCaseView` 函数（第179-206行）
- **签名**：从 `fromCaseView(rows: CaseRowView[], meta: MetaHeader)` 改为 `fromCaseView(groups: CaseGroupView[], meta: MetaHeader)`
- **输入**：接收 `CaseGroupView[]` 而非 `CaseRowView[]`
- **展平逻辑**：遍历 groups → 遍历 steps，每个 step 生成一个 `CaseRow`
  - step.stepNumber → CaseRow.step
  - 其余字段映射不变
- **meta 映射**：使用新字段对称映射（`system` → `systemName`，`firstTestDate`/`regressionDate` 直接赋值，`conclusionRule` → `conclusionRule`，新增 `precondition`）

### 4. 不变部分
- `CaseRowView` 相关导入保留
- `PipelineService` 接口不变
- `toFeatureView`、`toExecView`、`toDefectView`、`toModuleView` 等其他函数不变

## 影响范围
- `pipeline.ts` 内部函数签名变更：`toCaseView` 增加返回值中的 `groups` 字段；`fromCaseView` 输入参数类型变更
- 调用方（`context.tsx`、`Workbench.tsx`）需后续适配（不在本次修改范围内）