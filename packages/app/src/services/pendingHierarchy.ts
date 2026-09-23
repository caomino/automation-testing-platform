/**
 * @file pendingHierarchy.ts
 * @description 录制点击 → 待入树条目的**层级推导**（纯函数，可单测）
 *
 * 背景（用户反馈"列表层级与实际系统不符"）：
 *   早期实现用"点击顺序即层级"（后一条挂前一条下），结果用户依次点顶栏几个**同级 tab**
 *   （首页/用户管理/角色管理/菜单管理）时，被串成 7 层深链 —— 与真实结构完全不符。
 *
 * 现在的判定（只用**真实结构信号**，不依赖点击顺序，也不依赖任何系统特征）：
 *   ① **DOM 层级更深**：录制器记录的 `domLevel`（所在列表容器嵌套层数）严格更大 ⇒ 子级
 *   ② **URL 子路径**：本条 URL 是上一条的严格前缀延续 ⇒ 子级
 *   ③ 两者都不成立 ⇒ **同级**（宁缺勿造，绝不编造层级）
 *   页面按钮/功能（kind='action'）例外：它在**语义上归属**最近点过的菜单，故挂到该菜单下。
 */

export interface ClickStepInput {
  text?: string;
  selector?: string;
  url?: string;
  timestamp?: number;
  kind?: "menu" | "action";
  parentMenu?: string;
  actionKind?: string;
  pageTitle?: string;
  /** 录制器给出的结构信号：元素所在列表容器的嵌套层数 */
  domLevel?: number;
  /**
   * **DOM 祖先菜单链**（v2 权威层级信号）：该菜单项在真实 ul/li 嵌套里的祖先菜单标题，
   * 如 ['实例演示','表单']。与点击顺序无关 —— 用户跳跃点击、来回切换都不会影响层级。
   * 空数组 = 已知顶层；undefined = 旧录制数据（退回 domLevel/URL 启发式）。
   */
  menuPath?: string[];
}

export interface PendingHierarchyItem {
  seq: number;
  label: string;
  module: string;
  kind: "menu" | "action";
  parentSeq: number | null;
  depth: number;
  url?: string;
  pageTitle?: string;
  actionKind?: string;
  actionSelector?: string;
  parentMenu?: string;
}

/** 归一化 URL 用于前缀比较：保留 hash（SPA hash 路由的层级在 # 之后），去掉 query 与末尾斜杠 */
export function normUrlForHierarchy(u?: string): string {
  return (u || "").split("?")[0].replace(/\/+$/, "");
}

/**
 * 推导待入树条目的父子与层级。
 *
 * **层级来源分两代**：
 *  · **v2（权威）**：录制器为每个菜单项提取 **DOM 祖先菜单链** `menuPath`
 *    （如 ['实例演示','表单']，来自真实 ul/li 嵌套结构）—— 层级与点击顺序**完全无关**，
 *    用户跳跃点击、来回切换都不会再串链或拍平。缺失的祖先自动补全为合成条目，
 *    重复点击同一菜单天然复用同一条目（不产生重复）。
 *  · **v1（兼容）**：旧录制数据没有 `menuPath` 字段时，退回 domLevel/URL 前缀启发式。
 *
 * @param steps 录制得到的点击序列
 * @param baseSeq 现有列表的最大 seq（新条目从 baseSeq+1 起）
 * @param fallbackModule 录制所属系统名（模块列兜底）
 */
export function derivePendingHierarchy(
  steps: ClickStepInput[],
  baseSeq: number,
  fallbackModule: string,
): PendingHierarchyItem[] {
  const out: PendingHierarchyItem[] = [];
  // 统一 seq 分配：合成祖先与用户点击条目共用计数器
  let nextSeq = baseSeq;
  const next = () => ++nextSeq;

  // menuPath 权威模式：祖先链 key（'∕' 连接，防同名拼接歧义）→ 已建条目
  const byPath = new Map<string, { seq: number; depth: number }>();

  // v1 启发式状态（仅当 menu 项没有 menuPath 字段时使用）
  let lastMenuSeq: number | null = null;
  let lastMenuDepth = 0;
  let lastMenuUrl = "";
  let lastMenuLevel: number | null = null;

  steps.forEach((s, i) => {
    const label = (s.text || s.selector || "").trim() || `步骤 ${i + 1}`;
    const kind: "menu" | "action" = s.kind ?? "menu";

    // ===== v2 权威模式：录制器给出了 DOM 祖先链（含空数组 = 已知顶层）=====
    if (kind === "menu" && Array.isArray(s.menuPath)) {
      const chain = [...s.menuPath, label];
      let parentSeq: number | null = null;
      let node = { seq: 0, depth: -1 };
      for (let d = 0; d < chain.length; d++) {
        const key = chain.slice(0, d + 1).join(" ∕ ");
        const known = byPath.get(key);
        if (known) {
          node = known;
          parentSeq = known.seq;
          continue;
        }
        const isLeaf = d === chain.length - 1;
        node = { seq: next(), depth: d };
        byPath.set(key, node);
        out.push({
          seq: node.seq,
          label: chain[d],
          module: fallbackModule,
          kind: "menu",
          parentSeq,
          depth: d,
          // 用户真点过的叶子带落地 URL/选择器；合成的祖先没有独立落地地址
          url: isLeaf ? s.url : undefined,
          pageTitle: isLeaf ? s.pageTitle : undefined,
          actionSelector: isLeaf ? s.selector : undefined,
        });
        parentSeq = node.seq;
      }
      // 供后续 action 归属到本菜单叶子
      lastMenuSeq = node.seq;
      lastMenuDepth = node.depth;
      lastMenuUrl = s.url || "";
      lastMenuLevel = typeof s.domLevel === "number" ? s.domLevel : null;
      return;
    }

    // ===== v1 兼容：旧录制数据（无 menuPath）或 action =====
    const seq = next();
    let parentSeq: number | null = null;
    let depth = 0;
    let module = fallbackModule;

    if (kind === "menu") {
      const deeper =
        lastMenuLevel !== null && typeof s.domLevel === "number" && s.domLevel > lastMenuLevel;
      const u = normUrlForHierarchy(s.url);
      const pu = normUrlForHierarchy(lastMenuUrl);
      const urlChild = !!pu && !!u && u !== pu && (u.startsWith(pu + "/") || u.startsWith(pu + "#"));
      const isChild = lastMenuSeq !== null && (deeper || urlChild);
      parentSeq = isChild ? lastMenuSeq : null; // 结构信号不成立 ⇒ 同级
      depth = isChild ? lastMenuDepth + 1 : 0;
      lastMenuSeq = seq;
      lastMenuDepth = depth;
      lastMenuUrl = s.url || "";
      lastMenuLevel = typeof s.domLevel === "number" ? s.domLevel : null;
    } else {
      // 按钮/功能：语义归属最近点过的菜单（不是层级推断）
      parentSeq = lastMenuSeq;
      depth = lastMenuSeq === null ? 0 : lastMenuDepth + 1;
      module = s.parentMenu || fallbackModule;
    }

    out.push({
      seq,
      label,
      module: module || fallbackModule,
      kind,
      parentSeq,
      depth,
      url: s.url,
      pageTitle: s.pageTitle,
      actionKind: s.actionKind,
      actionSelector: s.selector,
      parentMenu: s.parentMenu,
    });
  });

  return out;
}

/**
 * 「全部入树」的处理顺序：**父必须先于子入树**。
 *
 * 原因：入树是逐条走后端合并的，子条目要挂到**父条目的真实节点 id** 下，
 * 而父条目的 id 只有它自己入树之后才存在。若乱序处理，子条目找不到父 id，
 * 就会被平铺到选中行下 ⇒ 层级丢失。
 *
 * 规则：按 depth 升序（父的 depth 必然小于子），同 depth 保持原有 seq 顺序（稳定，
 * 保证用户看到的列表顺序不被额外打乱）。缺失 depth 视为 0。不修改入参。
 */
export function orderForPromote<T extends { seq: number; depth?: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = a.depth ?? 0;
    const db = b.depth ?? 0;
    if (da !== db) return da - db;
    return a.seq - b.seq;
  });
}
