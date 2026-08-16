/**
 * @file menu-explorer.ts
 * @description 交互式菜单遍历探索器（结构化 + AI 兜底）：
 *   1) 一次性抽取导航层级（hover 展开子菜单，不靠「逐一点击堆叠」）→ 重建父子关系；
 *   2) 逐叶子进页采集功能点（查询/列表/新增/修改/删除/导出…）→ 挂为 action 子节点；
 *   3) 点完一个顶层分支回到起点再点下一个兄弟 → 根除「兄弟互嵌」与漏覆盖；
 *   4) 全局去重；结构化为空且注入 ai 时走 AI 兜底（zod 校验，失败回退结构化+needs_review）。
 * @contract 输出 @test-platform/contracts ModuleNode[]（含 type:'system' 根，parentId/depth/subsystemId 正确）
 * @frozen 对外仅导出 exploreViaMenus / MenuExploreLimits
 */

import type { Dialog, Page } from 'playwright';
import type { ModuleNode } from '@test-platform/contracts';
import type { AIClient } from '@test-platform/infra-ai';
import {
  buildNavHierarchy,
  toModuleNodes,
  dedupModuleTree,
  extractPageActions,
  aiFallback,
  type RawNavItem,
  type PageControl,
} from './nav-tree.js';

/** 探索上限配置 */
export interface MenuExploreLimits {
  /** 最多点击的叶子页面数（默认 60，按菜单量自适配） */
  maxLeafClicks: number;
  /** 点击后等待渲染时长 ms（默认 900） */
  settleMs: number;
  /** 子菜单递归深度上限（默认 4） */
  maxDepth: number;
  /** AI 兜底前的结构化兜底最大尝试 */
  aiMinStructuredCount: number;
}

const DEFAULT_LIMITS: MenuExploreLimits = {
  maxLeafClicks: 60,
  settleMs: 900,
  maxDepth: 4,
  aiMinStructuredCount: 1,
};

/** 危险词黑名单：菜单文本命中则绝不点击（防登出/删除/重置等破坏性导航） */
const DANGEROUS_TEXT =
  /退出|注销|登出|logout|sign\s?out|删除|清空|重置|修改密码|密码修改|解绑|禁用|停用/i;

/** 菜单容器候选（覆盖主流 UI 库与自研命名） */
const MENU_CONTAINERS = [
  '[class*="sidebar"]', '[class*="menu"]', 'nav', 'aside',
  '[role="menubar"]', '[role="navigation"]', '[class*="tree"]',
].join(',');

/** 菜单项候选（仅导航语义，排除内容区 tab/树形数据控件/普通按钮） */
const MENU_ITEMS = [
  'a[href]', '[role="menuitem"]', '[role="treeitem"]',
  'li[class*="menu-item"]', 'li[class*="submenu-title"]',
  '.el-menu-item', '.ant-menu-item', '.n-menu-item', '[class*="nav-item"]', '[class*="sidebar-item"]',
].join(',');

/** 浏览器内收集导航项（含层级 parentSelector）；跨 frame 收集 */
const COLLECT_NAV_FN = (args: { containerSel: string; itemSel: string }) => {
  const { containerSel, itemSel } = args;
  const dangerous =
    /退出|注销|登出|logout|sign\s?out|删除|清空|重置|修改密码|密码修改|解绑|禁用|停用/i;

  const cssPath = (el: Element): string => {
    let cur: Element | null = el;
    if (cur.id) return `#${cur.id}`;
    for (const a of ['data-testid', 'data-id', 'data-key', 'data-menu-id']) {
      if (cur.getAttribute(a)) return `${cur.tagName.toLowerCase()}[${a}="${cur.getAttribute(a)}"]`;
    }
    const parts: string[] = [];
    while (cur && cur !== document.body && parts.length < 6) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`${seg}#${cur.id}`);
        break;
      }
      const cls = Array.from(cur.classList).slice(0, 2).map((c) => `.${c}`).join('');
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
      parts.unshift(seg + cls);
      cur = cur.parentElement;
    }
    return parts.join('>');
  };

  const containers = Array.from(document.querySelectorAll(containerSel));
  const out: RawNavItem[] = [];
  const seen = new Set<string>();

  for (const container of containers) {
    for (const el of Array.from(container.querySelectorAll(itemSel))) {
      const html = el as HTMLElement;
      const text = (html.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2 || text.length > 30) continue;
      if (dangerous.test(text)) continue;
      const style = window.getComputedStyle(html);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = html.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const selector = cssPath(html);
      const href = html.getAttribute('href') || (html.querySelector('a[href]')?.getAttribute('href') ?? undefined);
      const expandable =
        html.querySelector('ul, ol, [class*="sub"], [class*="children"], [class*="arrow"], [class*="expand"], [class*="dropdown"]') !== null ||
        /expand|arrow|toggle|submenu|fold|dropdown/i.test(html.className);
      // 父级：最近的祖先「菜单项」选择器
      let parentEl: Element | null = html.parentElement;
      let parentSelector: string | null = null;
      while (parentEl && parentEl !== document.body) {
        if (parentEl.matches(itemSel) || parentEl.querySelector(':scope > ' + itemSel)) {
          parentSelector = cssPath(parentEl);
          break;
        }
        parentEl = parentEl.parentElement;
      }
      const key = selector;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ selector, text, href: href ?? undefined, expandable, parentSelector });
    }
  }
  return out;
};

/** 浏览器内收集页面功能点控件 + 是否含数据表格/列表 */
const COLLECT_CONTROLS_FN = () => {
  const main = document.querySelector('main, .content, #main, [class*="content"], [class*="main"]') || document.body;
  const hasDataGrid = !!main.querySelector('table, [class*="table"], [class*="grid"], [class*="list"], [class*="list-view"]');
  const controls: PageControl[] = [];
  const seen = new Set<string>();
  const candidates = main.querySelectorAll('button, a[href], input, select, [role="button"], [class*="btn"]');
  for (const el of Array.from(candidates)) {
    const html = el as HTMLElement;
    const tag = html.tagName.toLowerCase();
    const text = (html.textContent || '').replace(/\s+/g, ' ').trim();
    const label = text || (html as HTMLInputElement).placeholder || html.getAttribute('aria-label') || '';
    if (!label) continue;
    const sel =
      html.id ? `#${html.id}` : `${tag}[${['data-testid', 'data-id', 'name'].map((a) => html.getAttribute(a) ? `${a}="${html.getAttribute(a)}"` : '').filter(Boolean).join('][') || 'class'}='${html.className}']`;
    const key = sel + label;
    if (seen.has(key)) continue;
    seen.add(key);
    controls.push({
      selector: sel,
      tag,
      text: label,
      href: tag === 'a' ? (html as HTMLAnchorElement).getAttribute('href') ?? undefined : undefined,
      type: (html as HTMLInputElement).type || undefined,
      placeholder: (html as HTMLInputElement).placeholder || undefined,
    });
  }
  return { controls, hasDataGrid };
};

/** 跨 frame 收集导航项 */
async function collectNavAll(page: Page): Promise<RawNavItem[]> {
  const out: RawNavItem[] = [];
  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    try {
      const items = (await frames[i].evaluate(COLLECT_NAV_FN, {
        containerSel: MENU_CONTAINERS,
        itemSel: MENU_ITEMS,
      })) as RawNavItem[];
      out.push(...items);
    } catch {
      // 跨域 frame 或已卸载：跳过
    }
  }
  return out;
}

async function collectControls(page: Page): Promise<{ controls: PageControl[]; hasDataGrid: boolean }> {
  const frame = page.mainFrame();
  return frame.evaluate(COLLECT_CONTROLS_FN).catch(() => ({ controls: [], hasDataGrid: false }));
}

async function waitSettled(page: Page, settleMs: number): Promise<void> {
  await page.waitForTimeout(settleMs);
  await page.waitForLoadState('load', { timeout: 3000 }).catch(() => {});
}

async function safeClick(page: Page, selector: string, settleMs: number): Promise<boolean> {
  try {
    await page.click(selector, { timeout: 3000 });
    await waitSettled(page, settleMs);
    return true;
  } catch {
    // 主 frame 失败尝试各子 frame
    for (const f of page.frames()) {
      try {
        await f.click(selector, { timeout: 2000 });
        await waitSettled(page, settleMs);
        return true;
      } catch {
        // try next
      }
    }
    return false;
  }
}

export interface ExploreViaMenusOptions {
  ai?: AIClient;
  subsystemId: string;
  systemId?: string;
  limits?: Partial<MenuExploreLimits>;
}

/**
 * 结构化菜单遍历主入口。
 * 关键改进：导航层级一次性抽取（hover 展开，不靠点击堆叠）；
 * 逐叶子进页采功能点；兄弟分支互不嵌套；全局去重；空结果且有 ai 时走 AI 兜底。
 */
export async function exploreViaMenus(
  page: Page,
  opts: ExploreViaMenusOptions,
): Promise<ModuleNode[]> {
  const cfg = { ...DEFAULT_LIMITS, ...opts.limits };
  const startUrl = page.url();
  const ctx = { subsystemId: opts.subsystemId, systemId: opts.systemId ?? opts.subsystemId };

  const onDialog = (d: Dialog): void => {
    void d.dismiss().catch(() => {});
  };
  const onPopup = (p: Page): void => {
    void p.close().catch(() => {});
  };
  page.on('dialog', onDialog);
  page.on('popup', onPopup);

  try {
    // 1) 抽取导航层级（hover 展开子菜单以暴露下拉项）
    let navItems = await collectNavAll(page);
    let expanded = true;
    let guard = 0;
    while (expanded && guard++ < 8) {
      expanded = false;
      const bySelector = new Map(navItems.map((n) => [n.selector, n]));
      for (const it of navItems) {
        if (it.expandable && !it.href && !Array.from(bySelector.values()).some((c) => c.parentSelector === it.selector)) {
          // hover 展开（不导航），再收集其下子项
          try {
            await page.hover(it.selector, { timeout: 2000 });
            await page.waitForTimeout(Math.min(cfg.settleMs, 400));
          } catch {
            // 无法 hover 则跳过
          }
          const more = await collectNavAll(page);
          for (const m of more) {
            if (!bySelector.has(m.selector)) {
              bySelector.set(m.selector, m);
              expanded = true;
            }
          }
          navItems = Array.from(bySelector.values());
        }
      }
    }

    // 2) 无导航结构：尝试 AI 兜底（仅当注入 ai）
    if (navItems.length < cfg.aiMinStructuredCount && opts.ai) {
      const summary = await page
        .mainFrame()
        .evaluate(() => document.body.innerText.slice(0, 2000))
        .catch(() => '');
      const aiTree = await aiFallback(opts.ai, {
        subsystemId: ctx.subsystemId,
        systemId: ctx.systemId,
        structuredCount: navItems.length,
        pageSummary: summary,
      });
      if (aiTree && aiTree.length) {
        return dedupModuleTree(aiTree);
      }
    }

    if (navItems.length === 0) return [];

    // 3) 重建层级
    const nav = buildNavHierarchy(navItems);

    // 4) 逐叶子进页采集功能点
    const actionsByKey = new Map<string, ReturnType<typeof extractPageActions>>();
    const urlByKey = new Map<string, string>();
    const leaves = navItems.filter(
      (n) => !n.expandable && !navItems.some((c) => c.parentSelector === n.selector),
    );
    let clicked = 0;
    for (const leaf of leaves) {
      if (clicked >= cfg.maxLeafClicks) break;
      if (DANGEROUS_TEXT.test(leaf.text)) continue;
      const ok = await safeClick(page, leaf.selector, cfg.settleMs);
      if (!ok) continue;
      clicked += 1;
      // 根因修复：点击后记录真实跳转 URL。SPA 菜单（router 点击跳转、无 <a href>）的 menu.href 为空，
      // 必须靠点击后的 page.url() 回填 ModuleNode.url，否则用例阶段二次探索拿不到地址、退回模板步骤。
      const landed = page.url();
      if (landed) urlByKey.set(leaf.selector, landed);
      const { controls, hasDataGrid } = await collectControls(page);
      const actions = extractPageActions(controls, { hasDataGrid });
      actionsByKey.set(leaf.selector, actions);
    }

    // 回到起点页（清理浏览器状态）
    if (startUrl) {
      await page.goto(startUrl, { waitUntil: 'load' }).catch(() => {});
    }

    // 5) 组装 + 去重
    const tree = toModuleNodes(nav, ctx, actionsByKey, urlByKey);
    return dedupModuleTree(tree);
  } finally {
    page.off('dialog', onDialog);
    page.off('popup', onPopup);
  }
}
