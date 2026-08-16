# 实施计划：完全重写 Case.tsx

## 目标
将 `d:\newTest\packages\app\src\screens\Case.tsx` 从基于扁平 `caseRows` 的实现，重写为基于 `caseGroups` 的分模块表格实现，参考 `C:\Users\caomi\Desktop\测试用例工具\test-expert-local (8)\src\App.tsx` 中的表格渲染逻辑。

## 数据结构分析
- **MetaHeader**: `{ system, testPointId, testPoint, testers, clientStaff, developerStaff, firstTestDate, regressionDate, conclusionRule, precondition }`
- **CaseGroupView**: `{ groupId, caseNo, content, moduleName, precondition, steps: CaseStepView[] }`
- **CaseStepView**: `{ stepId, stepNumber, operation, expected, firstResult, regressionResult, conclusion }`
- **reducer 行为**: `CASE_STEP_REMOVE` 在移除步骤后自动过滤 `steps.length === 0` 的分组

## 实现步骤

### 1. 顶部工具栏 (保持现有功能)
- 配置按钮 → 打开 Meta 配置模态框
- 选择模块按钮 → 打开模块选择模态框，显示已选数量
- 生成选中 / 全部生成按钮 → 调用 `caseRegenerate()`
- AI 辅助 Toggle → 调用 `caseToggleAi()`
- 导出 CSV → 新格式 9 列 CSV

### 2. Meta 头表格 (8行 × 8列布局)
- 行1: 系统名称(label,15%) | 值(colSpan=2,35%) | 测试点标识(label,15%) | 值(colSpan=4,35%)
- 行2: 测试点(label) | 值(colSpan=7)
- 行3: 测试人员(label) | 值(colSpan=7)
- 行4: 委托单位人员(label) | 值(colSpan=7)
- 行5: 开发单位人员(label) | 值(colSpan=7)
- 行6: 初次测试时间(label) | 值(colSpan=2) | 回归测试时间(label) | 值(colSpan=4)
- 行7: 测试结论判定规则(label) | 值(colSpan=7) → 固定两行文本
- 行8: 预置条件(label) | 值(colSpan=7)
- 样式: `border:1px solid #000, padding:4px, 表头加粗居中`

### 3. 数据表格 (9列)
- 列宽: 用例编号(9%) | 测试内容(22%) | 步骤(5%) | 输入及操作说明(22%) | 预期结果(22%) | 初次测试结果(6%) | 回归测试结果(6%) | 测试结论(4%) | 操作(4%)

### 4. 按模块分组渲染
- 从 `caseGroups` 提取去重后的 `moduleName` 列表
- 若有 `caseSelectedModules`，只渲染选中的模块
- 空 `moduleName` 归到 "默认" 分组
- 每个模块渲染完整的 Meta 头表 + 数据表

### 5. rowSpan 合并
- 用例编号和测试内容列使用 `rowSpan={steps.length}` 合并
- 仅在 `sIdx === 0` 时渲染合并单元格

### 6. 操作列
- 每个步骤行: `+` (在下方添加步骤 via `caseStepAdd`) 和 `×` (删除当前步骤 via `caseStepRemove`)
- 删除最后一个步骤时 reducer 自动移除分组

### 7. 单元格编辑
- 使用 `editingCell` 状态管理编辑模式
- Meta 头: 通过 `caseUpdateMeta` 保存
- 步骤字段: 通过 `caseStepUpdate` 保存
- 用例编号/测试内容: 通过 `caseGroupUpdate` 保存

### 8. 保留的模态框
- Meta 配置模态框 → 更新为新字段结构
- 选择模块模态框 → 保持现有逻辑
- 删除确认对话框 → 用于步骤删除确认

### 9. 导出 CSV (新9列格式)
```csv
用例编号,测试内容,步骤,输入及操作说明,预期结果,初次测试结果,回归测试结果,测试结论
```

### 10. 代码组织
- 单文件实现，预计 300 行左右
- 子组件: `MetaTable` (Meta 头表), `DataTable` (数据表), `ModuleTables` (分组渲染)
- 使用现有导入: `Button, Card, Modal, Tag, Toggle, ConfirmDialog, SearchableSelect`

## 文件操作
- **写入**: `d:\newTest\packages\app\src\screens\Case.tsx` (完全重写)
- **引用**: `d:\newTest\packages\app\src\context.tsx` (类型定义，不修改)
- **参考**: `C:\Users\caomi\Desktop\测试用例工具\test-expert-local (8)\src\App.tsx` (表格布局参考)

## 验证方式
- TypeScript 类型检查 (通过 `GetDiagnostics`)
- 确认所有 `useApp()` 返回的方法名与 context 中一致
