/**
 * @file aiExplore.ts
 * @description AI 辅助探索实现（P-B / 双模式之「开启 AI」侧）。
 *
 * 隔离硬约束（design §3）：本文件**不得** import `menu-explorer.ts` / `nonAiExplore.ts` /
 * `infra-ai` 的 AIClient 实现细节（仅用其类型）；唯一交汇点是入参 `engine: McpEngine` 与
 * 出参 `ModuleNode[]`。运行时与 non-AI 路径二选一，绝不共用探索器代码。
 *
 * 算法（T3.2 增强）：独立 agent 循环 ——
 *   extractPageElements → 标注「菜单候选」（sidebar/menu 容器内）→ AIClient 决策
 *   → 本地危险词硬挡 → runStep(click) → 等待稳定 → 采集该页功能点挂为 action 叶子
 *   → 循环（封顶 maxSteps 防失控）。
 * 引导目标：**优先点击未访问的菜单项，进入每个菜单页面**，在每个页面内识别
 * 列表/新增/修改/删除/查询/导出等按钮级功能点。全程只读，失败安全降级。
 */
import type { McpEngine } from '@test-platform/engine-mcp';
import type { AIClient, AIRequest } from '@test-platform/infra-ai';
import type { ExploredElement, ModuleNode } from '@test-platform/contracts';

/** AI 模式的探索上下文 */
export interface AiExploreContext {
  subsystemId: string;
  systemId?: string;
  startUrl?: string;
}

/** AI 循环保护上限 */
export interface AiExploreLimits {
  /** 最大决策步数（防无限循环） */
  maxSteps: number;
  /** 点击后等待渲染时长 ms */
  settleMs: number;
}

const DEFAULT_LIMITS: AiExploreLimits = { maxSteps: 80, settleMs: 1500 };

/**
 * AI 模式**专属严格黑名单**：绝不点击任何可能破坏会话或数据的入口。
 * 比非 AI 的 DANGEROUS_TEXT 更严（含删除），因为 AI 决策有不确定性，宁可漏探不可误删。
 */
const AI_DANGEROUS_TEXT =
  /退出|注销|登出|logout|sign\s?out|切换账号|清空|重置|删除|解绑|修改密码|密码修改|禁用|停用|导出全部|批量删除/i;

/** 动作关键词 → 标签（轻量副本，隔离优先，不依赖 engine-mcp 内部 extractPageActions） */
const ACTION_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /新增|添加|新建|create|add|insert/i, label: '新增' },
  { re: /修改|编辑|更新|update|edit|modify/i, label: '修改' },
  { re: /删除|移除|delete|remove/i, label: '删除' },
  { re: /查询|搜索|检索|search|query|find/i, label: '查询' },
  { re: /导出|export/i, label: '导出' },
  { re: /导入|import/i, label: '导入' },
  { re: /详情|查看|detail|view/i, label: '查看详情' },
  { re: /提交|保存|save|submit/i, label: '保存' },
  { re: /列表|list|table/i, label: '列表' },
  { re: /刷新|reload|refresh/i, label: '刷新' },
];

/** 把候选元素识别为一个 action 节点（无匹配则按「查看」兜底） */
function actionNode(
  el: ExploredElement,
  pageId: string,
  subsystemId: string,
  depth: number,
): ModuleNode {
  const text = el.text || el.label || el.tag;
  const hit = ACTION_KEYWORDS.find((a) => a.re.test(text));
  const label = hit ? hit.label : text ? `查看(${text.slice(0, 12)})` : '查看';
  return {
    id: `ai_act_${pageId}_${el.ref}`,
    label,
    parentId: pageId,
    subsystemId,
    type: 'action',
    status: 'covered',
    children: [],
    url: el.href,
    depth,
  };
}

/** 解析 AI 返回的「下一步」决策 */
function parseDecision(text: string): { kind: 'done' } | { kind: 'click'; ref: string } {
  const t = (text || '').trim();
  if (/done|完成|结束|没有|无需|stop|finish/i.test(t) && !/ref/i.test(t)) {
    return { kind: 'done' };
  }
  // 优先解析 JSON {ref:"..."} 或 {action:"click", ref:"..."}
  const jsonMatch = t.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const ref = obj.ref || obj.selector || obj.target;
      if (ref) return { kind: 'click', ref: String(ref) };
      if (/done|finish|stop/i.test(String(obj.action ?? ''))) return { kind: 'done' };
    } catch {
      // 非 JSON，走下方宽松解析
    }
  }
  // 宽松：提取 ref="..." 或 ref: "..." 或末尾 token
  const refMatch = t.match(/ref[=:\s]+["']?([^\s"',}]+)/i);
  if (refMatch) return { kind: 'click', ref: refMatch[1].replace(/["']/g, '') };
  return { kind: 'done' };
}

/** 候选是否为「安全可点」的导航类元素（只点 a / button / role=button，绝不点 input/select/textarea） */
function isSafeClickable(el: ExploredElement): boolean {
  const tag = (el.tag || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return false;
  if (AI_DANGEROUS_TEXT.test(el.text || el.label || '')) return false;
  return true;
}

/**
 * 标注哪些候选元素位于「菜单/导航容器」内（sidebar / menu / nav）。
 * 用 engine.evaluate 批量判断，兼容 stub engine（返回 undefined 时降级为空集）。
 */
async function markMenuCandidates(
  engine: McpEngine,
  els: ExploredElement[],
): Promise<Set<string>> {
  const selectors = els.map((e) => e.selector).filter(Boolean);
  if (selectors.length === 0) return new Set();
  try {
    // 字符串形式注入（引擎 evaluate 原样传给 page.evaluate），避开 Node tsconfig 无 dom lib 的检查
    const marked = await engine.evaluate<number[]>(
      `(sels) => {
        const MENU_CONTAINERS = '[class*="sidebar"], [class*="menu"], [class*="nav"], nav, aside, [role="menubar"], [role="navigation"], [role="tree"]';
        const containers = Array.from(document.querySelectorAll(MENU_CONTAINERS));
        const marks = [];
        sels.forEach((sel, i) => {
          try {
            const el = document.querySelector(sel);
            if (el && containers.some((c) => c === el || c.contains(el))) marks.push(i);
          } catch {}
        });
        return marks;
      }` as unknown as (...args: any[]) => number[],
      selectors,
    );
    if (!Array.isArray(marked)) return new Set();
    return new Set(marked.map((i) => els[i]?.ref).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** 获取当前页面标题（兼容 stub：取不到时返回空） */
async function getPageTitle(engine: McpEngine): Promise<string> {
  try {
    const title = await engine.evaluate<string>(
      `() => {
        const main = document.querySelector('.app-main, main, .main, .content, [class*="content"], [class*="main"]') || document.body;
        const heading = main.querySelector('h1, h2, .page-title, [class*="page-title"], [class*="page_header"], [class*="title"]');
        const t = heading ? (heading.textContent || '').trim() : '';
        return t || document.title || '';
      }` as unknown as () => string,
    );
    return (title || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  } catch {
    return '';
  }
}

const SYSTEM_PROMPT = `你是一个 Web 系统功能探索助手。当前已登录目标系统，任务是把系统中**所有菜单页面**都走一遍，并在每个页面识别它的功能按钮（列表/新增/修改/删除/查询/导出等）。
规则：
1. 我会给你两组候选：A=菜单/导航项（点击可进入新页面），B=当前页面内的其他可点元素（按钮/链接/Tab）。
2. **优先选择 A 组中未访问过的菜单项**，点击进入其页面；父级菜单（带子菜单）先点开它，再点子菜单进入页面。
3. 只有当 A 组全部访问过（或没有 A 组候选）时，才考虑 B 组。
4. 严禁点包含「退出/注销/登出/切换账号/删除/清空/重置/解绑/修改密码」等破坏性文字的元素。
5. 若已无任何可探索的新菜单/新页面，回答 "done"。
6. 回答格式：ref="<候选的 ref>"，或 "done"。不要解释。`;

/**
 * AI 辅助探索主流程。
 * @returns 模块树（page 节点下挂 action 级功能点；异常时返回已收集节点并整体标 needs_review，绝不抛崩）
 */
export async function exploreWithAi(
  engine: McpEngine,
  ai: AIClient,
  ctx: AiExploreContext,
  limits: Partial<AiExploreLimits> = {},
): Promise<ModuleNode[]> {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  const subsystemId = ctx.subsystemId;
  const pages = new Map<string, ModuleNode>(); // 已访问 URL → page 节点
  const visitedRefs = new Set<string>();
  const visitedUrls = new Set<string>();

  if (ctx.startUrl) {
    try {
      await engine.navigate(ctx.startUrl);
    } catch {
      // 已在该页则忽略
    }
  }

  const getOrCreatePage = async (): Promise<ModuleNode> => {
    const url = await engine.getCurrentUrl();
    for (const [u, node] of pages) {
      if (url === u || url.startsWith(u) || u.startsWith(url)) return node;
    }
    const title = await getPageTitle(engine);
    const id = `ai_page_${pages.size}`;
    const node: ModuleNode = {
      id,
      label: title ? `页面(${title})` : `页面${pages.size + 1}`,
      parentId: null,
      subsystemId,
      type: 'page',
      status: 'covered',
      children: [],
      url,
      depth: 0,
    };
    pages.set(url || id, node);
    visitedUrls.add(url || id);
    return node;
  };

  /** 采集当前页功能点挂到对应 page 节点 */
  const harvest = async (): Promise<void> => {
    const pageNode = await getOrCreatePage();
    let els: ExploredElement[] = [];
    try {
      els = await engine.extractPageElements();
    } catch {
      els = [];
    }
    const seen = new Set<string>();
    for (const el of els) {
      if (seen.has(el.ref)) continue;
      seen.add(el.ref);
      // 识别「操作级」元素（按钮/链接/可点控件）挂为 action；纯输入框不挂
      const tag = (el.tag || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') continue;
      pageNode.children.push(actionNode(el, pageNode.id, subsystemId, pageNode.depth + 1));
    }
    if (pageNode.children.length === 0) {
      pageNode.status = 'needs_review';
      pageNode.reviewReason = 'AI 探索未在该页识别到操作级功能点';
    }
  };

  try {
    // 起点页先采一次
    await harvest();

    for (let step = 0; step < cfg.maxSteps; step++) {
      let candidates: ExploredElement[] = [];
      try {
        candidates = (await engine.extractPageElements()).filter(isSafeClickable);
      } catch {
        candidates = [];
      }
      const fresh = candidates.filter((c) => !visitedRefs.has(c.ref));
      if (fresh.length === 0) break;

      // 标注菜单候选（T3.2：AI 优先遍历菜单，才能进入每个子页面）
      const menuRefs = await markMenuCandidates(engine, fresh);
      const menuCands = fresh.filter((c) => menuRefs.has(c.ref));
      const otherCands = fresh.filter((c) => !menuRefs.has(c.ref));

      const fmt = (list: ExploredElement[]): string =>
        list.map((c) => `ref="${c.ref}" text="${c.text || c.label || ''}"`).join('\n');
      const prompt =
        'A=菜单/导航候选：\n' +
        (menuCands.length ? fmt(menuCands) : '（无）') +
        '\nB=页面其他可点元素：\n' +
        (otherCands.length ? fmt(otherCands.slice(0, 30)) : '（无）') +
        '\n请选择下一步要点击的 ref（优先 A 组未访问菜单），或回答 done。';
      const req: AIRequest = { prompt, system: SYSTEM_PROMPT };
      let decision;
      try {
        decision = parseDecision((await ai.complete(req)).text);
      } catch (e) {
        // AI 调用异常：安全收束，已收集节点整体标 needs_review（不抛崩）
        console.error('[explore][AI] AI 调用异常，已收集节点标 needs_review:', e);
        for (const p of pages.values()) {
          p.status = 'needs_review';
          p.reviewReason = `AI 调用异常：${e instanceof Error ? e.message : e}`;
        }
        break;
      }
      if (decision.kind === 'done') break;

      const target = fresh.find(
        (c) => c.ref === decision.ref || decision.ref.endsWith(c.ref) || c.ref.endsWith(decision.ref),
      );
      if (!target) continue; // AI 给了无效 ref，跳过本轮

      visitedRefs.add(target.ref);
      const urlBefore = await engine.getCurrentUrl();
      try {
        await engine.runStep({ kind: 'click', selector: target.selector || target.ref });
        await engine.waitForTimeout(cfg.settleMs);
      } catch {
        continue; // 点击失败则该候选放弃，继续下一轮
      }
      const urlAfter = await engine.getCurrentUrl();
      // 仅当 URL 变化且未访问过 → 新页面，harvest；否则可能是展开操作，下一轮自然发现新候选
      if (urlAfter !== urlBefore && !visitedUrls.has(urlAfter)) {
        await harvest();
      }
    }
  } catch (e) {
    console.error('[explore][AI] 探索循环异常，已收集部分节点并标记 needs_review:', e);
    for (const p of pages.values()) {
      p.status = 'needs_review';
      p.reviewReason = `AI 探索异常中断：${e instanceof Error ? e.message : e}`;
    }
  }

  return Array.from(pages.values());
}
