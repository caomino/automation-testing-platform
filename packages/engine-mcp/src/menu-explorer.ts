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
import {
  buildNavHierarchy,
  toModuleNodes,
  dedupModuleTree,
  extractPageActions,
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

/**
 * 危险词黑名单（**唯一真源**，浏览器侧通过参数注入，禁止再写第二份）。
 *
 * 收敛依据（P-A#3）：原黑名单含「删除/禁用/停用」，把用户明确要求的业务功能页
 * （如"删除记录管理""禁用用户列表"）整条丢掉，直接损失核心颗粒度。
 * 现只拦截**真正破坏性/会终止会话**的入口：
 *  - 会话终止：退出/注销/登出/logout/sign out/切换账号
 *  - 不可逆且常为即时动作：清空/重置/修改密码/解绑
 * 「删除/禁用/停用」放开——菜单层的这类文本绝大多数是功能页标题；
 * 且进页后只做只读控件识别（COLLECT_CONTROLS_FN 不点击任何按钮），不会真删数据。
 */
const DANGEROUS_SOURCE = '退出|注销|登出|logout|sign\\s?out|切换账号|清空|重置|修改密码|密码修改|解绑';
const DANGEROUS_TEXT = new RegExp(DANGEROUS_SOURCE, 'i');

/** 菜单容器候选（覆盖主流 UI 库与自研命名） */
const MENU_CONTAINERS = [
  '[class*="sidebar"]', '[class*="menu"]', 'nav', 'aside',
  '[role="menubar"]', '[role="navigation"]', '[class*="tree"]'
].join(',');

/** 菜单项候选（含父菜单 submenu，才能 hover 展开发现折叠的子菜单；否则子菜单折叠时颗粒度缺失） */
const MENU_ITEMS = [
  'a[href]', '[role="menuitem"]', '[role="treeitem"]',
  'li[class*="menu-item"]', 'li[class*="submenu"]', 'li[class*="menu-sub"]',
  '.el-menu-item', '.el-submenu',
  '.ant-menu-item', '.ant-menu-submenu',
  '.n-menu-item', '.n-submenu',
  '[class*="nav-item"]', '[class*="sidebar-item"]'
].join(',');

/** 浏览器内收集导航项（含层级 parentSelector）；跨 frame 收集 */
const COLLECT_NAV_FN = `((args) => {
  var containerSel = args.containerSel;
  var itemSel = args.itemSel;
  var dangerousSource = args.dangerousSource;
  // 黑名单由 Node 侧注入（DANGEROUS_SOURCE），避免浏览器侧维护第二份正则导致改一处等于没改
  var dangerous = new RegExp(dangerousSource, 'i');

  var cssPath = (el) => {
    var cur = el;
    if (cur.id) return '#' + cur.id;
    var attrs = ['data-testid', 'data-id', 'data-key', 'data-menu-id'];
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      if (cur.getAttribute(a)) return cur.tagName.toLowerCase() + '[' + a + '="' + cur.getAttribute(a) + '"]';
    }
    var parts = [];
    while (cur && cur !== document.body && parts.length < 12) {
      var seg = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(seg + '#' + cur.id);
        break;
      }
      // 过滤状态类（open/active/selected/collapsed 等），保证展开前后 selector 稳定，避免同一菜单项被当成两个
      var stateCls = /open|active|selected|collapsed|expanded|show|hidden|disabled|checked|hover/i;
      var cls = Array.from(cur.classList)
        .filter((c) => !stateCls.test(c))
        .slice(0, 2)
        .map((c) => '.' + c)
        .join('');
      var parent = cur.parentElement;
      if (parent) {
        var sameTag = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (sameTag.length > 1) seg += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg + cls);
      cur = cur.parentElement;
    }
    return parts.join('>');
  };

  var containers = Array.from(document.querySelectorAll(containerSel));
  var out = [];
  var seen = new Set();

  for (var cIdx = 0; cIdx < containers.length; cIdx++) {
    var container = containers[cIdx];
    var allEls = Array.from(container.querySelectorAll(itemSel));
    // 第一阶段：去嵌套过滤——跳过「内部含命中项、自身非链接、非子菜单容器」的纯容器（li 与其内部 a 不重复成父子）
    var keptEls = [];
    for (var eIdx = 0; eIdx < allEls.length; eIdx++) {
      var el = allEls[eIdx];
      var html = el;
      var hasNestedItem = allEls.some((c) => c !== el && el.contains(c));
      if (hasNestedItem && !html.getAttribute('href') && !html.querySelector('ul, ol, [role="menu"]')) {
        continue;
      }
      keptEls.push(el);
    }
    // 第二阶段：先算文本（去重用）
    var textOf = (el) => {
      var html = el;
      var t = '';
      for (var n = 0; n < html.childNodes.length; n++) {
        var c = html.childNodes[n];
        if (c.nodeType === 3) t += (c.textContent || '');
      }
      t = t.replace(/\\s+/g, ' ').trim();
      if (!t) {
        var leaf = html.querySelector('a, span, [class*="title"], [class*="label"], [class*="text"]');
        t = (leaf ? (leaf.textContent || '') : '').replace(/\\s+/g, ' ').trim();
      }
      if (!t) t = (html.textContent || '').replace(/\\s+/g, ' ').trim().replace(/\\s*\\d+\\s*\$/, '').trim();
      if (t.length > 50) t = t.substring(0, 47) + '...';
      return t;
    };
    var textCache = new Map();
    for (var kIdx = 0; kIdx < keptEls.length; kIdx++) textCache.set(keptEls[kIdx], textOf(keptEls[kIdx]));

    // 关键修复（T1.5 真机验证）：把「被更深同文本后代合并的浅层祖先」**真正移出**保留集合。
    var keptFinal = keptEls.filter(
      (el) =>
        !keptEls.some((c) => c !== el && el.contains(c) && textCache.get(c) === textCache.get(el)),
    );

    // 第三阶段：对最终保留项计算 text/selector/expandable/parentSelector（父级只在最终保留项中找）
    for (var fIdx = 0; fIdx < keptFinal.length; fIdx++) {
      var el = keptFinal[fIdx];
      var html = el;
      var text = textCache.get(el) || '';
      if (!text || text.length < 2 || text.length > 30) continue;
      if (dangerous.test(text)) continue;
      var style = window.getComputedStyle(html);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      var rect = html.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      var selector = cssPath(html);
      var expandable =
        html.querySelector('ul, ol, [role="menu"], [class*="submenu"], [class*="sub-menu"], [class*="children"]') !== null;
      // href：自身 → 内部 a → 祖先 a（a 包裹 li 的场景）
      var href = html.getAttribute('href') || undefined;
      if (!href && !expandable) {
        href = html.querySelector('a[href]')?.getAttribute('href') || undefined;
      }
      if (!href) {
        var p = html.parentElement;
        while (p && p !== document.body) {
          var ah = p.getAttribute ? p.getAttribute('href') : null;
          if (ah) {
            href = ah;
            break;
          }
          p = p.parentElement;
        }
      }
      // 父级：最近的「也在最终保留集合里」的祖先菜单项（避免指向被跳过的 li 或 ul 容器）
      var parentEl = html.parentElement;
      var parentSelector = null;
      while (parentEl && parentEl !== document.body) {
        if (keptFinal.includes(parentEl)) {
          parentSelector = cssPath(parentEl);
          break;
        }
        parentEl = parentEl.parentElement;
      }
      var key = selector;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ selector, text, href: href || undefined, expandable, parentSelector });
    }
  }
  return out;
})`;

/** 浏览器内收集页面功能点控件 + 是否含数据表格/列表（只识别、不点击） */
const COLLECT_CONTROLS_FN = `(() => {
  // 多容器扫描：所有 main/.content 容器都扫，而非只取第一个（表格/表单可能不在第一个容器内）
  var containers = Array.from(document.querySelectorAll('main, .content, #main, [class*="content"], [class*="main"]'));
  var roots = containers.length > 0 ? containers : [document.body];
  var hasDataGrid = roots.some((r) => !!r.querySelector('table, [class*="table"], [class*="grid"], [class*="list"], [class*="list-view"]'));
  var controls = [];
  var seen = new Set();
  // 扩展候选：Tab/标签页、列表项、textarea、分页等，补「页面菜单下的标签」颗粒度
  var SEL = 'button, a[href], [role="button"], [class*="btn"], input, select, textarea, [role="tab"], .ant-tabs-tab, .el-tabs__item, [role="listitem"], .ant-list-item, .ant-pagination-item';
  for (var mIdx = 0; mIdx < roots.length; mIdx++) {
    var main = roots[mIdx];
    var candidates = main.querySelectorAll(SEL);
    for (var cIdx = 0; cIdx < candidates.length; cIdx++) {
      var el = candidates[cIdx];
      var html = el;
      // 关键修复（串页污染）：keep-alive 缓存的隐藏页面 DOM 仍在文档中（display:none），
      // 必须跳过不可见元素，否则会把上一个页面的按钮/导航控件误挂到当前页面。
      var style = window.getComputedStyle(html);
      var rect = html.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || rect.width === 0 || rect.height === 0) continue;
      // 排除全局导航/标签页/顶栏内的控件（个人中心/刷新/公告弹窗等不属于页面功能点）
      if (html.closest('.navbar, .navbar-container, .tags-view, .tags-view-container, .sidebar, .sidebar-container, header, .header, .topbar, .top-bar, .layout-header, .sidebar-logo-container')) continue;
      var tag = html.tagName.toLowerCase();
      var isTab = !!html.closest('[role="tablist"]') || html.getAttribute('role') === 'tab' || /tabs-tab|tabs__item/i.test(html.className);
      var text = (html.textContent || '').replace(/\\s+/g, ' ').trim();
      var label = html.getAttribute('aria-label') || text || html.placeholder || '';
      if (!label) continue;
      var attrs = ['data-testid', 'data-id', 'name'];
      var attrStr = attrs.map((a) => html.getAttribute(a) ? '[' + a + '="' + html.getAttribute(a) + '"]' : '').filter(Boolean).join('');
      var sel = html.id ? ('#' + html.id) : (tag + (attrStr || ("['class'='" + html.className + "']")));
      var key = sel + label;
      if (seen.has(key)) continue;
      seen.add(key);
      controls.push({
        selector: sel,
        tag,
        text: label,
        href: tag === 'a' ? (html.getAttribute('href') || undefined) : undefined,
        type: isTab ? 'tab' : (html.type || undefined),
        placeholder: html.placeholder || undefined,
      });
    }
  }
  return { controls, hasDataGrid };
})`;

/** 跨 frame 收集导航项 */
async function collectNavAll(page: Page): Promise<RawNavItem[]> {
  const out: RawNavItem[] = [];
  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    try {
      const items = (await frames[i].evaluate(COLLECT_NAV_FN, {
        containerSel: MENU_CONTAINERS,
        itemSel: MENU_ITEMS,
        dangerousSource: DANGEROUS_SOURCE,
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
  return frame.evaluate<{ controls: PageControl[]; hasDataGrid: boolean }>(COLLECT_CONTROLS_FN).catch(() => ({ controls: [], hasDataGrid: false }));
}

async function waitSettled(page: Page, settleMs: number): Promise<void> {
  await page.waitForTimeout(settleMs);
  await page.waitForLoadState('load', { timeout: 3000 }).catch(() => {});
}

/**
 * 等待页面主内容区出现「内容已加载」标记（table / button / toolbar 等）。
 * T1.7：ruoyi 等系统在点击菜单后会有短暂 loading，立即 collectControls 可能拿到空列表。
 * 增强（真机验证）：SPA 路由切换有延迟，点击菜单后旧页面内容可能短暂残留；
 * 先等主内容区文本**稳定变化**（连续采样一致且非空），再等 marker，避免串页。
 */
/** T1.8：判断 href 是否为当前系统外部链接 */
function isExternalHref(href: string, startUrl: string): boolean {
  if (!href) return false;
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return new URL(href).origin !== new URL(startUrl).origin;
  } catch {
    return true;
  }
}

async function waitForContentLoaded(page: Page): Promise<void> {
  const sample = async (): Promise<string> =>
    page
      .mainFrame()
      .evaluate<string>(`(() => {
        var el =
          document.querySelector('.app-main, main, .main, .content, [class*="content"], [class*="main"]') ||
          document.body;
        return (el && el.innerText ? el.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 500);
      })()`)
      .catch(() => '');

  // 1) 等待内容区文本稳定：内容变化后连续采样一致（间隔 250ms）且非空，最多 ~5s
  const t0 = await sample();
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(300);
    const t1 = await sample();
    if (t1 && t1 !== t0 && t1.length > 10) {
      for (let j = 0; j < 6; j++) {
        await page.waitForTimeout(250);
        const t2 = await sample();
        if (t2 === t1) break; // 稳定
      }
      break;
    }
  }

  // 2) 等待 marker 出现（table / button / toolbar 等），3 秒兜底
  const contentSel =
    'main, .content, .app-main, [class*="content"], [class*="main"], #app, body';
  const markerSel =
    'table, .el-table, .ant-table, .btn, button, [role="button"], [class*="toolbar"], [class*="operation"], [class*="actions"]';
  try {
    await page.waitForFunction(
      `((args) => {
        var containers = Array.from(document.querySelectorAll(args.contentSel));
        var roots = containers.length > 0 ? containers : [document.body];
        return roots.some((r) => r.querySelector(args.markerSel));
      })(${JSON.stringify({ contentSel, markerSel })})`,
      null,
      { timeout: 3000 },
    );
  } catch {
    // 3 秒内未出现标记也继续，避免页面本身无表格/按钮时卡住
  }
}

/** 点击结果：区分「点击派发失败」与「点击成功但页面没落地」两种情况 */
export interface ClickOutcome {
  /** 点击动作本身是否成功派发 */
  clicked: boolean;
  /** 点击后是否确实落地到新视图（URL 或主内容区发生变化） */
  landed: boolean;
}

/**
 * 采集页面「落地指纹」：URL + 主内容区元素数 + 文本摘要。
 * SPA 菜单点击常不改变 URL（同路由内切视图），单看 URL 会误判未落地，故加内容维度。
 */
export async function pageFingerprint(page: Page): Promise<string> {
  const url = page.url();
  const body = await page
    .mainFrame()
    .evaluate<string>(`(() => {
      var el =
        document.querySelector('main, .main, .app-main, .content, [class*="content"], [class*="main"]') ||
        document.body;
      var text = el && el.innerText ? el.innerText : '';
      return (el ? el.querySelectorAll('*').length : 0) + ':' + text.slice(0, 300);
    })()`)
    .catch(() => '');
  return `${url}||${body}`;
}

/**
 * 点击菜单叶子并校验是否真正落地。
 *
 * 为什么必须校验落地（P-A#2）：
 *  - SPA 里 selector 过期 / 元素被遮挡时，click 可能"成功"但视图没换；
 *  - 此时若照旧采集控件，会把**上一个页面**的按钮挂到本叶子下 → 功能点表串页污染；
 *  - 反之若一律 return false，则大量叶子无 action 子节点 → 触发单页 DOM 兜底（老 bug 现场）。
 * 因此返回 clicked / landed 两个维度，由调用方分别处置。
 *
 * T1.6 增强：selector 失效时，用 text / href 重新定位。ruoyi 等动态侧边栏在父菜单展开后
 * 会重新渲染子菜单 DOM，原先记录的 `:nth-of-type(N)` selector 会失效，但菜单文本稳定。
 */
async function safeClick(
  page: Page,
  selector: string,
  settleMs: number,
  text?: string,
  href?: string,
): Promise<ClickOutcome> {
  const before = await pageFingerprint(page);

  const tryClick = async (sel: string): Promise<boolean> => {
    try {
      await page.click(sel, { timeout: 3000 });
      return true;
    } catch {
      for (const f of page.frames()) {
        try {
          await f.click(sel, { timeout: 2000 });
          return true;
        } catch {
          // try next
        }
      }
      return false;
    }
  };

  const tryFallback = async (): Promise<boolean> => {
    // fallback 1: href 精确匹配
    if (href) {
      try {
        await page.locator(`a[href="${href}"]`).click({ timeout: 2000 });
        return true;
      } catch {
        // ignore
      }
    }
    // fallback 2: 文本匹配（Playwright getByText）
    if (text && text.length >= 2) {
      try {
        await page.getByText(text, { exact: false }).first().click({ timeout: 2000 });
        return true;
      } catch {
        // ignore
      }
    }
    return false;
  };

  let clicked = await tryClick(selector);
  if (!clicked && (text || href)) {
    clicked = await tryFallback();
    if (clicked) {
      console.warn(`[explore] selector 失效，已按文本/href 重新定位点击: text="${text}" href="${href}"`);
    }
  }

  if (!clicked) {
    console.warn(`[explore] 菜单点击失败（selector 可能已过期或被遮挡）: ${selector}`);
    return { clicked: false, landed: false };
  }

  await waitSettled(page, settleMs);

  // 落地校验：SPA 路由渲染有延迟，轮询到指纹变化即判定落地（首次立即检查，正常路径零额外开销）
  const deadline = Date.now() + 1500;
  let landed = false;
  for (;;) {
    if ((await pageFingerprint(page)) !== before) {
      landed = true;
      break;
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(150);
  }

  if (!landed) {
    console.warn(`[explore] 点击后页面未变化，跳过该叶子控件采集以防串页污染: ${selector}`);
  }
  return { clicked: true, landed };
}

export interface ExploreViaMenusOptions {
  subsystemId: string;
  systemId?: string;
  limits?: Partial<MenuExploreLimits>;
}

/**
 * 展开父菜单并收集其下子项（递归 DFS 用）。
 * 点击优先用「文本」定位：ruoyi 等动态侧边栏的 cssPath 选择器在展开前后不稳定
 * （诊断证实：getByText 点击成功，cssPath click 静默失败），故文本优先、cssPath 回退。
 */
async function expandAndCollect(
  page: Page,
  item: RawNavItem,
  cfg: MenuExploreLimits,
): Promise<RawNavItem[]> {
  const collectChildren = async (): Promise<RawNavItem[]> => {
    const after = await collectNavAll(page);
    return after.filter((c) => c.parentSelector === item.selector);
  };

  // 1) 文本定位点击展开（Element-UI / Ant Design 侧边栏常见）
  try {
    await page.getByText(item.text, { exact: true }).first().click({ timeout: 3000 });
    await page.waitForTimeout(Math.min(cfg.settleMs, 400));
    const children = await collectChildren();
    if (children.length > 0) return children;
  } catch {
    // 继续尝试 cssPath
  }

  // 2) cssPath selector 点击展开（无稳定文本的场景）
  try {
    await page.click(item.selector, { timeout: 3000 });
    await page.waitForTimeout(Math.min(cfg.settleMs, 400));
    const children = await collectChildren();
    if (children.length > 0) return children;
  } catch {
    // 无法展开
  }

  // 3) hover 展开（水平顶部菜单常见）
  try {
    await page.hover(item.selector, { timeout: 2000 });
    await page.waitForTimeout(Math.min(cfg.settleMs, 400));
    const children = await collectChildren();
    if (children.length > 0) return children;
  } catch {
    // 无法展开
  }

  return [];
}

interface ExploreState {
  clicked: number;
  actionsByKey: Map<string, ReturnType<typeof extractPageActions>>;
  urlByKey: Map<string, string>;
  visitedSelectors: Set<string>;
  allItems: Map<string, RawNavItem>;
}

/**
 * 递归 DFS 菜单遍历：expandable 节点先展开再递归；叶子节点点击进入页面采集 action。
 * 关键修复（T1.5）：ruoyi 等 Element-UI 侧边栏在父菜单展开后会重新渲染子菜单 DOM，
 * 一次性全量收集的 selector 会失效。改为「边展开、边收集、边点击」，保证 selector 新鲜。
 */
async function exploreNavTree(
  page: Page,
  items: RawNavItem[],
  cfg: MenuExploreLimits,
  ctx: { subsystemId: string; systemId: string },
  state: ExploreState,
  depth: number,
  startUrl: string,
): Promise<void> {
  if (depth > cfg.maxDepth) return;

  for (const item of items) {
    if (DANGEROUS_TEXT.test(item.text)) continue;
    if (state.visitedSelectors.has(item.selector)) continue;

    // T1.8：外链不深入，避免跳出目标系统
    if (item.href && isExternalHref(item.href, startUrl)) {
      console.warn(`[explore] 外链/外部菜单跳过，避免跳出目标系统: ${item.text} -> ${item.href}`);
      state.visitedSelectors.add(item.selector);
      continue;
    }

    if (item.expandable) {
      // 若当前 items 里已经包含该父菜单的子项，说明已展开，直接递归
      const visibleChildren = items.filter((c) => c.parentSelector === item.selector);
      let children: RawNavItem[];
      if (visibleChildren.length > 0) {
        children = visibleChildren;
      } else {
        children = await expandAndCollect(page, item, cfg);
        // 记录父菜单已展开，避免后续重复点击导致折叠
        state.visitedSelectors.add(item.selector);
        for (const c of children) state.allItems.set(c.selector, c);
      }
      if (children.length > 0) {
        await exploreNavTree(page, children, cfg, ctx, state, depth + 1, startUrl);
      }
    } else {
      // 叶子：点击进入页面
      if (state.clicked >= cfg.maxLeafClicks) return;
      const outcome = await safeClick(page, item.selector, cfg.settleMs, item.text, item.href);
      if (!outcome.clicked) continue;
      state.clicked += 1;
      state.visitedSelectors.add(item.selector);
      if (!outcome.landed) continue;

      await waitForContentLoaded(page);

      const currentUrl = page.url();
      if (currentUrl && currentUrl !== startUrl) {
        state.urlByKey.set(item.selector, currentUrl);
      } else if (outcome.landed) {
        state.urlByKey.set(item.selector, `click:${item.selector}`);
      }
      const { controls, hasDataGrid } = await collectControls(page);
      const actions = extractPageActions(controls, { hasDataGrid });
      state.actionsByKey.set(item.selector, actions);
    }
  }
}

/**
 * 结构化菜单遍历主入口。
 * 关键改进（T1.5）：递归 DFS 边展开边点击；selector 失效 fallback（T1.6）；
 * 页面内容加载等待（T1.7）；外链处理（T1.8）。
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
    // ----------------------------------------------------------------------
    // 自动清场机制 (Auto-Dismiss)
    // 目标：解决 Sentinel DB 360 等系统在登录后弹出“新手引导 (Tour)”或“全屏公告 (Modal)”，
    // 导致真实的菜单 DOM 被遮挡或被引擎误判提取为菜单项的问题。
    // ----------------------------------------------------------------------
    try {
      console.log('[menu-explorer] 执行探索前置清场 (Auto-Dismiss) - 按下 Escape 键并寻找跳过按钮');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);

      // 扫描常见的新手引导/公告关闭按钮特征
      const dismissKeywords = ['skip', 'close', 'dismiss', 'got it', '跳过', '关闭', '我知道了'];
      const buttons = await page.$$('button, a, [role="button"], .close, .skip, [class*="close"], [class*="skip"]');
      let cleared = false;
      for (const btn of buttons) {
        const isVis = await btn.isVisible().catch(() => false);
        if (!isVis) continue;
        const text = (await btn.textContent().catch(() => '') || '').toLowerCase().trim();
        if (dismissKeywords.some(k => text.includes(k))) {
          console.log(`[menu-explorer] 发现并点击疑似引导/弹窗关闭按钮: "${text}"`);
          await btn.click({ timeout: 1000 }).catch(() => {});
          cleared = true;
          await page.waitForTimeout(300);
        }
      }
      if (cleared) {
        console.log('[menu-explorer] 引导弹窗清理完毕，等待 DOM 稳定');
        await page.waitForTimeout(500);
      }
    } catch (e) {
      console.warn('[menu-explorer] 自动清场过程出错 (非致命):', e);
    }
    // ----------------------------------------------------------------------

    const state: ExploreState = {
      clicked: 0,
      actionsByKey: new Map(),
      urlByKey: new Map(),
      visitedSelectors: new Set(),
      allItems: new Map(),
    };

    console.log('[menu-explorer] 等待页面初始渲染...');
    await waitSettled(page, cfg.settleMs * 2);

    let topItems = await collectNavAll(page);
    
    // 如果一次没抽到，可能是还没渲染完，再等等试试
    if (topItems.length === 0) {
      console.log('[menu-explorer] 未抽到导航，额外等待 3s...');
      await page.waitForTimeout(3000);
      topItems = await collectNavAll(page);
    }

    for (const it of topItems) state.allItems.set(it.selector, it);

    await exploreNavTree(page, topItems, cfg, ctx, state, 0, startUrl);

    if (state.allItems.size === 0) return [];

    // 用所有收集到的导航项重建完整层级（含动态展开发现的子项）
    const nav = buildNavHierarchy(Array.from(state.allItems.values()));

    // 回到起点页（清理浏览器状态）
    if (startUrl) {
      await page.goto(startUrl, { waitUntil: 'load' }).catch(() => {});
    }

    // 组装 + 去重
    const tree = toModuleNodes(nav, ctx, state.actionsByKey, state.urlByKey);
    return dedupModuleTree(tree);
  } finally {
    page.off('dialog', onDialog);
    page.off('popup', onPopup);
  }
}
