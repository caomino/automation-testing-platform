/**
 * @file nav-tree.ts
 * @description 探索核心纯函数（无浏览器依赖，可单测）：
 *   - 导航层级重建（buildNavHierarchy）
 *   - 层级 → ModuleNode 树（toModuleNodes，正确 parentId/depth/subsystemId，顶层=模块）
 *   - 全局去重（dedupModuleTree）
 *   - 页面功能点枚举（extractPageActions：查询/列表/新增/修改/删除/导出…）
 *   - AI 兜底归一化（aiFallback：zod 校验，失败返回 null）
 * @rationale 解决「乱点/漏覆盖/父子混乱/重复」：结构化抽取 + 每步定位 + 全局去重，
 *   而非「见啥点啥、兄弟互嵌、parentId 全空」。
 */
import type { ModuleNode, ActionKind } from '@test-platform/contracts';
import type { AIClient } from '@test-platform/infra-ai';
import { z } from 'zod';

/** 浏览器内一次性收集的导航项（含层级：parentSelector 指向父菜单容器/项） */
export interface RawNavItem {
  /** 稳定 CSS selector（作为节点唯一 key） */
  selector: string;
  /** 显示文本 */
  text: string;
  /** 导航 href（如有） */
  href?: string;
  /** 是否可展开（含子菜单） */
  expandable: boolean;
  /** 父节点 selector；null = 顶层 */
  parentSelector: string | null;
  /** 所属菜单容器标识（供「点击因果」跨容器挂父子，如顶部一级菜单 → 侧栏二三级菜单） */
  containerKey?: string;
}

/** 重建后的导航层级节点 */
export interface NavNode {
  key: string;
  label: string;
  href?: string;
  expandable: boolean;
  children: NavNode[];
}

/** 页面内可交互控件（供功能点枚举） */
export interface PageControl {
  selector: string;
  tag: string;
  text?: string;
  href?: string;
  type?: string;
  placeholder?: string;
}

/** 枚举出的功能点（action 节点源）。kind 统一为 contracts.ActionKind（单一分类来源）。
 *  审核/审批 → permission；启用禁用/提交保存等 UI 控件 → other（非业务动作，禁止在探索阶段触发）。 */
export interface ActionSpec {
  label: string;
  kind: ActionKind;
  selector: string;
  /** 原始控件文本（透传给 ModuleNode.actionText，避免下游重新猜测） */
  text?: string;
  url?: string;
}

const OPERATION_KEYWORDS: Array<{ re: RegExp; kind: ActionKind; label: string }> = [
  { re: /(新增|新建|添加|创建|录入)/, kind: 'create', label: '新增' },
  { re: /(修改|编辑|更新)/, kind: 'update', label: '修改' },
  { re: /(删除|移除|作废)/, kind: 'delete', label: '删除' },
  { re: /(查询|搜索|筛选|查找|检索)/, kind: 'query', label: '查询' },
  { re: /(导出|下载报表|导出报表)/, kind: 'export', label: '导出' },
  { re: /(导入)/, kind: 'import', label: '导入' },
  { re: /(审核|审批|复核|授权|权限)/, kind: 'permission', label: '审核' },
  { re: /(启用|禁用|激活|停用|上架|下架)/, kind: 'other', label: '启用/禁用' },
  { re: /(提交|保存|确定|确认|发布)/, kind: 'other', label: '提交' },
];

/** 文本清洗：去括号注释/角标、去多余空白、截断、去首尾标点 */
export function cleanLabel(label: string): string {
  let s = (label || '').replace(/\s+/g, ' ').trim();
  if (!s) return '未命名';
  // 去除括号及括号内的内容（英文别名/计数角标/快捷键等）
  const withoutBrackets = s.replace(/\s*[(（\[【][^)\]\）】]{0,80}[)）\]】]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutBrackets) {
    s = withoutBrackets;
  }
  s = s.replace(/^[\s\-_:|>]+|[\s\-_:|<]+$/g, '');
  if (s.length > 60) s = s.slice(0, 57).trim() + '...';
  return s || '未命名';
}

/** 由原始导航项重建层级树（parentSelector 链接父级，找不到父级则归顶层） */
export function buildNavHierarchy(items: RawNavItem[]): NavNode[] {
  const byKey = new Map<string, NavNode>();
  for (const it of items) {
    byKey.set(it.selector, {
      key: it.selector,
      label: cleanLabel(it.text),
      href: it.href,
      expandable: it.expandable,
      children: [],
    });
  }
  const roots: NavNode[] = [];
  for (const it of items) {
    const node = byKey.get(it.selector)!;
    const parent = it.parentSelector ? byKey.get(it.parentSelector) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  // 去环：若某节点仍无父但被误挂，已在上面处理；返回去重后的根
  const seen = new Set<NavNode>();
  const dedup = (nodes: NavNode[]): NavNode[] =>
    nodes.filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      n.children = dedup(n.children);
      return true;
    });
  return dedup(roots);
}

interface ToModuleCtx {
  subsystemId: string;
  systemId?: string;
  /** 系统入口 URL（用于把菜单 href 的相对路径解析为绝对 URL，保证 URL 可被用例阶段直接导航） */
  baseUrl?: string;
}

/**
 * 把菜单 href 解析为可导航的绝对 URL（通用）：
 *  - 相对路径（/system/user、system/user、?a=1、#/x）→ 以系统入口为 base 解析；
 *  - javascript:/空 → 视为不可导航（如实返回原值，由调用方按 placeholders 处理）。
 * 各框架的侧栏菜单大量使用相对 href（Element-UI/AntD/ruoyi 实测），不解析会丢掉 URL，
 * 导致用例阶段无法按路径二次探索。
 */
export function resolveNavUrl(href: string | undefined, baseUrl?: string): string | undefined {
  if (!href) return undefined;
  const h = href.trim();
  if (!h || /^(javascript:|#$)/i.test(h)) return h;
  if (/^https?:\/\//i.test(h)) return h;
  if (!baseUrl) return h;
  try {
    return new URL(h, baseUrl).toString();
  } catch {
    return h;
  }
}

/** 层级树 → ModuleNode 树：正确回填 parentId/depth/subsystemId，顶层即模块/页面（不再强制包 system 根）。
 *  actionsByKey：叶子页（无子菜单）对应的页面功能点，挂为 action 子节点。
 *  系统归属由 subsystemId 承载，与下游 feature 阶段主/子模块推导契约一致。 */
export function toModuleNodes(
  nav: NavNode[],
  ctx: ToModuleCtx,
  actionsByKey?: Map<string, ActionSpec[]>,
  urlByKey?: Map<string, string>,
): ModuleNode[] {
  let counter = 0;
  const build = (nodes: NavNode[], parentId: string | null, depth: number): ModuleNode[] =>
    nodes.map((n) => {
      const id = `n_${counter++}`;
      const hasNavChildren = n.children.length > 0;
      // 颗粒度修复：即使节点有子菜单，也允许挂 actions（识别出的页面功能点），不再因 hasNavChildren 丢弃
      const actions = actionsByKey ? actionsByKey.get(n.key) : undefined;
      const type: ModuleNode['type'] = hasNavChildren ? 'module' : 'page';
      const navChildren = build(n.children, id, depth + 1);
      const actionChildren = (actions ?? []).map((a) => actionToModule(a, id, ctx.subsystemId, depth + 1));
      const url = urlByKey?.get(n.key) ?? resolveNavUrl(n.href, ctx.baseUrl);
      // 状态口径（2026-09-18 边界裁定）：本阶段只做「菜单子目录/功能页」粒度探索，
      // 不再产出动作级功能点。故覆盖状态以「是否真实导航到页面（拿到可导航 URL）」为准，
      // 而非以是否有 action 子节点为准（否则菜单级探索会被误判为全部 needs_review）。
      const navigable = !!url && (/^https?:\/\//i.test(url) || url.startsWith('click:'));
      const node: ModuleNode = {
        id,
        label: n.label,
        parentId,
        subsystemId: ctx.subsystemId,
        type,
        status: actions && actions.length ? 'covered' : navigable ? 'covered' : 'needs_review',
        children: [...navChildren, ...actionChildren],
        depth,
        url,
        evidenceId: 'ev_nav',
      };
      return node;
    });

  return build(nav, null, 0);
}

/** 全局去重：按「祖先 label 链 + label + url + type」指纹去重（不含 parentId，避免自嵌套同名节点去不掉），
 *  保留首次出现（解决重复根因）。 */
export function dedupModuleTree(tree: ModuleNode[]): ModuleNode[] {
  const seen = new Set<string>();
  const walk = (nodes: ModuleNode[], ancestorLabels: string[]): ModuleNode[] =>
    nodes
      .filter((n) => {
        const chain = [...ancestorLabels, n.label].join('/');
        const fp = `${n.type}|${chain}|${n.url ?? ''}`;
        if (seen.has(fp)) return false;
        seen.add(fp);
        return true;
      })
      .map((n) => ({ ...n, children: walk(n.children, [...ancestorLabels, n.label]) }));
  return walk(tree, []);
}

/**
 * 归一化模块树：按最终 children 重算 type/depth，并修正 parentId 自洽性。
 * 为什么需要：合并汇总菜单（mergeRollupModules）会在建树后把子级并入其它节点，
 * 若不重算，会出现「type=page 却有子级」「depth 与实际层级不一致」的矛盾结构
 * （OA 实证：一级菜单被标成 page，导致下游按 type 取模块时漏掉整棵子树）。
 */
export function normalizeModuleTree(tree: ModuleNode[]): ModuleNode[] {
  const walk = (nodes: ModuleNode[], parentId: string | null, depth: number): ModuleNode[] =>
    nodes.map((n) => {
      const children = walk(n.children ?? [], n.id, depth + 1);
      const hasContainerChild = children.some((c) => c.type !== 'action');
      return {
        ...n,
        parentId,
        depth,
        type: hasContainerChild ? 'module' : n.type === 'action' ? 'action' : 'page',
        children,
      };
    });
  return walk(tree, null, 0);
}

/**
 * 合并「汇总型菜单」（如顶栏的「更多模块」下拉）：其直接子级多数是树中已存在的顶层模块同名节点时，
 * 该节点只是 UI 汇总入口，内容与他处重复。处理方式：把它各子级下的独有子节点并入对应顶层模块，
 * 然后丢弃该汇总节点 —— 避免重复模块与层级错挂。
 * 纯结构判定，不写死任何系统与菜单名。
 */
export function mergeRollupModules(tree: ModuleNode[]): ModuleNode[] {
  // 仅以「顶层模块」为合并目标（汇总菜单复制的正是顶层模块）
  const topByLabel = new Map<string, ModuleNode>();
  for (const n of tree) {
    if (n.type !== 'action') topByLabel.set(n.label, n);
  }
  const keep: ModuleNode[] = [];
  for (const node of tree) {
    const nonAction = node.children.filter((c) => c.type !== 'action');
    if (node.type === 'action' || nonAction.length === 0) {
      keep.push(node);
      continue;
    }
    const matched = nonAction.filter(
      (c) => topByLabel.get(c.label) && topByLabel.get(c.label) !== c,
    );
    // 汇总判定：非 action 子级「全部」与既有顶层模块同名（至少 1 个）→ 视为汇总入口。
    // 例外：子级与自身同名（模块列表里重复出现自身，如 项目管理→项目管理）不算汇总，保留。
    const isSelfDup = nonAction.some((c) => c.label === node.label);
    const isRollup = !isSelfDup && matched.length === nonAction.length;
    if (!isRollup) {
      keep.push(node);
      continue;
    }
    for (const c of node.children) {
      const target = topByLabel.get(c.label);
      if (!target || target === c) continue;
      const seen = new Set(target.children.map((x) => `${x.type}:${x.label}`));
      for (const g of c.children) {
        if (seen.has(`${g.type}:${g.label}`)) continue;
        g.parentId = target.id;
        target.children.push(g);
        seen.add(`${g.type}:${g.label}`);
      }
    }
    // 汇总节点自身丢弃（其内容已按标签并入既有顶层模块）
  }
  return keep;
}

/** 页面功能点枚举：列出全部操作（查询/列表/新增/修改/删除/导出/导入/审核/启用禁用/提交…） */
export function extractPageActions(
  controls: PageControl[],
  opts: { hasDataGrid?: boolean } = {},
): ActionSpec[] {
  const out: ActionSpec[] = [];
  const seenLabels = new Set<string>();

  // 列表功能点：页面存在数据表格/列表区域时，补充「列表」作为核心功能点
  if (opts.hasDataGrid) {
    out.push({ label: '列表', kind: 'list', selector: 'main, .content, table, [class*="table"], [class*="list"]', text: '列表' });
    seenLabels.add('列表');
  }

  for (const c of controls) {
    const text = (c.text || c.placeholder || '').trim();
    if (!text) continue;
    // 跳过纯装饰/无语义长文本
    if (text.length > 30) continue;

    // Tab/标签页：作为「页面菜单下的标签」功能点（颗粒度要求）
    if (c.type === 'tab') {
      if (!seenLabels.has(text)) {
        seenLabels.add(text);
        out.push({ label: text, kind: 'other', selector: c.selector, text, url: c.href });
      }
      continue;
    }

    const matched = OPERATION_KEYWORDS.find((o) => o.re.test(text));
    if (matched) {
      if (seenLabels.has(matched.label)) continue;
      seenLabels.add(matched.label);
      out.push({ label: matched.label, kind: matched.kind, selector: c.selector, text, url: c.href });
      continue;
    }
    // 其余有意义的可交互控件也列为功能点，避免遗漏。
    // 收紧（OA 实证）：不再"所有 a 标签都算功能点"——否则表格数据行链接（项目名称/单据号）
    // 会被当成功能点。仅接受按钮类控件，或文本为业务动作词（申请/审核/归档/补录…）。
    const isActionish =
      /button/i.test(c.tag) ||
      c.type === 'submit' ||
      /(提交|确定|保存|办理|处理|查看|详情|预览|打印|上传|生成|申请|审核|审批|复核|授权|启用|禁用|停用|导入|导出|下发|签收|撤销|撤回|跟踪|流转|归档|立项|补录|变更|重置|刷新|考核|作废|催办|转办|委派)/.test(text);
    if (isActionish && !seenLabels.has(text)) {
      seenLabels.add(text);
      out.push({ label: text, kind: 'other', selector: c.selector, text, url: c.href });
    }
  }
  return out;
}

/** ActionSpec → ModuleNode（action 子节点）。@T2 透传动作语义到 ModuleNode，避免下游重新猜测。 */
export function actionToModule(spec: ActionSpec, parentId: string, subsystemId: string, depth: number): ModuleNode {
  return {
    id: `act_${parentId}_${spec.label}`,
    label: spec.label,
    parentId,
    subsystemId,
    type: 'action',
    status: 'covered',
    children: [],
    depth,
    url: spec.url,
    evidenceId: 'ev_action',
    // @T2 透传动作语义
    actionKind: spec.kind,
    actionSelector: spec.selector,
    actionText: spec.text ?? spec.label,
  };
}

// --- AI 兜底归一化 ---
interface AiNode {
  label: string;
  type?: 'module' | 'page' | 'action';
  href?: string;
  children?: AiNode[];
}
const AiNodeSchema: z.ZodType<AiNode> = z.lazy(() =>
  z.object({
    label: z.string(),
    type: z.enum(['module', 'page', 'action']).optional(),
    href: z.string().optional(),
    children: z.array(AiNodeSchema).optional(),
  }),
);

export interface AiFallbackContext {
  subsystemId: string;
  systemId: string;
  /** 已结构化抽取到的节点数（用于判断是否值得兜底） */
  structuredCount: number;
  /** 页面导航文本摘要（喂给 AI 的上下文） */
  pageSummary: string;
}

/**
 * AI 兜底：把页面导航摘要发给 AI，要求返回规范化菜单树 JSON；
 * zod 校验失败或任意异常 → 返回 null（调用方回退到结构化结果 + needs_review）。
 * 此函数不主动开启 AI，仅在调用方已注入 ai 客户端时执行。
 */
export async function aiFallback(ai: AIClient, ctx: AiFallbackContext): Promise<ModuleNode[] | null> {
  try {
    const prompt =
      `你是测试平台导航结构识别器。下面是一段系统页面的导航/菜单文本：\n` +
      `${ctx.pageSummary}\n\n` +
      `请输出该系统完整的功能模块树（JSON 数组），每个节点含：label(中文名)、type(module=模块/page=页面/action=功能点)、href(可选)、children(可选)。` +
      `要求：列出所有模块与功能点（含新增/修改/删除/查询/导出等操作），层级分明，不要遗漏。只输出 JSON，不要解释。`;

    const res = await ai.complete({ prompt, temperature: 0.2 });
    const jsonText = (res.text || '').trim();
    const start = jsonText.indexOf('[');
    const end = jsonText.lastIndexOf(']');
    if (start < 0 || end < 0) return null;
    const parsed = JSON.parse(jsonText.slice(start, end + 1));
    const roots = z.array(AiNodeSchema).parse(parsed);

    // 归一化：生成 ModuleNode 树（正确 parentId/depth/subsystemId，顶层=模块，不包 system 根）
    let counter = 0;
    const build = (nodes: z.infer<typeof AiNodeSchema>[], parentId: string | null, depth: number): ModuleNode[] =>
      nodes.map((n) => {
        const id = `ai_${counter++}`;
        const type: ModuleNode['type'] = n.type ?? (n.children && n.children.length ? 'module' : 'page');
        return {
          id,
          label: cleanLabel(n.label),
          parentId,
          subsystemId: ctx.subsystemId,
          type,
          status: 'needs_review',
          children: build(n.children ?? [], id, depth + 1),
          depth,
          url: n.href,
          evidenceId: 'ev_ai',
        };
      });
    return build(roots, null, 0);
  } catch {
    return null;
  }
}
