import { useState, useEffect, useRef } from "react";
import { Button, Card, Modal, Table, Tag, Tree, ConfirmDialog } from "../components";
import type { TreeItem } from "../components";
import { useApp } from "../context";
import type { ModuleNodeView, PendingTreeItem } from "../context";
import * as dataApi from "../services/dataApi";
import { moduleTreeToFeatureTable, fromFeatureViewToTable } from "../services/pipeline";
import { derivePendingHierarchy, orderForPromote } from "../services/pendingHierarchy";
import { normalizeDisplayLabel } from "../services/abbr";

function statusTone(s?: string) {
  if (s === "已覆盖") return "ok" as const;
  if (s === "needs_review") return "warn" as const;
  if (s === "未探索") return "review" as const;
  return "gray" as const;
}

/** 判定 URL 是否为占位/示例地址（example.com 等），这类地址会导致打开打不开的页面 */
function isInvalidSystemUrl(url?: string): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return true;
    return /example\.(com|org|net)$/i.test(u.hostname);
  } catch {
    return true;
  }
}

/** 从模块树中移除指定 id 的节点及其子孙，返回新树（用于删除后立即持久化正确数据，规避 React 闭包过期） */
function removeNodesByIds(nodes: ModuleNodeView[], ids: Set<string>): ModuleNodeView[] {
  return nodes
    .filter((n) => !ids.has(n.id))
    .map((n) => ({ ...n, children: n.children ? removeNodesByIds(n.children, ids) : undefined }));
}

/** 契约 ModuleNode 树 → 前端 ModuleNodeView 树（字段映射；url/actionKind 一并带过来，避免 UI 丢数据） */
function toModuleViewTree(nodes: any[]): ModuleNodeView[] {
  return (nodes || []).map((n) => ({
    id: String(n.id),
    name: String(n.label ?? n.name ?? ""),
    type: n.type,
    status: n.status === "covered" ? "已覆盖" : n.status === "needs_review" ? "needs_review" : "未探索",
    url: n.url,
    pageTitle: n.pageTitle,
    actionKind: n.actionKind,
    children: toModuleViewTree(n.children || []),
  }));
}

/** 判断录制/补录路径是否已存在于模块树（按路径末段功能名或完整路径比对，用于「已去重」标记） */
function pathExistsInTree(path: string, nodes: ModuleNodeView[]): boolean {
  const trimmed = (path || "").trim();
  if (!trimmed) return false;
  const leaf = trimmed.split("→").pop()?.trim() || trimmed;
  const walk = (ns: ModuleNodeView[]): boolean =>
    ns.some((n) => {
      if (n.name === leaf || n.name === trimmed) return true;
      return n.children ? walk(n.children) : false;
    });
  return walk(nodes);
}

/**
 * 待入树条目 → 契约 `ClickPath`（入树的唯一出口，两条入树路径共用，避免各写一份而漏字段）。
 * 与 `ModuleNode` 对齐的字段（url / kind / parentMenu / actionSelector）必须全部带上，
 * 否则入树节点会缺 URL，对后续「功能点 → 用例」失去价值。
 */
function pendingToClickPath(item: PendingTreeItem) {
  return {
    steps: [
      {
        selector: item.actionSelector || "",
        text: item.label || item.path,
        url: item.url || "",
        timestamp: Date.now(),
        kind: (item.kind === "action" ? "action" : "menu") as "menu" | "action",
        parentMenu: item.parentMenu,
      },
    ],
    inferredModule: item.module,
    confidence: 1,
    menuUrl: item.url,
  };
}

/** 在树里按 label 找节点 id（入树响应未给出新增 id、或父条目已入树时的兜底）。
 *  兼容契约节点（label）与前端视图节点（name）两种字段名。 */
function findNodeIdByLabel(nodes: any[], label: string): string | undefined {
  for (const n of nodes || []) {
    if (String(n.label ?? n.name ?? "") === label) return String(n.id);
    const hit = findNodeIdByLabel(n.children || [], label);
    if (hit) return hit;
  }
  return undefined;
}

/** 模块树节点类型图标：目录📁 / 页面📄 / 功能🔘 / 系统🖥️ */
function typeIcon(t?: ModuleNodeView["type"]): string {
  if (t === "action") return "🔘";
  if (t === "page") return "📄";
  if (t === "system") return "🖥️";
  return "📁";
}

function toTreeItems(nodes: ModuleNodeView[], selected: string | null, onSelect: (id: string) => void, onToggle: ((id: string, checked: boolean) => void) | undefined, checkedIds: string[]): TreeItem[] {
  return nodes.map((n) => ({
    id: n.id,
    label: `${typeIcon(n.type)} ${normalizeDisplayLabel(n.name) || n.name}`,
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
    exploreAddPending,
    exploreSetModuleTree,
    exploreSetPendingTree,
    toast,
    addActivity,
    runPipelineExplore,
    exploreAiOn,
    exploreToggleAi,
    readOnlyClickPolicy,
    setReadOnlyClickPolicy,
    pipelineLoading,
    pipelineStage,
    pipelineError: _pipelineError,
    project,
    updateModuleTree,
    updateFeatureTable,
  } = useApp();

  const [modeEditOpen, setModeEditOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ModuleNodeView | null>(null);
  const [editTargetSeq, setEditTargetSeq] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ path: "", module: "", confidence: "0.90" });
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [newModuleName, setNewModuleName] = useState("");
  const [newNodeType, setNewNodeType] = useState<"module" | "page" | "action">("module");
  const [manualStep, setManualStep] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const treeToViews = (nodes: any[]): ModuleNodeView[] =>
    nodes.map((n) => ({
      id: n.id,
      name: n.label ?? n.id,
      type: n.type,
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
    if (isInvalidSystemUrl(system.url)) {
      toast("系统 URL 是示例地址（example.com），请先在项目管理中配置真实系统地址");
      return;
    }
    if (system.loginStatus !== "logged_in") {
      toast("请先登录系统");
      return;
    }
    // 会话有效性以「已登录」为主判据：登录后浏览器保持打开，探索阶段由后端复用
    // 活浏览器 / 持久化 storageState 做权威校验（落在登录页时后端返回会话失效并优雅兜底）。
    // 不再以前端 sessionState.cookies 为空就误判失效——OA 等 SPA/Token 形态的登录态
    // 常落在 localStorage 而非 document.cookie，但活浏览器仍持有有效会话。
    const cookies = system.sessionState?.cookies;
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
      // 子系统真实地址优先 capturedUrl（浏览器捕获），兜底 url
      systemUrl: system.capturedUrl || system.url,
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

  // ===== 入树的目标决策 =====
  // 历史问题（三次迭代，都是用户实测反馈）：
  //   v1 `disabled={!selectedModuleId}` → HTML 里 disabled 按钮不触发任何事件 ⇒ 点了毫无反应；
  //   v2 只弹 toast 提示 → 提示一闪而过、且入树动作没发生 ⇒ 用户仍判为"没反应"；
  //   v3 模块树为空时弹对话框 → 用户明确要求「**如果是空的就完全录入**」。
  // 现版本：**任何情况下点击都会真的入树** —— 空树时直接按记录自身层级建到根级。
  const [targetHint, setTargetHint] = useState(false);
  /** 已入树条目 seq → 它在模块树里的真实节点 id。用于"先入父、后入子"的跨批次父子解析
   *  （条目入树后会从待入树列表移除，届时 parentSeq 已指不到任何条目）。 */
  const promotedIdBySeqRef = useRef<Map<number, string>>(new Map());

  /**
   * 决定「入树」的落点，**保证点击必有结果**：
   *   ① 已在模块树选中行 → 落到选中行下方（拍板："落点以选中行为准"）
   *   ② 未选行但模块树非空 → 默认落到第一个节点下方，并明确告知落点（可在树里拖拽调整）
   *   ③ **模块树为空 → 直接建到根级**（`relativeToNodeId=null` + `end` ⇒ 契约里"追加到根"）
   *      —— 用户的明确要求是"如果是空的就完全录入"，所以**不再弹任何对话框、也不要求先建节点**；
   *      顶层条目建到根，带 parentSeq 的子条目再由 `resolveInsertTarget` 挂到父节点下。
   */
  const resolveFallback = (): { targetId: string | null; position: "below" | "end" } => {
    if (selectedModuleId) return { targetId: selectedModuleId, position: "below" };
    const first = moduleTree[0];
    if (first) {
      setTargetHint(true);
      window.setTimeout(() => setTargetHint(false), 1800);
      toast(`未选中目标行，已默认插入到「${first.name}」下方（可在模块树里拖拽调整位置）`);
      return { targetId: first.id, position: "below" };
    }
    // 空树：直接建到根级（契约：relativeToNodeId 为 null ⇒ 追加到根）
    return { targetId: null, position: "end" };
  };

  /**
   * 解析条目的插入目标。**关键**：契约 `mergeManualSupplement` 里
   * `above`/`below` 是"作为目标节点的**兄弟**插入"，只有 `end` 是"追加为目标的**子节点**"。
   * 因此：
   *   · 有父且能在树里找到父 → `end` + 父 id ⇒ **成为父的子节点**（这才是"入树自动建父子"）
   *   · 顶层条目 → `below` + 选中行 ⇒ 与选中行**同级**、插在它下方（拍板："落点以选中行为准"）
   *
   * 父的定位按可靠性从高到低：
   *   ① 父在**本次批量**里刚入树 → 用其真实节点 id
   *   ② **`parentMenu`**（录制时记下的"这个按钮属于哪个菜单"）→ 树里按 label 找
   *      （跨批次最可靠：父条目可能已入树并从列表移除，但按钮自身始终带着归属菜单名）
   *   ③ 会话内历史映射（seq → 入树拿到的真实 id），覆盖"先单条入父、再单条入子"
   *   ④ 父条目仍在列表 → 用其 label 在树里找
   */
  const resolveInsertTarget = (
    item: PendingTreeItem,
    tree: ModuleNodeView[],
    idBySeq: Map<number, string>,
    fallback: { targetId: string | null; position: "below" | "end" },
  ): { relativeToNodeId: string | null; insertPosition: "above" | "below" | "end" } => {
    const findParentId = (): string | undefined => {
      const ps = item.parentSeq;
      if (ps == null) return undefined;
      const fromBatch = idBySeq.get(ps);
      if (fromBatch) return fromBatch;
      if (item.parentMenu) {
        const byMenu = findNodeIdByLabel(tree, item.parentMenu);
        if (byMenu) return byMenu;
      }
      const fromHistory = promotedIdBySeqRef.current.get(ps);
      if (fromHistory) return fromHistory;
      const parentLabel = pendingTree.find((p) => p.seq === ps)?.label;
      return parentLabel ? findNodeIdByLabel(tree, parentLabel) : undefined;
    };
    const parentId = findParentId();
    if (parentId) return { relativeToNodeId: parentId, insertPosition: "end" };
    return { relativeToNodeId: fallback.targetId, insertPosition: fallback.position };
  };

  // ===== T6：待入树列表持久化（两段式要求它是"探索屏 body 上的**永久卡片**"）=====
  // 进入某系统时从后端加载一次；之后列表任何变更立即写回 —— 刷新页面 / 重启后端都不丢。
  // ⚠ 这里只能用「**加载完成**」才置位的标记（hydrated），绝不能用「**发起加载**」就置位的标记。
  //   曾用后者导致严重丢数据：加载是异步的，而写回 effect 依赖 pendingTree 变化 —— 首帧
  //   pendingTree 为 []、标记又已被同步置位 ⇒ 写回 effect 立刻把**空数组** PUT 到后端，
  //   覆盖掉已存的待入树记录（实测：后端 2 条 → 打开页面后变 0 条）。
  const pendingHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!system?.id || pendingHydratedRef.current === system.id) return;
    let cancelled = false;
    dataApi
      .getPendingTree(system.id)
      .then((items) => {
        if (cancelled) return;
        if (Array.isArray(items)) exploreSetPendingTree(items as any);
      })
      .catch(() => {})
      .finally(() => {
        // 加载（成功或失败）结束后才允许写回，避免用初始空态覆盖后端
        if (!cancelled) pendingHydratedRef.current = system.id;
      });
    return () => {
      cancelled = true;
    };
  }, [system?.id, exploreSetPendingTree]);

  useEffect(() => {
    if (!system?.id || pendingHydratedRef.current !== system.id) return;
    dataApi.savePendingTree(system.id, pendingTree as any).catch(() => {});
  }, [pendingTree, system?.id]);

  const handleSaveEdit = async () => {
    if (editTarget) {
      exploreUpdateModule(editTarget.id, { name: editTarget.name });
      toast("已保存");
      await saveModuleTreeToBackend();
    }
    setModeEditOpen(false);
    setEditTarget(null);
  };

  const handleSubmitNewModule = async () => {
    if (!newModuleName.trim()) {
      toast("请输入名称");
      return;
    }
    const newMod: ModuleNodeView = { id: `new-${Date.now()}`, name: newModuleName, type: newNodeType };
    exploreAddModule(selectedModuleId, newMod);
    const typeLabel = newNodeType === "module" ? "目录" : newNodeType === "page" ? "页面" : "功能";
    toast(`已添加${typeLabel}：${newModuleName}`);
    setAddModuleOpen(false);
    setNewModuleName("");
    await saveModuleTreeToBackend();
  };

  /** 一键把结构化模块树转换为九列功能表（主模块=目录/子模块=页面/功能点=页面/测试点=功能按钮） */
  const handleGenerateFeature = async () => {
    const rows = moduleTreeToFeatureTable(moduleTree, system.name);
    if (rows.length === 0) {
      toast("模块树中暂无「功能(按钮级)」节点，请先选中父节点后添加类型=功能的节点");
      return;
    }
    updateFeatureTable(rows);
    try {
      if (project.id && system.id) {
        await dataApi.saveFeatureTable(project.id, system.id, fromFeatureViewToTable(rows));
      }
    } catch (e) {
      toast(`功能表已生成但未保存：${(e as Error).message}`);
    }
    toast(`已生成 ${rows.length} 行功能表，请到「功能点」页查看`);
  };

  /** 快捷添加功能（按钮级预设）：作为当前选中节点的子节点 */
  const handleAddActionPreset = async (label: string) => {
    if (!selectedModuleId) {
      toast("请先在左侧模块树选中一个节点（功能将挂在其下）");
      return;
    }
    const node: ModuleNodeView = { id: `act-${Date.now()}-${label}`, name: label, type: "action" };
    exploreAddModule(selectedModuleId, node);
    toast(`已添加功能：${label}`);
    await saveModuleTreeToBackend();
  };

  const handleDeleteSelected = async () => {
    const idsToDelete = treeChecked.length > 0 ? treeChecked : (selectedModuleId ? [selectedModuleId] : []);
    if (idsToDelete.length === 0) {
      toast("请先选择要删除的模块（点击左侧复选框进行多选）");
      setConfirmOpen(false);
      return;
    }
    // 根因修复：基于 idsToDelete 直接计算删除后的新树，规避 dispatch 后同闭包内 moduleTree 仍是旧值
    const nextTree = removeNodesByIds(moduleTree, new Set(idsToDelete));
    if (idsToDelete.length === 1) {
      exploreRemoveModule(idsToDelete[0]);
    } else {
      exploreRemoveModulesBatch(idsToDelete);
    }
    toast(`已删除 ${idsToDelete.length} 个模块`);
    setConfirmOpen(false);
    await saveModuleTreeToBackend(nextTree);
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
    if (isInvalidSystemUrl(system.url)) {
      toast("系统 URL 是示例地址（example.com），请先在项目管理中配置真实系统地址");
      return;
    }
    try {
      setManualStep("正在启动录制...");
      const res = await dataApi.startRecording(system.id, system.capturedUrl || system.url);
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
      const steps: Array<{
        url?: string;
        selector?: string;
        text?: string;
        timestamp?: number;
        kind?: "menu" | "action";
        parentMenu?: string;
        /** 与 ModuleNode.actionKind 对齐（录制器已按通用动词分类） */
        actionKind?: string;
        pageTitle?: string;
        /** 录制器提供的结构信号：所在列表容器的嵌套层数（用于判父子，替代"点击顺序即层级"） */
        domLevel?: number;
      }> = data.clickPath?.steps || [];
      const baseSeq = Math.max(0, ...pendingTree.map((p) => p.seq));
      const moduleName = data.capturedTitle || system.name;
      if (steps.length === 0) {
        const emptyLabel = `录制于 ${new Date().toLocaleTimeString()}`;
        exploreAddPending({ seq: baseSeq + 1, path: emptyLabel, module: moduleName, confidence: "0.95", status: "待入树" });
        addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `人工补充：${emptyLabel}` });
      } else {
        // 层级推导已抽到 `services/pendingHierarchy.ts`（纯函数 + 单测，见 pendingHierarchy.test.ts）。
        //
        // ⚠ 关键修正（用户反馈"列表层级与实际系统不符"）：**点击顺序 ≠ 层级关系**。
        //   用户依次点顶栏几个**同级 tab**（首页/用户管理/角色管理/菜单管理）时，
        //   "后一条挂前一条下"会串成 7 层深链 —— 与真实结构完全不符。
        //   现只用**真实结构信号**判父子（任一成立才算子级，否则一律同级，宁缺勿造）：
        //     ① 录制器的 `domLevel`（所在列表容器嵌套层数）严格更大
        //     ② 本条 URL 是上一条的**严格前缀延续**（#/a → #/a/b）
        //   页面按钮/功能（kind='action'）例外：语义上归属最近点过的菜单。
        const derived = derivePendingHierarchy(steps, baseSeq, moduleName);
        derived.forEach((d) => {
          const isDup = pathExistsInTree(d.label, moduleTree);
          exploreAddPending({
            /* 列表态 */
            seq: d.seq,
            path: d.label,
            module: d.module,
            confidence: "0.95",
            status: isDup ? "已去重" : "待入树",
            /* 与模块树节点 ModuleNode 对齐（与模块所需参数一致，入树无损直传） */
            label: d.label, // ≡ ModuleNode.label
            nodeType: d.kind === "action" ? "action" : "page", // ≡ ModuleNode.type
            url: d.url, // ≡ ModuleNode.url
            pageTitle: d.pageTitle, // ≡ ModuleNode.pageTitle
            actionKind: d.actionKind, // ≡ ModuleNode.actionKind
            actionSelector: d.actionSelector, // ≡ ModuleNode.actionSelector
            subsystemId: system.id, // ≡ ModuleNode.subsystemId
            parentSeq: d.parentSeq, // → 入树时解析为 ModuleNode.parentId
            depth: d.depth, // ≡ ModuleNode.depth
            /* 录制态 */
            kind: d.kind,
            parentMenu: d.parentMenu,
          });
        });
        addActivity({
          id: `act-${Date.now()}`,
          time: new Date().toLocaleTimeString().slice(0, 5),
          text: `人工补充：录制 ${steps.length} 条（最小到按钮/功能）`,
        });
      }
      setRecordingId(null);
      setIsRecording(false);
      setManualOpen(false);
      setManualForm({ path: "", module: "", confidence: "0.90" });
      setManualStep("");
      toast(`录制完成：已采集 ${steps.length} 条，请在待入树列表中确认`);
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
    const isDup = pathExistsInTree(manualForm.path, moduleTree);
    exploreAddPending({
      seq,
      path: manualForm.path,
      module: manualForm.module,
      confidence: manualForm.confidence,
      status: isDup ? "已去重" : "待入树",
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
    const fallback = resolveFallback();
    try {
      // T9：入树改走**后端契约** mergeManualSupplement ——
      // 保证节点带 url/type/actionKind（与 ModuleNode 一致），并支持插入位置与去重。
      // （旧实现是前端本地插入 `{id,name}`，会丢掉 URL，导致该节点对「功能点→用例」无价值。）
      const { relativeToNodeId, insertPosition } = resolveInsertTarget(item, moduleTree, new Map(), fallback);
      const res = await dataApi.promoteManual(system.id, {
        clickPath: [pendingToClickPath(item)],
        insertPosition,
        relativeToNodeId,
      });
      exploreSetModuleTree(toModuleViewTree(res.moduleTree));
      const newId = res.addedNodeIds?.[0] ?? findNodeIdByLabel(res.moduleTree, item.label || item.path);
      if (newId) promotedIdBySeqRef.current.set(seq, newId);
      exploreRemovePending(seq);
      toast(`已入树：${item.label || item.path}（已带 URL）`);
      addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `入树：${item.path}` });
    } catch (e: any) {
      toast(`入树失败：${e.message}`);
    }
  };

  const handlePromoteAll = async () => {
    const targets = pendingTree.filter((p) => p.status === "待入树");
    if (targets.length === 0) {
      toast("待入树列表为空，暂无可入树的记录");
      return;
    }
    const fallback = resolveFallback();
    try {
      // 全部入树同样走**后端契约**（此前走 `explorePromoteAll` 的前端本地插入 —— 会丢 url/type）。
      // 逐条合并的原因：子条目要挂到**父条目的真实节点 id** 下，而父节点的 id 只有它入树后才存在；
      // 故用 orderForPromote 保证「父先于子」，并把每次新增的 id 记进 idBySeq 供子条目引用。
      const ordered = orderForPromote(targets);
      const idBySeq = new Map<number, string>();
      let tree = moduleTree;
      for (const t of ordered) {
        const { relativeToNodeId, insertPosition } = resolveInsertTarget(t, tree, idBySeq, fallback);
        const res = await dataApi.promoteManual(system.id, {
          clickPath: [pendingToClickPath(t)],
          insertPosition,
          relativeToNodeId,
        });
        tree = toModuleViewTree(res.moduleTree);
        const newId = res.addedNodeIds?.[0] ?? findNodeIdByLabel(res.moduleTree, t.label || t.path);
        if (newId) {
          idBySeq.set(t.seq, newId);
          promotedIdBySeqRef.current.set(t.seq, newId);
        }
      }
      exploreSetModuleTree(tree);
      targets.forEach((p) => exploreRemovePending(p.seq));
      toast(`已入树 ${targets.length} 条（均带 URL）`);
      addActivity({
        id: `act-${Date.now()}`,
        time: new Date().toLocaleTimeString().slice(0, 5),
        text: `全部入树 ${targets.length} 条`,
      });
    } catch (e: any) {
      toast(`入树失败：${e.message}`);
    }
  };

  const saveModuleTreeToBackend = async (nextTree?: ModuleNodeView[]) => {
    if (!project.id || !system.id) {
      console.warn('[Explore] saveModuleTreeToBackend: missing project.id or system.id', { projectId: project.id, systemId: system.id });
      return;
    }
    try {
      const contractTree = moduleTreeToContract(nextTree ?? moduleTree);
      await dataApi.saveModuleTree(project.id, system.id, contractTree);
      console.log(`[Explore] Module tree saved: ${contractTree.length} root nodes, systemId=${system.id}`);
    } catch (e) {
      console.error('[Explore] Failed to save module tree:', e);
      toast(`保存失败：${(e as Error).message}`);
    }
  };

  // 递归计算 parentId/depth（修复：原来全部置 null/0 导致树扁平化）
  const moduleTreeToContract = (nodes: ModuleNodeView[], parentId: string | null = null, depth = 0): any[] =>
    nodes.map((n) => ({
      id: n.id,
      label: n.name,
      parentId,
      subsystemId: system.id,
      // 根因修复：保留 url / pageTitle / actionKind，manuallyAdded 反映真实来源（见 pipeline.ts 同款修复）。
      url: n.url,
      pageTitle: n.pageTitle,
      actionKind: n.actionKind,
      manuallyAdded: n.manuallyAdded ?? false,
      type: (n.type ?? 'module') as 'system' | 'module' | 'page' | 'action',
      status: n.status === '已覆盖' ? 'covered' : n.status === 'needs_review' ? 'needs_review' : 'unexplored',
      children: n.children ? moduleTreeToContract(n.children, n.id, depth + 1) : [],
      depth,
    }));

  return (
    <>
      <div className="ph">
        <div>
          <h2>② 系统探索</h2>
          <div className="sub">模块树可 CRUD · 结构化人工补录：选中父节点 → 点「+ 目录/页面/功能」登记（功能=按钮级） → 点「🌳 生成功能表」刷新九列功能表；另有录制两段式（弹窗录制 → 待入树 → 选中行入树）</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={handleStartExplore} disabled={isExploring}>
            {isExploring ? "探索中..." : "开始/继续探索"}
          </Button>
          <label className="ai-toggle" title="实验功能：开启后由 AI 驱动探索，覆盖非标/无语义菜单的页面。默认关闭走确定性结构化探索。">
            <input
              type="checkbox"
              checked={exploreAiOn}
              onChange={(e) => exploreToggleAi(e.target.checked)}
            />
            AI 辅助探索（实验）
          </label>
          <label className="ai-toggle" title="只读点击安全策略：严格=仅放行 a[href]/弹窗/安全标记按钮；放行=放行所有非写操作按钮（新增/详情/查询等），仍拦截删除/提交/导出等写操作。适用于真实业务系统二次探索采证。">
            <input
              type="checkbox"
              checked={readOnlyClickPolicy === 'allow_all'}
              onChange={(e) => setReadOnlyClickPolicy(e.target.checked ? 'allow_all' : 'strict')}
            />
            只读点击：放行
          </label>
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
        <Card
          title={`模块树（☑多选 · 选中父节点自动选中子节点 · 支持拖拽）`}
          // 未选中目标行就点「入树」时高亮本卡片，把用户的注意力引到"要选哪儿"
          style={
            targetHint
              ? { outline: "2px solid var(--pri)", outlineOffset: 2, boxShadow: "0 0 0 4px rgba(37,99,235,0.15)" }
              : undefined
          }
        >
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
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Button size="sm" onClick={() => { setNewNodeType("module"); setNewModuleName(""); setAddModuleOpen(true); }}>
              + 目录
            </Button>
            <Button size="sm" onClick={() => { setNewNodeType("page"); setNewModuleName(""); setAddModuleOpen(true); }}>
              + 页面
            </Button>
            <Button size="sm" variant="pri" onClick={() => { setNewNodeType("action"); setNewModuleName(""); setAddModuleOpen(true); }}>
              + 功能
            </Button>
            <Button size="sm" variant="pri" onClick={handleGenerateFeature}>
              🌳 生成功能表
            </Button>
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>快捷功能(按钮级)：</span>
            {["新增", "修改", "列表", "删除", "查询", "导出"].map((label) => (
              <Button key={label} size="sm" onClick={() => handleAddActionPreset(label)}>
                {label}
              </Button>
            ))}
          </div>
          <div className="row">
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
              {
                key: "path",
                title: "菜单 / 功能",
                mono: true,
                // 按 depth 缩进呈现**父子层级**（对应拍板"入树时自动建父子"），
                // 类型标签用 `nodeType`（≡ ModuleNode.type），与模块树节点保持同一套语义。
                render: (r: any) => {
                  const nt = r.nodeType ?? (r.kind === "action" ? "action" : "page");
                  return (
                    <span style={{ paddingLeft: (r.depth ?? 0) * 16, display: "inline-block" }}>
                      {(r.depth ?? 0) > 0 && <span style={{ color: "var(--mut)" }}>└─ </span>}
                      {r.path}
                      <span style={{ marginLeft: 6 }}>
                        <Tag tone={nt === "action" ? "info" : "gray"}>{nt === "action" ? "功能" : "页面"}</Tag>
                      </span>
                    </span>
                  );
                },
              },
              { key: "module", title: "所在模块" },
              {
                key: "actionKind",
                title: "动作",
                // ≡ ModuleNode.actionKind（新增/查询/导出… 由录制器按通用动词分类）
                render: (r: any) => (r.actionKind ? <Tag tone="info">{r.actionKind}</Tag> : <Tag tone="gray">—</Tag>),
              },
              {
                key: "url",
                title: "URL",
                mono: true,
                render: (r: any) =>
                  r.url ? (
                    <span style={{ fontSize: 11 }} title={String(r.url)}>
                      {String(r.url).replace(/^https?:\/\//, "").slice(0, 44)}
                    </span>
                  ) : (
                    <Tag tone="gray">—</Tag>
                  ),
              },
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
              data-need-target={!selectedModuleId ? "1" : undefined}
              style={!selectedModuleId ? { opacity: 0.6 } : undefined}
              title={selectedModuleId ? "全部插入到选中行下方" : "未选目标行：默认插到第一个节点下；模块树为空时直接建到根级"}
              onClick={handlePromoteAll}
            >
              ✓ 全部入树
            </Button>
            <Button
              size="sm"
              variant="dng"
              disabled={pendingTree.filter((p) => p.status === "待入树").length === 0}
              onClick={() => {
                const targets = pendingTree.filter((p) => p.status === "待入树");
                if (targets.length === 0) return;
                // T10：真正的「忽略」= 丢弃这些待入树条目（原先只是 toast 占位，点了没反应）
                targets.forEach((p) => exploreRemovePending(p.seq));
                addActivity({
                  id: `act-${Date.now()}`,
                  time: new Date().toLocaleTimeString().slice(0, 5),
                  text: `忽略待入树 ${targets.length} 条`,
                });
                toast(`已忽略 ${targets.length} 条待入树记录`);
              }}
            >
              ✗ 忽略
            </Button>
            <span style={{ fontSize: 12, color: "var(--mut)", marginLeft: 8 }}>
              {selectedModuleId ? "将插入到选中行下方" : "未选目标行：默认插到第一个节点下；模块树为空时直接建到根级（按记录层级自动建树）"}
            </span>
          </div>
          {pendingTree.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b>行操作：</b>
              {pendingTree.map((item) => (
                <div
                  key={item.seq}
                  className="row"
                  style={{ marginTop: 4, gap: 8, paddingLeft: 8 + (item.depth ?? 0) * 16 }}
                >
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>#{item.seq}</span>
                  {(item.depth ?? 0) > 0 && <span style={{ color: "var(--mut)" }}>└─</span>}
                  <span style={{ fontSize: 13 }}>{item.path}</span>
                  {item.kind === "action" && <Tag tone="info">功能</Tag>}
                  {item.status === "待入树" && (
                    <>
                      <Button
                        size="sm"
                        variant="pri"
                        data-need-target={!selectedModuleId ? "1" : undefined}
                        style={!selectedModuleId ? { opacity: 0.6 } : undefined}
                        title={selectedModuleId ? "插入到选中行下方" : "未选目标行：默认插到第一个节点下；模块树为空时直接建到根级"}
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
        title="新增节点"
        footer={
          <>
            <Button onClick={() => { setAddModuleOpen(false); setNewModuleName(""); }}>取消</Button>
            <Button variant="pri" onClick={handleSubmitNewModule}>确认添加</Button>
          </>
        }
      >
        <div className="field">
          <label>节点类型 *</label>
          <div className="row" style={{ gap: 8 }}>
            {(["module", "page", "action"] as const).map((t) => (
              <label key={t} className="row" style={{ gap: 4, fontSize: 13 }}>
                <input
                  type="radio"
                  name="newNodeType"
                  checked={newNodeType === t}
                  onChange={() => setNewNodeType(t)}
                />
                {t === "module" ? "目录" : t === "page" ? "页面" : "功能(按钮级)"}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>名称 *</label>
          <input className="text-input" value={newModuleName} onChange={(e) => setNewModuleName(e.target.value)} autoFocus />
        </div>
        <div className="hint">
          将添加到：{selectedModuleId || "根节点"} 下方
          {newNodeType === "action" ? "（功能作为按钮级节点，生成功能表时映射为「测试点」）" : ""}
          {newNodeType === "page" ? "（页面作为子系统，生成功能表时映射为「子模块/功能点」）" : ""}
        </div>
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