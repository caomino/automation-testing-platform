/**
 * @file pageActionExplorer.ts
 * @description 页面内「具体功能点（添加/修改/列表/删除/导出/导入…）」抽取器。
 *
 * 设计对齐参考项目（C:\Users\caomi\Downloads\untitled (1)）的 UniversalDOMExtractor.extractButtonsFromDOM：
 *   - 不依赖引擎菜单遍历是否降级，直接用 engine.evaluate 在浏览器内抽取「页面内真实按钮」；
 *   - 用完整动作词表把按钮文字归类为 create/update/delete/query/export/import/detail/batch_delete/auth；
 *   - 转为 ModuleNode(type:'action') 挂在对应 page 节点下，实现「精确到具体功能」；
 *   - DOM 实采为空、且标题像 CRUD 模块时，按标题推断一组功能点并标 needs_review（诚实、不造假）。
 *
 * 红线：不 import engine-mcp 内部；只用 engine 公共方法（evaluate/navigate）；不改 contracts。
 */
import type { McpEngine } from '@test-platform/engine-mcp';
import type { ModuleNode } from '@test-platform/contracts';
import type { ActionKind } from '@test-platform/contracts';

/**
 * 单一动作分类来源 = contracts.ACTION_KINDS。
 * 此处保留局部 ACTION_DICTIONARY 用于「关键词→动作」识别，但其产出统一映射到 contracts.ActionKind，
 * 不再各自维护互不兼容的枚举（消除三处动作词典分歧）。
 * 局部 'auth' 直接对齐 contracts 'auth'；'toggle'/'submit' 等是 UI 控件而非业务动作，不进入 ActionKind。
 */
export type LocalActionKind = ActionKind;

interface RawAction {
  text: string;
  selector: string;
  tag: string;
  href: string;
}

/**
 * 完整动作词表（faithful 于参考项目 extractButtonsFromDOM 的意图判定，
 * 补齐了此前缺失的 batch_delete / auth / 重置·配置·设置 / 下载 / 同步 / 注销·强退 / 发布·上传·录入 等）。
 * 顺序即优先级：越靠前越先命中（批量删除必须排在删除之前）。
 */
const ACTION_DICTIONARY: Array<{ re: RegExp; kind: ActionKind; label: string }> = [
  { re: /新增|添加|创建|新建|发布|上传|录入|保存|提交|create|add|insert|new|save|submit/i, kind: 'create', label: '新增' },
  { re: /批量删除|批量清理|batch\s*delete|batchdelete/i, kind: 'batch_delete', label: '批量删除' },
  { re: /删除|移除|清理|注销|强退|delete|remove|drop/i, kind: 'delete', label: '删除' },
  { re: /修改|编辑|更新|重置|配置|设置|调整|edit|update|setting/i, kind: 'update', label: '修改' },
  { re: /授权|权限|分配角色|auth|permission|role/i, kind: 'auth', label: '授权' },
  { re: /导出|下载|export|download/i, kind: 'export', label: '导出' },
  { re: /导入|同步|import|sync/i, kind: 'import', label: '导入' },
  { re: /详情|明细|detail/i, kind: 'detail', label: '查看详情' },
  {
    re: /查询|搜索|筛选|刷新|查看|预览|search|query|filter|refresh|view|preview/i,
    kind: 'query',
    label: '查询',
  },
];

/** 把按钮/链接文字归类为 contracts.ActionKind；无匹配按「查看」兜底 */
export function classifyActionType(text: string): { kind: ActionKind; label: string } {
  for (const d of ACTION_DICTIONARY) {
    if (d.re.test(text)) return { kind: d.kind, label: d.label };
  }
  return { kind: 'other', label: text ? `查看${text.slice(0, 8)}` : '查看' };
}

/**
 * 浏览器内执行的功能点抽取脚本（faithful 于参考项目 extractButtonsFromDOM + COLLECT_CONTROLS_FN 的排除逻辑）：
 *   - 只在 main/.content 等主内容容器内扫描；
 *   - 排除 nav / sidebar / header / tags-view 等全局导航控件；
 *   - 排除不可见元素（keep-alive 缓存的隐藏页 DOM）；
 *   - 只取 button / a[href] / input[button|submit] / [role=button] / 带 btn 类的工具栏按钮；
 *   - 返回 { text, selector, tag, href } 候选。
 */
export function getActionExtractScript(): string {
  return `
    (() => {
      try {
        const containers = Array.from(document.querySelectorAll('main, .content, #main, [class*="content"], [class*="main"]'));
        const roots = containers.length ? containers : [document.body];
        const SEL = 'button, a[href], input[type="button"], input[type="submit"], [role="button"], [class*="btn"], [class*="toolbar"] button, [class*="operation"] button, [class*="actions"] button';
        const out = [];
        const seen = new Set();
        for (const s of roots) {
          for (const el of s.querySelectorAll(SEL)) {
            const h = el;
            const style = window.getComputedStyle(h);
            const rect = h.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || rect.width === 0 || rect.height === 0) continue;
            if (h.closest('.navbar, .navbar-container, .tags-view, .tags-view-container, .sidebar, .sidebar-container, header, .header, .topbar, .top-bar, .layout-header, .sidebar-logo-container, nav')) continue;
            const tag = h.tagName.toLowerCase();
            if (tag === 'input') {
              const t = (h.getAttribute('type') || '').toLowerCase();
              if (t !== 'button' && t !== 'submit') continue;
            }
            const text = (h.textContent || '').replace(/\\s+/g, ' ').trim() || h.getAttribute('aria-label') || h.getAttribute('value') || h.getAttribute('title') || '';
            if (!text || text.length < 2 || text.length > 30) continue;
            const cls = (h.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).join('.');
            const sel = h.id ? '#' + h.id : (h.getAttribute('data-testid') ? "[data-testid='" + h.getAttribute('data-testid') + "']" : tag + (cls ? '.' + cls : ''));
            const key = sel + '|' + text;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ text: text, selector: sel, tag: tag, href: tag === 'a' ? (h.getAttribute('href') || '') : '' });
          }
        }
        return out;
      } catch (e) {
        return [];
      }
    })()
  `;
}

/** CRUD 模块名词——标题命中其一且无 DOM 实采时，按标题推断一组功能点（标 needs_review） */
const CRUD_NOUNS = [
  '用户', '角色', '部门', '菜单', '字典', '岗位', '订单', '商品', '文章',
  '分类', '权限', '组织', '客户', '供应商', '库存', '日志', '配置', '数据',
];

/**
 * 抽取单个页面的「具体功能点」：
 *   1) 导航到页面 → engine.evaluate 抽 in-page 按钮 → 按动作词表分类成 action 节点；
 *   2) 实采为空且标题像 CRUD 模块 → 按标题推断一组功能点并标 needs_review。
 * 失败（导航/脚本异常）时返回空数组，由调用方决定兜底。
 */
export async function extractPageActions(
  engine: McpEngine,
  page: { id: string; url?: string; label: string; depth: number; children: ModuleNode[] },
  subsystemId: string,
): Promise<ModuleNode[]> {
  if (!page.url) return inferActionsFromTitle(page, subsystemId);
  try {
    await engine.navigate(page.url);
    await engine.waitForTimeout?.(500);
  } catch {
    return inferActionsFromTitle(page, subsystemId);
  }

  let raw: RawAction[] = [];
  try {
    raw = (await engine.evaluate(getActionExtractScript())) as RawAction[];
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];

  const actions: ModuleNode[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const { kind, label } = classifyActionType(r.text);
    const key = `${kind}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({
      id: `pa_${page.id}_${actions.length}`,
      label,
      parentId: page.id,
      subsystemId,
      type: 'action',
      status: 'covered',
      children: [],
      url: r.href || page.url,
      depth: page.depth + 1,
      // @T2 透传动作语义，避免下游重新猜测（根因#1）
      actionKind: kind,
      actionSelector: r.selector,
      actionText: r.text,
      reviewReason: `页面内实采按钮「${r.text}」→ ${label}`,
    });
  }

  if (actions.length > 0) return actions;
  return inferActionsFromTitle(page, subsystemId);
}

/**
 * 标题推断兜底：仅当标题含 CRUD 名词、且无任何实采功能点时调用。
 * 生成「查询/新增/修改/删除/导出/导入」并标 needs_review，诚实标注未从 DOM 实采。
 */
export function inferActionsFromTitle(
  page: { id: string; label: string; depth: number; children: ModuleNode[] },
  subsystemId: string,
): ModuleNode[] {
  const hasReal = page.children.some((c) => c.type === 'action');
  if (hasReal) return [];
  const title = page.label || '';
  if (!CRUD_NOUNS.some((n) => title.includes(n))) return [];

  const defs: Array<{ kind: ActionKind; label: string }> = [
    { kind: 'query', label: '查询' },
    { kind: 'create', label: '新增' },
    { kind: 'update', label: '修改' },
    { kind: 'delete', label: '删除' },
    { kind: 'export', label: '导出' },
    { kind: 'import', label: '导入' },
  ];
  return defs.map((d, i) => ({
    id: `infer_${page.id}_${i}`,
    label: d.label,
    parentId: page.id,
    subsystemId,
    type: 'action' as const,
    status: 'needs_review' as const,
    children: [],
    depth: page.depth + 1,
    // @T2 透传动作语义（推断型，仍标 needs_review）
    actionKind: d.kind,
    reviewReason: `标题「${title}」推断的 CRUD 功能点，未从页面 DOM 实采，需确认`,
  }));
}
