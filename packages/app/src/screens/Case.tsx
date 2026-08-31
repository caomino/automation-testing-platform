import { useState, useMemo } from "react";
import { Button, Card, Modal, Tag, Toggle, ConfirmDialog, SearchableSelect } from "../components";
import { useApp } from "../context";
import { useModalManager } from "../hooks/useModalManager";
import { buildCaseInput } from "../services/pipeline";
import type { CaseGroupView, CaseStepView } from "../context";

const COL_WIDTHS = [9, 22, 5, 22, 22, 6, 6, 4, 4];

const DEFAULT_CONCLUSION_RULE =
  "初次测试结果与预期结果一致，结论为通过，否则不通过\n回归测试结果与预期结果一致，结论为复测通过，否则不通过";

function coverageId(featureId: string | undefined, coverageKey: string): string {
  return `${featureId ?? ''}:${coverageKey}`;
}

function groupFeatureId(group: CaseGroupView): string | undefined {
  return group.featureId ?? group.steps[0]?.featureId;
}

function localCaseBlockingMessages(groups: CaseGroupView[]): string[] {
  const messages: string[] = [];
  for (const group of groups) {
    const groupLabel = group.caseNo || group.groupId;
    if (group.steps.length === 0) messages.push(`${groupLabel} 缺少测试步骤`);
    for (const step of group.steps) {
      const prefix = `${groupLabel}/${step.stepNumber || step.stepId}`;
      const visibleColumns = [group.caseNo, group.content, step.stepNumber, step.operation, step.expected, step.firstResult, step.regressionResult, step.conclusion];
      if (visibleColumns.some((value) => !String(value ?? '').trim())) messages.push(`${prefix} 存在空白的八列用例字段`);
      const featureId = step.featureId ?? group.featureId;
      const scenarioId = step.scenarioId ?? group.scenarioId;
      const coverageKeys = step.coverageKeys ?? group.coverageKeys;
      const needsReview = step.needsReview ?? group.needsReview;
      const reviewReason = step.reviewReason ?? group.reviewReason;
      if (!featureId) messages.push(`${prefix} 缺少功能点标识`);
      if (!scenarioId) messages.push(`${prefix} 缺少场景标识`);
      if (!coverageKeys?.length) messages.push(`${prefix} 缺少覆盖键`);
      if (needsReview && !reviewReason?.trim()) messages.push(`${prefix} 待复核但缺少原因`);
    }
  }
  return messages;
}

export function Case() {
  const {
    metaHeader,
    caseGroups,
    currentCaseWorkbook,
    caseSelectedModules,
    caseAiOn,
    aiCurrentDefault,
    featureRows,
    featureConfirmed,
    featurePaths,
    featureProfiles,
    featureEvidence,
    caseQualityGateIssues,
    caseGenerations,
    runPipelineCase,
    getFeatureModules,
    caseGroupAdd,
    caseGroupRemove,
    caseStepAdd,
    caseStepRemove,
    caseStepUpdate,
    caseGroupUpdate,
    caseUpdateMeta,
    caseSetSelection,
    caseToggleAi,
    readOnlyClickPolicy,
    setReadOnlyClickPolicy,
    toast,
    addActivity,
    pipelineLoading,
  } = useApp();

  const { openModal, closeModal, isModalOpen } = useModalManager();
  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    groupId: string;
    stepId?: string;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    groupId: string;
    stepId?: string;
    field: string;
  } | null>(null);
  const [cellValue, setCellValue] = useState("");
  const [metaForm, setMetaForm] = useState(metaHeader);
  const [showGenHistory, setShowGenHistory] = useState(false);
  const [moduleSearchQuery, setModuleSearchQuery] = useState("");

  // batchId -> 生成批次元数据（spec §6.5 / §17.7：每组用例可追溯来源）
  const genMap = useMemo(() => {
    const m = new Map<string, typeof caseGenerations[number]>();
    for (const g of caseGenerations) m.set(g.batchId, g);
    return m;
  }, [caseGenerations]);

  const buildSourceTitle = (batchId?: string): string | undefined => {
    if (!batchId) return undefined;
    const gen = genMap.get(batchId);
    if (!gen) return `批次: ${batchId}`;
    return `批次: ${gen.batchId}\n模式: ${gen.mode === 'ai' ? 'AI 辅助' : '无 AI'}\nAI 配置: ${gen.aiConfigId ?? '无'}\nscope: ${gen.scope}${gen.regenerateSelected ? ' · 定点重生成' : ''}`;
  };

  const moduleTreeData = useMemo(() => {
    const mainMap = new Map<string, { mainName: string; subModules: { name: string; count: number }[] }>();
    for (const row of featureRows) {
      const main = row.mainModule || "默认模块";
      const sub = row.subModule || "未分类";
      if (!mainMap.has(main)) {
        mainMap.set(main, { mainName: main, subModules: [] });
      }
      const subs = mainMap.get(main)!.subModules;
      const existing = subs.find((s) => s.name === sub);
      if (existing) {
        existing.count += 1;
      } else {
        subs.push({ name: sub, count: 1 });
      }
    }
    return Array.from(mainMap.values());
  }, [featureRows]);

  const allSubModuleNames = useMemo(() => {
    return Array.from(new Set(featureRows.map((r) => r.subModule).filter(Boolean)));
  }, [featureRows]);

  const filteredModuleTree = useMemo(() => {
    const q = moduleSearchQuery.trim().toLowerCase();
    if (!q) return moduleTreeData;
    return moduleTreeData
      .map((main) => {
        const matchMain = main.mainName.toLowerCase().includes(q);
        const filteredSubs = main.subModules.filter(
          (sub) => matchMain || sub.name.toLowerCase().includes(q)
        );
        return {
          ...main,
          subModules: filteredSubs,
        };
      })
      .filter((main) => main.subModules.length > 0);
  }, [moduleTreeData, moduleSearchQuery]);

  const selectedFeaturePointsCount = useMemo(() => {
    const selectedSet = new Set(caseSelectedModules);
    return featureRows.filter((r) => selectedSet.has(r.subModule)).length;
  }, [featureRows, caseSelectedModules]);

  const handleSelectAllModules = () => {
    caseSetSelection(allSubModuleNames);
  };

  const handleClearModuleSelection = () => {
    caseSetSelection([]);
  };

  const handleInvertModuleSelection = () => {
    const currentSet = new Set(caseSelectedModules);
    const inverted = allSubModuleNames.filter((name) => !currentSet.has(name));
    caseSetSelection(inverted);
  };

  const handleToggleMainModule = (subNames: string[]) => {
    const currentSet = new Set(caseSelectedModules);
    const allSelected = subNames.every((n) => currentSet.has(n));
    if (allSelected) {
      caseSetSelection(caseSelectedModules.filter((n) => !subNames.includes(n)));
    } else {
      const merged = Array.from(new Set([...caseSelectedModules, ...subNames]));
      caseSetSelection(merged);
    }
  };

  const handleToggleSubModule = (name: string) => {
    if (caseSelectedModules.includes(name)) {
      caseSetSelection(caseSelectedModules.filter((s) => s !== name));
    } else {
      caseSetSelection([...caseSelectedModules, name]);
    }
  };


  const handleGenerateSelected = async () => {
    if (!featureRows || featureRows.length === 0) {
      toast("请先在功能点阶段生成功能点数据");
      return;
    }
    if (!featureConfirmed) {
      toast("请先在功能点阶段确认功能点");
      return;
    }
    if (caseSelectedModules.length === 0) {
      toast("请先选择要测试的模块");
      return;
    }
    toast("正在生成选中模块测试用例，请稍候...");
    const input = buildCaseInput(featureRows, caseSelectedModules, metaHeader, 'selected_modules', featurePaths, caseAiOn, featureProfiles, featureEvidence, undefined, currentCaseWorkbook, aiCurrentDefault);
    const result = await runPipelineCase(input);
    if (!result) return;
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `生成选中模块用例: ${caseSelectedModules.join(', ')}` });
    toast("选中模块用例已生成");
  };

  const handleRegenerateSelected = async () => {
    if (!featureRows || featureRows.length === 0) {
      toast("请先在功能点阶段生成功能点数据");
      return;
    }
    if (!featureConfirmed) {
      toast("请先在功能点阶段确认功能点");
      return;
    }
    if (caseSelectedModules.length === 0) {
      toast("请先选择要重新生成的模块");
      return;
    }
    toast("正在重新生成选中模块测试用例，请稍候...");
    const input = buildCaseInput(featureRows, caseSelectedModules, metaHeader, 'selected_modules', featurePaths, caseAiOn, featureProfiles, featureEvidence, true, currentCaseWorkbook, aiCurrentDefault);
    const result = await runPipelineCase(input);
    if (!result) return;
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `重新生成选中模块用例: ${caseSelectedModules.join(', ')}` });
    toast("选中模块用例已重新生成");
  };

  const handleGenerateAll = async () => {
    if (!featureRows || featureRows.length === 0) {
      toast("请先在功能点阶段生成功能点数据");
      return;
    }
    if (!featureConfirmed) {
      toast("请先在功能点阶段确认功能点");
      return;
    }
    toast("正在生成全部测试用例，请稍候...");
    const input = buildCaseInput(featureRows, caseSelectedModules, metaHeader, 'all', featurePaths, caseAiOn, featureProfiles, featureEvidence, undefined, currentCaseWorkbook, aiCurrentDefault);
    const result = await runPipelineCase(input);
    if (!result) return;
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "全部用例已生成" });
    toast("全部用例已生成");
  };

  const groupedByModule = useMemo(() => {
    const map = new Map<string, CaseGroupView[]>();
    for (const g of caseGroups) {
      const key = g.moduleName || "默认";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return map;
  }, [caseGroups]);

  const filteredModules = useMemo(() => {
    const modules = Array.from(groupedByModule.keys());
    if (caseSelectedModules.length === 0) return modules;
    return modules.filter((m) => caseSelectedModules.includes(m));
  }, [groupedByModule, caseSelectedModules]);
  const requiredCoverageKeys = useMemo(() => new Set([
    ...Object.values(featureEvidence).flatMap((evidence: any) => (evidence?.coverageManifest?.requiredKeys ?? evidence?.coverageKeys ?? []).map((key: string) => coverageId(evidence?.featureId || '', key))),
    ...caseGroups.flatMap((group) => (group.coverageKeys ?? []).map((key) => coverageId(groupFeatureId(group), key))),
  ]), [caseGroups, featureEvidence]);
  const observedCoverageKeys = useMemo(() => new Set(
    caseGroups
      .filter((group) => !group.needsReview && group.evidenceLevel === 'observed')
      .flatMap((group) => (group.coverageKeys ?? []).map((key) => coverageId(groupFeatureId(group), key)))
      .filter((key) => requiredCoverageKeys.size === 0 || requiredCoverageKeys.has(key)),
  ), [caseGroups, requiredCoverageKeys]);
  const needsReviewCount = useMemo(() => caseGroups.filter((group) => group.needsReview).length, [caseGroups]);
  const blockingMessages = useMemo(() => [
    ...caseQualityGateIssues.filter((issue) => issue.blocking).map((issue) => issue.message),
    ...Object.values(featureEvidence).flatMap((evidence: any) => (evidence?.coverageManifest?.missingKeys ?? []).map((key: string) => `${evidence?.featureId} 缺少已观测覆盖：${key}`)),
    ...localCaseBlockingMessages(caseGroups),
  ].filter((message, index, all) => all.indexOf(message) === index), [caseGroups, caseQualityGateIssues, featureEvidence]);
  const isExecutable = caseGroups.length > 0 && needsReviewCount < caseGroups.length && blockingMessages.length === 0;

  const startEditCell = (groupId: string, stepId: string | undefined, field: string, value: string) => {
    setEditingCell({ groupId, stepId, field });
    setCellValue(value);
  };

  const commitEditCell = () => {
    if (!editingCell) return;
    const { groupId, stepId, field } = editingCell;
    if (stepId) {
      caseStepUpdate(groupId, stepId, { [field]: cellValue } as Partial<CaseStepView>);
    } else {
      caseGroupUpdate(groupId, { [field]: cellValue } as Partial<CaseGroupView>);
    }
    setEditingCell(null);
    setCellValue("");
  };

  const handleSaveMeta = () => {
    caseUpdateMeta(metaForm);
    toast("配置已同步");
    closeModal();
  };

  const handleApplySelection = () => {
    caseSetSelection(caseSelectedModules);
    toast(`已选 ${caseSelectedModules.length} 个模块`);
    closeModal();
  };

  const handleExportCsv = () => {
    const headers = ["用例编号", "测试内容", "步骤", "输入及操作说明", "预期结果", "初次测试结果", "回归测试结果", "测试结论"];
    const flatRows: string[][] = [headers];
    for (const g of caseGroups) {
      for (const s of g.steps) {
        flatRows.push([g.caseNo, g.content, s.stepNumber, s.operation, s.expected, s.firstResult, s.regressionResult, s.conclusion]);
      }
    }
    const csv = flatRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `test_cases_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出 CSV");
  };

  const handleAddStep = (groupId: string, afterStepId?: string) => {
    caseStepAdd(groupId, afterStepId);
    toast("已在下方插入新步骤");
  };

  const handleDeleteStep = (groupId: string, stepId: string) => {
    setConfirmDelete({ open: true, groupId, stepId });
  };

  const confirmDeleteAction = () => {
    if (!confirmDelete) return;
    const { groupId, stepId } = confirmDelete;
    if (stepId) {
      const group = caseGroups.find((g) => g.groupId === groupId);
      if (group && group.steps.length <= 1) {
        caseGroupRemove(groupId);
      } else {
        caseStepRemove(groupId, stepId);
      }
    }
    setConfirmDelete(null);
  };

  const renderMetaTable = () => {
    const tdStyle = (bold = false, center = true) => ({
      border: "1px solid #000",
      padding: "4px",
      fontWeight: bold ? "bold" : "normal",
      textAlign: center ? ("center" as const) : ("left" as const),
      verticalAlign: "middle" as const,
    });
    const editableStyle = {
      border: "1px solid #000",
      padding: "4px",
      wordWrap: "break-word" as const,
      outline: "none",
      cursor: "text",
    };
    const labelStyle = { ...tdStyle(true), width: "15%" };
    const span2Style = { ...editableStyle, width: "35%" };
    const span4Style = { ...editableStyle, width: "35%" };
    const span7Style = { ...editableStyle, width: "85%" };
    const span2LabelStyle = { ...tdStyle(true), width: "15%" };
    const span4LabelStyle = { ...tdStyle(true), width: "15%" };

    return (
      <table className="w-full" style={{ borderCollapse: "collapse", marginBottom: 8, tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td style={labelStyle}>系统名称</td>
            <td colSpan={2} style={span2Style} onClick={() => startEditCell("meta", undefined, "system", metaHeader.system)}>
              {editingCell?.field === "system" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.system || ""}
            </td>
            <td style={labelStyle}>测试点标识</td>
            <td colSpan={4} style={span4Style} onClick={() => startEditCell("meta", undefined, "testPointId", metaHeader.testPointId)}>
              {editingCell?.field === "testPointId" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.testPointId || ""}
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>测试点</td>
            <td colSpan={7} style={span7Style} onClick={() => startEditCell("meta", undefined, "testPoint", metaHeader.testPoint)}>
              {editingCell?.field === "testPoint" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.testPoint || ""}
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>测试人员</td>
            <td colSpan={7} style={span7Style} onClick={() => startEditCell("meta", undefined, "testers", metaHeader.testers)}>
              {editingCell?.field === "testers" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.testers || ""}
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>委托单位人员</td>
            <td colSpan={7} style={span7Style} onClick={() => startEditCell("meta", undefined, "clientStaff", metaHeader.clientStaff)}>
              {editingCell?.field === "clientStaff" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.clientStaff || ""}
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>开发单位人员</td>
            <td colSpan={7} style={span7Style} onClick={() => startEditCell("meta", undefined, "developerStaff", metaHeader.developerStaff)}>
              {editingCell?.field === "developerStaff" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.developerStaff || ""}
            </td>
          </tr>
          <tr>
            <td style={span2LabelStyle}>初次测试时间</td>
            <td colSpan={2} style={span2Style} onClick={() => startEditCell("meta", undefined, "firstTestDate", metaHeader.firstTestDate)}>
              {editingCell?.field === "firstTestDate" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.firstTestDate || ""}
            </td>
            <td style={span4LabelStyle}>回归测试时间</td>
            <td colSpan={4} style={span4Style} onClick={() => startEditCell("meta", undefined, "regressionDate", metaHeader.regressionDate)}>
              {editingCell?.field === "regressionDate" ? (
                <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
              ) : metaHeader.regressionDate || ""}
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>测试结论判定规则</td>
            <td colSpan={7} style={{ ...span7Style, cursor: "default" }}>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>{DEFAULT_CONCLUSION_RULE}</div>
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>预置条件</td>
            <td colSpan={7} style={span7Style} onClick={() => startEditCell("meta", undefined, "precondition", metaHeader.precondition)}>
              {editingCell?.field === "precondition" ? (
                <textarea className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus rows={2} style={{ width: "100%", minHeight: 40 }} />
              ) : metaHeader.precondition || ""}
            </td>
          </tr>
        </tbody>
      </table>
    );
  };

  const renderDataTable = (groups: CaseGroupView[]) => {
    const thStyle = (w: number) => ({
      border: "1px solid #000",
      padding: "4px",
      fontWeight: "bold",
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
      width: `${w}%`,
    });
    const tdBase = (w?: number) => ({
      border: "1px solid #000",
      padding: "4px",
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
      width: w ? `${w}%` : undefined,
    });

    return (
      <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={thStyle(COL_WIDTHS[0])}>用例编号</th>
            <th style={thStyle(COL_WIDTHS[1])}>测试内容</th>
            <th style={thStyle(COL_WIDTHS[2])}>步骤</th>
            <th style={thStyle(COL_WIDTHS[3])}>输入及操作说明</th>
            <th style={thStyle(COL_WIDTHS[4])}>预期结果</th>
            <th style={thStyle(COL_WIDTHS[5])}>初次测试结果</th>
            <th style={thStyle(COL_WIDTHS[6])}>回归测试结果</th>
            <th style={thStyle(COL_WIDTHS[7])}>测试结论</th>
            <th style={thStyle(COL_WIDTHS[8])}>操作</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) =>
            group.steps.map((step, sIdx) => {
              const isFirst = sIdx === 0;
              const rowSpan = group.steps.length || 1;
              const isEditingGroup = editingCell?.groupId === group.groupId && !editingCell.stepId;
              const isEditingStep = editingCell?.groupId === group.groupId && editingCell.stepId === step.stepId;

              const renderCell = (field: string, value: string, isTextarea = false) => {
                const isEditing = isEditingStep && editingCell?.field === field;
                if (isEditing) {
                  if (isTextarea) {
                    return (
                      <textarea
                        className="cell-edit"
                        value={cellValue}
                        onChange={(e) => setCellValue(e.target.value)}
                        onBlur={commitEditCell}
                        autoFocus
                        rows={2}
                        style={{ width: "100%", minHeight: 30 }}
                      />
                    );
                  }
                  return <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />;
                }
                return (
                  <span onClick={() => startEditCell(group.groupId, step.stepId, field, value)} style={{ cursor: "text" }}>
                    {value || ""}
                  </span>
                );
              };

              const renderGroupCell = (field: string, value: string, rowSpanAttr?: number) => {
                const isEditing = isEditingGroup && editingCell?.field === field;
                const content = isEditing ? (
                  <input className="cell-edit" value={cellValue} onChange={(e) => setCellValue(e.target.value)} onBlur={commitEditCell} autoFocus />
                ) : (
                  <>
                    <span onClick={() => startEditCell(group.groupId, undefined, field, value)} style={{ cursor: "text" }}>{value || ""}</span>
                    {field === "content" && group.scenarioName && <div><Tag tone="info">{group.scenarioName}{group.priority ? ` ${group.priority}` : ''}</Tag></div>}
                    {field === "content" && group.needsReview && <div title={group.reviewReason}><Tag tone="warn">待复核</Tag></div>}
                  </>
                );
                const sourceTitle = field === "caseNo" ? buildSourceTitle(group.batchId) : undefined;
                return rowSpanAttr ? <td rowSpan={rowSpanAttr} style={tdBase()} title={sourceTitle}>{content}</td> : <td style={tdBase()} title={sourceTitle}>{content}</td>;
              };

              return (
                <tr key={`${group.groupId}-${step.stepId}`}>
                  {isFirst && (
                    <>
                      {renderGroupCell("caseNo", group.caseNo, rowSpan)}
                      {renderGroupCell("content", group.content, rowSpan)}
                    </>
                  )}
                  <td style={{ ...tdBase(COL_WIDTHS[2]), fontWeight: "bold" }}>
                    {renderCell("stepNumber", step.stepNumber)}
                  </td>
                  <td style={{ ...tdBase(), textAlign: "left" }}>
                    {renderCell("operation", step.operation, true)}
                  </td>
                  <td style={{ ...tdBase(), textAlign: "left" }}>
                    {renderCell("expected", step.expected, true)}
                  </td>
                  <td style={tdBase()}>{renderCell("firstResult", step.firstResult)}</td>
                  <td style={tdBase()}>{renderCell("regressionResult", step.regressionResult)}</td>
                  <td style={tdBase()}>{renderCell("conclusion", step.conclusion)}</td>
                  <td style={tdBase(COL_WIDTHS[8])}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                      <Button size="sm" onClick={() => handleAddStep(group.groupId, step.stepId)} title="在下方添加步骤">
                        +
                      </Button>
                      <Button size="sm" variant="dng" onClick={() => handleDeleteStep(group.groupId, step.stepId)} title="删除此步骤">
                        ×
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
          {caseGroups.length === 0 && (
            <tr>
              <td colSpan={9} style={{ border: "1px solid #000", padding: "32px 20px", textAlign: "center", color: "var(--mut, #888)" }}>
                {pipelineLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 24, height: 24, border: "2px solid #2563eb", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    <div style={{ fontWeight: 500, color: "var(--pri, #2563eb)" }}>正在生成测试用例，请稍候...</div>
                  </div>
                ) : (
                  "暂无测试用例，请先生成或添加"
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  };

  return (
    <>
      <div className="ph">
        <div>
          <h2>④ 测试用例</h2>
          <div className="sub">Meta 头 + 可编辑表格 + 按模块分组 + AI 辅助</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={() => openModal('config')}>⚙ 配置</Button>
          <Button onClick={() => openModal('selectModule')}>📋 选择模块（已选 {caseSelectedModules.length}）</Button>
          <Button
            variant="pri"
            disabled={pipelineLoading}
            onClick={handleGenerateSelected}
          >
            {pipelineLoading ? "⏳ 生成中..." : "生成选中"}
          </Button>
          <Button
            variant="pri"
            disabled={pipelineLoading || caseSelectedModules.length === 0}
            onClick={handleRegenerateSelected}
            title="定点替换选中模块的功能点用例，不影响其他模块"
          >
            {pipelineLoading ? "⏳ 重新生成中..." : "重新生成选中模块"}
          </Button>
          <Button
            variant="pri"
            disabled={pipelineLoading}
            onClick={handleGenerateAll}
          >
            {pipelineLoading ? "⏳ 全部生成中..." : "全部生成"}
          </Button>
          <Button onClick={() => caseGroupAdd()} title="添加新用例分组">
            + 新用例
          </Button>
          <Toggle on={caseAiOn} onChange={(v) => caseToggleAi(v)} label="AI 辅助" />
          <Toggle on={readOnlyClickPolicy === 'allow_all'} onChange={(v) => setReadOnlyClickPolicy(v ? 'allow_all' : 'strict')} label="只读点击：放行" />
          <Button onClick={handleExportCsv}>导出 CSV</Button>
        </div>
      </div>

      {pipelineLoading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            marginBottom: "12px",
            borderRadius: "6px",
            backgroundColor: "rgba(37, 99, 235, 0.08)",
            border: "1px solid rgba(37, 99, 235, 0.25)",
            color: "var(--pri, #2563eb)",
          }}
        >
          <div
            style={{
              width: "18px",
              height: "18px",
              border: "2px solid rgba(37, 99, 235, 0.3)",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>测试用例生成中...</div>
            <div style={{ fontSize: "12px", color: "var(--mut, #64748b)", marginTop: "2px" }}>
              正在执行页面特征探索、提取表单字段/操作入口并构建标准测试用例矩阵，请稍候...
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>
          用例列表（{caseGroups.length} 个用例分组 · {caseGroups.reduce((sum, g) => sum + g.steps.length, 0)} 个步骤）
        </span>
        {requiredCoverageKeys.size > 0 && <Tag tone="info">覆盖 {observedCoverageKeys.size}/{requiredCoverageKeys.size}</Tag>}
        {needsReviewCount > 0 && <Tag tone="warn">待复核 {needsReviewCount}</Tag>}
        <span style={{ marginLeft: "auto" }} />
        {caseAiOn && <Tag tone="info">AI 辅助已开启</Tag>}
        {blockingMessages.length > 0 && <Tag tone="warn">阻塞问题 {blockingMessages.length}</Tag>}
        {isExecutable && <Tag tone="ok">可执行</Tag>}
        {caseGenerations.length > 0 && (
          <Button size="sm" onClick={() => setShowGenHistory((v) => !v)} title="查看每组用例的生成批次来源（batchId / 模式 / AI 配置）">
            生成批次记录 {caseGenerations.length}
          </Button>
        )}
      </div>

      {showGenHistory && caseGenerations.length > 0 && (
        <Card title="生成批次记录（每组用例可追溯其生成来源）" style={{ marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--mut)" }}>
                <th style={{ padding: "4px 8px" }}>批次 ID</th>
                <th style={{ padding: "4px 8px" }}>模式</th>
                <th style={{ padding: "4px 8px" }}>AI 配置</th>
                <th style={{ padding: "4px 8px" }}>scope</th>
                <th style={{ padding: "4px 8px" }}>本批功能点</th>
              </tr>
            </thead>
            <tbody>
              {caseGenerations.map((gen) => (
                <tr key={gen.batchId} style={{ borderTop: "1px solid var(--bd, #eee)" }}>
                  <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{gen.batchId}</td>
                  <td style={{ padding: "4px 8px" }}>{gen.mode === "ai" ? "AI 辅助" : "无 AI"}</td>
                  <td style={{ padding: "4px 8px" }}>{gen.aiConfigId ?? "无"}</td>
                  <td style={{ padding: "4px 8px" }}>{gen.scope}{gen.regenerateSelected ? " · 定点重生成" : ""}</td>
                  <td style={{ padding: "4px 8px" }}>{gen.orderedFeatureIds?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {blockingMessages.length > 0 && (
        <div style={{ marginBottom: 8, color: 'var(--dng, #b91c1c)', fontSize: 13 }}>
          {blockingMessages.map((message) => <div key={message}>{message}</div>)}
        </div>
      )}

      {filteredModules.map((moduleName) => (
        <Card key={moduleName} title={`模块: ${moduleName}`} style={{ marginBottom: 16 }}>
          {renderMetaTable()}
          {renderDataTable(groupedByModule.get(moduleName) || [])}
        </Card>
      ))}

      {filteredModules.length === 0 && caseGroups.length > 0 && (
        <Card title="测试用例" style={{ marginBottom: 16 }}>
          {renderMetaTable()}
          {renderDataTable(caseGroups)}
        </Card>
      )}

      <Modal
        open={isModalOpen('config')}
        onClose={closeModal}
        title="⚙ 用例配置"
        footer={
          <>
            <Button onClick={closeModal}>取消</Button>
            <Button variant="pri" onClick={handleSaveMeta}>应用配置</Button>
          </>
        }
      >
        <div className="field">
          <label>系统名称</label>
          <input className="text-input" value={metaForm.system} onChange={(e) => setMetaForm({ ...metaForm, system: e.target.value })} />
        </div>
        <div className="field">
          <label>测试点 ID</label>
          <input className="text-input" value={metaForm.testPointId} onChange={(e) => setMetaForm({ ...metaForm, testPointId: e.target.value })} />
        </div>
        <div className="field">
          <label>测试点</label>
          <input className="text-input" value={metaForm.testPoint} onChange={(e) => setMetaForm({ ...metaForm, testPoint: e.target.value })} />
        </div>
        <div className="field">
          <label>测试人员</label>
          <input className="text-input" value={metaForm.testers} onChange={(e) => setMetaForm({ ...metaForm, testers: e.target.value })} />
        </div>
        <div className="field">
          <label>委托单位人员</label>
          <input className="text-input" value={metaForm.clientStaff} onChange={(e) => setMetaForm({ ...metaForm, clientStaff: e.target.value })} />
        </div>
        <div className="field">
          <label>开发单位人员</label>
          <input className="text-input" value={metaForm.developerStaff} onChange={(e) => setMetaForm({ ...metaForm, developerStaff: e.target.value })} />
        </div>
        <div className="field">
          <label>初次测试时间</label>
          <input className="text-input" value={metaForm.firstTestDate} onChange={(e) => setMetaForm({ ...metaForm, firstTestDate: e.target.value })} />
        </div>
        <div className="field">
          <label>回归测试时间</label>
          <input className="text-input" value={metaForm.regressionDate} onChange={(e) => setMetaForm({ ...metaForm, regressionDate: e.target.value })} />
        </div>
        <div className="field">
          <label>预置条件</label>
          <textarea className="text-input" value={metaForm.precondition} onChange={(e) => setMetaForm({ ...metaForm, precondition: e.target.value })} rows={3} style={{ width: "100%" }} />
        </div>
      </Modal>

      <Modal
        open={isModalOpen('selectModule')}
        onClose={closeModal}
        title="📋 选择生成用例的模块"
        footer={
          <>
            <Button onClick={closeModal}>取消</Button>
            <Button variant="pri" onClick={handleApplySelection}>确认选择（已选 {caseSelectedModules.length} 个）</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 搜索与快捷操作栏 */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              className="text-input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="🔍 搜索主模块或子模块名称..."
              value={moduleSearchQuery}
              onChange={(e) => setModuleSearchQuery(e.target.value)}
            />
            <Button size="sm" onClick={handleSelectAllModules}>全选</Button>
            <Button size="sm" onClick={handleInvertModuleSelection}>反选</Button>
            <Button size="sm" onClick={handleClearModuleSelection}>清空</Button>
          </div>

          {/* 统计提示 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "var(--mut)" }}>
            <span>已选 <strong>{caseSelectedModules.length}</strong> / {allSubModuleNames.length} 个子模块</span>
            <span>覆盖 <strong>{selectedFeaturePointsCount}</strong> / {featureRows.length} 个功能点</span>
          </div>

          {/* 已选模块标签列表 */}
          {caseSelectedModules.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 80, overflowY: "auto", padding: "6px 8px", background: "var(--bg-subtle, #f8f9fa)", borderRadius: 6, border: "1px solid var(--bd, #e5e7eb)" }}>
              {caseSelectedModules.map((mod) => (
                <Tag key={mod} tone="info">
                  {mod}
                  <span
                    style={{ marginLeft: 4, cursor: "pointer", fontWeight: "bold" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSubModule(mod);
                    }}
                    title="移除"
                  >
                    ×
                  </span>
                </Tag>
              ))}
            </div>
          )}

          {/* 模块分组卡片列表 */}
          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
            {filteredModuleTree.length === 0 ? (
              <div style={{ textAlign: "center", padding: 24, color: "var(--mut)", fontSize: 13 }}>
                未搜索到匹配的模块
              </div>
            ) : (
              filteredModuleTree.map((main) => {
                const subNames = main.subModules.map((s) => s.name);
                const allSelected = subNames.length > 0 && subNames.every((n) => caseSelectedModules.includes(n));
                const someSelected = subNames.some((n) => caseSelectedModules.includes(n)) && !allSelected;
                const totalMainCount = main.subModules.reduce((acc, s) => acc + s.count, 0);

                return (
                  <div
                    key={main.mainName}
                    style={{
                      border: "1px solid var(--bd, #e5e7eb)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      background: "var(--card-bg, #fff)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        userSelect: "none",
                        paddingBottom: 6,
                        borderBottom: "1px solid var(--bd, #f0f0f0)",
                        marginBottom: 6,
                      }}
                      onClick={() => handleToggleMainModule(subNames)}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={() => handleToggleMainModule(subNames)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span>{main.mainName}</span>
                      </label>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>
                        {main.subModules.length} 个子模块 · {totalMainCount} 个功能点
                      </span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {main.subModules.map((sub) => {
                        const isChecked = caseSelectedModules.includes(sub.name);
                        return (
                          <div
                            key={sub.name}
                            onClick={() => handleToggleSubModule(sub.name)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 8px",
                              borderRadius: 4,
                              fontSize: 12,
                              cursor: "pointer",
                              userSelect: "none",
                              border: isChecked ? "1px solid var(--pri, #2563eb)" : "1px solid var(--bd, #e5e7eb)",
                              background: isChecked ? "var(--pri-subtle, #eff6ff)" : "var(--bg, #fff)",
                              color: isChecked ? "var(--pri, #1d4ed8)" : "inherit",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSubModule(sub.name)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span>{sub.name}</span>
                            <span style={{ color: "var(--mut)", fontSize: 11 }}>({sub.count})</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete?.open ?? false}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        title="删除确认"
        message="确定要删除此步骤吗？如果是最后一个步骤，整个用例分组将被移除。"
        danger
      />
    </>
  );
}
