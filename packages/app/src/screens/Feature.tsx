import React, { useState, useCallback, useMemo } from "react";
import { Button, Modal, Tag, ConfirmDialog } from "../components";
import { useApp } from "../context";
import type { FeatureRowView } from "../context";
import { fromModuleView } from "../services/pipeline";
import { deriveDisplayRows } from "../services/abbr";
import { useDebounce } from "../hooks/useDebounce";
import type { DesignSource } from '@test-platform/contracts';

/** 判断值是否可合并（空值不合并，每行独立；chapter 列除外） */
function canMerge(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

/** 计算每一列每个单元格的合并信息（纵向合并） */
type MergeInfo = { rowSpan: number; isTop: boolean };

/** 判断某列的值是否允许合并：
 *  - testPointId 列不合并（行级唯一主键，必须每格独立）
 *  - 其余列按真实值判断是否同值合并（含空值：主模块有数据、子模块为空时，空子模块也整列合并）
 *    对齐金标准纵向合并语义（空单元格同样参与 rowSpan，视觉上合并为一片空白）
 */
function canMergeColumn(col: keyof FeatureRowView, _v: unknown): boolean {
  if (col === "testPointId") return false;
  return true;
}

/** 是否属于同一合并单元：值相同 且 若值为空（归属更高层级）则更高层级也必须相同，
 *  避免"首页组子模块空"与"AI对话组子模块空"被错误合并成一片。
 *  层级边界规则（对应九列顺序）：
 *    chapter 空 → 跟随 system/mainModule/subModule 是否相同
 *    subModule 空 → 跟随 system/mainModule 是否相同
 *    feature 空 → 跟随 system/mainModule/subModule 是否相同
 *    testPoint 空 → 跟随 system/mainModule/subModule/feature 是否相同
 */
function sameMergeGroup(rows: FeatureRowView[], i: number, j: number, col: keyof FeatureRowView): boolean {
  if (rows[i][col] !== rows[j][col]) return false;
  const bounds: Partial<Record<keyof FeatureRowView, (keyof FeatureRowView)[]>> = {
    chapter: ["system", "mainModule", "subModule"],
    subModule: ["system", "mainModule"],
    feature: ["system", "mainModule", "subModule"],
    testPoint: ["system", "mainModule", "subModule", "feature"],
  };
  const deps = bounds[col] ?? [];
  return deps.every((d) => rows[i][d] === rows[j][d]);
}

/** 计算每一列每个单元格的合并信息（纵向合并） */
function buildMergeInfo(rows: FeatureRowView[]) {
  const n = rows.length;
  const infoMap: Record<string, MergeInfo> = {};

  if (n === 0) return { infoMap };

  // 九列中除了 seq/操作列(非数据)其余均参与合并：
  //   type, chapter, system, mainModule, subModule, feature, testPoint 按值合并；
  //   testPointId 不合并（行级唯一）——在 canMergeColumn 中拦截。
  const allCols: (keyof FeatureRowView)[] = ["type", "chapter", "system", "mainModule", "subModule", "feature", "testPoint", "testPointId"];

  for (const col of allCols) {
    let i = 0;
    while (i < n) {
      const val = rows[i][col];
      if (!canMergeColumn(col, val)) {
        infoMap[`${col}-${i}`] = { rowSpan: 1, isTop: true };
        i++;
        continue;
      }
      const compareVal = val;
      let j = i + 1;
      while (j < n && canMergeColumn(col, rows[j][col]) && sameMergeGroup(rows, i, j, col) && rows[j][col] === compareVal) {
        j++;
      }
      const size = j - i;
      for (let k = i; k < j; k++) {
        infoMap[`${col}-${k}`] = { rowSpan: k === i ? size : 0, isTop: k === i };
      }
      i = j;
    }
  }

  return { infoMap };
}

export function Feature() {
  const { featureRows, featureConfirmed, featureAddRow, featureRemoveRow, featureUpdateRow, featureConfirm, featureUnconfirm, featureToggleReview, saveFeatureTable, reloadFeatureTable, loadFeatureTemplate, toast, addActivity, runPipelineFeature, moduleTree, pipelineLoading, pipelineStage, system } = useApp();
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [cellValue, setCellValue] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; index: number } | null>(null);
  const [featureDirty, setFeatureDirty] = useState(false);
  const [designImportOpen, setDesignImportOpen] = useState(false);
  const [designKind, setDesignKind] = useState<DesignSource['kind']>('openapi');
  const [designName, setDesignName] = useState('');
  const [designContent, setDesignContent] = useState('');
  const [designSources, setDesignSources] = useState<DesignSource[]>([]);
  // 显示态派生：
  //   state.featureRows 保留"用户真实原文"（用于 fromFeatureViewToTable 序列化回 contracts 9 列，不丢失括号别名），
  //   UI 渲染/纵向合并/HTML 导出一律基于显示态 displayRows：
  //     ① normalizeDisplayLabel 去掉 (英文名/别名) 括号内容；
  //     ② main==sub 主模块列隐藏、sub==feature 功能列隐藏（父子去重展示）。
  const displayRows = useMemo(() => deriveDisplayRows(featureRows), [featureRows]);
  const { infoMap } = buildMergeInfo(displayRows);

  const debouncedSave = useDebounce(async () => {
    try {
      await saveFeatureTable();
      setFeatureDirty(false);
    } catch {
      // Explicit save reports errors; autosave failure leaves the draft marker visible.
    }
  }, 800);

  const autoSave = useCallback(() => {
    setFeatureDirty(true);
    debouncedSave();
  }, [debouncedSave]);

  const handleGenerateFeature = async () => {
    if ((!moduleTree || moduleTree.length === 0) && designSources.length === 0) {
      toast("请先运行探索流程，或导入 OpenAPI/工作流设计证据");
      return;
    }
    try {
      const contractInput = {
        moduleTree: fromModuleView(moduleTree),
        systemName: system?.name ?? 'default',
        confirmedOnly: false,
        designSources,
      };
      await runPipelineFeature(contractInput);
      toast("功能点生成成功");
      addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "功能点自动生成" });
    } catch (e) {
      toast(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const addDesignSource = () => {
    if (!designContent.trim()) {
      toast('请粘贴或选择设计证据文件');
      return;
    }
    const name = designName.trim() || (designKind === 'openapi' ? 'openapi.json' : 'workflow.json');
    setDesignSources((current) => [...current, { kind: designKind, name, content: designContent }]);
    setDesignContent('');
    setDesignName('');
    setDesignImportOpen(false);
    toast(`已添加设计证据：${name}`);
  };

  const importDesignFile = async (file: File | undefined) => {
    if (!file) return;
    setDesignContent(await file.text());
    setDesignName(file.name);
    if (/\.ya?ml$/i.test(file.name)) setDesignKind('openapi');
  };

  const handleAddRow = (index?: number) => {
    featureAddRow(index);
    autoSave();
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "新增功能点行" });
    toast("已新增行，合并已自动处理");
  };

  const handleRemoveRow = (index: number) => {
    featureRemoveRow(index);
    autoSave();
    toast("已删除行");
    setConfirmDialog(null);
  };

  const startEditCell = (row: number, col: string, value: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingCell({ row, col });
    setCellValue(value);
  };

  const commitEditCell = () => {
    if (editingCell) {
      featureUpdateRow(editingCell.row, { [editingCell.col]: cellValue } as Partial<FeatureRowView>);
      autoSave();
      setEditingCell(null);
      setCellValue("");
    }
  };

  const handleCopyToExcel = () => {
    const tableContainer = document.querySelector(".feature-excel-tbl");
    if (!tableContainer) {
      toast("未找到表格");
      return;
    }

    // 克隆 DOM，避免影响原页面
    const clone = tableContainer.cloneNode(true) as HTMLElement;

    // 移除操作列等不需要复制的元素
    const noCopy = clone.querySelectorAll(".op, .row-actions, button");
    noCopy.forEach((el) => el.parentNode?.removeChild(el));

    // 找到操作列并移除最后一列
    const table = clone.querySelector("table");
    if (table) {
      // 移除表头最后一列（操作）
      const thCells = table.querySelectorAll("thead th");
      if (thCells.length > 0) thCells[thCells.length - 1].remove();
      // 移除所有行的最后一个 td
      const bodyRows = table.querySelectorAll("tbody tr");
      bodyRows.forEach((tr) => {
        const tdCells = tr.querySelectorAll("td");
        if (tdCells.length > 0) tdCells[tdCells.length - 1].remove();
      });
    }

    // 为所有单元格添加内联样式（Excel 兼容）
    const allCells = clone.querySelectorAll("td, th");
    allCells.forEach((cell) => {
      const htmlCell = cell as HTMLElement;
      htmlCell.style.border = "1px solid #000000";
      htmlCell.style.fontFamily = "SimSun, 宋体, serif";
      htmlCell.style.fontSize = "12px";
      htmlCell.style.padding = "8px 10px";
      htmlCell.style.wordWrap = "break-word";
      htmlCell.style.whiteSpace = "normal";
      htmlCell.style.verticalAlign = "middle";
      htmlCell.style.textAlign = "center";
      // 移除所有 React 事件属性
      htmlCell.removeAttribute("onclick");
      htmlCell.removeAttribute("onblur");
      htmlCell.removeAttribute("onchange");
      // 清空 input 的值或替换为文本
      if (htmlCell.querySelector("input")) {
        const input = htmlCell.querySelector("input");
        htmlCell.textContent = input?.getAttribute("value") || "";
      }
    });

    // 清空所有 span 中的内容（保留文本）
    const spans = clone.querySelectorAll("span");
    spans.forEach((span) => {
      const text = span.textContent || "";
      if (span.parentNode) {
        span.parentNode.replaceChild(document.createTextNode(text), span);
      }
    });

    // 临时插入 DOM 并复制
    clone.style.position = "absolute";
    clone.style.left = "-9999px";
    document.body.appendChild(clone);

    const range = document.createRange();
    range.selectNode(clone);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand("copy");
        toast("已复制到 Excel，粘贴即可保留格式");
      } catch {
        toast("复制失败，请手动复制");
      }
      selection.removeAllRanges();
    }

    document.body.removeChild(clone);
  };

  /** 构建带完整样式和合并的 HTML 表格（Excel 兼容） */
  const buildStyledHtmlTable = (rows: FeatureRowView[]): string => {
    const { infoMap: mergeInfo } = buildMergeInfo(rows);

    const headers = ["序号", "测试类型", "需求章节", "系统名称", "主模块", "子模块", "功能点", "测试点", "测试点标识"];

    const colWidths = [50, 80, 70, 130, 100, 90, 100, 110, 140];

    let html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<!--[if gte mso 9]>
<xml>
  <x:ExcelWorkbook>
    <x:ExcelWorksheets>
      <x:ExcelWorksheet>
        <x:Name>功能点</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
      </x:ExcelWorksheet>
    </x:ExcelWorksheets>
  </x:ExcelWorkbook>
</xml>
<![endif]-->
</head>
<body>
<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:'SimSun','宋体',serif;font-size:12px;">`;

    // 表头
    html += '<thead><tr>';
    headers.forEach((h, idx) => {
      html += `<th style="border:1px solid #000;background:#f3f4f6;font-weight:bold;text-align:center;width:${colWidths[idx]}px;">${h}</th>`;
    });
    html += '</tr></thead>';

    // 数据行
    html += '<tbody>';
    rows.forEach((r, i) => {
      html += '<tr>';

      // 序号
      html += `<td style="border:1px solid #000;text-align:center;">${r.seq}</td>`;

      // 测试类型 (type) - 合并
      const typeInfo = mergeInfo[`type-${i}`];
      if (typeInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;" rowSpan="${typeInfo.rowSpan}">${r.type}</td>`;
      }

      // 需求章节 (chapter) - 按真实值合并；空值时展示为占位
      const chapterInfo = mergeInfo[`chapter-${i}`];
      if (chapterInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;" rowSpan="${chapterInfo.rowSpan}">${r.chapter || '&nbsp;'}</td>`;
      }

      // 系统名称 (system) - 合并
      const systemInfo = mergeInfo[`system-${i}`];
      if (systemInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;background:#f9fafb;" rowSpan="${systemInfo.rowSpan}">${r.system}</td>`;
      }

      // 主模块 (mainModule) - 合并
      const mainInfo = mergeInfo[`mainModule-${i}`];
      if (mainInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;background:#f9fafb;" rowSpan="${mainInfo.rowSpan}">${r.mainModule}</td>`;
      }

      // 子模块 (subModule) - 合并
      const subInfo = mergeInfo[`subModule-${i}`];
      if (subInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;background:#f9fafb;" rowSpan="${subInfo.rowSpan}">${r.subModule}</td>`;
      }

      // 功能点 (feature) - 合并
      const featureInfo = mergeInfo[`feature-${i}`];
      if (featureInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;background:#f9fafb;" rowSpan="${featureInfo.rowSpan}">${r.feature}</td>`;
      }

      // 测试点 (testPoint) - 允许同值合并
      const testPointInfo = mergeInfo[`testPoint-${i}`];
      if (testPointInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;" rowSpan="${testPointInfo.rowSpan}">${r.testPoint}</td>`;
      }

      // 测试点标识 (testPointId) - 不合并（行级唯一主键）
      const testPointIdInfo = mergeInfo[`testPointId-${i}`];
      if (testPointIdInfo?.isTop) {
        html += `<td style="border:1px solid #000;text-align:center;font-family:ui-monospace,monospace;" rowSpan="${testPointIdInfo.rowSpan}">${r.testPointId}</td>`;
      }

      html += '</tr>';
    });
    html += '</tbody></table></body></html>';

    return html;
  };

  const handleExportExcel = () => {
    if (featureRows.length === 0) {
      toast("无数据可导出");
      return;
    }

    const html = buildStyledHtmlTable(displayRows);
    const blob = new Blob(["\ufeff" + html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fileName = `功能点表_${new Date().toISOString().slice(0, 10)}.xls`;
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`已导出 ${fileName}`);
  };

  return (
    <>
      <div className="ph">
        <div>
          <h2>③ 功能点审核</h2>
          <div className="sub">九列 + 纵向合并 + 增删 + 整体确认 · 镜像 TestMaster · 严格遵循金标准</div>
        </div>
        <div className="row">
          <Button onClick={() => { loadFeatureTemplate(); addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "加载固定模板" }); }}>加载固定模板</Button>
          <Button onClick={() => { reloadFeatureTable(); addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "加载本轮版本" }); }}>加载本轮版本</Button>
          <Button onClick={() => setDesignImportOpen(true)}>导入设计证据</Button>
          <Button variant="pri" onClick={handleGenerateFeature} disabled={(!moduleTree || moduleTree.length === 0) && designSources.length === 0}>
            {pipelineLoading && pipelineStage === 'feature' ? '生成中...' : '生成功能点'}
          </Button>
          <Button variant="pri" onClick={() => { saveFeatureTable(); addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "保存功能点草稿" }); }}>保存草稿</Button>
          <Button onClick={handleExportExcel}>导出 Excel</Button>
          <Button
            variant="pri"
            onClick={() => {
              if (featureConfirmed) {
                featureUnconfirm();
                toast("已取消确认");
              } else {
                setConfirmOpen(true);
              }
            }}
          >
            {featureConfirmed ? "✓ 已确认（点击取消）" : "✓ 整体确认"}
          </Button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <Button
          size="sm"
          title="新增功能点行"
          onClick={() => handleAddRow()}
        >
          + 新增行
        </Button>
        <Button size="sm" onClick={handleCopyToExcel}>
          📋 复制到 Excel
        </Button>
        <span style={{ marginLeft: "auto" }} />
        {featureConfirmed ? (
          <Tag tone="ok">已确认</Tag>
        ) : (
          <Tag tone="info">待确认</Tag>
        )}
        {featureDirty && <Tag tone="warn">未保存...</Tag>}
        {featureRows.filter((r) => r.needsReview).length > 0 && (
          <Tag tone="warn">
            {featureRows.filter((r) => r.needsReview).length} needs_review
          </Tag>
        )}
      </div>

      <div className="tbl-wrap feature-excel-tbl">
        {featureRows.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "#6b7280" }}>
            <div style={{ fontSize: 40, marginBottom: 12, lineHeight: 1 }}>📋</div>
            <div style={{ fontSize: 14, marginBottom: 20, color: "#6b7280" }}>暂无功能点数据，点击下方按钮新增第一行</div>
            <Button variant="pri" onClick={() => handleAddRow()}>+ 新增第一行</Button>
          </div>
        ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>序号</th>
              <th style={{ width: 80 }}>测试类型</th>
              <th style={{ width: 70 }}>需求章节</th>
              <th style={{ width: 130 }}>系统名称</th>
              <th style={{ width: 100 }}>主模块</th>
              <th style={{ width: 90 }}>子模块</th>
              <th style={{ width: 100 }}>功能点</th>
              <th style={{ width: 110 }}>测试点</th>
              <th style={{ width: 140 }}>测试点标识</th>
              <th style={{ width: 100 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, i) => {
              const typeInfo = infoMap[`type-${i}`];
              const chapterInfo = infoMap[`chapter-${i}`];
              const systemInfo = infoMap[`system-${i}`];
              const mainInfo = infoMap[`mainModule-${i}`];
              const subInfo = infoMap[`subModule-${i}`];
              const featureInfo = infoMap[`feature-${i}`];
              const testPointInfo = infoMap[`testPoint-${i}`];
              const testPointIdInfo = infoMap[`testPointId-${i}`];

              const showType = typeInfo?.isTop ?? true;
              const showChapter = chapterInfo?.isTop ?? true;
              const showSystem = systemInfo?.isTop ?? true;
              const showMain = mainInfo?.isTop ?? true;
              const showSub = subInfo?.isTop ?? true;
              const showFeature = featureInfo?.isTop ?? true;
              const showTestPoint = testPointInfo?.isTop ?? true;
              const showTestPointId = testPointIdInfo?.isTop ?? true;

              const typeSpan = typeInfo?.rowSpan ?? 1;
              const chapterSpan = chapterInfo?.rowSpan ?? 1;
              const systemSpan = systemInfo?.rowSpan ?? 1;
              const mainSpan = mainInfo?.rowSpan ?? 1;
              const subSpan = subInfo?.rowSpan ?? 1;
              const featureSpan = featureInfo?.rowSpan ?? 1;
              const testPointSpan = testPointInfo?.rowSpan ?? 1;
              const testPointIdSpan = testPointIdInfo?.rowSpan ?? 1;

              return (
                <tr key={i}>
                  <td onClick={(e) => startEditCell(i, "seq", String(r.seq), e)} style={{ cursor: "text" }}>
                    {editingCell?.row === i && editingCell?.col === "seq" ? (
                      <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                    ) : (
                      r.seq
                    )}
                  </td>
                  {showType && (
                    <td className="merge" rowSpan={typeSpan} onClick={(e) => startEditCell(i, "type", String(r.type), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "type" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        r.type
                      )}
                    </td>
                  )}
                  {showChapter && (
                    <td className="merge" rowSpan={chapterSpan} onClick={(e) => startEditCell(i, "chapter", String(r.chapter), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "chapter" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        r.chapter
                      )}
                    </td>
                  )}
                  {showSystem && (
                    <td className="merge" rowSpan={systemSpan} onClick={(e) => startEditCell(i, "system", String(r.system), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "system" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        r.system
                      )}
                    </td>
                  )}
                  {showMain && (
                    <td className="merge" rowSpan={mainSpan} onClick={(e) => startEditCell(i, "mainModule", String(r.mainModule), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "mainModule" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        r.mainModule
                      )}
                    </td>
                  )}
                  {showSub && (
                    <td className="merge" rowSpan={subSpan} onClick={(e) => startEditCell(i, "subModule", String(r.subModule), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "subModule" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        r.subModule
                      )}
                    </td>
                  )}
                  {showFeature && (
                    <td className="merge" rowSpan={featureSpan} onClick={(e) => startEditCell(i, "feature", String(r.feature), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "feature" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        r.feature
                      )}
                    </td>
                  )}
                  {showTestPoint && (
                    <td className="merge" rowSpan={testPointSpan} onClick={(e) => startEditCell(i, "testPoint", String(r.testPoint), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "testPoint" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        <>
                          {r.testPoint}
                          {!editingCell && r.needsReview && (
                            <span onClick={(e) => { e.stopPropagation(); featureToggleReview(i); }} style={{ cursor: "pointer" }}><Tag tone="warn">
                              needs_review
                            </Tag></span>
                          )}
                        </>
                      )}
                    </td>
                  )}
                  {showTestPointId && (
                    <td className="mono merge" rowSpan={testPointIdSpan} onClick={(e) => startEditCell(i, "testPointId", String(r.testPointId), e)} style={{ cursor: "text" }}>
                      {editingCell?.row === i && editingCell?.col === "testPointId" ? (
                        <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                      ) : (
                        r.testPointId
                      )}
                    </td>
                  )}
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="op">
                      <Button size="sm" onClick={(e) => { e?.stopPropagation(); handleAddRow(i); }} title="在当前行下方插入新行">
                        +
                      </Button>
                      <Button size="sm" variant="dng" onClick={(e) => { e?.stopPropagation(); setConfirmDialog({ open: true, index: i }); }} title="删除当前行">
                        ×
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="整体确认"
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button
              variant="pri"
              onClick={() => {
                setConfirmOpen(false);
                featureConfirm();
                addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "功能点整体确认" });
                toast("已整体确认，可生成用例");
              }}
            >
              ✓ 确认
            </Button>
          </>
        }
      >
        <p>确认后，已确认的功能点将用于生成测试用例。未确认/needs_review 的功能点不会生成用例。</p>
        <div className="meta-head">
          已确认 {featureRows.length - featureRows.filter((r) => r.needsReview).length} 条 · needs_review{" "}
          {featureRows.filter((r) => r.needsReview).length} 条 · 共 {featureRows.length} 条
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDialog?.open ?? false}
        onClose={() => setConfirmDialog(null)}
        onConfirm={() => confirmDialog && handleRemoveRow(confirmDialog.index)}
        title="删除行确认"
        message="确定要删除此行功能点吗？此操作不可恢复。"
        danger
      />

      <Modal
        open={designImportOpen}
        onClose={() => setDesignImportOpen(false)}
        title="导入设计证据"
        footer={
          <>
            <Button onClick={() => setDesignImportOpen(false)}>取消</Button>
            <Button variant="pri" onClick={addDesignSource}>加入本次生成</Button>
          </>
        }
      >
        <div className="field">
          <label>证据类型</label>
          <select className="text-input" value={designKind} onChange={(event) => setDesignKind(event.target.value as DesignSource['kind'])}>
            <option value="openapi">OpenAPI / Swagger</option>
            <option value="workflow">业务工作流 JSON</option>
          </select>
        </div>
        <div className="field">
          <label>文件</label>
          <input type="file" accept={designKind === 'openapi' ? '.json,.yaml,.yml,application/json,application/yaml,text/yaml' : '.json,application/json'} onChange={(event) => void importDesignFile(event.target.files?.[0])} />
        </div>
        <div className="field">
          <label>来源名称</label>
          <input className="text-input" value={designName} onChange={(event) => setDesignName(event.target.value)} placeholder={designKind === 'openapi' ? 'openapi.yaml' : 'workflow.json'} />
        </div>
        <div className="field">
          <label>结构化内容</label>
          <textarea className="text-input" value={designContent} onChange={(event) => setDesignContent(event.target.value)} rows={10} style={{ width: '100%' }} />
        </div>
      </Modal>

      {designSources.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          <Tag tone="info">设计证据 {designSources.length}</Tag>
          {designSources.map((source, index) => (
            <Button key={`${source.kind}-${source.name}-${index}`} size="sm" onClick={() => setDesignSources((current) => current.filter((_, currentIndex) => currentIndex !== index))} title="移除设计证据">
              {source.name ?? source.kind} ×
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
