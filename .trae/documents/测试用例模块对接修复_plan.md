# 测试用例模块对接修复计划

## 问题诊断

### 当前状态 vs 要求

| # | 问题 | 现状 | 要求（来自 PRD v1.3 + 主规格 v1.5） |
|---|------|------|-------------------------------------|
| 1 | 功能点数据未对接 | `caseRegenerate()` 仅重置本地状态，未调用 `runPipelineCase` | 点击"生成用例"需将已确认的 `featureTable` 传入 `stage-case.run()` |
| 2 | 选择模块为空 | `moduleOptions` 使用 `execModules`（执行阶段状态），功能点生成后此数组为空 | 模块选择应基于 `featureRows` 提取主模块/子模块列表 |
| 3 | 数据流断裂 | `Case.tsx` 未从 `featureRows` 提取模块信息传给 `runPipelineCase` | 选择模块 → 过滤功能点 → 生成用例 的完整链路 |
| 4 | scope 选择未实现 | `caseSelectedModules` 仅作 UI 展示，未实际参与用例生成过滤 | `scope: 'selected_modules'\|'all'` + `selectedModuleIds` 传给 stage-case |

### 根因分析

```
数据流断点图：

探索 → 功能点 → 用例 → 执行
  ↑       ↑        ↑
  |       |        └── 断点1: caseRegenerate() 未调 pipeline
  |       |        └── 断点2: 未传 featureTable 给 stage-case
  |       |        └── 断点3: 模块选项数据源错误
  |       └── featureRows 已生成并确认 ✓
  └── moduleTree 已生成 ✓
```

---

## 修复计划

### 步骤 1：修复 `context.tsx` — 用例生成 Pipeline 对接

**文件**: `packages/app/src/context.tsx`

1.1 增加 `runPipelineCase` 的参数构建逻辑：
   - 从 `state.featureRows` 提取功能点二维数组 `featureTable`
   - 构建 `CaseInput` 对象：`{ featureTable, scope, selectedModuleIds, metaConfig, aiConfig }`
   - 调用 `svc.runStageCase(input)` 并处理返回结果

1.2 修改 `CASE_REGENERATE` reducer：
   - 改为调用 `runPipelineCase`（在 useApp 返回的方法中处理）
   - 不再仅重置状态，而是触发真实 pipeline 调用

1.3 增加从 `featureRows` 提取模块列表的逻辑：
   - `getFeatureModules()` → 返回 `{ mainModules: string[], subModules: string[] }`
   - 用于填充选择模块的下拉选项

### 步骤 2：修复 `Case.tsx` — 用例页面对接

**文件**: `packages/app/src/screens/Case.tsx`

2.1 修改 `moduleOptions` 数据源：
   - 从 `execModules` 改为从 `featureRows` 提取的模块列表
   - 去重后生成选项：`{ value: subModule, label: subModule }`
   - 当 `featureRows` 为空时显示提示"请先生成功能点"

2.2 修改 `caseRegenerate` 调用：
   - 点击"生成选中"/"全部生成"时，调用 `runPipelineCase(input)` 而非 `caseRegenerate()`
   - 根据 `caseSelectedModules` 决定 `scope` 为 `'selected_modules'` 或 `'all'`
   - 传入当前 `metaHeader` 作为 `metaConfig`

2.3 增加前置检查：
   - 若 `featureRows.length === 0`，提示"请先在功能点页面生成并确认功能点"
   - 若 `featureConfirmed === false`，提示"请先确认功能点后再生成用例"

2.4 修复 `CaseGroupView` 的 `moduleName` 绑定：
   - `toCaseView()` 转换时，从 `sheet.rows[0].featureId` 或 `metaHeader` 提取模块名
   - 确保用例分组按模块正确展示

### 步骤 3：修复 `pipeline.ts` — 数据转换

**文件**: `packages/app/src/services/pipeline.ts`

3.1 修改 `toCaseView()`：
   - 增加 `moduleName` 提取逻辑，从 `CaseRow.featureId` 或 `CaseSheet.sheetName` 推断
   - 填充到 `CaseGroupView.moduleName`

3.2 增加从 `FeatureRowView[]` 到 `FeatureRow[][]` 的转换：
   - 新增 `fromFeatureViewToTable(rows: FeatureRowView[]): string[][]` 
   - 用于将前端视图数据转为 contract 要求的 `FeatureRow[][]` 格式

### 步骤 4：修复 `stage-case/src/index.ts` — 核心生成逻辑

**文件**: `packages/stage-case/src/index.ts`

4.1 增加 `featureTable` 为空的边界检查：
   - 若 `input.featureTable` 为空或展平后为空，返回空结果 + 友好提示

4.2 增加 `scope` 过滤的日志/调试信息（便于排查）

---

## 涉及文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `packages/app/src/context.tsx` | 修改 | 修复 `runPipelineCase` 方法，增加 `getFeatureModules` |
| `packages/app/src/screens/Case.tsx` | 修改 | 修复模块选项数据源，对接 pipeline |
| `packages/app/src/services/pipeline.ts` | 修改 | 修复 `toCaseView` 增加 moduleName，增加 `fromFeatureViewToTable` |
| `packages/stage-case/src/index.ts` | 修改 | 增加空数据边界检查 |

---

## 风险与约束

1. **contracts 包不可修改**：`CaseInput`/`CaseOutput`/`FeatureRow` 等类型已冻结，本计划不涉及接口变更
2. **不破坏现有功能**：功能点页面、执行页面的现有逻辑不受影响
3. **数据兼容**：`toCaseView`/`fromCaseView` 的转换需兼容 mock 数据和真实 pipeline 数据
4. **类型安全**：严格 TypeScript，无 `any` 类型断言

---

## 验证标准

1. ✅ 在功能点页面生成并确认功能点后，进入用例页面
2. ✅ 点击"选择模块"能看到从功能点提取的模块列表（而非空）
3. ✅ 点击"全部生成"能成功调用 pipeline 并生成用例
4. ✅ 点击"生成选中"仅生成所选模块的用例
5. ✅ 生成的用例按子模块分组展示，moduleName 正确填充
6. ✅ 无功能点数据时，用例页面给出友好提示
7. ✅ TypeScript 编译零错误
