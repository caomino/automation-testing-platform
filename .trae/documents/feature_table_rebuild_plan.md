# 功能点页面重构计划：表格样式、单元格合并与 Excel 导出

## 1. 需求分析

根据用户提供的 Excel 截图和参考项目 `test-expert-local`，目标是将 `Feature.tsx` 页面改造成符合 Excel 格式要求的专业表格：

### 1.1 核心问题
1.  **单元格合并逻辑缺陷**：当前代码依赖 `FeatureRowView.merge` 字段判断合并，但该字段在 `buildFeatureTable` 生成时未正确填充，导致 `colspan`/`rowspan` 合并逻辑失效。
2.  **导出格式不一致**：当前导出使用 CSV/TSV，无法保留单元格合并结构、边框样式和字体，与 Excel 截图格式要求差距大。
3.  **编辑体验不佳**：点击单元格时生成的 `<input>` 带有明显的蓝色边框 (`cell-edit` 类) 和阴影，破坏了表格的视觉整体性。

### 1.2 参考标准 (Excel 截图分析)
根据用户上传的图片，目标表格样式如下：
*   **表头**：浅灰色背景，加粗。
*   **合并规则**：
    *   **A-D 列** (序号、测试类型、需求章节、系统名称)：通常不合并或按主模块合并。
    *   **E 列** (主模块)：纵向合并，跨越所有子模块行。
    *   **F 列** (子模块)：纵向合并，跨越所有功能点行。
    *   **G 列** (功能点)：纵向合并，跨越所有测试点行。
    *   **H-I 列** (测试点、测试点标识)：不合并，每行独立。
*   **边框**：所有单元格有明显的黑色实线边框 (`border: 1px solid #000`)。
*   **字体**：宋体 (FangSong)，较小字号 (9pt)。

## 2. 修复方案

### 步骤 1：修复单元格合并逻辑 (`Feature.tsx`)
重写 `computeGroups` 函数，基于数据内容自动计算合并关系，不再依赖不可靠的 `merge` 字段。

```typescript
// 新逻辑：遍历行，按"主模块"、"子模块"、"功能点"三个层级聚合
function computeGroups(rows: FeatureRowView[]) {
  const groups: { start: number; size: number; type: 'mainModule' | 'subModule' | 'feature' }[] = [];
  let i = 0;
  while (i < rows.length) {
    let size = 1;
    // 向上检查：如果当前行与上一行在主/子/功能模块上相同，则归入同一组合并
    // ...
    groups.push({ start: i, size, type: '...' });
    i += size;
  }
  return groups;
}
```

### 步骤 2：优化单元格编辑样式 (`styles.css`)
修改 `.cell-edit` 样式，实现“无感编辑”效果：
*   去除边框 (`border: none`)。
*   去除阴影 (`box-shadow: none`)。
*   背景透明 (`background: transparent`)。
*   字体大小与父单元格一致。
*   仅在聚焦时保留光标提示。

### 步骤 3：实现 Excel 原生格式导出
引入 `xlsx` (SheetJS) 库，生成真正的 `.xlsx` 文件：
1.  **安装依赖**：`pnpm --filter @test-platform/app add xlsx`
2.  **实现 `handleExportExcel`**：
    *   使用 `XLSX.utils.book_new()` 创建工作簿。
    *   使用 `XLSX.utils.json_to_sheet()` 生成 Sheet。
    *   计算合并区域 (`!merges`)，对应 Excel 截图中的层级结构。
    *   设置列宽 (`!cols`)。
    *   写入单元格样式（字体、边框、对齐）。
    *   导出为 `.xlsx` 文件。

### 步骤 4：视觉还原度提升
*   为 `tbody td` 添加 `border: 1px solid #d1d5db` 实线边框。
*   将字体改为系统默认的衬线风格（若需严格匹配宋体，可引入 `font-family: SimSun`）。
*   表头背景色改为 `#f3f4f6` (浅灰)。

## 3. 执行步骤

1.  **更新 `Feature.tsx`**：
    *   重写 `computeGroups`。
    *   修改 `handleExportExcel`，使用 `xlsx` 导出。
    *   根据新的合并规则调整 `<td>` 渲染逻辑 (`rowSpan`)。
2.  **更新 `styles.css`**：
    *   优化 `.cell-edit` 样式。
    *   增加表格边框和字体样式。
3.  **验证**：
    *   检查页面合并效果是否符合 Excel 截图。
    *   点击导出按钮，验证下载的 `.xlsx` 文件是否保留了合并结构。

## 4. 风险与依赖
*   **依赖新增**：需要在 `@test-platform/app` 包中新增 `xlsx` 依赖。
*   **样式兼容性**：直接修改 `.cell-edit` 可能影响 `Case.tsx` 等其他页面，需确认全局影响或使用局部样式覆盖。
