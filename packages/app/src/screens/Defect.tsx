import { useState } from "react";
import { Button, Card, Table, Tag, Modal, Lightbox, ConfirmDialog } from "../components";
import { useApp } from "../context";
import type { DefectRowView } from "../context";

export function Defect() {
  const { defectRows, defectFilter, defectSetFilter, defectAdd, defectUpdate, defectRemove, execModules, toast, addActivity } = useApp();
  const [newDefectOpen, setNewDefectOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [newDefect, setNewDefect] = useState<Partial<DefectRowView>>({});
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editData, setEditData] = useState<DefectRowView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; seq: number } | null>(null);

  const filtered = defectFilter === "全部模块" ? defectRows : defectRows.filter((d) => d.environment.includes(defectFilter));

  const handleSaveNew = () => {
    const seq = Math.max(0, ...defectRows.map((d) => d.seq)) + 1;
    defectAdd({
      seq,
      description: newDefect.description ?? "新缺陷",
      level: (newDefect.level as any) ?? "中",
      qualityAttribute: newDefect.qualityAttribute ?? "功能正确性",
      environment: newDefect.environment ?? "Win11·Chrome",
    });
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `新建缺陷：${newDefect.description}` });
    setNewDefectOpen(false);
    setNewDefect({});
    toast("缺陷已创建");
  };

  const handleSaveEdit = () => {
    if (editingRow !== null && editData) {
      defectUpdate(editData.seq, editData);
      toast("已保存");
    }
    setEditingRow(null);
    setEditData(null);
  };

  const handleExportDefects = () => {
    const headers = ["#", "缺陷描述", "优先级", "质量属性", "环境"];
    const csv = [
      headers.join(","),
      ...defectRows.map((d) =>
        [d.seq, d.description, d.level, d.qualityAttribute, d.environment]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `defects_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出缺陷");
  };

  const filterOptions = [
    "全部模块",
    ...(execModules.length > 0
      ? execModules.map((m) => m.name)
      : ["检查室管理", "检查项目管理", "报告管理"]
    ),
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h2>⑥ 缺陷</h2>
          <div className="sub">六列 + 截图 + Lightbox · 真实筛选与编辑</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={() => setNewDefectOpen(true)}>
            + 新建缺陷
          </Button>
          <Button onClick={() => toast("已导入缺陷")}>📥 导入</Button>
          <Button onClick={handleExportDefects}>📤 导出</Button>
        </div>
      </div>

      <Card title={`缺陷列表（${filtered.length} 条 · 共 ${defectRows.length} 条）`}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>筛选：</span>
          {filterOptions.map((opt) => (
            <Button key={opt} size="sm" variant={defectFilter === opt ? "pri" : "ghost"} onClick={() => defectSetFilter(opt)}>
              {opt}
            </Button>
          ))}
          <span style={{ marginLeft: "auto" }} />
          <Tag tone="danger">{defectRows.filter((d) => d.level === "高").length} 高优先</Tag>
          <Tag tone="warn">{defectRows.filter((d) => d.level === "中").length} 中优先</Tag>
        </div>

        <Table
          columns={[
            { key: "seq", title: "#", width: 40 },
            { key: "description", title: "缺陷描述" },
            {
              key: "screenshot",
              title: "截图",
              width: 80,
              render: (r: any) =>
                r.screenshot ? (
                  <img
                    src={`data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%23e5e7eb'/><text x='20' y='24' text-anchor='middle' font-size='10' fill='%236b7280'>IMG</text></svg>`}
                    alt="screenshot"
                    style={{ width: 40, height: 40, cursor: "pointer", borderRadius: 4 }}
                    onClick={() => setLightboxSrc(r.screenshot)}
                  />
                ) : (
                  <span style={{ color: "var(--mut)" }}>—</span>
                ),
            },
            {
              key: "level",
              title: "优先级",
              width: 80,
              render: (r: any) => <Tag tone={r.level === "高" ? "danger" : "warn"}>{r.level}</Tag>,
            },
            { key: "qualityAttribute", title: "质量属性", width: 100 },
            { key: "environment", title: "环境", width: 180 },
          ]}
          rows={filtered as any[]}
          rowKey={(r: any) => String(r.seq)}
          onRowAction={(r: any, _i, action) => {
            if (action === "remove") {
              setConfirmDelete({ open: true, seq: r.seq });
            } else if (action === "edit") {
              setEditingRow(r.seq);
              setEditData(r);
            }
          }}
        />
      </Card>

      <Modal
        open={newDefectOpen}
        onClose={() => {
          setNewDefectOpen(false);
          setNewDefect({});
        }}
        title="+ 新建缺陷"
        footer={
          <>
            <Button
              onClick={() => {
                setNewDefectOpen(false);
                setNewDefect({});
              }}
            >
              取消
            </Button>
            <Button variant="pri" onClick={handleSaveNew}>
              创建
            </Button>
          </>
        }
      >
        <div className="field">
          <label>缺陷描述 *</label>
          <textarea
            className="text-area"
            rows={3}
            placeholder="请描述缺陷..."
            value={newDefect.description ?? ""}
            onChange={(e) => setNewDefect({ ...newDefect, description: e.target.value })}
          />
        </div>
        <div className="field">
          <label>优先级</label>
          <select value={newDefect.level ?? "中"} onChange={(e) => setNewDefect({ ...newDefect, level: e.target.value as any })}>
            <option value="中">中</option>
            <option value="高">高</option>
          </select>
        </div>
        <div className="field">
          <label>质量属性</label>
          <select
            value={newDefect.qualityAttribute ?? "功能正确性"}
            onChange={(e) => setNewDefect({ ...newDefect, qualityAttribute: e.target.value })}
          >
            <option>功能正确性</option>
            <option>健壮性</option>
            <option>安全性</option>
            <option>易用性</option>
            <option>性能</option>
          </select>
        </div>
        <div className="field">
          <label>环境</label>
          <input
            className="text-input"
            value={newDefect.environment ?? ""}
            onChange={(e) => setNewDefect({ ...newDefect, environment: e.target.value })}
            placeholder="例如：Win11·Chrome·QYYX_PZ_JCX_01/S2"
          />
        </div>
      </Modal>

      <Modal
        open={editingRow !== null}
        onClose={() => {
          setEditingRow(null);
          setEditData(null);
        }}
        title="编辑缺陷"
        footer={
          <>
            <Button
              onClick={() => {
                setEditingRow(null);
                setEditData(null);
              }}
            >
              取消
            </Button>
            <Button variant="pri" onClick={handleSaveEdit}>
              保存
            </Button>
          </>
        }
      >
        {editData && (
          <>
            <div className="field">
              <label>缺陷描述</label>
              <textarea
                className="text-area"
                rows={3}
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
              />
            </div>
            <div className="field">
              <label>优先级</label>
              <select value={editData.level} onChange={(e) => setEditData({ ...editData, level: e.target.value as any })}>
                <option value="中">中</option>
                <option value="高">高</option>
              </select>
            </div>
            <div className="field">
              <label>质量属性</label>
              <input
                className="text-input"
                value={editData.qualityAttribute}
                onChange={(e) => setEditData({ ...editData, qualityAttribute: e.target.value })}
              />
            </div>
          </>
        )}
      </Modal>

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      <ConfirmDialog
        open={confirmDelete?.open ?? false}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && defectRemove(confirmDelete.seq)}
        title="删除确认"
        message="确定要删除此条缺陷吗？"
        danger
      />
    </>
  );
}