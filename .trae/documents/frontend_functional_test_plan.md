# 前端完整功能测试计划

## 研究结论

### 当前状态分析

经过对整个前端代码库的深入分析，发现以下问题：

#### 1. 导出功能缺失（根本原因）
以下页面的"导出"按钮仅显示 toast 提示，没有实际导出逻辑：
- **Feature.tsx L93**: `导出 Excel` → 仅 `toast("已导出 Excel")`
- **Feature.tsx L52-73**: `复制到Excel` → 使用 `navigator.clipboard.writeText()`，在非安全上下文会失败
- **Execute.tsx L75**: `📥 导出结果` → 仅 `toast("已导出执行结果")`
- **Explore.tsx L167**: `导出模块树` → 仅 `toast("已导出模块树")`
- **Defect.tsx L61**: `📤 导出` → 仅 `toast("已导出缺陷")`

#### 2. 表格列数与规范不一致
- **Case.tsx**: 当前有 8 列数据 + 1 列操作 = 9 列。规范要求 8 列：#、用例编号、内容、步骤、操作、预期结果、结论、操作。需移除"首次结果"和"回归结果"两列。

#### 3. 当前测试覆盖严重不足
现有 `workflow.test.tsx` 仅 14 个测试，覆盖基本渲染，缺少：
- 按钮点击后的行为验证
- 表单填写与提交
- Modal 打开/关闭交互
- 表格单元格编辑
- 筛选/过滤逻辑
- 导航切换
- 导出功能
- 错误/异常路径

---

## 需要修改的文件

### 源码修复
| 文件 | 修改内容 |
|------|----------|
| `src/screens/Feature.tsx` | 实现真正的复制到Excel功能（tab分隔文本+clipboard降级方案）、修复Excel导出 |
| `src/screens/Case.tsx` | 移除"首次结果"和"回归结果"列，添加导出功能 |
| `src/screens/Execute.tsx` | 实现真正的导出结果功能 |
| `src/screens/Explore.tsx` | 实现真正的导出模块树功能 |
| `src/screens/Defect.tsx` | 实现真正的导出缺陷功能 |

### 测试文件
| 文件 | 修改内容 |
|------|----------|
| `src/screens/workflow.test.tsx` | 完整重写，覆盖所有页面交互 |
| `src/App.test.tsx` (新建) | App组件导航与整体流程测试 |

---

## 实施步骤

### 第一阶段：修复源码中的导出功能

#### 1.1 Feature.tsx 导出修复
- **复制到Excel**: 将 `navigator.clipboard.writeText(html)` 改为生成 tab-separated 纯文本，使用 `navigator.clipboard.writeText()` + `document.execCommand('copy')` 降级方案
- **导出Excel**: 生成 CSV 格式文件并触发下载（`Blob` + `URL.createObjectURL` + `<a>` 标签触发）

#### 1.2 Case.tsx 表格修复
- 移除"首次结果"和"回归结果"两个 `<th>` 表头和对应 `<td>` 数据单元格
- 添加"导出"按钮，实现 CSV 导出

#### 1.3 Execute.tsx 导出修复
- 实现 `导出结果` 功能：将 execMatrix 数据转为 CSV 格式并触发下载

#### 1.4 Explore.tsx 导出修复
- 实现 `导出模块树` 功能：将 moduleTree 转为 JSON 格式并下载

#### 1.5 Defect.tsx 导出修复
- 实现 `导出` 功能：将 defectRows 转为 CSV 格式并下载

### 第二阶段：编写完整的页面功能测试

#### 2.1 重写 workflow.test.tsx - 覆盖所有页面交互

**Workbench 页面（8 个测试）:**
- 登录状态正确渲染（已登录/未登录）
- 登录按钮在未登录时可用
- 流水线按钮在未登录时禁用
- 点击"登录系统"按钮应触发 runPipelineLogin
- 点击"探索"按钮应触发 runPipelineExplore 并导航到 s2
- 点击"功能点"按钮应触发 runPipelineFeature 并导航到 s3
- 点击"用例"按钮应触发 runPipelineCase 并导航到 s4
- 点击"执行"按钮应触发 runPipelineExecute 并导航到 s5
- 点击"缺陷"按钮应触发 runPipelineDefect 并导航到 s6
- 点击"切换系统"应显示系统列表并可选择切换
- 活动记录正确显示

**Explore 页面（10 个测试）:**
- 模块树正确渲染
- 空模块树不崩溃
- 点击"新增模块"按钮打开 Modal
- 填写模块名称并提交，应调用 exploreAddModule
- 选择模块后点击"编辑选中"打开编辑 Modal
- 编辑模块名称后保存，应调用 exploreUpdateModule
- 选择模块后点击"删除选中"，确认后调用 exploreRemoveModule
- 人工补充流程：填写表单 → 写入待入树列表
- 待入树列表的"入树"操作应调用 explorePromoteToTree
- "全部入树"应调用 explorePromoteAll
- 覆盖率统计正确显示

**Feature 页面（10 个测试）:**
- 功能点表格正确渲染
- 点击"+ 新增行"应调用 featureAddRow
- 点击"× 删除行"应弹出确认对话框
- 确认删除后应调用 featureRemoveRow
- 点击单元格进入编辑模式
- 编辑后失焦应调用 featureUpdateRow
- 点击"📋 复制到 Excel"应生成剪贴板文本
- 点击"导出 Excel"应触发文件下载
- 点击"✓ 整体确认"应弹出确认对话框
- 确认后 featureConfirmed 变为 true

**Case 页面（12 个测试）:**
- 用例表格正确渲染（正确列数）
- 点击单元格进入编辑模式
- 编辑后失焦应调用 caseUpdateRow
- 点击"+"按钮应在下方插入新行
- 点击"×"按钮应弹出删除确认
- 确认删除后应调用 caseRemoveRow
- 点击"⚙ 配置"打开配置 Modal
- 修改 Meta 头字段后保存
- 点击"⚙ 选择模块"打开选择 Modal
- 选择模块后确认应调用 caseSetSelection
- 点击"生成选中"应调用 caseRegenerate
- 点击"全部生成"应调用 caseRegenerate
- AI 辅助开关切换应调用 caseToggleAi

**Execute 页面（8 个测试）:**
- 模块列表正确渲染
- 点击模块复选框应调用 execToggleModule
- 全选/取消全选应调用 execToggleAll
- 无选中模块时"执行选中"按钮禁用
- 有选中模块时点击"执行选中"应调用 execRun("selected")
- 点击"执行全部"应调用 execRun("all")
- 点击矩阵单元格应显示详情 Modal
- 点击"🛡 数据隔离 Verify"应打开 Modal 并运行验证
- 点击"📥 导出结果"应触发 CSV 下载

**Defect 页面（8 个测试）:**
- 缺陷列表正确渲染
- 点击"+ 新建缺陷"打开 Modal
- 填写缺陷信息后创建应调用 defectAdd
- 点击"编辑"应打开编辑 Modal
- 保存编辑应调用 defectUpdate
- 点击"删除"应弹出确认对话框
- 确认删除后应调用 defectRemove
- 筛选按钮切换应调用 defectSetFilter
- 导出缺陷应触发 CSV 下载

#### 2.2 新建 App.test.tsx - 整体导航测试
- 侧边栏导航点击切换屏幕
- 顶部导航按钮（连接系统/退出登录）
- 面包屑渲染
- 屏幕切换动画/class 名正确

### 第三阶段：运行全部测试并确保通过

---

## 风险与注意事项

1. **Clipboard API 限制**: `navigator.clipboard` 在 jsdom 中不可用，需要 mock
2. **文件下载测试**: 需要 mock `Blob`、`URL.createObjectURL` 和 `<a>` 元素的 click 事件
3. **异步操作**: 流水线按钮涉及异步调用，需要使用 `async/await` 和 `vi.waitFor`
4. **Modal 交互**: 需要测试 Modal 的打开和关闭，包括确认对话框
5. **表格编辑**: React Testing Library 的 `fireEvent.click` 和 `fireEvent.blur` 模拟
6. **mock 完整性**: 需要确保所有 useApp 返回的 action 都有 mock 实现

## 测试执行命令

```bash
cd d:\newTest\packages\app
pnpm run test
```
