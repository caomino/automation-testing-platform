import { useState, useEffect } from "react";
import { Button, Card, Modal, Table, Tag, Tree, ConfirmDialog } from "../components";
import type { TreeItem } from "../components";
import { useApp } from "../context";
import type { ModuleNodeView } from "../context";
import * as dataApi from "../services/dataApi";

function statusTone(s?: string) {
  if (s === "已覆盖") return "ok" as const;
  if (s === "needs_review") return "warn" as const;
  if (s === "未探索") return "review" as const;
  return "gray" as const;
}

function toTreeItems(nodes: ModuleNodeView[], selected: string | null, onSelect: (id: string) => void, onToggle: ((id: string, checked: boolean) => void) | undefined, checkedIds: string[]): TreeItem[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.status ? `📂 ${n.name}` : `🔹 ${n.name}`,
    selected: n.id === selected,
    onNodeClick: () => onSelect(n.id),
    onToggle: onToggle ? (id, c) => onToggle(id, c) : undefined,
    checked: checkedIds.includes(n.id),
    tags: n.status ? <Tag tone={statusTone(n.status)}>{n.status}</Tag> : undefined,
    children: n.children ? toTreeItems(n.children, selected, onSelect, onToggle, checkedIds) : undefined,
  }));
}

export function Explore() {
  const {
    system,
    moduleTree,
    pendingTree,
    selectedModuleId,
    treeChecked,
    exploreSetSelected,
    exploreToggleChecked,
    exploreAddModule,
    exploreUpdateModule,
    exploreRemoveModule,
    exploreRemoveModulesBatch,
    exploreSelectAll,
    exploreInvertSelection,
    exploreMoveNode,
    exploreRemovePending,
    exploreUpdatePending,
    explorePromoteToTree,
    explorePromoteAll,
    exploreAddPending,
    toast,
    addActivity,
    runPipelineExplore,
    pipelineLoading,
    pipelineStage,
    pipelineError: _pipelineError,
    project,
    updateModuleTree,
  } = useApp();

  const [modeEditOpen, setModeEditOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ModuleNodeView | null>(null);
  const [editTargetSeq, setEditTargetSeq] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ path: "", module: "", confidence: "0.90" });
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [newModuleName, setNewModuleName] = useState("");
  const [manualStep, setManualStep] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const treeToViews = (nodes: any[]): ModuleNodeView[] =>
    nodes.map((n) => ({
      id: n.id,
      name: n.label ?? n.id,
      status: n.status === 'covered' ? '已覆盖' : n.status === 'needs_review' ? 'needs_review' : '未探索',
      children: n.children ? treeToViews(n.children) : undefined,
    }));

  const reloadModuleTree = async () => {
    if (!system.id || !project.id) return;
    try {
      const tree = await dataApi.getModuleTree(project.id, system.id);
      if (tree && Array.isArray(tree) && tree.length > 0) {
        const nodes = treeToViews(tree);
        updateModuleTree(nodes);
        console.log(`[Explore] Loaded ${nodes.length} root modules for system ${system.id}`);
        toast(`已加载 ${tree.length} 个模块`);
      } else {
        console.log(`[Explore] No module tree data for system ${system.id}`);
      }
    } catch (e) {
      console.error('[Explore] Failed to load module tree:', e);
    }
  };

  useEffect(() => {
    reloadModuleTree();
  }, [system.id]);

  const handleStartExplore = async () => {
    if (!system.id) {
      toast("请先选择一个系统");
      return;
    }
    if (!system.url) {
      toast("请先在项目管理中配置系统 URL");
      return;
    }
    if (system.loginStatus !== "logged_in") {
      toast("请先登录系统");
      return;
    }
    // 第一优先级：检查会话有效性
    const isNoLoginMode = system.credentialMode === 'no-login' || system.loginMode === 'no-login';
    const cookies = system.sessionState?.cookies;
    const hasValidCookies = cookies && cookies.length > 0;
    if (!isNoLoginMode && !hasValidCookies) {
      toast("登录会话失效，请返回工作台重新登录");
      return;
    }
    const sessionHandle = {
      sessionId: system.id,
      systemId: system.id,
      loginStatus: "ok" as const,
      cookies: cookies ?? [],
      headers: system.sessionState?.headers ?? {},
      tokens: system.sessionState?.tokens ?? [],
      expiresAt: Date.now() + 3600000,
    };
    const input: any = {
      sessionHandle,
      subsystemId: system.id,
      systemUrl: system.url,
    };
    try {
      toast("正在启动浏览器探索，请稍候...");
      const out = await runPipelineExplore(input);
      if (out?.moduleTree && out.moduleTree.length > 0) {
        toast(`探索完成：发现 ${out.moduleTree.length} 个模块`);
      } else {
        toast("探索完成但未发现模块，请检查页面结构");
      }
    } catch (e: any) {
      console.error("探索失败详情:", e);
      const errMsg = e.message || "未知错误";
      if (errMsg.includes("EXPLORE_FAILED")) {
        toast("探索失败：无法获取模块数据，请检查：1)系统URL是否正确 2)网络是否可访问 3)登录会话是否有效");
      } else {
        toast(`探索失败：${errMsg}`);
      }
    }
  };

  const isExploring = pipelineLoading && pipelineStage === "explore";

  const handleExportTree = () => {
    const data = JSON.stringify(moduleTree, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `module_tree_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出模块树 JSON");
  };

  const totalModules = (() => {
    let count = 0;
    const walk = (nodes: ModuleNodeView[]) => {
      count += nodes.length;
      nodes.forEach((n) => n.children && walk(n.children));
    };
    walk(moduleTree);
    return count;
  })();

  const coveredModules = (() => {
    let count = 0;
    const walk = (nodes: ModuleNodeView[]) => {
      nodes.forEach((n) => {
        if (n.status === "已覆盖") count++;
        if (n.children) walk(n.children);
      });
    };
    walk(moduleTree);
    return count;
  })();

  const pendingCount = pendingTree.filter((p) => p.status === "待入树").length;

  const handleSaveEdit = async () => {
    if (editTarget) {
      exploreUpdateModule(editTarget.id, { name: editTarget.name });
      toast("已保存");
      await saveModuleTreeToBackend();
    }
    setModeEditOpen(false);
    setEditTarget(null);
  };

  const handleAddModule = () => {
    setNewModuleName("");
    setAddModuleOpen(true);
  };

  const handleSubmitNewModule = async () => {
    if (!newModuleName.trim()) {
      toast("请输入模块名称");
      return;
    }
    const newMod: ModuleNodeView = { id: `new-${Date.now()}`, name: newModuleName };
    exploreAddModule(selectedModuleId, newMod);
    toast(`已添加模块：${newModuleName}`);
    setAddModuleOpen(false);
    setNewModuleName("");
    await saveModuleTreeToBackend();
  };

  const handleDeleteSelected = async () => {
    const idsToDelete = treeChecked.length > 0 ? treeChecked : (selectedModuleId ? [selectedModuleId] : []);
    if (idsToDelete.length === 0) {
      toast("请先选择要删除的模块（点击左侧复选框进行多选）");
      setConfirmOpen(false);
      return;
    }
    if (idsToDelete.length === 1) {
      exploreRemoveModule(idsToDelete[0]);
    } else {
      exploreRemoveModulesBatch(idsToDelete);
    }
    toast(`已删除 ${idsToDelete.length} 个模块`);
    setConfirmOpen(false);
    await saveModuleTreeToBackend();
  };

  const handleDropNode = async (sourceId: string, targetId: string, position: 'before' | 'after' | 'child') => {
    exploreMoveNode(sourceId, targetId, position);
    const posLabel = position === 'before' ? '上方' : position === 'after' ? '下方' : '作为子节点';
    toast(`已移动模块到目标节点${posLabel}`);
    await saveModuleTreeToBackend();
  };

  const handleStartRecording = async () => {
    if (!system.url) {
      toast("请先设置系统 URL");
      return;
    }
    try {
      setManualStep("正在启动录制...");
      const res = await dataApi.startRecording(system.id, system.url);
      setRecordingId(res.recordingId);
      setIsRecording(true);
      setManualStep("录制中 - 请在浏览器中进行操作");
      setManualOpen(true);
      toast("浏览器已打开，请在浏览器中进行操作，完成后点击「停止录制」");
    } catch (e: any) {
      toast(`启动录制失败：${e.message}`);
      setManualStep("");
    }
  };

  const handleStopRecording = async () => {
    if (!recordingId) return;
    try {
      setManualStep("正在停止录制...");
      const data = await dataApi.stopRecording(recordingId);
      const seq = Math.max(0, ...pendingTree.map((p) => p.seq)) + 1;
      const steps = data.clickPath.steps;
      const pathLabel = steps.length > 0
        ? steps.map((s) => s.text || s.selector).join(" / ")
        : `录制于 ${new Date().toLocaleTimeString()}`;
      exploreAddPending({
        seq,
        path: pathLabel,
        module: data.capturedTitle || system.name,
        confidence: "0.95",
        status: "待入树",
      });
      addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `人工补充：${pathLabel}` });
      setRecordingId(null);
      setIsRecording(false);
      setManualOpen(false);
      setManualForm({ path: "", module: "", confidence: "0.90" });
      setManualStep("");
      toast("录制完成，请在待入树列表中确认");
    } catch (e: any) {
      toast(`停止录制失败：${e.message}`);
      setManualStep("");
    }
  };

  const handleManualAdd = () => {
    if (!manualForm.path || !manualForm.module) {
      toast("请填写完整信息");
      return;
    }
    const seq = Math.max(0, ...pendingTree.map((p) => p.seq)) + 1;
    exploreAddPending({
      seq,
      path: manualForm.path,
      module: manualForm.module,
      confidence: manualForm.confidence,
      status: "待入树",
    });
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `人工补充：${manualForm.path}` });
    setManualOpen(false);
    setManualForm({ path: "", module: "", confidence: "0.90" });
    setManualStep("");
    toast("已添加到待入树列表");
  };

  const handlePromoteToTree = async (seq: number) => {
    const item = pendingTree.find((p) => p.seq === seq);
    if (!item) return;
    if (!selectedModuleId) {
      toast("请先选择一个模块树目标位置");
      return;
    }
    explorePromoteToTree(seq);
    toast(`已入树：插入到「${item.module}」下方`);
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `入树：${item.path}` });
    await saveModuleTreeToBackend();
  };

  const handlePromoteAll = async () => {
    if (!selectedModuleId) {
      toast("请先在左侧选择模块树目标位置");
      return;
    }
    explorePromoteAll();
    toast(`${pendingCount} 条已批量插入到选中行下方`);
    await saveModuleTreeToBackend();
  };

  const saveModuleTreeToBackend = async () => {
    if (!project.id || !system.id) {
      console.warn('[Explore] saveModuleTreeToBackend: missing project.id or system.id', { projectId: project.id, systemId: system.id });
      return;
    }
    try {
      const contractTree = moduleTreeToContract(moduleTree);
      await dataApi.saveModuleTree(project.id, system.id, contractTree);
      console.log(`[Explore] Module tree saved: ${contractTree.length} root nodes, systemId=${system.id}`);
    } catch (e) {
      console.error('[Explore] Failed to save module tree:', e);
      toast(`保存失败：${(e as Error).message}`);
    }
  };

  const moduleTreeToContract = (nodes: ModuleNodeView[]): any[] =>
    nodes.map((n) => ({
      id: n.id,
      label: n.name,
      parentId: null,
      subsystemId: system.id,
      type: 'module',
      status: n.status === '已覆盖' ? 'covered' : n.status === 'needs_review' ? 'needs_review' : 'unexplored',
      children: n.children ? moduleTreeToContract(n.children) : [],
      depth: 0,
      manuallyAdded: true,
    }));

  return (
    <>
      <div className="ph">
        <div>
          <h2>② 系统探索</h2>
          <div className="sub">模块树可 CRUD · 人工补录两段式：弹窗录制 → 写入待入树列表 → 选中模块树行 → 行内入树插入下方</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={handleStartExplore} disabled={isExploring}>
            {isExploring ? "探索中..." : "开始/继续探索"}
          </Button>
          <div>
            <Button variant="pri" onClick={handleStartRecording} disabled={isRecording}>
              {isRecording ? "录制中..." : "👆 人工补充（自动开浏览器）"}
            </Button>
            {manualStep && (
              <div className="meta-head" style={{ marginTop: 8, background: "var(--priS)" }}>
                <span style={{ color: "var(--priT)" }}>{manualStep}</span>
              </div>
            )}
          </div>
          <Button onClick={handleExportTree}>导出模块树</Button>
        </div>
      </div>

      <div className="grid g2">
        <Card title={`模块树（☑多选 · 选中父节点自动选中子节点 · 支持拖拽）`}>
          <div className="row" style={{ marginBottom: 8, gap: 8 }}>
            <Button size="sm" onClick={exploreSelectAll}>全选</Button>
            <Button size="sm" onClick={exploreInvertSelection}>反选</Button>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              已选 <b>{treeChecked.length}</b> 项（点击复选框可选中父节点及其所有子节点）
            </span>
          </div>
          <Tree
            root={`🖥️ ${system.name}`}
            items={toTreeItems(moduleTree, selectedModuleId, exploreSetSelected, exploreToggleChecked, treeChecked)}
            onDropNode={handleDropNode}
          />
          <hr />
          <div className="row">
            <Button size="sm" onClick={handleAddModule}>
              + 新增模块
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!selectedModuleId) {
                  toast("请先选择一个模块");
                  return;
                }
                const findNode = (nodes: ModuleNodeView[]): ModuleNodeView | null => {
                  for (const n of nodes) {
                    if (n.id === selectedModuleId) return n;
                    if (n.children) {
                      const f = findNode(n.children);
                      if (f) return f;
                    }
                  }
                  return null;
                };
                const node = findNode(moduleTree);
                if (node) {
                  setEditTarget(node);
                  setModeEditOpen(true);
                }
              }}
            >
              编辑选中
            </Button>
            <Button
              size="sm"
              variant="dng"
              onClick={() => {
                const idsToDelete = treeChecked.length > 0 ? treeChecked : (selectedModuleId ? [selectedModuleId] : []);
                if (idsToDelete.length === 0) {
                  toast("请先选择要删除的模块");
                  return;
                }
                setConfirmOpen(true);
              }}
            >
              删除选中{treeChecked.length > 0 ? `(${treeChecked.length})` : ""}
            </Button>
          </div>
        </Card>

        <Card title={`📥 待入树列表（${pendingCount} 条待入树 · 共 ${pendingTree.length} 条）`}>
          <div className="meta-head">
            <b>两段式工作流</b>
            <br />① 点「人工补充」→ 弹窗录制（自动开浏览器）
            <br />② 弹窗确认 → 录制数据写入本列表
            <br />③ 左侧模块树<b>选中目标行</b>
            <br />④ 点本列表行内 [入树] → 插入到选中行下方
          </div>
          <hr />
          <Table
            columns={[
              { key: "seq", title: "#", width: 40 },
              { key: "path", title: "录制路径", mono: true },
              { key: "module", title: "所在模块" },
              {
                key: "confidence",
                title: "置信",
                render: (r: any) => (r.confidence === "—" ? <Tag tone="gray">—</Tag> : <Tag tone="info">{r.confidence}</Tag>),
              },
              {
                key: "status",
                title: "状态",
                render: (r: any) => (r.status === "待入树" ? <Tag tone="warn">待入树</Tag> : <Tag tone="ok">已去重</Tag>),
              },
            ]}
            rows={pendingTree as any[]}
            rowKey={(r: any) => String(r.seq)}
            onRowAction={(r: any, _i, action) => {
              if (action === "remove") {
                exploreRemovePending(r.seq);
                toast("已删除");
              }
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <Button
              size="sm"
              variant="pri"
              onClick={handlePromoteAll}
            >
              ✓ 全部入树
            </Button>
            <Button size="sm" onClick={() => toast("已忽略")}>
              ✗ 忽略
            </Button>
            <span style={{ fontSize: 12, color: "var(--mut)", marginLeft: 8 }}>
              {selectedModuleId ? `将插入到选中行下方` : `未选中模块树行时 [入树] 置灰；先在左侧选中目标位置`}
            </span>
          </div>
          {pendingTree.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b>行操作：</b>
              {pendingTree.map((item) => (
                <div key={item.seq} className="row" style={{ marginTop: 4, gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>#{item.seq}</span>
                  <span style={{ fontSize: 13 }}>{item.path}</span>
                  {item.status === "待入树" && (
                    <>
                      <Button
                        size="sm"
                        variant="pri"
                        onClick={() => handlePromoteToTree(item.seq)}
                      >
                        入树
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditTargetSeq(item.seq);
                          setManualForm({ path: item.path, module: item.module, confidence: item.confidence });
                          setManualOpen(true);
                        }}
                      >
                        修改
                      </Button>
                      <Button size="sm" variant="dng" onClick={() => exploreRemovePending(item.seq)}>
                        删除
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title={`覆盖率（一眼可判） · ${coveredModules}/${totalModules} 模块`} style={{ marginTop: 16 }}>
        <div className="legend">
          <span>
            <i style={{ background: "#16A34A" }} />
            已覆盖
          </span>
          <span>
            <i style={{ background: "#B45309" }} />
            needs_review
          </span>
          <span>
            <i style={{ background: "#9F1239" }} />
            未探索
          </span>
          <span style={{ marginLeft: "auto" }}>
            进度：<b>{coveredModules}/{totalModules} 模块</b> · frontier：{totalModules - coveredModules} 待补
          </span>
        </div>
      </Card>

      <Modal
        open={addModuleOpen}
        onClose={() => { setAddModuleOpen(false); setNewModuleName(""); }}
        title="新增模块"
        footer={
          <>
            <Button onClick={() => { setAddModuleOpen(false); setNewModuleName(""); }}>取消</Button>
            <Button variant="pri" onClick={handleSubmitNewModule}>确认添加</Button>
          </>
        }
      >
        <div className="field">
          <label>模块名称 *</label>
          <input className="text-input" value={newModuleName} onChange={(e) => setNewModuleName(e.target.value)} autoFocus />
        </div>
        <div className="hint">将添加到：{selectedModuleId || "根节点"} 下方</div>
      </Modal>

      <Modal
        open={modeEditOpen}
        onClose={() => {
          setModeEditOpen(false);
          setEditTarget(null);
        }}
        title="编辑模块"
        footer={
          <>
            <Button
              onClick={() => {
                setModeEditOpen(false);
                setEditTarget(null);
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
        <div className="field">
          <label>模块名称</label>
          <input
            defaultValue={editTarget?.name ?? ""}
            onChange={(e) => editTarget && (editTarget.name = e.target.value)}
          />
        </div>
        <div className="field">
          <label>所属子系统</label>
          <select>
            <option>{system.name}</option>
          </select>
        </div>
        <div className="field">
          <label>状态</label>
          <select
            defaultValue={editTarget?.status ?? "未探索"}
            onChange={(e) => editTarget && (editTarget.status = e.target.value as any)}
          >
            <option>已覆盖</option>
            <option>needs_review</option>
            <option>未探索</option>
          </select>
        </div>
      </Modal>

      <Modal
        open={manualOpen}
        onClose={() => {
          if (isRecording && recordingId) {
            handleStopRecording();
          }
          setManualOpen(false);
          setManualForm({ path: "", module: "", confidence: "0.90" });
          setEditTargetSeq(null);
          setRecordingId(null);
          setIsRecording(false);
        }}
        title={isRecording ? "🔴 录制中 - 请在浏览器中操作" : editTargetSeq !== null ? "📝 修改待入树条目" : "👆 人工补充"}
        wide
        footer={
          isRecording ? (
            <>
              <Button
                variant="dng"
                onClick={handleStopRecording}
              >
                ⏹ 停止录制并保存
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => {
                  setManualOpen(false);
                  setManualForm({ path: "", module: "", confidence: "0.90" });
                  setEditTargetSeq(null);
                }}
              >
                取消
              </Button>
              <Button
                variant="pri"
                onClick={() => {
                  if (editTargetSeq !== null) {
                    exploreUpdatePending(editTargetSeq, manualForm as any);
                    toast("已保存修改");
                  } else {
                    handleManualAdd();
                  }
                  setManualOpen(false);
                  setManualForm({ path: "", module: "", confidence: "0.90" });
                  setEditTargetSeq(null);
                }}
              >
                {editTargetSeq !== null ? "保存修改" : "✓ 写入待入树列表"}
              </Button>
            </>
          )
        }
      >
        {isRecording ? (
          <>
            <div className="captured" style={{ background: "#FEF3C7", borderColor: "#D97706" }}>
              <span style={{ fontWeight: 600 }}>🔴 录制进行中...</span>
              <div className="hint" style={{ marginTop: 8 }}>
                请在打开的浏览器中进行操作（点击、填写表单等）<br />
                完成后点击下方「停止录制并保存」按钮
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>录制状态</label>
              <div className="meta-head" style={{ background: "#fff" }}>
                <div className="rowline">
                  <div>
                    <b>录制 ID</b> <code>{recordingId}</code>
                  </div>
                  <div>
                    <b>目标 URL</b> <code>{system.url}</code>
                  </div>
                  <div>
                    <b>开始时间</b> {new Date().toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {editTargetSeq === null && (
              <div className="captured" style={{ background: "#DCFCE7", borderColor: "#16A34A" }}>
                <span>💡 点击「开始录制」将自动打开浏览器并记录您的操作</span>
                <div className="hint" style={{ marginTop: 4 }}>
                  或者手动填写下方表单添加待入树条目
                </div>
              </div>
            )}
            <div className="field" style={{ marginTop: 12 }}>
              <label>说明</label>
              <div className="hint">
                弹窗只负责录制：确认后录制数据写入「📥 待入树列表」（探索屏右侧）；插入位置 = 之后在模块树选中行 + 列表行内 [入树] 决定
              </div>
            </div>
            <div className="field">
              <label>录制路径</label>
              <input
                className="text-input"
                value={manualForm.path}
                onChange={(e) => setManualForm({ ...manualForm, path: e.target.value })}
                placeholder="例如：检查室/导入 → Excel 上传"
              />
            </div>
            <div className="field">
              <label>推断模块</label>
              <input
                className="text-input"
                value={manualForm.module}
                onChange={(e) => setManualForm({ ...manualForm, module: e.target.value })}
                placeholder="例如：导入导出"
              />
            </div>
            <div className="field">
              <label>置信度</label>
              <input
                className="text-input"
                value={manualForm.confidence}
                onChange={(e) => setManualForm({ ...manualForm, confidence: e.target.value })}
                placeholder="0.00 - 1.00"
              />
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDeleteSelected}
        title="删除确认"
        message={`确定要删除选中的模块吗？此操作不可恢复。`}
        danger
      />
    </>
  );
}