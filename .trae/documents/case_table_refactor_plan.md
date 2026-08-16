# 测试用例表格重构计划

## 目标
将当前项目的测试用例表格重构为符合文档要求、与参考项目（test-expert-local）一致的表格结构。

## 调研结论

### 当前问题
1. **表格结构不完整**：只有7列（用例编号、内容、步骤、操作、预期结果、结论、操作），缺少"初次测试结果"和"回归测试结果"两列
2. **无单元格合并**：同一用例的多个步骤没有使用 rowSpan 合并用例编号和测试内容列
3. **Meta头字段不完整**：只有7个字段，缺少委托单位人员、开发单位人员、初次测试时间、回归测试时间、测试结论判定规则、预置条件
4. **不支持多模块分组**：选择多个模块时，应该生成多个独立表格
5. **操作功能缺失**：不支持在步骤下方添加新步骤

### 参考项目实现
- **表格列**：用例编号(9%)、测试内容(22%)、步骤(5%)、输入及操作说明(22%)、预期结果(22%)、初次测试结果(6%)、回归测试结果(6%)、测试结论(4%)、操作(4%)
- **数据模型**：`TestCase { caseId, content, precondition, steps: TestCaseStep[] }`
- **单元格合并**：用例编号和测试内容使用 `rowSpan={tc.steps.length}` 合并
- **Meta头**：系统名称、测试点标识、测试点、测试人员、委托单位人员、开发单位人员、初次测试时间、回归测试时间、测试结论判定规则、预置条件
- **操作**：支持在步骤下方插入、删除步骤

### 文档要求（§5.4）
- **八列**：用例编号/测试内容/步骤/输入及操作说明/预期结果/初次测试结果/回归测试结果/测试结论
- **列宽**：[18,16,8,34,34,14,14,12]
- **Excel结构顺序**：meta头 → 列头行 → 用例数据行 → 软件截图行
- **按模块分组**：每个模块生成独立的sheet/表格

## 修改范围

### 1. `packages/app/src/context.tsx`
- **扩展 MetaHeader 类型**：增加 developerStaff、firstTestDate、regressionDate、conclusionRule、precondition 字段
- **新增 CaseStepView 类型**：代表单个步骤
- **新增 CaseGroupView 类型**：代表一组用例（一个用例包含多个步骤）
- **修改 CaseRowView**：保持扁平结构用于向后兼容，新增 CaseGroupView 用于渲染
- **更新 AppState**：caseRows 改为 caseGroups（分组结构）
- **更新 Reducer**：添加 CASE_ADD_STEP、CASE_REMOVE_STEP、CASE_UPDATE_STEP 等 action

### 2. `packages/app/src/services/pipeline.ts`
- **更新 toCaseView**：返回分组结构 `{ groups: CaseGroupView[], meta: MetaHeader }`
- **更新 fromCaseView**：将分组结构展平为 CaseSheet

### 3. `packages/app/src/screens/Case.tsx`（主要修改）
- **重写表格渲染**：
  - Meta头表格：完整字段、正确的合并结构
  - 用例数据表格：8列 + 操作列
  - 按模块分组渲染多个表格
  - rowSpan 合并用例编号和测试内容
  - 点击+下方添加步骤功能
  - 删除步骤功能
  - 软件截图行
- **保留功能**：配置模态框、选择模块、AI辅助、导出CSV

### 4. `packages/app/src/styles.css`
- 添加/更新表格样式以支持新结构

## 详细实现步骤

### Step 1: 扩展类型定义（context.tsx）
```typescript
// MetaHeader 扩展
interface MetaHeader {
  system: string;
  testPointId: string;
  testPoint: string;
  testers: string;
  clientStaff: string;
  developerStaff: string;      // 新增
  firstTestDate: string;       // 新增（原 times 拆分）
  regressionDate: string;      // 新增
  conclusionRule: string;       // 新增（原 rules）
  precondition: string;         // 新增
}

// 步骤视图
interface CaseStepView {
  stepId: string;
  stepNumber: string;           // Step1, Step2...
  operation: string;
  expected: string;
  firstResult: string;          // \ 或实际结果
  regressionResult: string;     // \ 或实际结果
  conclusion: string;           // \ 或通过/不通过
}

// 用例分组视图（一个用例 = 一组步骤）
interface CaseGroupView {
  groupId: string;
  caseNo: string;               // 用例编号
  content: string;              // 测试内容
  moduleName: string;           // 所属模块
  precondition: string;         // 预置条件
  steps: CaseStepView[];        // 多个步骤
}
```

### Step 2: 更新 State 和 Reducer
```typescript
interface AppState {
  // ... 其他字段
  caseGroups: CaseGroupView[];  // 替换原 caseRows
  // ...
}

// 新增 Action
type Action = 
  | { type: "CASE_ADD_GROUP"; moduleName?: string }
  | { type: "CASE_REMOVE_GROUP"; groupId: string }
  | { type: "CASE_UPDATE_GROUP"; groupId: string; patch: Partial<CaseGroupView> }
  | { type: "CASE_ADD_STEP"; groupId: string; afterStepId?: string }
  | { type: "CASE_REMOVE_STEP"; groupId: string; stepId: string }
  | { type: "CASE_UPDATE_STEP"; groupId: string; stepId: string; patch: Partial<CaseStepView> }
  // ... 其他现有 action
```

### Step 3: 重写 Case.tsx 表格渲染
核心渲染逻辑：
1. 按 moduleName 分组 caseGroups
2. 每个模块渲染独立表格
3. 表格结构：
   - Meta头（8行，含合并单元格）
   - 列头行（9列：用例编号、测试内容、步骤、输入及操作说明、预期结果、初次测试结果、回归测试结果、测试结论、操作）
   - 用例数据行（按分组渲染，rowSpan合并）
   - 软件截图行（colSpan合并）

### Step 4: 更新 pipeline.ts 类型转换
```typescript
function toCaseView(sheets: CaseSheet[]): { groups: CaseGroupView[]; meta: MetaHeader }
function fromCaseView(groups: CaseGroupView[], meta: MetaHeader): CaseSheet[]
```

## 风险处理

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| contracts包冻结不可修改 | 无法修改CaseRow类型 | 在app层扩展view类型，pipeline层做转换 |
| 现有功能测试用例 | 修改后可能影响执行/缺陷屏 | 保持向后兼容，CaseRowView保留 |
| 数据迁移 | 旧数据格式需要兼容 | 在toCaseView中处理旧格式 |

## 约束遵守
- **不修改 contracts 包**（冻结约束）
- **仅修改 app 包**的 context.tsx、Case.tsx、pipeline.ts、styles.css
- **保持现有接口签名兼容**
- 文件行数控制在 300 行以内，超出部分拆分组件

## 交付清单
1. [ ] `context.tsx` - 类型扩展 + Reducer 更新
2. [ ] `Case.tsx` - 表格渲染重构（核心）
3. [ ] `pipeline.ts` - 类型转换函数更新
4. [ ] `styles.css` - 表格样式更新
5. [ ] 功能验证：Meta头完整渲染、8列表格、rowSpan合并、多模块分组、添加/删除步骤

## 用户确认点
- ✅ 采用分组结构（一个用例包含多个步骤）
- ✅ Meta头增加完整字段
- ✅ contracts包保持冻结，仅修改app层
- ✅ 选择测试模块可以生成多个表格
