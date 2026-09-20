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
  mergeRollupModules,
  normalizeModuleTree,
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
const DANGEROUS_SOURCE = '退出|注销|登出|logout|sign\\s?out|切换账号|清空|重置|修改密码|密码修改|解绑|锁屏|锁定';
const DANGEROUS_TEXT = new RegExp(DANGEROUS_SOURCE, 'i');

/**
 * 非内容导航噪声黑名单（**部件类**，通用后台模板语义，不含任何系统拓扑）。
 * 依据（OA bpms 实证）：右侧顶栏部件区（消息/通知/任务/用户菜单/全屏/便签）、
 * logo、侧栏开关等会被 `a[href]` 宽匹配误收为菜单项。
 * 注意：**不可拉黑 `navbar-custom-menu`** —— 实证该容器在 AdminLTE 布局里同时承载
 * 「顶部一级菜单（.pull-left，即 我的办公/项目管理/…）」与「右侧部件区」，拉黑会误杀一级菜单。
 */
const NOISE_SOURCE =
  'messages-menu|notifications-menu|tasks-menu|user-menu|user-panel|sidebar-toggle|dropdown-menu|dropdown-toggle|logo|brand';
/** 内容区选择器：导航菜单绝不在内容区；命中者视为页面内容（卡片/快捷入口），不是菜单项。
 *  覆盖主流后台布局的内容宿主命名（通用，不针对某一系统）：
 *  AdminLTE `.content-wrapper`、ruoyi `#page-wrapper`、Element-Plus `.app-main`、AntD `.ant-layout-content`、
 *  NaiveUI/自研 `.layout-content` / `main` / `#main` / `*main-content`。 */
const CONTENT_SEL = [
  'main',
  '.content',
  '.content-wrapper',
  '#main',
  '#page-wrapper',
  '.page-wrapper',
  '.app-main',
  '.el-main',
  '.ant-layout-content',
  '.layout-content',
  '[class*="content-wrapper"]',
  '[class*="page-wrapper"]',
  '[class*="main-content"]',
  '[class*="page-container"]',
].join(', ');

/** 菜单容器候选（覆盖主流 UI 库与自研命名） */
const MENU_CONTAINERS = [
  '[class*="sidebar"]', '[class*="menu"]', 'nav', 'aside',
  '[role="menubar"]', '[role="navigation"]', '[class*="tree"]',
].join(',');

/** 菜单项候选（含父菜单 submenu，才能 hover 展开发现折叠的子菜单；否则子菜单折叠时颗粒度缺失） */
const MENU_ITEMS = [
  'a[href]', '[role="menuitem"]', '[role="treeitem"]',
  'li[class*="menu-item"]', 'li[class*="submenu"]', 'li[class*="menu-sub"]',
  '.el-menu-item', '.el-submenu',
  '.ant-menu-item', '.ant-menu-submenu',
  '.n-menu-item', '.n-submenu',
  '[class*="nav-item"]', '[class*="sidebar-item"]',
].join(',');

/** 浏览器内收集导航项（含层级 parentSelector）；跨 frame 收集 */
const COLLECT_NAV_FN = (args: {
  containerSel: string;
  itemSel: string;
  dangerousSource: string;
  noiseSource: string;
  contentSel: string;
}) => {
  const { containerSel, itemSel, dangerousSource, noiseSource, contentSel } = args;
  // 黑名单由 Node 侧注入（DANGEROUS_SOURCE），避免浏览器侧维护第二份正则导致改一处等于没改
  const dangerous = new RegExp(dangerousSource, 'i');
  const noise = new RegExp(noiseSource, 'i');

  // 噪声区判定：自身或祖先 className 命中噪声黑名单（logo/顶栏部件区/用户面板等）
  const inNoise = (el: Element): boolean => {
    let anc: Element | null = el;
    while (anc && anc !== document.body) {
      const cn = (anc as HTMLElement).className;
      if (typeof cn === 'string' && cn && noise.test(cn)) return true;
      anc = anc.parentElement;
    }
    return false;
  };
  // 内容区判定：导航菜单不在内容区；内容区的卡片/快捷入口不是菜单项
  const inContent = (el: Element): boolean => !!el.closest(contentSel);

  const cssPath = (el: Element): string => {
    let cur: Element | null = el;
    if (cur.id) return `#${cur.id}`;
    for (const a of ['data-testid', 'data-id', 'data-key', 'data-menu-id']) {
      if (cur.getAttribute(a)) return `${cur.tagName.toLowerCase()}[${a}="${cur.getAttribute(a)}"]`;
    }
    const parts: string[] = [];
    while (cur && cur !== document.body && parts.length < 12) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`${seg}#${cur.id}`);
        break;
      }
      // 过滤状态类（open/active/selected/collapsed 等），保证展开前后 selector 稳定，避免同一菜单项被当成两个
      const stateCls = /open|active|selected|collapsed|expanded|show|hidden|disabled|checked|hover/i;
      const cls = Array.from(cur.classList)
        .filter((c) => !stateCls.test(c))
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('');
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

  // 容器卫生：排除页面根（body/html 常因 sidebar-mini / layout 类被 [class*="sidebar"] 命中，
  // 一旦当容器会把内容区卡片、快捷入口全部收进来，并污染 containerKey 归属）；
  // 并排除「非导航」的菜单类容器（通用启发式，框架无关）：
  //   右键菜单(context-menu)、页签栏(page-tabs/menuTabs)、下拉浮层(dropdown)、消息面板(notice)、
  //   面包屑(breadcrumb)、分页(pagination)、框架下拉组件(el-dropdown / ant-dropdown / tabs-nav)
  const NON_NAV_CONTAINER = /(context-menu|page-tabs|menutabs|dropdown|notice|breadcrumb|pagination|tabs-nav|top-links|navbar-right|welcome-message|navbar-top|top-bar)/i;
  const containers = Array.from(document.querySelectorAll(containerSel)).filter((c) => {
    if (c === document.body || c.tagName === 'HTML') return false;
    const cn = typeof (c as HTMLElement).className === 'string' ? (c as HTMLElement).className : '';
    if (cn && NON_NAV_CONTAINER.test(cn)) return false;
    return true;
  });
  const out: RawNavItem[] = [];
  const seen = new Set<string>();

  for (const container of containers) {
    const allEls = Array.from(container.querySelectorAll(itemSel));
    // 容器标识：跨容器「点击因果」归属用（顶部一级菜单点击后，侧栏另一容器的二三级菜单出现）
    const cid = container.id ? `#${container.id}` : '';
    const ccls =
      typeof container.className === 'string'
        ? container.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('')
        : '';
    const containerKey = `${container.tagName.toLowerCase()}${cid}${ccls}`;
    // 第一阶段：去嵌套过滤——跳过「内部含命中项、自身非链接、非子菜单容器」的纯容器（li 与其内部 a 不重复成父子）
    const keptEls: Element[] = [];
    for (const el of allEls) {
      const html = el as HTMLElement;
      const hasNestedItem = allEls.some((c) => c !== el && el.contains(c));
      if (hasNestedItem && !html.getAttribute('href') && !html.querySelector('ul, ol, [role="menu"]')) {
        continue;
      }
      // 噪声区过滤：logo/品牌区/侧栏开关/通知角标/用户面板/顶栏部件区不是菜单项
      if (inNoise(el)) continue;
      // 内容区过滤：仪表盘卡片、快捷入口等位于内容区，不是导航菜单项
      if (inContent(el)) continue;
      // 表格区过滤（通用）：表头/数据行/行内操作链（编辑/删除/详情…）是页面内容，不是导航菜单项。
      // 依据：OA（AdminLTE 表格行内链）与 ruoyi（表格操作列）实测都会混入，且各框架同构。
      if (el.closest('table, thead, tbody, tr')) continue;
      // 品牌/Logo 过滤（通用兜底）：各后台 logo 常是「无 class 的 <a><img></a>」直接挂在导航容器上，
      // 类名规则（logo|brand）拦不住（ruoyi 实测：<a href="/index">RuoYi</a> 无任何 class）。
      // 判定：含 <img> 且文本很短 → 视为品牌位，不是菜单项。
      if (html.querySelector('img') && (html.textContent || '').trim().length <= 12) continue;
      keptEls.push(el);
    }
    // 第二阶段：先算文本（去重用）
    const textOf = (el: Element): string => {
      const html = el as HTMLElement;
      let t = '';
      for (const c of Array.from(html.childNodes)) {
        if (c.nodeType === 3) t += (c.textContent || '');
      }
      t = t.replace(/\s+/g, ' ').trim();
      if (!t) {
        const leaf = html.querySelector('a, span, [class*="title"], [class*="label"], [class*="text"]');
        t = (leaf ? (leaf.textContent || '') : '').replace(/\s+/g, ' ').trim();
      }
      if (!t) t = (html.textContent || '').replace(/\s+/g, ' ').trim().replace(/\s*\d+\s*$/, '').trim();
      return t;
    };
    const textCache = new Map<Element, string>();
    for (const el of keptEls) textCache.set(el, textOf(el));

    // 关键修复（T1.5 真机验证）：把「被更深同文本后代合并的浅层祖先」**真正移出**保留集合。
    // ruoyi 等：a[href] 直接包裹 li.el-menu-item（同文本）时，a 与 li 都命中 itemSel。
    // 若 a 仍留在集合里，li 的 parentSelector 会指向 a 而非父菜单 li.el-submenu，
    // 导致层级匹配失败（只匹配到不被 a 包裹的项）。此处把 a 移除，li 继承其 href。
    const keptFinal = keptEls.filter(
      (el) =>
        !keptEls.some((c) => c !== el && el.contains(c) && textCache.get(c) === textCache.get(el)),
    );

    // 第三阶段：对最终保留项计算 text/selector/expandable/parentSelector（父级只在最终保留项中找）
    for (const el of keptFinal) {
      const html = el as HTMLElement;
      const text = textCache.get(el) || '';
      if (!text || text.length < 2 || text.length > 30) continue;
      if (dangerous.test(text)) continue;
      const style = window.getComputedStyle(html);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = html.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const selector = cssPath(html);
      // 可展开判定（通用，覆盖三种主流结构）：
      //   ① 子菜单在自身内部（AdminLTE `a` 内含 ul.treeview-menu）；
      //   ② 子菜单在同一 li 的兄弟位置（Element-UI / AntD / ruoyi：`li > a` + `li > ul`）；
      //   ③ role/class 语义（role=menu、class*=submenu/children）。
      const SUBMENU_SEL = 'ul, ol, [role="menu"], [class*="submenu"], [class*="sub-menu"], [class*="children"]';
      const parentLi = html.closest('li');
      const submenuInSelf = html.querySelector(SUBMENU_SEL) !== null;
      const submenuInParentLi =
        !!parentLi &&
        Array.from(parentLi.children).some(
          (c) => c !== html && c.matches?.('ul, ol, [role="menu"], [class*="submenu"], [class*="sub-menu"], [class*="children"]'),
        );
      const expandable = submenuInSelf || submenuInParentLi;
      // href：自身 → 内部 a → 祖先 a（a 包裹 li 的场景）
      let href: string | undefined = html.getAttribute('href') || undefined;
      if (!href && !expandable) {
        href = html.querySelector('a[href]')?.getAttribute('href') ?? undefined;
      }
      if (!href) {
        let p: Element | null = html.parentElement;
        while (p && p !== document.body) {
          const ah = (p as HTMLElement).getAttribute?.('href');
          if (ah) {
            href = ah;
            break;
          }
          p = p.parentElement;
        }
      }
      // 父级：最近的「也在最终保留集合里」的祖先菜单项（避免指向被跳过的 li 或 ul 容器）
      // 通用补充（AdminLTE / Element-UI / AntD 同构）：子菜单常与父菜单项是**兄弟**关系 ——
      //   `<li class="treeview"><a>工时管理</a><ul class="treeview-menu"><li><a>工时填报</a>…</ul></li>`
      // 此时叶子 <a> 的 DOM 祖先里没有父菜单项，只按祖先找会得到 null → 层级塌缩/错挂。
      // 规则：向上遇到子菜单容器（ul/ol/[class*=menu]）时，取其父 li 的**前置同级 <a>** 作为父菜单项。
      let parentEl: Element | null = html.parentElement;
      let parentSelector: string | null = null;
      while (parentEl && parentEl !== document.body) {
        if (keptFinal.includes(parentEl)) {
          parentSelector = cssPath(parentEl);
          break;
        }
        if (/^(UL|OL)$/i.test(parentEl.tagName)) {
          const li = parentEl.parentElement;
          const anchor = li
            ? Array.from(li.children).find(
                (c) => c.tagName === 'A' && keptFinal.includes(c),
              )
            : null;
          if (anchor) {
            parentSelector = cssPath(anchor);
            break;
          }
        }
        parentEl = parentEl.parentElement;
      }
      const key = selector;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ selector, text, href: href ?? undefined, expandable, parentSelector, containerKey });
    }
  }
  return out;
};

/** 浏览器内收集页面功能点控件 + 是否含数据表格/列表（只识别、不点击） */
const COLLECT_CONTROLS_FN = () => {
  // 多容器扫描：所有 main/.content 容器都扫，而非只取第一个（表格/表单可能不在第一个容器内）
  const containers = Array.from(document.querySelectorAll('main, .content, #main, [class*="content"], [class*="main"]'));
  const roots: Element[] = containers.length > 0 ? (containers as Element[]) : [document.body];
  const hasDataGrid = roots.some((r) => !!r.querySelector('table, [class*="table"], [class*="grid"], [class*="list"], [class*="list-view"]'));
  const controls: PageControl[] = [];
  const seen = new Set<string>();
  // 扩展候选：Tab/标签页、列表项、textarea、分页等，补「页面菜单下的标签」颗粒度
  const SEL = 'button, a[href], [role="button"], [class*="btn"], input, select, textarea, [role="tab"], .ant-tabs-tab, .el-tabs__item, [role="listitem"], .ant-list-item, .ant-pagination-item';
  for (const main of roots) {
    const candidates = main.querySelectorAll(SEL);
    for (const el of Array.from(candidates)) {
      const html = el as HTMLElement;
      // 关键修复（串页污染）：keep-alive 缓存的隐藏页面 DOM 仍在文档中（display:none），
      // 必须跳过不可见元素，否则会把上一个页面的按钮/导航控件误挂到当前页面。
      const style = window.getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || rect.width === 0 || rect.height === 0) continue;
      // 排除全局导航/标签页/顶栏内的控件（个人中心/刷新/公告弹窗等不属于页面功能点）
      if (html.closest('.navbar, .navbar-container, .tags-view, .tags-view-container, .sidebar, .sidebar-container, header, .header, .topbar, .top-bar, .layout-header, .sidebar-logo-container')) continue;
      // 排除仪表盘统计部件（小卡片/统计块）：它们是展示型入口，不是页面功能点
      if (html.closest('.small-box, .info-box, [class*="widget"], [class*="statistic"], [class*="stat-"]')) continue;
      // 排除分页/页码/表头区：‹ 1 2 3 ›、每页条数、"跳转"等不是业务功能点
      if (html.closest('[class*="pagination"], .pagination, [class*="pager"], thead')) continue;
      const tag = html.tagName.toLowerCase();
      const isTab = !!html.closest('[role="tablist"]') || html.getAttribute('role') === 'tab' || /tabs-tab|tabs__item/i.test(html.className);
      const text = (html.textContent || '').replace(/\s+/g, ' ').trim();
      const label = html.getAttribute('aria-label') || text || (html as HTMLInputElement).placeholder || '';
      if (!label) continue;
      // 纯数字/分页符号（"1"、"50 50100150"、"‹"、">"、省略号）不是功能点
      if (/^[\d\s.,:;%‹›«»<>×xX+\-/|]+$/.test(label)) continue;
      if (/^(\.\.\.|…)+$/.test(label)) continue;
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
        type: isTab ? 'tab' : ((html as HTMLInputElement).type || undefined),
        placeholder: (html as HTMLInputElement).placeholder || undefined,
      });
    }
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
        dangerousSource: DANGEROUS_SOURCE,
        noiseSource: NOISE_SOURCE,
        contentSel: CONTENT_SEL,
      })) as RawNavItem[];
      out.push(...items);
    } catch {
      // 跨域 frame 或已卸载：跳过
    }
  }
  return out;
}

async function collectControls(page: Page): Promise<{ controls: PageControl[]; hasDataGrid: boolean }> {
  // iframe/tab 感知：AdminLTE 等系统把功能页加载在 tab iframe 里，只扫主 frame 会全部采空。
  // 逐 frame 采集后按「selector+text」去重合并；跨域/已卸载 frame 静默跳过。
  const merged: { controls: PageControl[]; hasDataGrid: boolean } = { controls: [], hasDataGrid: false };
  for (const f of page.frames()) {
    try {
      const r = (await f.evaluate(COLLECT_CONTROLS_FN)) as { controls: PageControl[]; hasDataGrid: boolean };
      if (!r) continue;
      merged.controls.push(...(r.controls ?? []));
      merged.hasDataGrid = merged.hasDataGrid || !!r.hasDataGrid;
    } catch {
      // 跨域 frame 或已卸载：跳过
    }
  }
  const seen = new Set<string>();
  merged.controls = merged.controls.filter((c) => {
    const k = `${c.selector}|${c.text ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return merged;
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
  // iframe 感知采样：功能页可能在 tab iframe 里，任一 frame 内容稳定变化都算「已加载」
  const sample = async (): Promise<string> => {
    const parts: string[] = [];
    for (const f of page.frames()) {
      const t = await f
        .evaluate(() => {
          const el =
            document.querySelector('.app-main, main, .main, .content, [class*="content"], [class*="main"]') ??
            document.body;
          return ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
        })
        .catch(() => '');
      parts.push(t);
    }
    return parts.join('|');
  };

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
      (args: { contentSel: string; markerSel: string }) => {
        const containers = Array.from(document.querySelectorAll(args.contentSel));
        const roots = containers.length > 0 ? (containers as Element[]) : [document.body];
        return roots.some((r) => r.querySelector(args.markerSel));
      },
      { contentSel, markerSel },
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
  /** 落地页真实地址：主 frame URL 变化值，或新增/变化的 tab iframe src；未捕获则为空 */
  landedUrl?: string;
}

/**
 * 采集页面「落地指纹」：URL + 主内容区元素数 + 文本摘要。
 * SPA 菜单点击常不改变 URL（同路由内切视图），单看 URL 会误判未落地，故加内容维度。
 */
/** 安全读 frame URL：伪 frame / 已卸载 frame 可能没有 url() 或读取抛错 */
function frameUrlOf(f: { url?: () => string }): string {
  try {
    return typeof f.url === 'function' ? f.url() : '';
  } catch {
    return '';
  }
}

export async function pageFingerprint(page: Page): Promise<string> {
  // iframe 感知：主 frame 不变但 tab iframe 内容变化的「落地」必须能被识别，
  // 否则 AdminLTE 类系统（功能页在 iframe）会被误判未落地而跳过采集。
  const parts: string[] = [page.url()];
  for (const f of page.frames()) {
    const body = await f
      .evaluate(() => {
        const el =
          document.querySelector('main, .main, .app-main, .content, [class*="content"], [class*="main"]') ??
          document.body;
        const text = (el as HTMLElement).innerText ?? '';
        return `${el.querySelectorAll('*').length}:${text.slice(0, 300)}`;
      })
      .catch(() => '');
    parts.push(`${f === page.mainFrame() ? 'main' : 'sub'}:${frameUrlOf(f)}::${body}`);
  }
  return parts.join('||');
}

/** 子 frame（tab iframe）URL 快照：用于点击后捕获「落地 URL」（仅 http/https） */
async function childFrameUrls(page: Page): Promise<string[]> {
  const urls: string[] = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const u = frameUrlOf(f);
    if (u && /^https?:/i.test(u)) urls.push(u);
  }
  return urls;
}

/**
 * 当前「可见」iframe 的 src（tab 复用场景兜底）：
 * 点击一个已在其它 tab 打开过的菜单时，应用只切换激活 tab，不新建 iframe、主 URL 也不变，
 * 此时「新增 frame」为空 → 改取可见 iframe 的 src 才是该页面的真实地址。
 */
async function visibleIframeUrls(page: Page): Promise<string[]> {
  try {
    return (await page.mainFrame().evaluate(() =>
      Array.from(document.querySelectorAll('iframe'))
        .filter((f) => {
          const r = (f as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((f) => (f as HTMLIFrameElement).src)
        .filter((s) => !!s && /^https?:/i.test(s)),
    )) as string[];
  } catch {
    return [];
  }
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
/**
 * 点击「第一个可见且可交互」的匹配元素。
 * 为什么必须逐个尝试（OA bpms 实证）：同一菜单项常同时存在于顶栏下拉与侧栏（DOM 两份），
 * Playwright `page.click(sel)` 默认严格模式遇多匹配直接报错，`.first()` 又可能命中隐藏那份而超时
 * → 42/42 叶子点击失败、URL 与功能点全部采不到。此处逐个过滤可见性后点击，与系统无关。
 *
 * 兼容两种 locator 调用面：真实 Playwright Locator（count/nth/isVisible）与精简桩对象（直接 click / first()）。
 */
async function clickLocatorOnce(raw: unknown): Promise<boolean> {
  let loc = raw as {
    click?: (o?: unknown) => Promise<void>;
    first?: () => unknown;
    count?: () => Promise<number>;
    nth?: (i: number) => unknown;
  };
  if (!loc || typeof loc.click !== 'function') {
    // 精简桩可能只提供 first()（getByText 风格）
    if (typeof loc?.first === 'function') loc = loc.first() as typeof loc;
  }
  if (!loc || typeof loc.click !== 'function') return false;
  if (typeof loc.count !== 'function' || typeof loc.nth !== 'function') {
    try {
      await loc.click({ timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
  let n = 0;
  try {
    n = await loc.count();
  } catch {
    return false;
  }
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i) as {
      isVisible?: () => Promise<boolean>;
      scrollIntoViewIfNeeded?: (o?: unknown) => Promise<void>;
      click: (o?: unknown) => Promise<void>;
    };
    try {
      if (typeof el.isVisible === 'function' && !(await el.isVisible())) continue;
      if (typeof el.scrollIntoViewIfNeeded === 'function') {
        await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      }
      await el.click({ timeout: 2000 });
      return true;
    } catch {
      // 该元素不可点（被遮挡/已卸载/不可见）→ 尝试下一个
    }
  }
  return false;
}

async function safeClick(
  page: Page,
  selector: string,
  settleMs: number,
  text?: string,
  href?: string,
): Promise<ClickOutcome> {
  const before = await pageFingerprint(page);
  const mainBefore = page.url();
  const framesBefore = await childFrameUrls(page);

  const tryClick = async (sel: string): Promise<boolean> => {
    const anyPage = page as unknown as { locator?: (s: string) => unknown };
    if (typeof anyPage.locator === 'function') {
      if (await clickLocatorOnce(anyPage.locator(sel))) return true;
      for (const f of page.frames()) {
        const anyFrame = f as unknown as { locator?: (s: string) => unknown };
        if (typeof anyFrame.locator === 'function' && (await clickLocatorOnce(anyFrame.locator(sel)))) return true;
      }
      return false;
    }
    // 精简桩：退回基础 click
    try {
      await page.click(sel);
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
    // fallback 1: href 精确匹配（同样只点可见元素）
    if (href) {
      const anyPage = page as unknown as { locator?: (s: string) => unknown };
      if (typeof anyPage.locator === 'function' && (await clickLocatorOnce(anyPage.locator(`a[href="${href}"]`)))) {
        return true;
      }
    }
    // fallback 2: 文本匹配：先精确再包含，逐个可见元素尝试
    if (text && text.length >= 2) {
      const anyPage = page as unknown as { getByText?: (t: string, o?: unknown) => unknown };
      if (typeof anyPage.getByText === 'function') {
        for (const exact of [true, false]) {
          if (await clickLocatorOnce(anyPage.getByText(text, { exact }))) return true;
        }
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
  // 窗口 3s：兼容慢加载（iframe 首帧较晚）场景，避免真实菜单被误判未落地而剔除
  const deadline = Date.now() + 3000;
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
    return { clicked: true, landed };
  }

  // 落地 URL 捕获（修「URL 丢失」）：主 frame URL 变化优先；
  // 否则取新增/变化的 tab iframe src —— AdminLTE 类系统功能页真实地址在 iframe 上，
  // 菜单 href 本身多为 javascript: 伪协议，不捕获 iframe 就永远拿不到 URL。
  let landedUrl: string | undefined;
  const mainAfter = page.url();
  if (mainAfter && mainAfter !== mainBefore) {
    landedUrl = mainAfter;
  } else {
    const framesAfter = await childFrameUrls(page);
    const fresh = framesAfter.find((u) => !framesBefore.includes(u));
    if (fresh) {
      landedUrl = fresh;
    } else {
      // 兜底：tab 复用（不新建 iframe、URL 未变）→ 取当前可见 iframe src
      const visible = await visibleIframeUrls(page);
      landedUrl = visible.find((u) => !framesBefore.includes(u)) ?? visible[0];
    }
  }
  return { clicked: true, landed, landedUrl };
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
  depth = 0,
): Promise<RawNavItem[]> {
  // 点击前快照：支撑「点击因果」发现。AdminLTE 等系统点击一级菜单后，二三级菜单在
  // 另一容器（如侧栏）刷新出现，与点击项无 DOM 祖先关系，parentSelector 永远匹配不上；
  // 只能靠「点击后新出现的导航项」建立因果父子（运行时改写 parentSelector，下游不感知）。
  const beforeKeys = new Set((await collectNavAll(page)).map((c) => c.selector));

  const collectChildren = async (): Promise<RawNavItem[]> => {
    const after = await collectNavAll(page);
    // 1) 常规：DOM 祖先关系（Element-UI / AntD 等子菜单在点击项子树内）
    const byParent = after.filter((c) => c.parentSelector === item.selector);
    if (byParent.length > 0) return byParent;
    // 2) 因果：点击后新出现且非自身的导航项 → 挂为点击项子级
    const causalNew = after.filter((c) => !beforeKeys.has(c.selector) && c.selector !== item.selector);
    if (causalNew.length > 0) {
      for (const c of causalNew) {
        // 只补空、不覆盖：保留同批新项之间 DOM 已确定的分组父子关系
        const domParent = c.parentSelector;
        const parentAvailable = !!domParent && causalNew.some((x) => x.selector === domParent);
        if (!parentAvailable) c.parentSelector = item.selector;
      }
      return causalNew;
    }
    // 3) 容器回退（仅顶层）：DOM 节点复用（selector 未变）时，另一菜单容器的可见项即子级
    if (depth === 0) {
      const crossContainer = after.filter(
        (c) =>
          c.selector !== item.selector &&
          !!c.containerKey &&
          !!item.containerKey &&
          c.containerKey !== item.containerKey,
      );
      for (const c of crossContainer) c.parentSelector = item.selector;
      return crossContainer;
    }
    return [];
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
  /** 菜单项 selector → 落地页面 URL（供用例阶段按路径精准导航） */
  urlByKey: Map<string, string>;
  visitedSelectors: Set<string>;
  allItems: Map<string, RawNavItem>;
  /** 自我验证判定为 UI 控件（点击无落地且无子菜单）的项，组装前剔除 */
  deadSelectors: Set<string>;
}

/**
 * 递归 DFS 菜单遍历：expandable 节点先展开再递归；叶子节点点击进入页面（仅记录落地 URL）。
 * 关键修复（T1.5）：ruoyi 等 Element-UI 侧边栏在父菜单展开后会重新渲染子菜单 DOM，
 * 一次性全量收集的 selector 会失效。改为「边展开、边收集、边点击」，保证 selector 新鲜。
 * 粒度边界（用户裁定 2026-09-18）：只到菜单子目录/功能页，不采集页面内按钮级功能点。
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
        children = await expandAndCollect(page, item, cfg, depth);
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
      // 点击前导航快照：支撑叶子级「点击因果」子菜单发现（expandable 判定依赖 DOM 子树，
      // AdminLTE 类系统子菜单在别处刷新，DOM 上不可展开但点击后会出现新导航项）
      const navBeforeKeys = new Set((await collectNavAll(page)).map((c) => c.selector));
      const outcome = await safeClick(page, item.selector, cfg.settleMs, item.text, item.href);
      if (!outcome.clicked) continue;
      state.clicked += 1;
      state.visitedSelectors.add(item.selector);

      // 因果子菜单发现（先于落地判定）：AdminLTE 一级菜单点击只「换侧栏组」，
      // 内容区不变（未 landed）但侧栏出现新项，必须据此建立父子并继续下探。
      // 两级策略：
      //  ① 新出现项优先（侧栏刷新/DOM 重建，selector 变化）；
      //  ② 容器回退（仅顶层）：点击项与候选项分属不同菜单容器（顶部一级菜单 → 侧栏二三级菜单），
      //     DOM 节点被复用时（selector 未变、仅显隐变化）「另一容器的可见项」即本项子级。
      const navAfter = await collectNavAll(page);
      let causal = navAfter.filter(
        (c) =>
          !navBeforeKeys.has(c.selector) &&
          c.selector !== item.selector &&
          !state.visitedSelectors.has(c.selector),
      );
      if (causal.length === 0 && depth === 0 && !outcome.landed) {
        // 容器回退仅在「点击未落地」时启用（关键收敛）：
        // AdminLTE 一级菜单 href=javascript: 点击只换侧栏组（不落地）→ 需要回退认领侧栏项；
        // 而 ruoyi「AI对话」这类真实链接点击后会落地到自己的页面，此时再认领「另一容器」的
        // 顶栏部件项就是误挂（实测：AI对话 被挂上 文档/全屏）→ 落地成功则不回退。
        causal = navAfter.filter(
          (c) =>
            c.selector !== item.selector &&
            !state.visitedSelectors.has(c.selector) &&
            !!c.containerKey &&
            !!item.containerKey &&
            c.containerKey !== item.containerKey,
        );
      }
      if (causal.length > 0) {
        for (const c of causal) {
          // 只补空、不覆盖（关键）：同批新项之间若 DOM 已确定父子（如 工时管理>工时填报、
          // 绩效管理>绩效查询），必须保留 —— 否则分组层级被抹平成兄弟（OA 实测问题）。
          // 仅当无 DOM 父、或 DOM 父不在「本批新项 / 已收集项」中时，才挂到本次点击项下。
          const domParent = c.parentSelector;
          const parentAvailable =
            !!domParent &&
            (state.allItems.has(domParent) || causal.some((x) => x.selector === domParent));
          if (!parentAvailable) c.parentSelector = item.selector;
          state.allItems.set(c.selector, c);
        }
        await exploreNavTree(page, causal, cfg, ctx, state, depth + 1, startUrl);
        continue;
      }

      if (!outcome.landed) {
        // 自我验证：真菜单点击必然改变视图或揭示子菜单；两者皆无 → UI 控件（全屏/便签/头像等），
        // 从最终树中剔除（不写死具体控件名，靠行为判定）
        console.warn(`[explore] 点击无落地且无子菜单，判定为 UI 控件并剔除: ${item.text}`);
        state.deadSelectors.add(item.selector);
        continue;
      }

      // 不再等待/采集页面内控件：边界裁定后，探索只负责「菜单子目录/功能页」粒度的落地 URL。
      const currentUrl = page.url();
      // URL 捕获优先级：safeClick 的落地 URL（主 URL 变化 / tab iframe src）
      //               > 主 frame URL 变化 > click: 占位（仅标记已点击，非真实地址）
      if (outcome.landedUrl) {
        state.urlByKey.set(item.selector, outcome.landedUrl);
      } else if (currentUrl && currentUrl !== startUrl) {
        state.urlByKey.set(item.selector, currentUrl);
      } else {
        state.urlByKey.set(item.selector, `click:${item.selector}`);
      }

      // 边界（用户裁定 2026-09-18）：第一次探索只到「菜单子目录/功能页」粒度，
      // 这里**不再** collectControls / extractPageActions —— 不采集页面内按钮级功能点。
      // 动作级「非常详细」的探索由生成测试用例阶段的按功能点证据采集负责
      //（orchestrator.featureEvidenceExplorer：按 featurePaths 逐页导航 + 只读点击）。
      // 保留点击菜单项本身：它是导航（AdminLTE 靠点击换侧栏组/开 tab），且真实页面 URL
      // 只能通过点击后捕获（菜单 href 多为 javascript: 伪协议）。
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
  const ctx = {
    subsystemId: opts.subsystemId,
    systemId: opts.systemId ?? opts.subsystemId,
    // 相对 href 的解析基准＝当前所在页面 URL（探索起点即登录后入口页），
    // 使 `/system/user` 这类相对菜单地址变成绝对 URL，供用例阶段直接导航。
    baseUrl: startUrl,
  };

  const onDialog = (d: Dialog): void => {
    void d.dismiss().catch(() => {});
  };
  const onPopup = (p: Page): void => {
    void p.close().catch(() => {});
  };
  page.on('dialog', onDialog);
  page.on('popup', onPopup);

  try {
    const state: ExploreState = {
      clicked: 0,
      urlByKey: new Map(),
      visitedSelectors: new Set(),
      allItems: new Map(),
      deadSelectors: new Set(),
    };

    const topItems = await collectNavAll(page);
    for (const it of topItems) state.allItems.set(it.selector, it);

    await exploreNavTree(page, topItems, cfg, ctx, state, 0, startUrl);

    if (state.allItems.size === 0) return [];

    // 用所有收集到的导航项重建完整层级（含动态展开发现的子项；剔除自我验证为 UI 控件的项）
    const aliveItems = Array.from(state.allItems.values()).filter(
      (it) => !state.deadSelectors.has(it.selector),
    );
    if (aliveItems.length === 0) return [];
    const nav = buildNavHierarchy(aliveItems);

    // 回到起点页（清理浏览器状态）
    if (startUrl) {
      await page.goto(startUrl, { waitUntil: 'load' }).catch(() => {});
    }

    // 组装 + 去重 + 合并汇总型菜单（如「更多模块」下重复的顶层模块）+ 归一化 type/depth
    // 不传 actionsByKey：本阶段不产出动作级功能点（边界：动作级归用例阶段）
    const tree = toModuleNodes(nav, ctx, undefined, state.urlByKey);
    return normalizeModuleTree(mergeRollupModules(dedupModuleTree(tree)));
  } finally {
    page.off('dialog', onDialog);
    page.off('popup', onPopup);
  }
}
