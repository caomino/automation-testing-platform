# App 前端修复计划

## 问题综述

用户反馈：前端问题多、流程跑不动、假数据、页面格式糟糕、测试无法进行。

## 根因分析

### P0 阻塞性问题（必须先修）

1. **`context.tsx` L870 处 `require` 动态引入**
   - `runPipelineExecute` 中写了 `const { toExecView } = require('./services/pipeline')`
   - Vite 使用原生 ESM，`require` 在浏览器端直接报错，导致"执行"按钮点击就挂
   - 所有流水线操作点一次就崩，流程完全跑不动

2. **Mock orchestrator 返回数据结构错误**
   - `featureTable` 返回的数组与 `toFeatureView()` 的字段映射不匹配（9 列 vs 实际 7 列）
   - `caseWorkbook` 只返回 1 条用例，meta 字段不全
   - `defect` 返回空数组，导致缺陷页永远空
   - 各 stage 间输入输出未串联（login→explore→feature→case→execute→defect 的数据未传递）

3. **Table 组件 editable 模式 bug**
   - `components.tsx` L146：`onChange={() => onRowAction?.(r, i, "__edit__" as any) || undefined}`
   - onClick 时没有真正切换到编辑模式，点击单元格没反应

### P1 影响体验的样式问题

4. **CSS 缺失**
   - `SearchableSelect` 组件的 CSS 类（`.searchable-select`, `.ss-display`, `.ss-dropdown`, `.ss-search`, `.ss-options`, `.ss-placeholder`, `.ss-arrow`, `.ss-option`）没有在 styles.css 中定义 → 选择器显示错乱
   - `Case.tsx` 的 meta 头样式（`.meta-row`, `.meta-cell`, `.meta-key`, `.meta-value`）缺失 → Meta 头显示为未排版的 div 堆叠

5. **Toast 无动画**
   - `.toast` 没有过渡动画，出现时很突兀

6. **Defect 截图 lightbox 无效**
   - 点击截图是内联 SVG data URL，在 lightbox 中放大无意义

### P2 清理项

7. **遗留 Python 脚本**（4 个）：`_fix_case.py`, `_modify_case.py`, `_modify_explore.py`, `_modify_feature.py` 混在 `src/` 根目录

## 修复计划

### Phase 1：修 P0 阻塞性问题（核心流程恢复）

#### 1.1 修复 `context.tsx` 的 require 动态引入
- 文件：`packages/app/src/context.tsx`
- 修改 `runPipelineExecute`：将 `const { toExecView } = require(...)` 改为顶部 ESM 静态 import
- 在文件顶部添加：`import { toExecView } from './services/pipeline';`

#### 1.2 重写 `pipeline.ts` 的 mock orchestrator
- 文件：`packages/app/src/services/pipeline.ts`
- 修正 `feature` stage：featureTable 改为 9 列，与 `toFeatureView` 的索引映射对齐
- 修正 `case` stage：返回完整的 caseWorkbook（至少 3-5 条用例，meta 字段齐全）
- 修正 `defect` stage：返回 2-3 个缺陷示例，不再为空
- 实现数据串联：mock 模式下 `runFullPipeline` 和 `runStageX` 间传递真实状态
- 修正 `toFeatureView` 索引映射与新 mock 数据对齐

#### 1.3 修复 Table 组件 editable 交互
- 文件：`packages/app/src/components.tsx`
- 修复 editable 模式点击 → 切换 input 的逻辑
- 保证 onBlur 能正确提交变更

### Phase 2：修 P1 样式/交互问题

#### 2.1 补全 CSS 缺失
- 文件：`packages/app/src/styles.css`
- 添加 `SearchableSelect` 全套样式（dropdown、option、search、placeholder 等）
- 添加 meta 头样式（`.meta-row`, `.meta-cell`, `.meta-key`, `.meta-value`）
- 给 `.toast` 添加 fade-in/fade-out 过渡

#### 2.2 修复 Workbench 真实流水线按钮
- 文件：`packages/app/src/screens/Workbench.tsx`
- 点击"探索/功能点/用例/执行/缺陷"按钮后，调用成功的 pipeline 应该把结果写入 state，然后自动跳转到对应屏
- 修复当前"调用了但没反应"的情况

#### 2.3 修复 Defect 截图显示
- 文件：`packages/app/src/screens/Defect.tsx`
- 截图列改为显示文件名 + 占位图标，lightbox 显示有意义的占位图

### Phase 3：清理

#### 3.1 删除遗留 Python 脚本
- 删除 `src/_fix_case.py`, `src/_modify_case.py`, `src/_modify_explore.py`, `src/_modify_feature.py`

## 影响范围

- `packages/app/src/context.tsx` — 中等改动（修复 require + 确保 pipeline 流程串联）
- `packages/app/src/services/pipeline.ts` — 中等改动（重写 mock 数据 + 串联）
- `packages/app/src/components.tsx` — 小改动（修复 Table editable）
- `packages/app/src/styles.css` — 中等改动（新增缺失样式）
- `packages/app/src/screens/Workbench.tsx` — 小改动（按钮行为修正）
- `packages/app/src/screens/Defect.tsx` — 小改动（截图显示）
- 删除 4 个 .py 文件

## 风险与注意事项

1. **contracts 包冻结**：pipeline.ts 的输入/输出类型对齐 @test-platform/contracts，修改类型转换时不能改接口签名
2. **不改后端**：本次修复只涉及前端 mock 模式和样式，不触碰 orchestrator / engine-mcp
3. **保持现状**：不引入新依赖，不修改 tsconfig / vite 配置
4. **渐进式**：Phase 1 完成后先验证流程能跑通，再推进 Phase 2/3

## 验收标准

1. ✅ 点击 Workbench 的"探索/功能点/用例/执行/缺陷"按钮能正常执行完成，state 数据更新，页面自动跳转
2. ✅ 无任何浏览器控制台错误
3. ✅ Table 的单元格可点击编辑
4. ✅ SearchableSelect 显示正常
5. ✅ Case 页 meta 头排版正常
6. ✅ Toast 有淡入淡出动画
7. ✅ 无遗留 Python 脚本