# 功能点审核页面 - 单元格合并 & Excel 格式修复计划

## 问题分析

### 问题 1：第二列（测试类型）未合并，第三列（需求章节）需空出后合并

**根因**：`buildMergeInfo` 函数（`Feature.tsx` 第 19-48 行）目前仅处理 `system`, `mainModule`, `subModule`, `feature` 四列，遗漏了 `type`（测试类型）和 `chapter`（需求章节）。

**现状**：
| 列序 | 字段 | 当前状态 | 期望状态 |
|------|------|----------|----------|
| 1 | seq (序号) | 独立单元格 ✅ | 独立单元格 |
| 2 | type (测试类型) | 未合并 ❌ | 纵向合并 |
| 3 | chapter (需求章节) | 显示内容 ❌ | 清空内容 + 纵向合并 |
| 4 | system (系统名称) | 合并 ✅ | 保持不变 |
| 5 | mainModule (主模块) | 合并 ✅ | 保持不变 |
| 6 | subModule (子模块) | 合并 ✅ | 保持不变 |
| 7 | feature (功能点) | 合并 ✅ | 保持不变 |
| 8 | testPoint (测试点) | 独立单元格 ✅ | 保持不变 |
| 9 | testPointId (测试点标识) | 独立单元格 ✅ | 保持不变 |

---

### 问题 2：复制到 Excel / 导出 Excel 格式丢失

**根因**：
1. **复制到 Excel**（`Feature.tsx` 第 135-159 行）：使用纯文本 + TAB 分隔符写入剪贴板，Excel 粘贴时无法保留合并单元格结构。
2. **导出 Excel**（`Feature.tsx` 第 161-200 行）：使用 `xlsx` 社区版库，该版本**不支持单元格样式**（字体、边框、合并后的外观等），只能导出纯数据 + 合并区域。

**参考项目方案**：`test-expert-local` 中的 `copyToExcel` 函数采用 **DOM 克隆 + 内联样式 + `execCommand("copy")`** 方案，Excel 粘贴后可完整保留表格结构和样式。

---

## 修改计划

### 文件：[Feature.tsx](file:///d:/newTest/packages/app/src/screens/Feature.tsx)

#### 修改 1：扩展 `buildMergeInfo` 函数

**变更**：将 `type` 和 `chapter` 加入需要合并的列列表

```typescript
// 第 21 行，修改 cols 数组
const cols: (keyof FeatureRowView)[] = ["type", "chapter", "mainModule", "subModule", "feature"];

// 第 25 行，allCols 也加入 type 和 chapter
const allCols: (keyof FeatureRowView)[] = ["type", "chapter", "system", ...cols];
```

同时需要为 `type` 和 `chapter` 列在渲染表格时添加 `rowSpan` 逻辑（类似 `system`, `mainModule` 等列的处理方式）。

#### 修改 2：`chapter` 列（需求章节）清空后显示

在渲染 `chapter` 列时，若该值为空或被清空，显示为空字符串但仍保留合并逻辑。用户要求"第三列需要空出来"——即在视觉上这一列留空，仅做合并。

#### 修改 3：重写 `handleCopyToExcel` 函数

**方案**：参考 `test-expert-local` 项目，使用 DOM 克隆方式

```typescript
const handleCopyToExcel = () => {
  const tableContainer = document.querySelector('.feature-excel-tbl');
  if (!tableContainer) return;

  // 克隆 DOM，避免影响原页面
  const clone = tableContainer.cloneNode(true) as HTMLElement;
  
  // 移除操作列等不需要复制的元素
  const noCopy = clone.querySelectorAll('.op, .row-actions');
  noCopy.forEach(el => el.parentNode?.removeChild(el));

  // 为所有单元格添加内联样式（Excel 兼容）
  const allCells = clone.querySelectorAll('td, th');
  allCells.forEach(cell => {
    const htmlCell = cell as HTMLElement;
    htmlCell.style.border = '1px solid #000000';
    htmlCell.style.fontFamily = 'SimSun, 宋体, serif';
    htmlCell.style.fontSize = '12px';
    htmlCell.style.padding = '8px 10px';
    htmlCell.style.wordWrap = 'break-word';
    htmlCell.style.whiteSpace = 'normal';
  });

  // 临时插入 DOM 并复制
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  document.body.appendChild(clone);
  
  const range = document.createRange();
  range.selectNode(clone);
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('copy');
    selection.removeAllRanges();
  }
  
  document.body.removeChild(clone);
  toast('已复制到 Excel，粘贴即可保留格式');
};
```

#### 修改 4：重写 `handleExportExcel` 函数

**方案**：由于 `xlsx` 社区版不支持样式导出，改用 **生成 HTML 文件 + Excel 打开** 方案，完美保留合并单元格和样式。

```typescript
const handleExportExcel = () => {
  if (featureRows.length === 0) {
    toast('无数据可导出');
    return;
  }

  // 构建 HTML table，包含内联样式
  const html = buildStyledHtmlTable(featureRows);
  
  // 创建 Blob 并下载
  const blob = new Blob(['\ufeff' + html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fileName = `功能点表_${new Date().toISOString().slice(0, 10)}.xls`;
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  toast(`已导出 ${fileName}`);
};

// 构建带样式和合并的 HTML 表格
function buildStyledHtmlTable(rows: FeatureRowView[]): string {
  // 1. 构建与 DOM 渲染一致的合并信息
  // 2. 生成 <table> 标签，包含 border, font, rowSpan 等内联样式
  // 3. 返回完整 HTML 字符串
}
```

**注意**：文件扩展名使用 `.xls`（Excel 兼容 HTML 格式），Excel 打开时可完整保留合并单元格和样式。

#### 修改 5：扩展 `computeMerges` 函数（导出用）

为 Excel 导出（如果仍需要 xlsx 格式）和 HTML 导出提供合并信息支持。

---

### 文件：[styles.css](file:///d:/newTest/packages/app/src/styles.css)

可能需要微调 `.feature-excel-tbl` 相关样式，确保内联样式优先级正确。

---

## 依赖与风险

| 项目 | 说明 |
|------|------|
| **无新依赖** | 所有实现使用原生 DOM API + 已有的 `xlsx` 库（如果保留 xlsx 导出） |
| **向后兼容** | 导出格式从 `.xlsx` 变为 `.xls`（HTML 格式），Excel/WPS 均可打开，用户体验一致 |
| **剪贴板权限** | `document.execCommand("copy")` 在用户交互上下文中调用，无需额外权限 |
| **测试覆盖** | 需验证合并逻辑变更不影响现有测试用例 |

---

## 验证步骤

1. ✅ 加载固定模板，确认第二列（测试类型）正确合并
2. ✅ 确认第三列（需求章节）显示为空且正确合并
3. ✅ 点击"复制到 Excel" → 粘贴到 Excel，检查：
   - 合并单元格结构正确
   - 边框、字体样式保留
   - 数据完整
4. ✅ 点击"导出 Excel" → 用 Excel 打开，检查：
   - 合并单元格结构正确
   - 样式与页面一致
   - 数据完整
