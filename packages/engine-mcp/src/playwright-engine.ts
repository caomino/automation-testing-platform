/**
 * @file playwright-engine.ts
 * @description McpEngine 的 Playwright 实现（DOM 语义抽象 + 浏览器控制）
 * @frozen v1.0 — 接口冻结；DOM 提取逻辑可按 70 项矩阵持续增强，接口不变
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ModuleNode, CaseRow, ExecutionStepResult, ScreenshotRef } from '@test-platform/contracts';
import type { EngineConfig, SemanticNode, BrowserCommand, CaptureEngine, ExploredElement, PlaywrightStorageState } from './types.js';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { exploreViaMenus } from './menu-explorer.js';

/** 浏览器内 DOM 遍历：返回语义节点树（JSON 可序列化）
 *  策略：识别导航容器（NAV/sidebar/menu）提取菜单项作为根模块，
 *  主内容区按容器分组，避免 BODY 单点导致模块树扁平。
 */
const DOM_WALK = `
(function walk(root) {
  const interactiveTags = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMIT']);
  const containerTags = new Set(['DIV','SECTION','ASIDE','NAV','UL','OL','LI','FORM','TABLE','HEADER','FOOTER','MAIN','ARTICLE']);
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
    const node = {
      tag: tag, role: role || undefined, text: text || undefined, name: name || undefined,
      type: type || undefined, placeholder: placeholder, selector: stableSelector(el), href: href || undefined,
      children: [], rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      interactive, isDataControl: isInput || isSubmit,
    };
    for (const child of el.children) {
      if (child.nodeType === 1 && isVisible(child)) {
        const cn = toNode(child);
        if (cn.interactive || containerTags.has(cn.tag) || cn.children.length) node.children.push(cn);
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
    const mainContent = rootEl.querySelector('main, .content, .main, #main, [class*="content"], [class*="main"]');
    if (mainContent && isVisible(mainContent)) {
      const mc = toNode(mainContent);
      if (mc.children.length > 0 || mc.interactive) contentModules.push(mc);
    }
    const forms = rootEl.querySelectorAll('form');
    for (const form of forms) {
      if (!isVisible(form)) continue;
      const fn = toNode(form);
      if (fn.children.length > 0 || fn.isDataControl) contentModules.push(fn);
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
        if (cn.children.length > 0 || cn.interactive || containerTags.has(cn.tag)) {
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
    this.browser = await chromium.launch({
      headless: this.config.headless,
      executablePath: this.config.executablePath,
      args: [
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        ...(this.config.manualTakeover ? ['--remote-debugging-port=0'] : []),
      ],
    });
    
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

    this.context = await this.browser.newContext(contextOptions);
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

  async navigate(url: string): Promise<void> {
    const page = this.currentPage();
    await page.goto(url, { waitUntil: 'load' });
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
      await page.waitForFunction(() => {
        const root = document.querySelector('#app, #root, #__nuxt, #__next');
        if (!root) return document.body && document.body.children.length > 0;
        // SPA root should have children (app mounted)
        return root.children.length > 0 || (document.body && document.body.textContent && document.body.textContent.trim().length > 10);
      }, { timeout: 5000 });
    } catch {
      // Could not detect SPA rendering, continue anyway
    }
  }

  async extractSemanticDom(rootSelector?: string): Promise<SemanticNode[]> {
    const page = this.currentPage();
    const result = await page.evaluate(
      ({ fn, selector }: { fn: string; selector: string | null }) => {
        const f = new Function('return (' + fn.trim() + ')')();
        const root = selector ? (globalThis as any).document.querySelector(selector) : null;
        return f(root);
      },
      { fn: DOM_WALK, selector: rootSelector ?? null },
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
        if (node.interactive || this.isFormNode(node)) {
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

  private toExploredElement(node: SemanticNode): ExploredElement {
    const tag = node.tag.toLowerCase();
    const isFormControl = ['input', 'select', 'textarea', 'form'].includes(tag);
    const suggestedAction = this.inferAction(tag, node);

    return {
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
    };
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
    return page.evaluate(() => {
      // engine-mcp 为 Node 包（tsconfig 不含 dom lib），浏览器全局经 globalThis 访问并显式收窄类型
      const g = globalThis as unknown as {
        document: { querySelector(sel: string): { content?: string } | null };
      };
      const out: Record<string, string> = {};
      for (const key of ['Authorization', 'X-Token', 'X-Auth-Token', 'X-CSRF-Token']) {
        const meta = g.document.querySelector(`meta[name="${key}"]`);
        if (meta?.content) out[key] = meta.content;
      }
      return out;
    });
  }

  /** 提取当前会话 Token（localStorage/sessionStorage），供复用 */
  async getSessionTokens(): Promise<string[]> {
    const page = this.currentPage();
    return page.evaluate(() => {
      const g = globalThis as unknown as {
        localStorage: { getItem(k: string): string | null };
        sessionStorage: { getItem(k: string): string | null };
      };
      const out: string[] = [];
      for (const key of ['token', 'accessToken', 'authToken', 'Authorization']) {
        const v = g.localStorage.getItem(key) || g.sessionStorage.getItem(key);
        if (v) out.push(`${key}=${v}`);
      }
      return out;
    });
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
      await page.evaluate((tkns: string[]) => {
        const g = globalThis as unknown as {
          localStorage: { setItem(k: string, v: string): void };
        };
        for (const t of tkns) {
          const idx = t.indexOf('=');
          const k = idx >= 0 ? t.slice(0, idx) : t;
          const v = idx >= 0 ? t.slice(idx + 1) : '';
          try {
            g.localStorage.setItem(k, v);
          } catch {
            // 忽略无 localStorage 的场景（如 about:blank）
          }
        }
      }, tokens);
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
    return this.currentPage().evaluate(fn as any, ...args);
  }

  /** 检查当前页面是否有登录表单（判断是否需要登录） */
  async hasLoginForm(): Promise<boolean> {
    const page = this.currentPage();
    return page.evaluate(() => {
      const g = globalThis as unknown as {
        document: Document;
      };
      const selectors = [
        'input[type="password"]',
        '.login-form',
        '.login-container',
        '[class*="login"]',
        '[class*="Login"]',
        '#login-form',
        'form[action*="login"]',
      ];
      for (const sel of selectors) {
        try {
          if (g.document.querySelector(sel)) return true;
        } catch {
          // 忽略无效选择器
        }
      }
      // 检查是否有用户名/密码输入框
      const inputs = Array.from(g.document.querySelectorAll('input'));
      let hasUserField = false;
      let hasPasswordField = false;
      for (const input of inputs) {
        const type = input.type.toLowerCase();
        const name = (input.name || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        if (type === 'password') hasPasswordField = true;
        if (type === 'text' && (name.includes('user') || name.includes('account') || placeholder.includes('用户') || placeholder.includes('账号') || placeholder.includes('user'))) {
          hasUserField = true;
        }
      }
      return hasPasswordField || (hasUserField && hasPasswordField);
    });
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
    return page.evaluate(() => {
      const out: Array<{ storage: 'local' | 'session'; name: string; value: string }> = [];
      const ls = window.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k != null) out.push({ storage: 'local', name: k, value: ls.getItem(k) ?? '' });
      }
      const ss = window.sessionStorage;
      for (let i = 0; i < ss.length; i++) {
        const k = ss.key(i);
        if (k != null) out.push({ storage: 'session', name: k, value: ss.getItem(k) ?? '' });
      }
      return out;
    });
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
