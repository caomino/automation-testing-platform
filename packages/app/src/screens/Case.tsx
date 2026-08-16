import { useState, useMemo } from "react";
import { Button, Card, Modal, Tag, Toggle, ConfirmDialog, SearchableSelect } from "../components";
import { useApp } from "../context";
import { useModalManager } from "../hooks/useModalManager";
import { buildCaseInput } from "../services/pipeline";
import type { CaseGroupView, CaseStepView } from "../context";

const COL_WIDTHS = [9, 22, 5, 22, 22, 6, 6, 4, 4];

const META_LABELS: Record<string, string> = {
  system: "系统名称",
  testPointId: "测试点标识",
  testPoint: "测试点",
  testers: "测试人员",
  clientStaff: "委托单位人员",
  developerStaff: "开发单位人员",
  firstTestDate: "初次测试时间",
  regressionDate: "回归测试时间",
  conclusionRule: "测试结论判定规则",
  precondition: "预置条件",
};

const DEFAULT_CONCLUSION_RULE =
  "初次测试结果与预期结果一致，结论为通过，否则不通过\n回归测试结果与预期结果一致，结论为复测通过，否则不通过";

export function Case() {
  const {
    metaHeader,
    caseGroups,
    caseSelectedModules,
    caseAiOn,
    featureRows,
    featureConfirmed,
    featurePaths,
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
    toast,
    addActivity,
    pipelineLoading,
  } = useApp();

  const { currentModal, openModal, closeModal, isModalOpen } = useModalManager();
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

  const moduleOptions = useMemo(() => {
    const { subModules } = getFeatureModules();
    if (subModules.length > 0) {
      return subModules.map((name) => ({ value: name, label: name }));
    }
    return [];
  }, [featureRows, getFeatureModules]);


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
    const input = buildCaseInput(featureRows, caseSelectedModules, metaHeader, 'selected_modules', featurePaths, caseAiOn);
    await runPipelineCase(input);
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `生成选中模块用例: ${caseSelectedModules.join(', ')}` });
    toast("选中模块用例已生成");
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
    const input = buildCaseInput(featureRows, caseSelectedModules, metaHeader, 'all', featurePaths, caseAiOn);
    await runPipelineCase(input);
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
      textAlign: center ? "center" : "left",
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
                  <span onClick={() => startEditCell(group.groupId, undefined, field, value)} style={{ cursor: "text" }}>
                    {value || ""}
                  </span>
                );
                return rowSpanAttr ? <td rowSpan={rowSpanAttr} style={tdBase()}>{content}</td> : <td style={tdBase()}>{content}</td>;
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
              <td colSpan={9} style={{ border: "1px solid #000", padding: "20px", textAlign: "center", color: "#999" }}>
                暂无测试用例，请先生成或添加
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
            生成选中
          </Button>
          <Button
            variant="pri"
            disabled={pipelineLoading}
            onClick={handleGenerateAll}
          >
            全部生成
          </Button>
          <Button onClick={() => caseGroupAdd()} title="添加新用例分组">
            + 新用例
          </Button>
          <Toggle on={caseAiOn} onChange={(v) => caseToggleAi(v)} label="AI 辅助" />
          <Button onClick={handleExportCsv}>导出 CSV</Button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>
          用例列表（{caseGroups.length} 个用例分组 · {caseGroups.reduce((sum, g) => sum + g.steps.length, 0)} 个步骤）
        </span>
        <span style={{ marginLeft: "auto" }} />
        {caseAiOn && <Tag tone="info">AI 辅助已开启</Tag>}
        {caseGroups.length > 0 && <Tag tone="ok">可执行</Tag>}
      </div>

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
            <Button variant="pri" onClick={handleApplySelection}>确认选择</Button>
          </>
        }
      >
        <div className="field">
          <label>已选模块（{caseSelectedModules.length} 个）</label>
          <SearchableSelect
            multiple
            selected={caseSelectedModules}
            onSelectedChange={(sel) => caseSetSelection(sel)}
            options={moduleOptions}
            placeholder="选择模块..."
          />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>选择后只渲染选中模块的测试用例表格。</div>
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
