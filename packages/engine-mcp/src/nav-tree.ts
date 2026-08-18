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
import type { ModuleNode } from '@test-platform/contracts';
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

/** 枚举出的功能点（action 节点源） */
export interface ActionSpec {
  label: string;
  kind: 'query' | 'list' | 'create' | 'update' | 'delete' | 'export' | 'import' | 'audit' | 'toggle' | 'submit' | 'other';
  selector: string;
  url?: string;
}

const OPERATION_KEYWORDS: Array<{ re: RegExp; kind: ActionSpec['kind']; label: string }> = [
  { re: /(新增|新建|添加|创建|录入)/, kind: 'create', label: '新增' },
  { re: /(修改|编辑|更新)/, kind: 'update', label: '修改' },
  { re: /(删除|移除|作废)/, kind: 'delete', label: '删除' },
  { re: /(查询|搜索|筛选|查找|检索)/, kind: 'query', label: '查询' },
  { re: /(导出|下载报表|导出报表)/, kind: 'export', label: '导出' },
  { re: /(导入)/, kind: 'import', label: '导入' },
  { re: /(审核|审批|复核)/, kind: 'audit', label: '审核' },
  { re: /(启用|禁用|激活|停用|上架|下架)/, kind: 'toggle', label: '启用/禁用' },
  { re: /(提交|保存|确定|确认|发布)/, kind: 'submit', label: '提交' },
];

/** 文本清洗：去多余空白、截断、去首尾标点 */
export function cleanLabel(label: string): string {
  let s = (label || '').replace(/\s+/g, ' ').trim();
  if (!s) return '未命名';
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
      const node: ModuleNode = {
        id,
        label: n.label,
        parentId,
        subsystemId: ctx.subsystemId,
        type,
        status: actions && actions.length ? 'covered' : 'needs_review',
        children: [...navChildren, ...actionChildren],
        depth,
        url: urlByKey?.get(n.key) ?? n.href,
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

/** 页面功能点枚举：列出全部操作（查询/列表/新增/修改/删除/导出/导入/审核/启用禁用/提交…） */
export function extractPageActions(
  controls: PageControl[],
  opts: { hasDataGrid?: boolean } = {},
): ActionSpec[] {
  const out: ActionSpec[] = [];
  const seenLabels = new Set<string>();

  // 列表功能点：页面存在数据表格/列表区域时，补充「列表」作为核心功能点
  if (opts.hasDataGrid) {
    out.push({ label: '列表', kind: 'list', selector: 'main, .content, table, [class*="table"], [class*="list"]' });
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
        out.push({ label: text, kind: 'other', selector: c.selector, url: c.href });
      }
      continue;
    }

    const matched = OPERATION_KEYWORDS.find((o) => o.re.test(text));
    if (matched) {
      if (seenLabels.has(matched.label)) continue;
      seenLabels.add(matched.label);
      out.push({ label: matched.label, kind: matched.kind, selector: c.selector, url: c.href });
      continue;
    }
    // 其余有意义的可交互控件（按钮/链接/提交类）也列为功能点，避免遗漏
    const isActionish =
      /button/i.test(c.tag) ||
      c.type === 'submit' ||
      /a/i.test(c.tag) ||
      /(提交|确定|保存|办理|处理|查看|详情|预览|打印|上传|生成)/.test(text);
    if (isActionish && !seenLabels.has(text)) {
      seenLabels.add(text);
      out.push({ label: text, kind: 'other', selector: c.selector, url: c.href });
    }
  }
  return out;
}

/** ActionSpec → ModuleNode（action 子节点） */
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
