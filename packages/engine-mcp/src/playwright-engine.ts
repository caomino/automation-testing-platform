/**
 * @file playwright-engine.ts
 * @description McpEngine 的 Playwright 实现（DOM 语义抽象 + 浏览器控制）
 * @frozen v1.0 — 接口冻结；DOM 提取逻辑可按 70 项矩阵持续增强，接口不变
 */
import { chromium, type Browser, type BrowserContext, type CDPSession, type Download, type Page, type Route, type WebSocket as PlaywrightWebSocket } from 'playwright';
import type { ModuleNode, CaseRow, ExecutionStepResult, ScreenshotRef } from '@test-platform/contracts';
import type { EngineConfig, SemanticNode, BrowserCommand, CaptureEngine, ExploredElement, PlaywrightStorageState, ReadOnlyClickPurpose, ReadOnlyClickResult } from './types.js';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { exploreViaMenus } from './menu-explorer.js';

/** 浏览器内 DOM 遍历：返回语义节点树（JSON 可序列化）
 *  策略：识别导航容器（NAV/sidebar/menu）提取菜单项作为根模块，
 *  主内容区按容器分组，避免 BODY 单点导致模块树扁平。
 */
const DOM_WALK = `
(function walk(root) {
  const interactiveTags = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','SUBMIT']);
  const containerTags = new Set(['DIV','SECTION','ASIDE','NAV','UL','OL','LI','FORM','TABLE','DETAILS','HEADER','FOOTER','MAIN','ARTICLE']);
  const navSelectors = ['nav', '.sidebar', '.menu', '.nav', '.el-menu', '.ant-menu', '.n-menu', '.v-navigation-drawer', '.layout-sidebar', '.layout-menu', '.aside', '[class*="sidebar"]', '[class*="menu"]', '[class*="nav"]', '[class*="aside"]', '[class*="layout"]', '[class*="drawer"]'];
  const navRoles = ['navigation', 'menubar', 'menu', 'tree'];
  function stableSelector(el) {
    if (el.id) return '#' + el.id;
    const dataAttrs = ['data-testid','data-id','data-key','name'];
    for (const a of dataAttrs) { const v = el.getAttribute(a); if (v) return el.tagName.toLowerCase() + '[' + a + '="' + v + '"]'; }
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) { parts.unshift(n.tagName.toLowerCase()); n = n.parentElement; }
    return parts.join(' > ');
  }
  function hasNavRole(el) {
    if (el.tagName === 'NAV') return true;
    // Check ARIA role
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (navRoles.includes(role)) return true;
    const cls = (el.className || '').toString().toLowerCase();
    // Check common nav selectors
    for (const s of navSelectors) {
      if (s.startsWith('.')) {
        if (cls.includes(s.slice(1))) return true;
      } else if (s.startsWith('[')) {
        try { if (el.matches(s)) return true; } catch(e) {}
      } else {
        if (el.tagName === s.toUpperCase()) return true;
      }
    }
    return false;
  }
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function toNode(el) {
    const tag = el.tagName; const role = el.getAttribute('aria-role') || el.getAttribute('role');
    const text = (el.textContent || '').trim().slice(0, 200);
    const type = el.getAttribute('type') || el.getAttribute('data-type') || undefined;
    const name = el.getAttribute('name') || el.getAttribute('aria-label') || el.getAttribute('title') || undefined;
    const placeholder = el.getAttribute('placeholder') || undefined;
    const href = tag === 'A' ? el.getAttribute('href') : undefined;
    const r = el.getBoundingClientRect();
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const isSubmit = (tag === 'BUTTON' && (type === 'submit' || /提交|保存|新增|删除|修改/.test(text))) || type === 'submit';
    const interactive = interactiveTags.has(tag) || !!role || el.onclick != null;
    // —— @T3 字段约束语义（只读抽取） —— //
    const node = {
      tag: tag, role: role || undefined, text: text || undefined, name: name || undefined,
      type: type || undefined, placeholder: placeholder, selector: stableSelector(el), href: href || undefined,
      children: [], rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      interactive, isDataControl: isInput || isSubmit,
      ariaHasPopup: el.getAttribute('aria-haspopup') || undefined,
      safeReadOnlyOpener: el.hasAttribute('data-safe-opener') || el.hasAttribute('data-readonly-opener') || el.hasAttribute('data-safe-sample') || el.hasAttribute('data-readonly-sample') || undefined,
    };
    // 必填：required / aria-required / 标签含 * 或「必填」
    const reqAttr = el.getAttribute('required') !== null || (el.getAttribute('aria-required') || '').toLowerCase() === 'true';
    const labelText = (() => { const l = el.closest('label'); return l ? l.textContent || '' : (el.getAttribute('aria-label') || el.getAttribute('title') || ''); })();
    const required = reqAttr || /[*\u2731]/.test(labelText) || /必填|必选/.test(labelText);
    if (required) node.required = true;
    const ro = el.getAttribute('readonly') !== null; if (ro) node.readonly = true;
    const dis = el.getAttribute('disabled') !== null; if (dis) node.disabled = true;
    const ml = el.getAttribute('minlength'); if (ml) node.minLength = parseInt(ml, 10);
    const xl = el.getAttribute('maxlength'); if (xl) node.maxLength = parseInt(xl, 10);
    const mn = el.getAttribute('min'); if (mn && !isNaN(Number(mn))) node.minimum = Number(mn);
    const mx = el.getAttribute('max'); if (mx && !isNaN(Number(mx))) node.maximum = Number(mx);
    const pat = el.getAttribute('pattern'); if (pat) node.pattern = pat;
    const mult = el.getAttribute('multiple') !== null; if (mult) node.multiple = true;
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      node.checked = !!el.checked;
    }
    // 枚举可选项（select / radio / checkbox-group）
    if (tag === 'SELECT') {
      const opts = Array.from(el.options || []).map((o) => (o.textContent || '').trim()).filter(Boolean);
      if (opts.length) node.options = opts;
    } else if (type === 'radio' || type === 'checkbox') {
      // 同 name 的 radio/checkbox 视为一组枚举
      const grp = el.getAttribute('name');
      if (grp) {
        const sibs = Array.from(el.form ? el.form.querySelectorAll('input[name="' + grp + '"]') : []).map((s) => (s.getAttribute('value') || s.getAttribute('aria-label') || s.getAttribute('title') || s.textContent || '').trim()).filter(Boolean);
        if (sibs.length) node.options = sibs;
      }
    }
    // 表格 / 分页 / 排序 / 筛选语义
    if (tag === 'TABLE') {
      const headCells = Array.from(el.querySelectorAll('th')).map((th) => (th.textContent || '').trim()).filter(Boolean);
      node.columns = headCells;
      const bodyRows = el.querySelectorAll('tbody tr');
      node.rowCount = bodyRows.length;
      const paginationEl = el.closest('[class*="pagination"], [class*="page"], [class*="Pagination"]') || el.parentElement && el.parentElement.querySelector('[class*="pagination"], [class*="page"]');
      if (paginationEl) {
        node.hasPagination = true;
        node.paginationInfo = (paginationEl.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
      }
      const sortableHeaders = el.querySelectorAll('[class*="sort"], [aria-sort], th[sortable], [class*="is-sortable"]');
      if (sortableHeaders.length) {
        node.hasSorting = true;
        node.sortableColumns = Array.from(sortableHeaders).map((h) => (h.textContent || '').trim()).filter(Boolean);
      }
    }
    const className = (el.getAttribute('class') || '').toLowerCase();
    const containers = [];
    const uncovered = [];
    const expanded = el.getAttribute('aria-expanded');
    const addContainer = (kind, extra) => containers.push({ kind, ref: node.selector, selector: node.selector, label: name || text || undefined, ...(expanded === null ? {} : { expanded: expanded === 'true' }), ...extra });
    if (role === 'tab' || /(^|[\\s_-])tabs?([\\s_-]|$)/.test(className)) addContainer('tab', {});
    if (role === 'dialog' || /(^|[\\s_-])dialog([\\s_-]|$)/.test(className)) addContainer('dialog', {});
    if (/drawer/.test(className)) addContainer('drawer', {});
    if (tag === 'DETAILS' || /accordion|collapse/.test(className)) addContainer('collapse', {});
    const isVirtualList = /virtual[-_ ]?list|react-window|vue-virtual|virtualized/.test(className);
    if (isVirtualList) {
      node.isVirtualList = true;
      node.columns = Array.from(el.querySelectorAll('[role="columnheader"], th')).map((h) => (h.textContent || '').trim()).filter(Boolean);
      node.rowCount = el.querySelectorAll('[role="row"], li, [data-index]').length;
      node.hasPagination = false;
      node.hasSorting = false;
      node.hasFilter = false;
      addContainer('virtual_list', {});
    }
    if (tag === 'IFRAME') {
      const src = el.getAttribute('src') || '';
      let crossOrigin = false;
      try { crossOrigin = !!src && new URL(src, document.baseURI).origin !== window.location.origin; } catch (e) { crossOrigin = true; }
      addContainer('iframe', { crossOrigin });
      if (crossOrigin) uncovered.push({ kind: 'cross_origin_iframe', reason: '跨域 iframe 不可读' });
    }
    if (el.shadowRoot) addContainer('shadow', { shadowDom: 'open' });
    if (el.getAttribute('data-shadow-dom') === 'closed') {
      addContainer('shadow', { shadowDom: 'closed' });
      uncovered.push({ kind: 'closed_shadow_dom', reason: 'closed Shadow DOM 不可读' });
    }
    if (tag === 'CANVAS') uncovered.push({ kind: 'canvas', reason: 'Canvas 像素语义不可读' });
    if (containers.length) node.containers = containers;
    if (uncovered.length) node.uncovered = uncovered;
    // 筛选区识别（含筛选/查询按钮或 filter 容器）
    const isFilterArea = /筛选|查询|搜索|filter/i.test(text) || el.getAttribute('class') && /filter|search|query/i.test(el.getAttribute('class') || '');
    if (isFilterArea && (el.querySelector('input, select') || /筛选|查询/.test(text))) {
      node.hasFilter = true;
      const ff = Array.from(el.querySelectorAll('input, select')).map((f) => (f.getAttribute('name') || f.getAttribute('placeholder') || f.getAttribute('aria-label') || '')).filter(Boolean);
      if (ff.length) node.filterFields = ff;
    }
    const childElements = Array.from(el.children);
    if (tag === 'IFRAME' && !node.uncovered?.some((item) => item.kind === 'cross_origin_iframe')) {
      try { childElements.push(...Array.from(el.contentDocument?.body?.children || [])); } catch (e) { uncovered.push({ kind: 'cross_origin_iframe', reason: '同源 iframe 读取失败，需人工复核' }); }
    }
    if (el.shadowRoot) childElements.push(...Array.from(el.shadowRoot.children));
    for (const child of childElements) {
      if (child.nodeType === 1 && isVisible(child)) {
        const cn = toNode(child);
        if (cn.interactive || containerTags.has(cn.tag) || cn.children.length || cn.containers?.length || cn.uncovered?.length) node.children.push(cn);
      }
    }
    return node;
  }
  function extractNavModules(el) {
    const modules = [];
    const seenContainers = new Set();
    // Find nav/menu containers
    const navContainers = [];
    if (hasNavRole(el) && isVisible(el)) navContainers.push(el);
    // Check descendants
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function(node) {
        if (node.nodeType === 1 && hasNavRole(node) && isVisible(node)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    let n;
    while ((n = walker.nextNode())) navContainers.push(n);
    // Also check entire document for teleport/portal nav elements
    if (root === document.body) {
      const docWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode: function(node) {
          if (node.nodeType === 1 && node !== root && hasNavRole(node) && isVisible(node)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      });
      let dn;
      while ((dn = docWalker.nextNode()) && navContainers.length < 30) navContainers.push(dn);
    }
    // Deduplicate nested containers
    const uniqueContainers = [];
    for (const cont of navContainers) {
      const key = stableSelector(cont);
      if (!seenContainers.has(key)) {
        let isNested = false;
        for (const existing of uniqueContainers) {
          if (existing.contains(cont)) { isNested = true; break; }
        }
        if (!isNested) {
          seenContainers.add(key);
          uniqueContainers.push(cont);
        }
      }
    }
    // Process each nav container
    for (const nav of uniqueContainers) {
      // Broad selector set for menu items
      const items = nav.querySelectorAll('li, a, [role="menuitem"], .menu-item, .nav-item, .sidebar-item, .el-menu-item, .ant-menu-item, [class*="menu-item"], [class*="nav-item"], [class*="sidebar-item"]');
      const seen = new Set();
      for (const item of items) {
        if (!isVisible(item)) continue;
        const key = (item.textContent || '').trim().toLowerCase();
        if (!key || seen.has(key) || key.length > 30) continue;
        seen.add(key);
        const text = (item.textContent || '').trim().slice(0, 100);
        const link = item.querySelector('a[href]') || (item.tagName === 'A' ? item : null);
        const node = {
          tag: item.tagName,
          text: text,
          name: text,
          selector: stableSelector(item),
          href: link ? link.getAttribute('href') || undefined : undefined,
          role: 'menuitem',
          interactive: true,
          children: [],
          rect: { x: 0, y: 0, w: 0, h: 0 },
        };
        // Check for sub-items with broader selectors
        const subItems = item.querySelectorAll(':scope > ul > li, :scope > .sub-menu > li, :scope > [class*="sub"] > li, :scope > .el-menu-item-group > .el-menu-item, :scope > .ant-menu-submenu > .ant-menu-item');
        if (subItems.length > 0) {
          for (const sub of subItems) {
            if (!isVisible(sub)) continue;
            const subText = (sub.textContent || '').trim().slice(0, 100);
            if (subText && subText !== text) {
              node.children.push({
                tag: sub.tagName,
                text: subText,
                name: subText,
                selector: stableSelector(sub),
                href: undefined,
                role: 'menuitem',
                interactive: true,
                children: [],
                rect: { x: 0, y: 0, w: 0, h: 0 },
              });
            }
          }
        }
        modules.push(node);
      }
      // If no items found with li/a selectors, try direct text children
      if (modules.length === 0) {
        const directChildren = nav.children;
        for (const child of directChildren) {
          if (child.nodeType === 1 && isVisible(child)) {
            const childText = (child.textContent || '').trim().slice(0, 100);
            if (childText && childText.length < 30 && child.children.length <= 3) {
              modules.push({
                tag: child.tagName,
                text: childText,
                name: childText,
                selector: stableSelector(child),
                href: undefined,
                role: 'menuitem',
                interactive: true,
                children: [],
                rect: { x: 0, y: 0, w: 0, h: 0 },
              });
            }
          }
        }
      }
    }
    return modules;
  }
  const rootEl = root || document.body;
  // Strategy 1: Extract navigation menu items as root modules
  const navModules = extractNavModules(rootEl);
  if (navModules.length > 0) {
    const contentModules = [];
    const mainContent = rootEl.querySelector('main, .content, .main, #main, [class*="content"], [class*="main"], #app, #root, .app-main, .layout-content, .el-main, .ant-layout-content');
    if (mainContent && isVisible(mainContent)) {
      const mc = toNode(mainContent);
      if (mc.children.length > 0 || mc.interactive) contentModules.push(mc);
    }
    // Also include top-level non-nav container children from rootEl (e.g. #app, .app-wrapper, section) so all form controls/buttons are retained
    for (const child of rootEl.children) {
      if (child.nodeType === 1 && isVisible(child) && !hasNavRole(child)) {
        const cn = toNode(child);
        if (cn.children.length > 0 || cn.interactive || cn.isDataControl || containerTags.has(cn.tag)) {
          if (!contentModules.some((existing) => existing.selector === cn.selector)) {
            contentModules.push(cn);
          }
        }
      }
    }
    const forms = rootEl.querySelectorAll('form');
    for (const form of forms) {
      if (!isVisible(form)) continue;
      const fn = toNode(form);
      if (fn.children.length > 0 || fn.isDataControl) {
        if (!contentModules.some((existing) => existing.selector === fn.selector)) {
          contentModules.push(fn);
        }
      }
    }
    return [...navModules, ...contentModules];
  }
  // Strategy 2: Broader nav detection across entire document
  const allNavs = document.querySelectorAll('nav, [role="navigation"], [role="menubar"], [class*="sidebar"], [class*="menu"]');
  const fallbackModules = [];
  const fbSeen = new Set();
  for (const nav of allNavs) {
    if (!isVisible(nav)) continue;
    const items = nav.querySelectorAll('li, a, [role="menuitem"]');
    for (const item of items) {
      if (!isVisible(item)) continue;
      const text = (item.textContent || '').trim().slice(0, 100);
      const key = text.toLowerCase();
      if (!text || text.length > 30 || fbSeen.has(key)) continue;
      fbSeen.add(key);
      fallbackModules.push({
        tag: item.tagName,
        text: text,
        name: text,
        selector: stableSelector(item),
        href: item.tagName === 'A' ? item.getAttribute('href') || undefined : undefined,
        role: 'menuitem',
        interactive: true,
        children: [],
        rect: { x: 0, y: 0, w: 0, h: 0 },
      });
    }
  }
  if (fallbackModules.length > 0) return fallbackModules;
  // Strategy 3: Final fallback - return top-level containers from body
  if (rootEl && rootEl.children.length > 0) {
    const roots = [];
    for (const child of rootEl.children) {
      if (child.nodeType === 1 && isVisible(child)) {
        const cn = toNode(child);
        if (cn.children.length > 0 || cn.interactive || containerTags.has(cn.tag) || cn.containers?.length || cn.uncovered?.length || cn.isVirtualList) {
          roots.push(cn);
        }
      }
    }
    if (roots.length > 0) return roots;
  }
  return [];
})`;

/**
 * 递归把整棵模块树标记为 needs_review，并写入原因。
 * 用于「探索退化」场景：产出仍返回（便于人工审核补充），但绝不以 covered 伪装成功。
 * 契约兼容：仅使用 ModuleNode 既有字段 status / reviewReason，不新增契约字段。
 */
export function markTreeNeedsReview(nodes: ModuleNode[], reason: string): ModuleNode[] {
  for (const n of nodes) {
    n.status = 'needs_review';
    n.reviewReason = reason;
    if (n.children.length > 0) markTreeNeedsReview(n.children, reason);
  }
  return nodes;
}

export class PlaywrightEngine implements CaptureEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  /** 证据点击使用的临时隔离上下文；客户端写入只发生在这里，恢复 base 时整体丢弃。 */
  private readOnlyContext: BrowserContext | null = null;
  private readOnlyPage: Page | null = null;
  private readonly config: EngineConfig;
  private navigationPath: string[] = [];
  /** 所有已打开的页面（含用户点击门户业务系统后自动弹出的新标签页），最新活动页优先 */
  private pages: Page[] = [];
  /** 最近一次活跃的页面（新标签页出现或页面被点击后更新） */
  private activePage: Page | null = null;
  /**
   * 上一次 exploreModules 是否退化为「单页静态 DOM 兜底」。
   * 供 stage-explore 的粒度闸门读取：true 表示本次产出只有目录级颗粒度，不可当成成功探索。
   */
  lastExploreDegraded = false;

  constructor(config: EngineConfig) {
    this.config = config;
  }

  async launch(): Promise<void> {
    this.navigationPath = [];
    const cdpUrl = this.config.cdpUrl || process.env.TEST_PLATFORM_CDP_URL;
    if (cdpUrl) {
      // 连接已运行浏览器（agent-browser / 用户 Chrome）：复用其已登录会话。
      // 登录/探索直接在该浏览器上进行，免验证码、免 pwMCP 独立开窗（换方式打开系统）。
      console.log(`[engine-mcp] connecting to existing browser via CDP ${cdpUrl}`);
      this.browser = await chromium.connectOverCDP(cdpUrl);
    } else {
      let headlessMode = this.config.headless;
      // 在没有 X11 / $DISPLAY 的 Linux 容器环境下，有头模式无法创建窗口，自动降级为 headless: true
      if (headlessMode === false && process.platform === 'linux' && !process.env.DISPLAY) {
        console.warn('[engine-mcp] Linux 环境未检测到 XServer / $DISPLAY，自动降级为无头模式 (headless: true)');
        headlessMode = true;
      }
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        ...(this.config.manualTakeover ? ['--remote-debugging-port=0'] : []),
      ];
      let execPath = this.config.executablePath;
      if (!execPath && process.platform === 'linux') {
        const candidatePaths = [
          '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
          '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ];
        try {
          const fs = await import('fs');
          for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
              execPath = p;
              break;
            }
          }
        } catch {
          // ignore
        }
      }

      try {
        this.browser = await chromium.launch({
          headless: headlessMode,
          executablePath: execPath,
          args: launchArgs,
        });
      } catch (err: any) {
        // 若依然因缺失 XServer / DISPLAY 或无头 shell 路径启动失败，自动重试并尝试其他已知路径
        if (headlessMode === false || /XServer|DISPLAY|ozone|headless: true|Executable doesn't exist/i.test(err?.message || '')) {
          console.warn(`[engine-mcp] 浏览器初次启动异常 (${err?.message || err})，尝试无头模式/备用可执行路径重试...`);
          try {
            this.browser = await chromium.launch({
              headless: true,
              executablePath: execPath,
              args: launchArgs,
            });
          } catch (retryErr: any) {
            // 如果指定了 execPath 依然报错，尝试不带 execPath
            this.browser = await chromium.launch({
              headless: true,
              args: launchArgs,
            });
          }
        } else {
          throw err;
        }
      }
    }

    const contextOptions: {
      viewport: { width: number; height: number };
      ignoreHTTPSErrors: boolean;
      storageState?: PlaywrightStorageState | string;
    } = {
      viewport: this.config.viewport ?? { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
    };

    if (this.config.storageState) {
      contextOptions.storageState = this.config.storageState;
    }

    // 连接模式：优先复用浏览器已有 context（保留其登录会话与已开页面），否则新建
    if (cdpUrl) {
      const existing = this.browser.contexts().find((c) => c.pages().length > 0);
      this.context = existing ?? (await this.browser.newContext(contextOptions));
    } else {
      this.context = await this.browser.newContext(contextOptions);
    }
    try {
      await this.context.addInitScript(`
        var __name = function(target, value) {
          try { return Object.defineProperty(target, 'name', { value: value, configurable: true }); } catch (e) { return target; }
        };
        if (typeof window !== 'undefined') {
          window.__name = __name;
        }
        if (typeof globalThis !== 'undefined') {
          globalThis.__name = __name;
        }
      `);
    } catch {
      // ignore
    }
    // 追踪新标签页（如门户「业务系统」点击后弹出的子系统页）：后续 getCurrentUrl /
    // 会话捕获 / 探索必须落在最新活动页，否则 capturedUrl 永远停在门户工作台。
    this.context.on('page', (p) => {
      if (!this.pages.includes(p)) this.pages.push(p);
      this.activePage = p;
      p.bringToFront().catch(() => {});
      p.on('close', () => {
        this.pages = this.pages.filter((x) => x !== p);
        if (this.activePage === p) this.activePage = this.pages[this.pages.length - 1] ?? null;
      });
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeoutMs ?? 30000);
    this.pages = [this.page];
    this.activePage = this.page;
  }

  /** 最新活动页：新标签页优先（用户手动跳转/门户业务系统弹窗），否则回退主页面 */
  private currentPage(): Page {
    try {
      if (this.readOnlyPage && !this.readOnlyPage.isClosed()) return this.readOnlyPage;
    } catch { /* fallthrough */ }
    // 优先最近活动页；mock 场景（测试注入对象字面量）无 isClosed，用 try 兜底
    try {
      if (this.activePage && !(this.activePage as any).isClosed?.()) return this.activePage;
    } catch { /* fallthrough */ }
    try {
      if (this.page && !(this.page as any).isClosed?.()) return this.page;
    } catch { /* fallthrough */ }
    const alive = this.pages.filter((p) => {
      try { return !(p as any).isClosed?.(); } catch { return true; }
    });
    if (alive.length > 0) return alive[alive.length - 1];
    // 测试场景：直接注入 engine.page 对象字面量（未走 launch，pages 为空）→ 回退 this.page
    if (this.page) return this.page;
    throw new Error('engine not launched');
  }

  private async createReadOnlySandbox(sourcePage: Page): Promise<Page> {
    if (!this.browser) throw new Error('engine not launched');
    await this.discardReadOnlySandbox();
    const sourceContext = sourcePage.context();
    const storageState = await sourceContext.storageState();
    const html = await sourcePage.content();
    const sourceUrl = sourcePage.url();
    const sessionStorage = await sourcePage.evaluate(`(() => {
      var out = {};
      var ss = window.sessionStorage;
      if (ss) {
        for (var i = 0; i < ss.length; i++) {
          var key = ss.key(i);
          if (key) out[key] = ss.getItem(key) || '';
        }
      }
      return out;
    })()`).catch(() => ({} as Record<string, string>));
    const context = await this.browser.newContext({
      viewport: this.config.viewport ?? { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
      storageState,
    });
    try {
      await context.addInitScript(`
        if (typeof window !== 'undefined' && typeof window.__name === 'undefined') {
          window.__name = function(target, value) {
            try { return Object.defineProperty(target, 'name', { value: value, configurable: true }); } catch (e) { return target; }
          };
        }
        if (typeof globalThis !== 'undefined' && typeof globalThis.__name === 'undefined') {
          globalThis.__name = function(target, value) {
            try { return Object.defineProperty(target, 'name', { value: value, configurable: true }); } catch (e) { return target; }
          };
        }
      `);
      const sandbox = await context.newPage();
      sandbox.setDefaultTimeout(this.config.timeoutMs ?? 30_000);
      await sandbox.addInitScript(`((entries) => {
        for (var key in entries) {
          if (Object.prototype.hasOwnProperty.call(entries, key)) {
            window.sessionStorage.setItem(key, entries[key]);
          }
        }
      })(${JSON.stringify(sessionStorage)})`);
      if (/^https?:\/\//i.test(sourceUrl)) {
        const initialUrl = sourceUrl.replace(/#.*$/, '');
        const initialize = async (routeValue: Route): Promise<void> => {
          const request = routeValue.request();
          if (request.method() === 'GET' && request.isNavigationRequest() && request.resourceType() === 'document' && request.url().replace(/#.*$/, '') === initialUrl) {
            await routeValue.fulfill({ body: html, contentType: 'text/html' });
            return;
          }
          await routeValue.abort('blockedbyclient');
        };
        await context.route('**/*', initialize);
        try {
          await sandbox.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
        } finally {
          await context.unroute('**/*', initialize);
        }
      } else {
        await sandbox.setContent(html, { waitUntil: 'domcontentloaded' });
      }
      this.readOnlyContext = context;
      this.readOnlyPage = sandbox;
      return sandbox;
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }

  private async discardReadOnlySandbox(): Promise<void> {
    const context = this.readOnlyContext;
    this.readOnlyContext = null;
    this.readOnlyPage = null;
    await context?.close().catch(() => {});
  }

  async navigate(url: string): Promise<void> {
    await this.discardReadOnlySandbox();
    const page = this.currentPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
    } catch {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      } catch {
        // Continue if page is partially loaded
      }
    }
    this.navigationPath.push(url);
    // Wait for SPA rendering: give JavaScript time to render navigation/menus
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Try waiting for common navigation elements to appear
    try {
      await page.waitForSelector(
        'nav, .sidebar, .menu, .el-menu, .ant-menu, [class*="sidebar"], [class*="menu"], [class*="nav"]',
        { timeout: 5000 }
      );
    } catch {
      // Navigation elements not found within timeout - continue anyway
    }
    // Try waiting for login form elements (for login pages)
    try {
      await page.waitForSelector(
        'input[type="password"], .login-form, .login-container, [class*="login"], [class*="Login"]',
        { timeout: 3000 }
      );
    } catch {
      // Login form not found - may already be logged in or non-login page
    }
    // Final safety wait: ensure SPA has rendered enough content
    try {
      await page.waitForFunction(`(() => {
        var root = document.querySelector('#app, #root, #__nuxt, #__next');
        if (!root) return document.body && document.body.children.length > 0;
        return root.children.length > 0 || (document.body && document.body.textContent && document.body.textContent.trim().length > 10);
      })()`, { timeout: 5000 });
    } catch {
      // Could not detect SPA rendering, continue anyway
    }
  }

  async extractSemanticDom(rootSelector?: string): Promise<SemanticNode[]> {
    const page = this.currentPage();
    const result = await page.evaluate(
      `(({ fn, selector }) => {
        var f = new Function('return (' + fn.trim() + ')')();
        var root = selector ? document.querySelector(selector) : null;
        return f(root);
      })(${JSON.stringify({ fn: DOM_WALK, selector: rootSelector ?? null })})`
    );
    return result as SemanticNode[];
  }

  async exploreModules(): Promise<ModuleNode[]> {
    const page = this.currentPage();
    const subsystemId = this.config.subsystemId ?? '';
    const systemId = this.config.systemId ?? subsystemId;
    this.lastExploreDegraded = false;
    let degradeReason = '菜单遍历返回空结果（未识别到导航菜单）';
    // 优先：结构化菜单遍历（一次性抽导航层级 + 逐叶子采功能点 + 全局去重）
    try {
      const menuTree = await exploreViaMenus(page, {
        subsystemId,
        systemId,
      });
      if (menuTree.length > 0) return menuTree;
    } catch (e) {
      degradeReason = `菜单遍历抛错: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[explore] exploreViaMenus 失败:', e);
    }
    // 退化路径：单页静态 DOM 提取。
    // 【禁止静默降级】此路径只能产出「容器=module / 可交互叶子=action」的单页浅层树，
    // 拿不到菜单层级、也不含逐叶子进页采集的操作级功能点 —— 正是「探索只抓父集目录」的现场。
    // 因此必须：①醒目告警 ②置退化标志供上层闸门读取 ③整树标 needs_review，绝不伪装成功。
    console.error(
      `[explore][DEGRADED] ${degradeReason} → 退化为单页 DOM 提取，颗粒度可能仅到目录级，结果已整体标记 needs_review`,
    );
    this.lastExploreDegraded = true;
    const dom = await this.extractSemanticDom();
    const nodes = this.domToModules(dom, null, 0, subsystemId);
    return markTreeNeedsReview(
      nodes,
      `菜单遍历失败（${degradeReason}），退化为单页 DOM 提取，颗粒度可能仅到目录级`,
    );
  }

  async extractPageElements(url?: string): Promise<ExploredElement[]> {
    if (url) {
      await this.navigate(url);
      const page = this.currentPage();
      await page?.waitForLoadState('networkidle').catch(() => {});
    }

    const dom = await this.extractSemanticDom();
    const elements: ExploredElement[] = [];

    const walkNodes = (nodes: SemanticNode[]) => {
      for (const node of nodes) {
        const tag = node.tag.toLowerCase();
        // 交互/表单控件、表格或语义容器 → 抽取为可消费元素。
        if (node.interactive || this.isFormNodeSafe(node) || tag === 'table' || node.isVirtualList || node.containers?.length || node.uncovered?.length) {
          elements.push(this.toExploredElement(node));
        }
        if (node.children.length > 0) {
          walkNodes(node.children);
        }
      }
    };
    walkNodes(dom);

    return elements;
  }

  private isFormNode(node: SemanticNode): boolean {
    const formTags = ['INPUT', 'SELECT', 'TEXTAREA', 'FORM'];
    return formTags.includes(node.tag);
  }

  /** 是否为表单控件节点（含 SELECT/TEXTAREA/FORM/INPUT） */
  private isFormNodeSafe(node: SemanticNode): boolean {
    return this.isFormNode(node);
  }

  private toExploredElement(node: SemanticNode): ExploredElement {
    const tag = node.tag.toLowerCase();
    const isFormControl = ['input', 'select', 'textarea', 'form'].includes(tag);
    const suggestedAction = this.inferAction(tag, node);

    const el: ExploredElement & { role?: string; ariaHasPopup?: string; safeReadOnlyOpener?: boolean } = {
      ref: node.selector,
      tag,
      text: node.text,
      selector: node.selector,
      interactive: node.interactive,
      label: node.name,
      inputType: node.type,
      href: node.href,
      isFormControl,
      suggestedAction,
      role: node.role,
      ariaHasPopup: node.ariaHasPopup,
      safeReadOnlyOpener: node.safeReadOnlyOpener,
    };
    // —— @T3 透传字段约束语义（只读抽取） —— //
    if (node.required !== undefined) el.required = node.required;
    if (node.minLength !== undefined) el.minLength = node.minLength;
    if (node.maxLength !== undefined) el.maxLength = node.maxLength;
    if (node.minimum !== undefined) el.minimum = node.minimum;
    if (node.maximum !== undefined) el.maximum = node.maximum;
    if (node.pattern !== undefined) el.pattern = node.pattern;
    if (node.options !== undefined) el.options = node.options;
    if (node.multiple !== undefined) el.multiple = node.multiple;
    if (node.readonly !== undefined) el.readonly = node.readonly;
    if (node.disabled !== undefined) el.disabled = node.disabled;
    if (node.checked !== undefined) el.checked = node.checked;
    // 表格与虚拟列表语义
    if ((tag === 'table' || node.isVirtualList) && (node.columns || node.hasPagination || node.hasSorting || node.hasFilter || node.isVirtualList)) {
      el.tableInfo = {
        columns: node.columns ?? [],
        rowCount: node.rowCount ?? 0,
        hasPagination: !!node.hasPagination,
        paginationInfo: node.paginationInfo,
        hasSorting: !!node.hasSorting,
        sortableColumns: node.sortableColumns,
        hasFilter: !!node.hasFilter,
        filterFields: node.filterFields,
        isVirtualList: node.isVirtualList,
      };
    }
    if (node.containers?.length) el.containers = node.containers;
    if (node.uncovered?.length) el.uncovered = node.uncovered;
    return el;
  }

  async runReadOnlyClick(selector: string, purpose: ReadOnlyClickPurpose): Promise<ReadOnlyClickResult> {
    let page = this.currentPage();
    const beforeUrl = page.url();
    let locator = page.locator(selector);
    let createdSandbox = false;
    try {
      const initialCount = await locator.count();
      if (initialCount === 0) {
        return { status: 'blocked', beforeUrl, reason: '未找到匹配的当前 DOM 节点' };
      }
      if (initialCount > 1) {
        // 存在多个匹配节点时，优先选取可见（visible）节点
        const visibleLocator = locator.locator('visible=true');
        const vCount = await visibleLocator.count();
        if (vCount >= 1) {
          locator = visibleLocator.first();
        } else {
          locator = locator.first();
        }
      }
      let semantics: {
        tag: string;
        role: string;
        type: string;
        text: string;
        className: string;
        href: string;
        hasPopup: string;
        safeOpener: boolean;
        safeSample: boolean;
        expanded: string | null;
        isSummary: boolean;
      } | null = null;

      try {
        semantics = await locator.evaluate((element: Element) => {
          var el = (element || document.body) as HTMLElement;
          var tag = el.tagName ? el.tagName.toLowerCase() : '';
          var role = (el.getAttribute('role') || '').toLowerCase();
          var type = (el.getAttribute('type') || '').toLowerCase();
          var text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim();
          var className = el.className ? el.className.toString().toLowerCase() : '';
          return {
            tag: tag,
            role: role,
            type: type,
            text: text,
            className: className,
            href: tag === 'a' ? (el.getAttribute('href') || '') : '',
            hasPopup: (el.getAttribute('aria-haspopup') || '').toLowerCase(),
            safeOpener: el.hasAttribute('data-safe-opener') || el.hasAttribute('data-readonly-opener'),
            safeSample: el.hasAttribute('data-safe-sample') || el.hasAttribute('data-readonly-sample'),
            expanded: el.getAttribute('aria-expanded'),
            isSummary: tag === 'summary',
          };
        });
      } catch (err: any) {
        return {
          status: 'blocked',
          beforeUrl,
          reason: `提取节点语义异常: ${err?.message || String(err)}`,
        };
      }

      if (!semantics) {
        return {
          status: 'blocked',
          beforeUrl,
          reason: '提取节点语义返回为空',
        };
      }
      const normalized = semantics.text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
      const dangerous = /提交|保存|删除|移除|导入|导出|发布|审批|同意|驳回|submit|save|delete|remove|import|export|publish|approve|reject/.test(normalized);
      const iconOnly = !semantics.text;
      const formControl = ['input', 'select', 'textarea', 'option'].includes(semantics.tag) || ['checkbox', 'radio', 'file', 'submit'].includes(semantics.type);
      const isSwitch = semantics.role === 'switch' || /switch|toggle/.test(semantics.className);
      const safeHref = (() => {
        if (!semantics.href) return false;
        try { const next = new URL(semantics.href, beforeUrl); return next.origin === new URL(beforeUrl).origin && !/delete|remove|destroy|submit|approve|reject|publish|import|export|reset|clear/i.test(`${next.pathname}${next.search}`); } catch { return false; }
      })();
      const allowedDocumentUrl = semantics.tag === 'a' && safeHref
        ? new URL(semantics.href, beforeUrl).href.replace(/#.*$/, '')
        : undefined;
      // 只读点击安全策略（页面可配置，engine config 注入）：
      //   strict    —— 仅放行 a[href] / aria-haspopup=dialog / data-safe-opener（默认）
      //   allow_all —— 放行所有非写操作按钮/链接（新增/详情/查询/修改等），
      //               但仍由上方 dangerous 拦截提交/保存/删除/导入/导出/审核等写操作，
      //               并由沙箱拦截一切非预置网络请求与下载（只读红线不变）。
      const clickPolicy = this.config.readOnlyClickPolicy ?? 'strict';
      const allowed = purpose === 'container'
        ? (semantics.role === 'tab' || semantics.isSummary || semantics.expanded !== null)
        : purpose === 'sample'
          ? semantics.safeSample
          : clickPolicy === 'allow_all'
            ? (['a', 'button'].includes(semantics.tag))
            : ((semantics.tag === 'a' && safeHref) || (['a', 'button'].includes(semantics.tag) && (semantics.hasPopup === 'dialog' || semantics.safeOpener)));
      if (dangerous || iconOnly || formControl || isSwitch || !allowed) {
        return { status: 'blocked', beforeUrl, reason: '目标节点不满足只读点击语义约束' };
      }

      if (page.context() === this.context) {
        page = await this.createReadOnlySandbox(page);
        createdSandbox = true;
        locator = page.locator(selector);
        const sCount = await locator.count();
        if (sCount === 0) {
          await this.discardReadOnlySandbox();
          return { status: 'blocked', beforeUrl, reason: '隔离上下文中未找到匹配的 DOM 节点' };
        }
        if (sCount > 1) {
          const visibleLocator = locator.locator('visible=true');
          const vCount = await visibleLocator.count();
          if (vCount >= 1) {
            locator = visibleLocator.first();
          } else {
            locator = locator.first();
          }
        }
      }

      let writeRequest: { method: string; url: string } | undefined;
      let downloaded = false;
      let allowExpectedNavigation = false;
      const onWebSocket = (socket: PlaywrightWebSocket): void => {
        writeRequest = { method: 'WebSocket', url: socket.url() };
      };
      const route = async (routeValue: Route): Promise<void> => {
        const request = routeValue.request();
        const method = request.method().toUpperCase();
        const isSafeReadMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);
        const allowedNavigation = allowExpectedNavigation
          && method === 'GET'
          && request.isNavigationRequest()
          && request.resourceType() === 'document'
          && request.url().replace(/#.*$/, '') === allowedDocumentUrl;
        // Non-navigation GET / HEAD / OPTIONS requests (SPA data fetching, assets, read-only APIs) are safe and permitted
        if (isSafeReadMethod && (!request.isNavigationRequest() || allowedNavigation)) {
          await routeValue.fallback();
          return;
        }
        writeRequest = { method, url: request.url() };
        await routeValue.abort('blockedbyclient');
      };
      const onDownload = (download: Download): void => {
        downloaded = true;
        void download.delete().catch(() => {});
      };
      let popupDetected = false;
      const popups = new Set<Page>();
      const onPopup = (popup: Page): void => {
        if (popup === page) return;
        popupDetected = true;
        popups.add(popup);
        popup.on('download', onDownload);
        void popup.close().catch(() => {});
      };
      const guardKey = `__testPlatformReadOnlyGuard_${randomUUID()}`;
      await page.evaluate(`((key) => {
        if (typeof globalThis.__name === 'undefined') {
          globalThis.__name = function(t, v) { try { return Object.defineProperty(t, 'name', { value: v, configurable: true }); } catch (e) { return t; } };
        }
        var snapshot = function(storage) {
          return Object.fromEntries(Array.from(
            { length: storage.length },
            function(_, index) {
              var itemKey = storage.key(index) || '';
              return [itemKey, storage.getItem(itemKey) || ''];
            }
          ).filter(function(entry) { return entry[0]; }));
        };
        var safeSnapshot = function(name) {
          try { return snapshot(globalThis[name]); } catch (e) { return undefined; }
        };
        var state = {
          writes: [],
          restores: [],
          storage: { local: safeSnapshot('localStorage'), session: safeSnapshot('sessionStorage') },
        };
        var rejectWrite = function(name) {
          return function() {
            state.writes.push(name);
            throw new Error('read-only interaction blocked ' + name);
          };
        };
        var wrap = function(target, name, label) {
          if (!target || typeof target[name] !== 'function') return;
          var original = target[name];
          target[name] = rejectWrite(label);
          state.restores.push(function() { target[name] = original; });
        };
        var wrapConstructor = function(target, name, label) {
          if (!target || typeof target[name] !== 'function') return;
          var original = target[name];
          target[name] = function() {
            state.writes.push(label);
            throw new Error('read-only interaction blocked ' + label);
          };
          state.restores.push(function() { target[name] = original; });
        };
        var wrapFetch = function() {
          if (!globalThis.fetch) return;
          var originalFetch = globalThis.fetch;
          globalThis.fetch = function(input, init) {
            var method = 'GET';
            if (init && init.method) {
              method = String(init.method).toUpperCase();
            } else if (input && typeof input === 'object' && 'method' in input && input.method) {
              method = String(input.method).toUpperCase();
            }
            if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
              state.writes.push('fetch(' + method + ')');
              throw new Error('read-only interaction blocked fetch(' + method + ')');
            }
            return originalFetch.apply(globalThis, arguments);
          };
          state.restores.push(function() { globalThis.fetch = originalFetch; });
        };
        var wrapXhr = function() {
          if (!globalThis.XMLHttpRequest || !globalThis.XMLHttpRequest.prototype) return;
          var originalOpen = globalThis.XMLHttpRequest.prototype.open;
          globalThis.XMLHttpRequest.prototype.open = function(method) {
            var m = String(method || 'GET').toUpperCase();
            if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
              state.writes.push('XMLHttpRequest.open(' + m + ')');
              throw new Error('read-only interaction blocked XMLHttpRequest.open(' + m + ')');
            }
            return originalOpen.apply(this, arguments);
          };
          state.restores.push(function() { globalThis.XMLHttpRequest.prototype.open = originalOpen; });
        };
        wrapFetch();
        wrapXhr();
        wrap(globalThis.Navigator && globalThis.Navigator.prototype, 'sendBeacon', 'navigator.sendBeacon');
        wrap(globalThis.HTMLFormElement && globalThis.HTMLFormElement.prototype, 'submit', 'HTMLFormElement.submit');
        wrap(globalThis.HTMLFormElement && globalThis.HTMLFormElement.prototype, 'requestSubmit', 'HTMLFormElement.requestSubmit');
        wrapConstructor(globalThis, 'WebSocket', 'WebSocket');
        wrapConstructor(globalThis, 'EventSource', 'EventSource');
        var preventAnchorNavigation = function(event) {
          if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault();
        };
        document.addEventListener('click', preventAnchorNavigation, true);
        state.restores.push(function() { document.removeEventListener('click', preventAnchorNavigation, true); });
        wrap(Storage.prototype, 'setItem', 'Storage.setItem');
        wrap(Storage.prototype, 'removeItem', 'Storage.removeItem');
        wrap(Storage.prototype, 'clear', 'Storage.clear');
        wrap(globalThis.IDBObjectStore && globalThis.IDBObjectStore.prototype, 'add', 'IndexedDB.add');
        wrap(globalThis.IDBObjectStore && globalThis.IDBObjectStore.prototype, 'put', 'IndexedDB.put');
        wrap(globalThis.IDBObjectStore && globalThis.IDBObjectStore.prototype, 'delete', 'IndexedDB.delete');
        wrap(globalThis.IDBObjectStore && globalThis.IDBObjectStore.prototype, 'clear', 'IndexedDB.clear');
        wrap(globalThis.IDBFactory && globalThis.IDBFactory.prototype, 'deleteDatabase', 'IndexedDB.deleteDatabase');
        wrap(globalThis, 'setTimeout', 'setTimeout');
        wrap(globalThis, 'setInterval', 'setInterval');
        wrap(globalThis, 'requestAnimationFrame', 'requestAnimationFrame');
        var cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (cookie && cookie.get && cookie.configurable !== false) {
          Object.defineProperty(document, 'cookie', {
            configurable: true,
            get: function() { return cookie.get.call(document); },
            set: rejectWrite('document.cookie'),
          });
          state.restores.push(function() { delete document.cookie; });
        }
        globalThis[key] = state;
      })(${JSON.stringify(guardKey)})`);
      const context = page.context();
      let cdp: CDPSession | undefined;
      const onWebSocketCreated = (event: { url: string }): void => {
        writeRequest = { method: 'WebSocket', url: event.url };
      };
      if (context) {
        await context.route('**/*', route);
        context.on('page', onPopup);
        cdp = await context.newCDPSession(page);
        cdp.on('Network.webSocketCreated', onWebSocketCreated);
        await cdp.send('Network.enable');
      } else {
        await page.route('**/*', route);
        page.on('popup', onPopup);
      }
      page.on('download', onDownload);
      page.on('websocket', onWebSocket);
      let clientWrites: string[] = [];
      let guardsRestored = false;
      const restoreClientGuards = async (): Promise<string[]> => page.evaluate<string[]>(`((key) => {
        if (typeof globalThis.__name === 'undefined') {
          globalThis.__name = function(t, v) { try { return Object.defineProperty(t, 'name', { value: v, configurable: true }); } catch (e) { return t; } };
        }
        var state = globalThis[key];
        if (!state) return [];
        var current = function(storage) {
          return Object.fromEntries(Array.from(
            { length: storage.length },
            function(_, index) {
              var itemKey = storage.key(index) || '';
              return [itemKey, storage.getItem(itemKey) || ''];
            }
          ).filter(function(entry) { return entry[0]; }));
        };
        var localChanged = state.storage && state.storage.local !== undefined && JSON.stringify(current(localStorage)) !== JSON.stringify(state.storage.local);
        var sessionChanged = state.storage && state.storage.session !== undefined && JSON.stringify(current(sessionStorage)) !== JSON.stringify(state.storage.session);
        if (localChanged) state.writes && state.writes.push('localStorage snapshot changed');
        if (sessionChanged) state.writes && state.writes.push('sessionStorage snapshot changed');
        for (var i = 0; i < (state.restores || []).length; i++) {
          try { state.restores[i](); } catch (e) {}
        }
        var restoreStorage = function(storage, values) {
          storage.clear();
          for (var itemKey in values) {
            if (Object.prototype.hasOwnProperty.call(values, itemKey)) {
              storage.setItem(itemKey, values[itemKey]);
            }
          }
        };
        if (state.storage && state.storage.local !== undefined) restoreStorage(localStorage, state.storage.local);
        if (state.storage && state.storage.session !== undefined) restoreStorage(sessionStorage, state.storage.session);
        delete globalThis[key];
        return state.writes || [];
      })(${JSON.stringify(guardKey)})`).catch(() => ['浏览器上下文已变化，无法确认客户端写入守卫恢复']);
      try {
        await locator.click({ timeout: this.config.timeoutMs ?? 30_000, noWaitAfter: true });
        await page.waitForTimeout(250);
        clientWrites = await restoreClientGuards();
        guardsRestored = true;
        if (!writeRequest && !downloaded && clientWrites.length === 0 && !popupDetected && allowedDocumentUrl) {
          await cdp?.send('Network.setBlockedURLs', { urls: [] });
          allowExpectedNavigation = true;
          let navigationError: unknown;
          await page.goto(allowedDocumentUrl, { waitUntil: 'domcontentloaded', timeout: this.config.timeoutMs ?? 30_000 }).catch((error: unknown) => {
            navigationError = error;
          });
          await page.waitForTimeout(100);
          if (navigationError && !downloaded) throw navigationError;
        }
      } finally {
        page.off('download', onDownload);
        page.off('websocket', onWebSocket);
        if (context) {
          context.off('page', onPopup);
          await context.unroute('**/*', route);
        } else {
          page.off('popup', onPopup);
          await page.unroute('**/*', route);
        }
        if (cdp) {
          cdp.off('Network.webSocketCreated', onWebSocketCreated);
          await cdp.send('Network.setBlockedURLs', { urls: [] }).catch(() => {});
          await cdp.detach().catch(() => {});
        }
        await Promise.all([...popups].map((popup) => popup.close().catch(() => {})));
        if (!guardsRestored) clientWrites = await restoreClientGuards();
      }
      const afterUrl = page.url();
      if (writeRequest || downloaded || clientWrites.length > 0 || popupDetected) {
        if (createdSandbox) await this.discardReadOnlySandbox();
        return { status: 'blocked', beforeUrl, afterUrl, reason: clientWrites.length > 0 ? `已阻断客户端写入: ${clientWrites.join(', ')}` : writeRequest ? `已在发送前拦截未授权 ${writeRequest.method} 请求` : downloaded ? '检测到下载并删除本地下载文件' : '检测到新弹窗，已关闭并停止采集', writeRequest, download: downloaded };
      }
      return { status: 'performed', beforeUrl, afterUrl };
    } catch (error) {
      const afterUrl = (() => { try { return page.url(); } catch { return undefined; } })();
      if (createdSandbox) await this.discardReadOnlySandbox();
      return { status: 'blocked', beforeUrl, afterUrl, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private inferAction(tag: string, node: SemanticNode): 'click' | 'fill' | 'select' | 'navigate' {
    if (!node.interactive) return 'navigate';
    if (tag === 'button') return 'click';
    if (tag === 'a') return 'navigate';
    if (tag === 'select') return 'select';
    if (tag === 'input' || tag === 'textarea' || tag === 'form') return 'fill';
    return 'click';
  }

  /** 语义节点 → 模块树：容器=module，可交互叶子=action/page */
  private domToModules(nodes: SemanticNode[], parentId: string | null, depth: number, subsystemId: string): ModuleNode[] {
    const out: ModuleNode[] = [];
    // 降级路径 url 兜底：单页 DOM 摊开的节点多无 href，若全部无 url 则 featurePaths 恒空、
    // 用例阶段拿不到任何定位 → 静默模板直出。故叶子无 href 时补当前页 URL，
    // 保证至少能定位到系统首页（配合用例阶段按功能点名称兜底）。
    const currentUrl = this.currentPage().url();
    for (const n of nodes) {
      const id = randomUUID();
      const isContainer = ['DIV', 'SECTION', 'ASIDE', 'NAV', 'UL', 'OL', 'LI', 'FORM', 'TABLE', 'HEADER', 'FOOTER', 'MAIN', 'ARTICLE'].includes(n.tag);
      const type: ModuleNode['type'] = n.interactive && !isContainer ? 'action' : n.children.length ? 'module' : 'page';
      const rawLabel = n.text || n.name || n.tag;
      const label = this.cleanLabel(rawLabel);
      const isLeaf = n.children.length === 0;
      out.push({
        id,
        label,
        parentId,
        subsystemId,
        type,
        status: 'covered',
        children: this.domToModules(n.children, id, depth + 1, subsystemId),
        // 无 href 的叶子补当前页 URL（若 href 为 javascript:; / # 等无效值也忽略，仅用真实地址）
        url: n.href && !/^(javascript:|#|void)/i.test(n.href) ? n.href : isLeaf && currentUrl ? currentUrl : undefined,
        depth,
        evidenceId: 'ev_dom',
      });
    }
    return out;
  }

  private cleanLabel(label: string): string {
    if (!label) return '未知模块';
    // Remove excessive whitespace and normalize
    let cleaned = label.replace(/\s+/g, ' ').trim();
    // Remove common noise patterns
    cleaned = cleaned.replace(/\s*[(（\[【][^)\]\）】]{0,80}[)）\]】]\s*/g, ' ');
    cleaned = cleaned.replace(/⌘.*?K/g, ''); // Remove keyboard shortcuts
    cleaned = cleaned.replace(/Ctrl/g, '');
    // Remove URLs and paths
    cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
    // Remove duplicate words (consecutive identical words)
    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');
    // Truncate to reasonable length
    if (cleaned.length > 50) {
      cleaned = cleaned.slice(0, 47).trim() + '...';
    }
    // Remove leading/trailing punctuation
    cleaned = cleaned.replace(/^[\s\-_:|>]+|[\s\-_:|<]+$/g, '');
    // If after cleaning it's empty, use tag name
    if (!cleaned.trim()) return '未知模块';
    return cleaned.trim();
  }

  async runStep(cmd: BrowserCommand): Promise<ExecutionStepResult> {
    const page = this.currentPage();
    if (this.config.readOnly && (cmd.kind === 'fill' || cmd.kind === 'select' || cmd.kind === 'press')) {
      return { step: cmd.kind, operation: JSON.stringify(cmd), expected: '', actual: '只读模式禁止写操作', result: 'skipped' };
    }
    try {
      switch (cmd.kind) {
        case 'navigate':
          await this.navigate(cmd.url);
          break;
        case 'click':
          await page.click(cmd.selector, { timeout: this.config.timeoutMs ?? 30000 });
          break;
        case 'fill':
          await page.fill(cmd.selector, cmd.value);
          break;
        case 'select':
          await page.selectOption(cmd.selector, cmd.value);
          break;
        case 'press':
          await page.press(cmd.selector, cmd.key);
          break;
        case 'wait':
          await page.waitForSelector(cmd.selector, { timeout: this.config.timeoutMs ?? 30000 });
          break;
        case 'screenshot':
          await page.screenshot({ path: cmd.path });
          break;
        case 'dom':
          await this.extractSemanticDom(cmd.selector);
          break;
      }
      return { step: cmd.kind, operation: JSON.stringify(cmd), expected: '', actual: 'ok', result: 'passed' };
    } catch (e) {
      return { step: cmd.kind, operation: JSON.stringify(cmd), expected: '', actual: String(e).slice(0, 200), result: 'failed' };
    }
  }

  /**
   * 解析用例操作文本为浏览器命令序列
   * 支持的操作模式：
   *   - "点击【XXX】" / "选择XXX" → click
   *   - "在XXX输入框录入'YYY'" / "录入YYY" → fill
   *   - "访问XXX" / "跳转到XXX" → navigate
   *   - "等待XXX" → wait
   *   - "按下Enter" / "按Enter键" → press
   *   - 多步操作用 "→" 或 "；" 分隔
   */
  static parseOperation(row: CaseRow): BrowserCommand[] {
    const op = (row.operation || '').trim();
    if (!op) return [];

    const segments = op.split(/[→；;\n]/).map((s) => s.trim()).filter(Boolean);
    const commands: BrowserCommand[] = [];

    for (const seg of segments) {
      const cmd = this.parseSegment(seg, row);
      if (cmd) commands.push(cmd);
    }

    return commands;
  }

  private static parseSegment(segment: string, _row: CaseRow): BrowserCommand | null {
    const s = segment.trim();

    // navigate: "访问URL" / "跳转URL" / "打开URL"
    const navMatch = s.match(/(?:访问|跳转|打开|进入)\s*([^\s]+)/);
    if (navMatch) {
      return { kind: 'navigate', url: navMatch[1] };
    }

    // fill: "在XXX输入YYY" / "录入YYY" / "输入YYY" / "填写YYY"
    // 策略：先定位动作动词的位置，再提取目标和值
    const actionVerbs = ['录入', '输入', '填写', '填入'];
    let actionIndex = -1;
    let matchedVerb = '';
    for (const verb of actionVerbs) {
      const idx = s.lastIndexOf(verb);
      if (idx > actionIndex) {
        actionIndex = idx;
        matchedVerb = verb;
      }
    }

    if (actionIndex >= 0) {
      const before = s.slice(0, actionIndex).trim();
      const after = s.slice(actionIndex + matchedVerb.length).trim();

      // 提取目标（"在【目标】" 或 "在目标"）
      let target = '';
      const targetMatch = before.match(/在[【[]?(\S+?)[】\]]?$/);
      if (targetMatch) {
        target = targetMatch[1];
      }

      // 提取值（引号包裹或直接值）
      const valueMatch = after.match(/^['"「『]?([^'""」』\s]+)/);
      const value = valueMatch ? valueMatch[1] : after;

      if (target) {
        return {
          kind: 'fill',
          selector: `input[name="${target}"], input[placeholder*="${target}"]`,
          value,
        };
      }
      return { kind: 'fill', selector: 'input, textarea', value };
    }

    // press: "按下XXX" / "按XXX键"
    const pressMatch = s.match(/(?:按下|按)\s*(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End)/i);
    if (pressMatch) {
      return { kind: 'press', selector: 'input, textarea', key: pressMatch[1] };
    }

    // wait: "等待XXX" / "等XXX加载"
    const waitMatch = s.match(/(?:等待|等)\s*(\S+)/);
    if (waitMatch) {
      return { kind: 'wait', selector: waitMatch[1] };
    }

    // click: "点击【XXX】" / "选择XXX" — 去掉包装括号
    const clickMatch = s.match(/(?:点击|选择|单击)\s*[【[]?(\S+?)[】\]]?(?:\s|$)/) || s.match(/(?:点击|选择|单击)\s*(\S+)/);
    if (clickMatch) {
      return { kind: 'click', selector: `text=${clickMatch[1]}` };
    }

    // 关键词隐式 click
    const keywordActions = ['新增', '保存', '删除', '提交', '查询', '搜索', '确定', '取消', '编辑', '修改', '导出', '导入', '打印'];
    for (const kw of keywordActions) {
      if (s.includes(kw)) {
        return { kind: 'click', selector: `text=${kw}` };
      }
    }

    // 默认：返回跳过命令（不抛错，标记为 skipped）
    return { kind: 'click', selector: `text=${s}` };
  }

  async runCase(row: CaseRow): Promise<ExecutionStepResult[]> {
    const commands = PlaywrightEngine.parseOperation(row);
    if (commands.length === 0) {
      return [{ step: row.step, operation: row.operation || row.content, expected: row.expected, actual: '无操作指令', result: 'skipped' }];
    }

    const results: ExecutionStepResult[] = [];
    const dom = await this.extractSemanticDom().catch(() => null);
    const flat = dom ? this.flatten(dom) : [];

    for (const cmd of commands) {
      const resolvedCmd = this.resolveSelector(cmd, flat);
      results.push(await this.runStep(resolvedCmd));
    }

    return results;
  }

  /** 将操作指令中的语义 selector 解析为实际 DOM selector */
  private resolveSelector(cmd: BrowserCommand, flat: SemanticNode[]): BrowserCommand {
    if (!('selector' in cmd)) return cmd;

    const sel = cmd.selector!;

    // text=XXX 模式：在语义树中查找匹配文本的节点
    if (sel.startsWith('text=')) {
      const targetText = sel.slice(5).toLowerCase();
      const match = flat.find((n) =>
        n.text && n.text.toLowerCase().includes(targetText) && (n.interactive || n.isDataControl)
      );
      if (match) {
        return { ...cmd, selector: match.selector };
      }
      // 兜底：查找所有匹配文本的节点
      const anyMatch = flat.find((n) => n.text && n.text.toLowerCase().includes(targetText));
      if (anyMatch) {
        return { ...cmd, selector: anyMatch.selector };
      }
    }

    return cmd;
  }

  private flatten(nodes: SemanticNode[]): SemanticNode[] {
    const out: SemanticNode[] = [];
    for (const n of nodes) {
      out.push(n);
      out.push(...this.flatten(n.children));
    }
    return out;
  }

  async screenshot(path: string): Promise<ScreenshotRef> {
    const page = this.currentPage();
    await page.screenshot({ path, fullPage: true });
    return { id: randomUUID(), fileName: basename(path), path };
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 提取当前会话 Cookie（name=value 形式），供登录后捕获与跨子系统复用 */
  async getSessionCookies(): Promise<string[]> {
    const page = this.currentPage();
    const cookies = await page.context().cookies();
    return cookies.map((c) => `${c.name}=${c.value}`);
  }

  /** 提取当前会话请求头（扫描文档内鉴权 meta 头，供复用） */
  async getSessionHeaders(): Promise<Record<string, string>> {
    const page = this.currentPage();
    return page.evaluate(`(() => {
      var g = globalThis;
      var out = {};
      var keys = ['Authorization', 'X-Token', 'X-Auth-Token', 'X-CSRF-Token'];
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var meta = g.document && g.document.querySelector ? g.document.querySelector('meta[name="' + key + '"]') : null;
        if (meta && meta.content) out[key] = meta.content;
      }
      return out;
    })()`);
  }

  /** 提取当前会话 Token（localStorage/sessionStorage），供复用 */
  async getSessionTokens(): Promise<string[]> {
    const page = this.currentPage();
    return page.evaluate(`(() => {
      var g = globalThis;
      var out = [];
      try {
        if (g.localStorage) {
          for (var i = 0; i < g.localStorage.length; i++) {
            var k = g.localStorage.key(i);
            var v = g.localStorage.getItem(k);
            if (v && k) out.push('L|' + k + '=' + v);
          }
        }
      } catch (e) {}
      try {
        if (g.sessionStorage) {
          for (var i = 0; i < g.sessionStorage.length; i++) {
            var k = g.sessionStorage.key(i);
            var v = g.sessionStorage.getItem(k);
            if (v && k) out.push('S|' + k + '=' + v);
          }
        }
      } catch (e) {}
      return out;
    })()`);
  }

  /** 注入复用会话：将门户会话的 cookies/tokens 应用到当前上下文，实现跨子系统复用 */
  async applySession(state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }): Promise<void> {
    const page = this.currentPage();
    const currentUrl = page.url();
    // Playwright addCookies 要求合法 http(s) 页面上下文；about:blank 注入会抛异常
    if (!/^https?:\/\//i.test(currentUrl)) {
      throw new Error(`applySession 需先导航到 http(s) 页面（当前: ${currentUrl || 'about:blank'}）`);
    }
    const cookies = state.cookies.map((c) => {
      const idx = c.indexOf('=');
      const name = idx >= 0 ? c.slice(0, idx) : c;
      const value = idx >= 0 ? c.slice(idx + 1) : '';
      return { name, value, url: currentUrl };
    });
    if (cookies.length) await page.context().addCookies(cookies);
    if (state.tokens?.length) {
      const tokens = state.tokens;
      await page.evaluate(`((tkns) => {
        var g = globalThis;
        for (var i = 0; i < tkns.length; i++) {
          var t = tkns[i];
          var target = 'both';
          if (t.indexOf('L|') === 0) { target = 'local'; t = t.slice(2); }
          else if (t.indexOf('S|') === 0) { target = 'session'; t = t.slice(2); }
          var idx = t.indexOf('=');
          var k = idx >= 0 ? t.slice(0, idx) : t;
          var v = idx >= 0 ? t.slice(idx + 1) : '';
          try {
            if ((target === 'both' || target === 'local') && g.localStorage) g.localStorage.setItem(k, v);
            if ((target === 'both' || target === 'session') && g.sessionStorage) g.sessionStorage.setItem(k, v);
          } catch (e) {}
        }
      })(${JSON.stringify(tokens)})`);
    }
  }

  /** 获取当前页面 URL（实现 CaptureEngine 接口）：返回最新活动页（新标签页优先） */
  async getCurrentUrl(): Promise<string> {
    return this.currentPage().url();
  }

  /** 获取当前页面标题（实现 CaptureEngine 接口） */
  async getCurrentTitle(): Promise<string> {
    return this.currentPage().title();
  }

  /** 在页面上下文执行表达式（人工补录录制等场景使用） */
  async evaluate<T = any>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T> {
    const page = this.currentPage();
    const fnStr = typeof fn === 'function' ? fn.toString() : fn.trim();
    const wrapped = `((...callArgs) => {
      var __name = function(t, v) { try { return Object.defineProperty(t, 'name', { value: v, configurable: true }); } catch (e) { return t; } };
      if (typeof window !== 'undefined') { window.__name = __name; }
      if (typeof globalThis !== 'undefined') { globalThis.__name = __name; }
      var targetFn = (0, eval)(${JSON.stringify(fnStr)});
      if (typeof targetFn === 'function') {
        return targetFn(...callArgs);
      }
      return targetFn;
    })`;
    return page.evaluate<T, any[]>(wrapped, args);
  }

  /** 检查当前页面是否有登录表单（判断是否需要登录） */
  async hasLoginForm(): Promise<boolean> {
    const page = this.currentPage();
    return page.evaluate(`(() => {
      var g = globalThis;
      var selectors = [
        'input[type="password"]',
        '.login-form',
        '.login-container',
        '[class*="login"]',
        '[class*="Login"]',
        '#login-form',
        'form[action*="login"]',
      ];
      for (var i = 0; i < selectors.length; i++) {
        try {
          if (g.document && g.document.querySelector(selectors[i])) return true;
        } catch (e) {}
      }
      var inputs = g.document ? Array.from(g.document.querySelectorAll('input')) : [];
      var hasUserField = false;
      var hasPasswordField = false;
      for (var j = 0; j < inputs.length; j++) {
        var input = inputs[j];
        var type = (input.type || '').toLowerCase();
        var name = (input.name || '').toLowerCase();
        var placeholder = (input.placeholder || '').toLowerCase();
        if (type === 'password') hasPasswordField = true;
        if (type === 'text' && (name.includes('user') || name.includes('account') || placeholder.includes('用户') || placeholder.includes('账号') || placeholder.includes('user'))) {
          hasUserField = true;
        }
      }
      return hasPasswordField || (hasUserField && hasPasswordField);
    })()`);
  }

  /** 导航到 URL 并确保会话有效：先检查已登录，再应用保存的会话 */
  async ensureSession(
    url: string,
    sessionState?: { cookies?: string[]; headers?: Record<string, string>; tokens?: string[] }
  ): Promise<{ loggedIn: boolean; method: 'reuse' | 'applied' | 'anonymous' }> {
    console.log(`[engine] ensureSession: 导航到 ${url}`);
    await this.navigate(url);

    // 1. 首先检查是否已经登录（页面没有登录表单 = 已登录）
    const hasForm = await this.hasLoginForm();
    if (!hasForm) {
      console.log('[engine] 会话复用成功：页面无登录表单，用户已登录');
      return { loggedIn: true, method: 'reuse' };
    }

    // 2. 页面有登录表单，尝试应用保存的会话
    if (sessionState?.cookies?.length || sessionState?.tokens?.length) {
      console.log(`[engine] 检测到登录表单，尝试应用保存的会话（${sessionState.cookies?.length ?? 0} cookies）`);
      try {
        await this.applySession({
          cookies: sessionState.cookies || [],
          headers: sessionState.headers || {},
          tokens: sessionState.tokens || [],
        });
        // 应用会话后重新导航以刷新页面状态
        await this.navigate(url);
        const stillHasForm = await this.hasLoginForm();
        if (!stillHasForm) {
          console.log('[engine] 会话应用成功：已应用保存的登录状态');
          return { loggedIn: true, method: 'applied' };
        }
        console.warn('[engine] 会话应用后仍显示登录表单，会话可能已过期');
      } catch (e) {
        console.warn('[engine] 会话应用失败:', e);
      }
    }

    // 3. 无法自动登录，需要人工介入
    console.warn('[engine] 无有效会话，用户需要手动登录');
    return { loggedIn: false, method: 'anonymous' };
  }

  /** 获取导航路径（实现 CaptureEngine 接口） */
  async getNavigationPath(): Promise<string[]> {
    return [...this.navigationPath];
  }

  async close(): Promise<void> {
    await this.discardReadOnlySandbox();
    await this.context?.close();
    this.context = null;
    await this.browser?.close();
    this.browser = null;
    this.page = null;
    this.pages = [];
    this.activePage = null;
  }

  /** 获取当前浏览器上下文的 Storage State（用于会话复用） */
  async getStorageState(): Promise<PlaywrightStorageState> {
    if (!this.context) {
      return { cookies: [], origins: [] };
    }
    return await this.context.storageState() as PlaywrightStorageState;
  }

  /** 抓取当前页面全部 localStorage + sessionStorage（任意 key），供跨重载会话保持 */
  async getAllStorageTokens(): Promise<Array<{ storage: 'local' | 'session'; name: string; value: string }>> {
    const page = this.currentPage();
    return page.evaluate(`(() => {
      var out = [];
      var ls = window.localStorage;
      if (ls) {
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (k != null) out.push({ storage: 'local', name: k, value: ls.getItem(k) || '' });
        }
      }
      var ss = window.sessionStorage;
      if (ss) {
        for (var j = 0; j < ss.length; j++) {
          var sk = ss.key(j);
          if (sk != null) out.push({ storage: 'session', name: sk, value: ss.getItem(sk) || '' });
        }
      }
      return out;
    })()`);
  }

  /**
   * 注册页面初始化脚本：在每次页面导航前注入，用于跨重载保持会话（含 sessionStorage 恢复）。
   * 注册于 context 级，对后续所有页面/重载生效；脚本在页面自身脚本之前运行。
   */
  async addInitScript(fn: (arg?: unknown) => void, arg?: unknown): Promise<void> {
    if (!this.context) throw new Error('engine not launched');
    await this.context.addInitScript(fn as any, arg as any);
  }
}
