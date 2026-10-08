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
 * 导航项候选 —— **纯结构性判据，与框架/系统无关**。
 *
 * ⛔ 依据 AGENTS.md HARD RULE #0：**禁止**在此加入任何系统/框架专属的 class 名、ID 或裸标签。
 *    历史违规已清除：`nav`（裸标签）、`[class*="sidebar"]`、`[class*="menu"]`、`.el-menu-item`、
 *    `.ant-menu-item`、`.n-menu-item`、`li[class*="menu-item"]`、`[class*="tree"]` 等。
 *
 * 原理：菜单项的本质是「**可导航的项**」——带 `href` 的链接，或带导航语义 role 的元素。
 * 这层语义在任何 UI 框架下都成立，无需知道它长什么 class。
 */
const NAV_ITEM_SEL = 'a[href], [role="menuitem"], [role="treeitem"], [role="tab"], [role="link"]';

/**
 * 子菜单容器判据 —— 结构语义（列表容器 / 菜单·树·分组语义容器）。
 * 覆盖主流两种结构：① 子菜单嵌在锚点内部（`<a>…<ul>`）；② 子菜单是 `li` 的兄弟（`li>a` + `li>ul`）。
 */
const SUBMENU_SEL = 'ul, ol, [role="menu"], [role="group"], [role="tree"]';

/**
 * 分区几何阈值（**比例判据，与系统无关**）：
 * - 侧栏：**贴左/贴右** + 竖向窄条（宽 ≤ 视口 45%，高 ≥ 视口 20%）
 * - 顶栏：**贴顶** + 横向矮条（高 ≤ 视口 15%，宽 ≥ 视口 35%）
 *
 * 「贴边」是必需的：实测 AntD Pro 的内容区表格（left=320px，572×195）与页脚条
 * （y=1991，1296×17）都满足"窄条/矮条"，但都不贴边 —— 只靠宽高比会把它们当导航区。
 * 反过来，内容主区天然三者皆不满足，因此可零类名地区分「导航区 / 内容区」。
 */
const SIDEBAR_MAX_W_RATIO = 0.45;
/**
 * 侧栏最小高度占视口比。**不能设太高**：实测 OA(AdminLTE) 的侧栏是「每个一级菜单一个
 * `ul.tab-pane` 组，按需显示」，短组（如「项目管理」只有 2 项，高约 80px ≈ 9%vh）同样合法。
 * 设为 0.2 会把短组整组判掉 → 该一级菜单被判「无子菜单」→ 误当 UI 控件剔除。
 * 因为有「贴边 + 宽度 ≤45%vw」双重约束兜底，这里放宽到 0.08 不会引入内容区误判。
 */
const SIDEBAR_MIN_H_RATIO = 0.08;
/** 贴边容忍度：容器边缘落在视口边缘 12% 以内视为贴边 */
const EDGE_RATIO = 0.12;
const TOPBAR_MAX_H_RATIO = 0.15;
const TOPBAR_MIN_W_RATIO = 0.35;
/** 候选容器至少需含这么多个导航项，才可能是导航区（孤立链接是内容/卡片，不是菜单） */
const MIN_ITEMS_PER_CONTAINER = 3;

/** 浏览器内收集导航项（含层级 parentSelector）；跨 frame 收集 */
const COLLECT_NAV_FN = (args: {
  itemSel: string;
  submenuSel: string;
  dangerousSource: string;
  sidebarMaxWRatio: number;
  sidebarMinHRatio: number;
  edgeRatio: number;
  topbarMaxHRatio: number;
  topbarMinWRatio: number;
  minItemsPerContainer: number;
}) => {
  const {
    itemSel,
    submenuSel,
    dangerousSource,
    sidebarMaxWRatio,
    sidebarMinHRatio,
    edgeRatio,
    topbarMaxHRatio,
    topbarMinWRatio,
    minItemsPerContainer,
  } = args;
  // 危险词由 Node 侧注入（DANGEROUS_SOURCE），避免浏览器侧维护第二份正则导致改一处等于没改。
  // 注意：危险词是**通用语义**（退出/注销/删除…与具体系统无关），仅用于「禁止点击」，不参与菜单识别。
  const dangerous = new RegExp(dangerousSource, 'i');

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

  // ==================== 导航区识别：几何 + 结构（零类名依赖） ====================
  // ⛔ 依据 AGENTS.md HARD RULE #0：此处**不允许**出现任何系统/框架专属的 class/ID/裸标签。
  //    判据只有三类：① 几何（宽高占视口比）② 结构（同构候选项数量）③ 行为（Node 侧点击验证）。
  //
  // 为什么不能用「命中 nav/sidebar/menu 等类名就收」：OA 顶栏 `<nav class="navbar …">` 装的是
  // **一级菜单**（要收），ruoyi 顶栏 `<nav class="navbar navbar-static-top">` 装的是**部件**
  // （文档/锁屏/全屏/消息，要排）——结构同构、语义相反，任何类名清单必错其一。
  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;

  /**
   * 无布局引擎的环境（jsdom 单测里 rect 恒为 0）→ 几何判据整体不可用，
   * 自动退化为**纯结构判据**（样式可见性 + 结构计数），避免测试环境全灭。
   * 真实浏览器一定有布局，此分支不影响线上行为。
   */
  const layoutAvailable = (() => {
    try {
      const r = document.body.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    } catch {
      return false;
    }
  })();

  const isVisibleEl = (el: Element): boolean => {
    const s = window.getComputedStyle(el as HTMLElement);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (!layoutAvailable) return true; // 无布局信息：仅凭样式判断
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  /** 导航区形态：侧栏=贴边竖向窄条；顶栏=贴顶横向矮条。内容主区/内容区表格/页脚天然皆不满足。 */
  const navZoneShape = (el: Element): 'sidebar' | 'topbar' | null => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const huggingSide = r.left <= vw * edgeRatio || r.right >= vw * (1 - edgeRatio);
    if (huggingSide && r.width <= vw * sidebarMaxWRatio && r.height >= vh * sidebarMinHRatio) {
      return 'sidebar';
    }
    const huggingTop = r.top <= vh * edgeRatio;
    if (huggingTop && r.height <= vh * topbarMaxHRatio && r.width >= vw * topbarMinWRatio) {
      return 'topbar';
    }
    return null;
  };

  /**
   * 浮层排除（通用结构判据）：菜单项位于文档流内；下拉/弹层/气泡面板是 `position:absolute` 的浮层。
   * 实测：ruoyi 顶栏「消息」的下拉面板项（通知/公告/全部已读）会被误当子菜单。
   * 只判 `absolute`，**不判 `fixed`** —— 固定侧栏常用 `fixed`，判它会误杀真菜单。
   */
  const inOverlay = (el: Element): boolean => {
    let p: Element | null = el;
    for (let d = 0; p && p !== document.body && d < 6; d++) {
      const cs = window.getComputedStyle(p as HTMLElement);
      if (cs.position === 'absolute') return true;
      p = p.parentElement;
    }
    return false;
  };

  // 1) 收集全部可见导航项候选，向上累计每个祖先的候选数（一次 O(n·depth)，避免 O(n²)）
  const allItems = Array.from(document.querySelectorAll(itemSel)).filter(isVisibleEl);
  const itemCount = new Map<Element, number>();
  const MAX_UP = 10;
  for (const it of allItems) {
    let p: Element | null = it.parentElement;
    for (let d = 0; p && p !== document.body && d < MAX_UP; d++) {
      itemCount.set(p, (itemCount.get(p) ?? 0) + 1);
      p = p.parentElement;
    }
  }
  // 2) 候选导航区 = 候选数达阈值（成组出现）+ 形态为侧栏/顶栏（内容区在此被几何排除；
  //    无布局引擎时 layoutAvailable=false，几何判据自动跳过，退化为结构判据）
  const hostCandidates: Element[] = [];
  for (const [el, n] of itemCount) {
    if (n < minItemsPerContainer) continue;
    if (el === document.body || el.tagName === 'HTML') continue;
    if (layoutAvailable && !navZoneShape(el)) continue;
    hostCandidates.push(el);
  }
  // 3) 祖孙去重：同一批项被祖孙两级同时框住时，保留结构更具体（更深）的那个
  const containers = hostCandidates.filter(
    (h) => !hostCandidates.some((o) => o !== h && h.contains(o) && itemCount.get(o) === itemCount.get(h)),
  );
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
      // 说明（HARD RULE #0）：此处**不再有**「噪声区 / 内容区」类名黑名单。
      // 噪声与内容区已在容器层用几何（侧栏/顶栏形态）+ 结构（成组出现）排除；
      // 顶栏部件（全屏/锁屏/消息/头像…）等残留由 Node 侧的点击行为验证收口（见 exploreNavTree 的 deadSelectors）。
      // 表格区过滤（通用）：表头/数据行/行内操作链（编辑/删除/详情…）是页面内容，不是导航菜单项。
      // 依据：OA（AdminLTE 表格行内链）与 ruoyi（表格操作列）实测都会混入，且各框架同构。
      if (el.closest('table, thead, tbody, tr')) continue;
      // 浮层过滤（通用）：下拉/弹层面板项不是菜单项（见 inOverlay 说明）
      if (inOverlay(el)) continue;
      // 品牌/Logo 位过滤（**通用，两种形态，零类名**）：
      //  ① 含 <img> 且文本短 —— 各后台最常见的「图标 logo」；
      //  ② 位于视口**左上角**（贴左且贴顶 6% 内）且文本较长 —— 「文字 logo / 站点名 / 标语」。
      //     菜单项文本短且**成组排列**，不会同时满足「左上角 + 长文本」。
      // 实测来源：OA 顶栏 logo `<a>JFT 数字化项目管理平台…</a>` 曾被当顶层菜单项，
      // 并抢先把「我的办公」那一组侧栏项采成自己的子级，导致真实一级菜单丢失。
      const brandText = (html.textContent || '').replace(/\s+/g, ' ').trim();
      if (html.querySelector('img') && brandText.length <= 12) continue;
      {
        const rb = html.getBoundingClientRect();
        if (rb.left <= vw * 0.06 && rb.top <= vh * 0.06 && brandText.length > 12) continue;
      }
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
        // 兜底取文本（**结构判据，零类名**）：菜单项文本通常落在最内层的叶子元素上。
        const leaf = Array.from(html.querySelectorAll('*')).find(
          (e) => e.children.length === 0 && (e.textContent || '').trim().length > 0,
        );
        t = (leaf?.textContent || '').replace(/\s+/g, ' ').trim();
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
      // 纯数字/纯符号且**极短（≤2 字符）**者视为角标/页码（"10"、"›"），不是菜单项。
      // ⚠ 必须限制长度：异常页菜单的标签就是 "403"/"404"/"500"（3 位），一刀切会误删真实菜单项。
      if (text.length <= 2 && /^[\d\s.,:;%‹›«»<>×xX+\-/|]+$/.test(text)) continue;
      if (dangerous.test(text)) continue;
      const style = window.getComputedStyle(html);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = html.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const selector = cssPath(html);
      // 可展开判定（**结构语义，零类名**）：
      //   ① 子菜单嵌在自身内部（`<a>…<ul>`，AdminLTE 形态）；
      //   ② 子菜单是同一 `li` 的兄弟（`li>a` + `li>ul`，Element-UI / AntD / ruoyi 形态）；
      //   ③ role 语义（role=menu/group/tree）。
      // 说明：不再用 `class*=submenu/children` 之类类名判据（HARD RULE #0）。
      const submenuInSelf = html.querySelector(submenuSel) !== null;
      const parentLi = html.closest('li');
      const submenuInParentLi =
        !!parentLi && Array.from(parentLi.children).some((c) => c !== html && !!c.matches?.(submenuSel));
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

// 说明（AGENTS.md HARD RULE #0）：原 `COLLECT_CONTROLS_FN`（页面按钮级控件采集）已**删除**，原因：
//   ① 边界：第一次探索只到「菜单子页」粒度，不采页面按钮（动作级归用例阶段）；
//   ② 它内部依赖大量系统/框架专属类名（`.el-tabs__item`、`.ant-list-item`、`.small-box`、
//      `.topbar`、`.tags-view`、`[class*="pagination"]` …）属写死，且已无任何调用者（死代码）。
//   页面按钮级采集由「用例阶段」的 `stage-case` / `pageActionExplorer` 承担。

/** 跨 frame 收集导航项 */
async function collectNavAll(page: Page): Promise<RawNavItem[]> {
  const out: RawNavItem[] = [];
  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    try {
      const items = (await frames[i].evaluate(COLLECT_NAV_FN, {
        itemSel: NAV_ITEM_SEL,
        submenuSel: SUBMENU_SEL,
        dangerousSource: DANGEROUS_SOURCE,
        sidebarMaxWRatio: SIDEBAR_MAX_W_RATIO,
        sidebarMinHRatio: SIDEBAR_MIN_H_RATIO,
        edgeRatio: EDGE_RATIO,
        topbarMaxHRatio: TOPBAR_MAX_H_RATIO,
        topbarMinWRatio: TOPBAR_MIN_W_RATIO,
        minItemsPerContainer: MIN_ITEMS_PER_CONTAINER,
      })) as RawNavItem[];
      out.push(...items);
    } catch {
      // 跨域 frame 或已卸载：跳过
    }
  }
  return out;
}

// 说明（AGENTS.md HARD RULE #0）：原 `collectControls()`（逐 frame 采集页面按钮控件）已删除 ——
// 它是死代码（无调用者），且其采集规则依赖系统专属类名，违反通用性铁律。

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
          // HARD RULE #0：内容区只认标准元素 / ARIA，不列任何框架类名
          const el = document.querySelector('main, [role="main"]') ?? document.body;
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
  // HARD RULE #0：只用标准元素 / ARIA role，不列任何框架类名（`main` 为 HTML5 标准元素，`role="main"` 为标准 ARIA）。
  const contentSel = 'main, [role="main"], body';
  const markerSel = 'table, button, [role="button"], [role="grid"], [role="table"], input, select';
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
  //
  // ⚠ 两个**通用**稳定性要求（缺一则落地判定失效）：
  //  ① **数字骨架化**：把连续数字替换为 `#`。后台首页普遍含动态数字（当前时间、未读计数、
  //     待办条数），否则同一页面每次采样都不同 → 所有点击都被判「有落地」→
  //     顶栏部件（全屏/便签/更多模块/导航切换）无法被剔除。
  //  ② **不含「元素总数」**：元素数同样随动态内容/轮播浮动，是假变化的另一来源。
  const parts: string[] = [page.url()];
  for (const f of page.frames()) {
    const body = await f
      .evaluate(() => {
        // HARD RULE #0：内容区只认标准元素 / ARIA，不列任何框架类名
        const el = document.querySelector('main, [role="main"]') ?? document.body;
        const text = (el as HTMLElement).innerText ?? '';
        return text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 300);
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
  //
  // ⚠ 用 **text** 而非 selector 做「新增」判定（通用性关键）：
  //   selector 含结构路径，页面重渲染（换页/局部刷新）后同一菜单项的 selector 会变，
  //   会把**长期存在的项**误判成「点击产生的子项」——实测 ruoyi 点 logo 后整条顶栏被当成子菜单。
  //   text 稳定得多：长期存在的项其 text 不变，只有真正新出现的项 text 才不在快照里。
  const beforeTexts = new Set((await collectNavAll(page)).map((c) => c.text));

  const collectChildren = async (): Promise<RawNavItem[]> => {
    const after = await collectNavAll(page);
    // 1) 常规：DOM 祖先关系（Element-UI / AntD 等子菜单在点击项子树内）
    const byParent = after.filter((c) => c.parentSelector === item.selector);
    if (byParent.length > 0) return byParent;
    // 2) 因果：点击后**新出现**（按 text 判定，避免重渲染误判）且非自身的导航项 → 挂为点击项子级
    const causalNew = after.filter((c) => !beforeTexts.has(c.text) && c.selector !== item.selector);
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

  /**
   * 采集子项；**一次为空则加长等待重采**（通用容错，不是针对某系统）。
   * 依据（OA AdminLTE 实测）：点击一级菜单后是「切换另一个 `ul.tab-pane` 组的可见性」，
   * 项少的短组（如「项目管理」仅 2 项）需要约 1s 才完成切换/渲染；400ms 就采集会拿到空集，
   * 该一级菜单随即被误判「无子菜单」当作 UI 控件剔除 → **真实菜单缺失**。
   * 正常路径不受影响（第一次采集非空就不再等）。
   */
  const collectChildrenWithRetry = async (): Promise<RawNavItem[]> => {
    let children = await collectChildren();
    if (children.length === 0) {
      await page.waitForTimeout(900);
      children = await collectChildren();
    }
    return children;
  };

  // 1) cssPath 精确 selector 优先（**顺序很关键**）：同名文本在页面常有多份
  //    （顶栏一级菜单「项目管理」与侧栏组内首项同名），先按文本点会点到另一份 → 导航到错页面 → 子菜单采空。
  try {
    await page.click(item.selector, { timeout: 3000 });
    await page.waitForTimeout(Math.min(cfg.settleMs, 400));
    const children = await collectChildrenWithRetry();
    if (children.length > 0) return children;
  } catch {
    // selector 失效，继续尝试文本定位
  }

  // 2) 文本定位点击展开（Element-UI / Ant Design 侧边栏常见；仅作 selector 失效时的兜底）
  try {
    await page.getByText(item.text, { exact: true }).first().click({ timeout: 3000 });
    await page.waitForTimeout(Math.min(cfg.settleMs, 400));
    const children = await collectChildrenWithRetry();
    if (children.length > 0) return children;
  } catch {
    // 无法展开
  }

  // 3) hover 展开（水平顶部菜单常见）
  try {
    await page.hover(item.selector, { timeout: 2000 });
    await page.waitForTimeout(Math.min(cfg.settleMs, 400));
    const children = await collectChildrenWithRetry();
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
