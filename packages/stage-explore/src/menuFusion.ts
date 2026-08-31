/**
 * @file menuFusion.ts
 * @description 探索降级融合管线（P1→P7）。
 *
 * 核心思想（无权限方案）：以「前端产物」为主源、逐级降级补强，每一级都记录「为什么降级」。
 * 全程不写死任何系统拓扑 —— 适配任意管理系统（路由/DOM 实时抽取，而非硬编码系统库），
 * 单一权威树来自路由 path（确定性建层级），DOM 仅作中文标题富化，杜绝重复/层级混乱。
 *   P1a 运行时 SPA 路由内存探测（Vue/React）—— 无权限、置信度最高
 *   P1b 静态逆向 JS 分包 —— P1a 失败兜底，仍是前端产物（不受 RBAC 裁剪）
 *   P2  DOM 菜单树（engine.exploreModules）—— 补中文标题、捕获非 SPA 菜单页
 *   P3/P4 只读实导航 + 功能点采集 —— 对仅路由发现的页做 best-effort 验证（封顶、全 try/catch）
 *   P5  后端 API 嗅探 —— 显式跳过（见 degrade 原因）
 *   P6  AI 自愈 —— 仅 AI 模式（在 aiExplore 中单独触发，不在此处）
 *   P7  去重 + 格式化
 *
 * 红线：不 import contracts 之外的运行时类型；只用 engine 的公共方法；不触碰 engine-mcp 内部。
 */
import type { McpEngine } from '@test-platform/engine-mcp';
import type { ModuleNode } from '@test-platform/contracts';
import {
  extractRoutesFromChunks,
  extractRoutesRuntime,
  routesToModuleNodes,
  type DegradationNote,
  type RawRoute,
} from './routeTreeExplorer.js';
import { extractPageActions } from './pageActionExplorer.js';

/** 安全取当前 URL（兼容 stub：取不到返回空） */
async function safeGetCurrentUrl(engine: McpEngine): Promise<string> {
  try {
    return (await engine.getCurrentUrl()) || '';
  } catch {
    return '';
  }
}

/** 由 URL 推导 origin（正则实现，避免依赖 DOM/Node 全局 URL 类型） */
function deriveOrigin(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+/i);
  return m ? m[0] : '';
}

/** 归一化 URL 为 pathname（去掉 query/hash/尾部斜杠），无协议则按 path 处理 */
function normalizeUrlToPath(url: string): string {
  if (!url) return '';
  const m = url.match(/^https?:\/\/[^/]+(\/[^?#]*)/i);
  if (m) return m[1].replace(/\/+$/, '');
  return url.split('?')[0].split('#')[0].replace(/\/+$/, '');
}

/** 仅用 DOM 节点富化路由树的「中文标题」（按 path 或 label 匹配），不新建节点，
 *  避免把 DOM 树并行为第二棵树而导致重复节点 / 层级混乱。 */
function enrichLabelsFromDom(
  tree: ModuleNode[],
  domByPath: Map<string, ModuleNode>,
  domByLabel: Map<string, ModuleNode>,
): void {
  const walk = (nodes: ModuleNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'action') {
        if (n.children.length) walk(n.children);
        continue;
      }
      const path = n.url ? normalizeUrlToPath(n.url) : '';
      const domHit =
        (path && domByPath.get(path)) || (n.label && domByLabel.get(n.label)) || null;
      if (domHit && domHit.label) {
        const lastSeg = path.split('/').filter(Boolean).pop() ?? '';
        // 路由标签若是空 / 无中文 / 等于原始 path 段 → 用 DOM 提供的更可读标题
        const looksLikeSegment = !n.label || !/[一-龥]/.test(n.label) || n.label === lastSeg;
        if (looksLikeSegment) n.label = domHit.label;
      }
      if (n.children.length) walk(n.children);
    }
  };
  walk(tree);
}

/** 合并 action 子节点（按 label 去重，避免重复功能点；修正 parentId 与归属父节点一致） */
function mergeActions(page: ModuleNode, actions: ModuleNode[]): void {
  const seen = new Set(page.children.map((c) => `${c.type}:${c.label}`));
  for (const a of actions) {
    const key = `${a.type}:${a.label}`;
    if (!seen.has(key)) {
      a.parentId = page.id;
      page.children.push(a);
      seen.add(key);
    }
  }
}

/** 将降级链格式化为单行日志，便于运行时直接看到「为什么降级」 */
export function formatDegradationSummary(degradations: DegradationNote[]): string {
  if (degradations.length === 0) return '未触发降级（P1a 运行时路由探测即命中）';
  return degradations
    .map((d) => `[${d.level}] ${d.from} → ${d.to}：${d.reason}`)
    .join(' ｜ ');
}

export interface FusionOptions {
  subsystemId: string;
  systemId?: string;
  startUrl?: string;
}

export interface FusionResult {
  tree: ModuleNode[];
  degradations: DegradationNote[];
}

/**
 * 无权限多级降级融合主流程。
 * @returns 模块树（含子目录 page 节点 + 操作级 action 功能点）与降级记录。
 *  失败时（所有来源都没产出）返回至少 1 个 needs_review 占位根，保证管线「永远产出」不崩。
 */
export async function buildModuleTreeViaDegradation(
  engine: McpEngine,
  opts: FusionOptions,
): Promise<FusionResult> {
  const degradations: DegradationNote[] = [];
  const subsystemId = opts.subsystemId;

  const baseUrl = opts.startUrl || (await safeGetCurrentUrl(engine));
  const origin = deriveOrigin(baseUrl);

  // —— 通用策略：不写死任何系统；以「路由 path」为唯一权威建单树 —— //
  // 路由树（按 path 段确定性建层级，天然不重复不混乱）为首选基线；
  // 路由为空时回退到 DOM 菜单树（同样是一棵单树，非 merge 两棵树）。
  // DOM 仅作为「中文标题富化」来源，绝不并行为第二棵树（那会造成重复/层级乱）。

  // —— P1a 运行时路由内存探测（无权限、置信度最高） —— //
  const runtime = await extractRoutesRuntime(engine);
  let routes: RawRoute[] = runtime.ok ? runtime.routes : [];
  if (routes.length === 0) {
    degradations.push({
      level: 'P1a→P1b',
      from: '运行时 SPA 路由内存探测',
      to: '静态逆向 JS 分包',
      reason:
        '运行时探针无结果：生产构建常剥离 __vue_app__ / __remixRouter / __VUE_DEVTOOLS 等全局变量，' +
        '或当前并非 Vue/React 类 SPA；改用静态逆向打包产物（仍是前端产物，不受 RBAC 裁剪）兜底',
    });
    // —— P1b 静态逆向 JS 分包 —— //
    const st = await extractRoutesFromChunks(engine, origin);
    if (st.routes.length > 0) {
      routes = st.routes;
    } else {
      degradations.push({
        level: 'P1b→P2',
        from: '静态逆向 JS 分包',
        to: 'DOM 菜单树',
        reason:
          st.scanned === 0
            ? '页面未加载可抓取的外部脚本（或无跨域抓取权限），静态逆向无产出'
            : '未能从 JS 分包中正则命中路由定义（打包混淆 / 路由以函数式注册 / 低代码 schema），静态逆向无产出',
      });
    }
  }

  // —— 路由树（P1 产出） —— //
  const routeNodes: ModuleNode[] = routes.length
    ? routesToModuleNodes(routes, subsystemId, origin)
    : [];

  // —— P2 DOM 菜单树（exploreModules） —— //
  let domTree: ModuleNode[] = [];
  try {
    domTree = await engine.exploreModules();
  } catch {
    degradations.push({
      level: 'P2',
      from: 'DOM 菜单树（engine.exploreModules）',
      to: '仅路由来源',
      reason: 'engine.exploreModules 调用失败，放弃 DOM 补充，仅以路由逆向结果为准',
    });
  }

  // —— 基线策略（单树，绝不把两棵树 merge） —— //
  // 1) 路由树优先（path 确定性建层级，完整且无重复）；
  // 2) 路由为空 → 用 DOM 菜单树作单树（非 SPA / 传统多页系统）；
  // 3) 都空 → 空树（后续 P0-1 占位兜底）。
  // DOM 菜单仅用于「富化路由节点的中文标题」，不新建节点，从而杜绝重复 / 层级混乱。
  const domByPath = new Map<string, ModuleNode>();
  const domByLabel = new Map<string, ModuleNode>();
  const indexDom = (nodes: ModuleNode[]): void => {
    for (const n of nodes) {
      if (n.type !== 'action') {
        if (n.url) domByPath.set(normalizeUrlToPath(n.url), n);
        if (n.label) domByLabel.set(n.label, n);
      }
      if (n.children.length) indexDom(n.children);
    }
  };
  indexDom(domTree);

  let tree: ModuleNode[];
  if (routeNodes.length > 0) {
    tree = routeNodes;
    enrichLabelsFromDom(tree, domByPath, domByLabel);
  } else if (domTree.length > 0) {
    tree = domTree;
  } else {
    tree = [];
  }

  // —— P3/P4 逐页面采集「具体功能点（添加/修改/列表/删除/导出/导入…）」 —— //
  // 不依赖引擎菜单遍历是否降级：直接对每页实导航 + engine.evaluate 抽 in-page 按钮，
  // 用完整动作词表转为 type:'action' 子节点挂到 page 下；引擎已给足功能点的页跳过，避免重复下潜。
  const allPages: ModuleNode[] = [];
  const collectPages = (nodes: ModuleNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'page') allPages.push(n);
      if (n.children.length) collectPages(n.children);
    }
  };
  collectPages(tree);

  const cap = Math.min(allPages.length, 60);
  let explored = 0;
  for (let i = 0; i < cap; i++) {
    const page = allPages[i];
    const existing = page.children.filter((c) => c.type === 'action');
    if (existing.length >= 3) continue; // 引擎已给足，跳过去重下潜
    const actions = await extractPageActions(engine, page, subsystemId);
    const seen = new Set(existing.map((c) => `${c.type}:${c.label}`));
    for (const a of actions) {
      const key = `${a.type}:${a.label}`;
      if (!seen.has(key)) {
        a.parentId = page.id;
        page.children.push(a);
        seen.add(key);
      }
    }
    explored++;
  }
  // 验证后恢复起点（避免把浏览器留在末页）
  if (baseUrl && explored > 0) {
    try {
      await engine.navigate(baseUrl);
    } catch {
      /* ignore */
    }
  }

  // —— P5 后端 API 嗅探：显式跳过并记录原因 —— //
  degradations.push({
    level: 'P5',
    from: '后端 API 嗅探（补全增删改查端点）',
    to: '仅前端源（路由 / DOM / 分包）',
    reason:
      '当前引擎未暴露网络请求事件（无 page.on(response) 接口），无法被动嗅探端点；且主动嗅探写操作会违反' +
      '「只读探索、只增新数据」铁律。故不以 RBAC 后端菜单为权威源（后端菜单恰是「有权限才看得到」的来源），' +
      '仅用前端产物（不受权限裁剪）作为无权限主源',
  });

  // —— P7 去重：合并同 path 兄弟（理论上已按 path 唯一，这里兜底去重 ID 冲突） —— //
  const seenIds = new Set<string>();
  const dedupe = (nodes: ModuleNode[]): ModuleNode[] =>
    nodes
      .filter((n) => {
        if (seenIds.has(n.id)) return false;
        seenIds.add(n.id);
        return true;
      })
      .map((n) => ({ ...n, children: dedupe(n.children) }));
  tree = dedupe(tree);

  return { tree, degradations };
}

/**
 * P0-1 兜底：当所有来源都无产出时，返回至少 1 个 needs_review 占位根，
 * 保证「管线永远产出」、不抛 EXPLORE_FAILED。降级原因汇总到 reviewReason，可追溯。
 * 调用方（nonAi/ai）在融合结果为空时按需调用。
 */
export function emptyPlaceholderNode(
  subsystemId: string,
  degradations: DegradationNote[],
): ModuleNode {
  return {
    id: `rt_empty_${subsystemId}`,
    label: '未探测到任何前端路由/菜单',
    parentId: null,
    subsystemId,
    type: 'system',
    status: 'needs_review',
    children: [],
    depth: 0,
    reviewReason: degradations.map((d) => `[${d.level}] ${d.reason}`).join(' | '),
  };
}

/**
 * 将 AI 模式额外深入发现的页面（page 节点 + action 子节点）合并进融合基线树。
 * - 与基线同名 path 的页面：吸收其 action、复用更可读的中文标题。
 * - 基线没有的页面：保持原节点（id/label/children）按 path 挂到对应 module 链下。
 * 供 aiExplore 在「P1-P7 降级基线」之上叠加「P6 AI 自愈」使用。
 */
export function mergeExternalPages(
  base: ModuleNode[],
  pages: ModuleNode[],
  subsystemId: string,
): ModuleNode[] {
  const pathMap = new Map<string, ModuleNode>();
  const indexTree = (nodes: ModuleNode[]): void => {
    for (const n of nodes) {
      if (n.type !== 'action' && n.url) pathMap.set(normalizeUrlToPath(n.url), n);
      if (n.children.length) indexTree(n.children);
    }
  };
  indexTree(base);

  for (const p of pages) {
    const path = normalizeUrlToPath(p.url || '');
    if (!path) continue;
    const existing = pathMap.get(path);
    if (existing) {
      mergeActions(existing, p.children);
      if (!existing.label || existing.label === path) existing.label = p.label;
    } else {
      const segs = path.split('/').filter(Boolean);
      let parent: ModuleNode | null = null;
      let parentPath = '';
      for (let i = 0; i < segs.length - 1; i++) {
        const cp = parentPath + '/' + segs[i];
        let m = pathMap.get(cp);
        if (!m) {
          m = {
            id: `mf_${subsystemId}_${cp}`,
            label: segs[i],
            parentId: parent ? parent.id : null,
            subsystemId,
            type: 'module',
            status: 'covered',
            children: [],
            depth: i,
          };
          if (parent) parent.children.push(m);
          else base.push(m);
          pathMap.set(cp, m);
        }
        parentPath = cp;
        parent = m;
      }
      p.parentId = parent ? parent.id : null;
      p.depth = segs.length - 1;
      if (parent) parent.children.push(p);
      else base.push(p);
      pathMap.set(path, p);
    }
  }
  return base;
}
