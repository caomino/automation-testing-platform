/**
 * @file playwright-engine.ts
 * @description McpEngine 的 Playwright 实现（DOM 语义抽象 + 浏览器控制）
 * @frozen v1.0 — 接口冻结；DOM 提取逻辑可按 70 项矩阵持续增强，接口不变
 */
import { chromium, type Browser, type Page } from 'playwright';
import type { ModuleNode, CaseRow, ExecutionStepResult, ScreenshotRef } from '@test-platform/contracts';
import type { EngineConfig, McpEngine, SemanticNode, BrowserCommand } from './types';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

/** 浏览器内 DOM 遍历：返回语义节点树（JSON 可序列化） */
const DOM_WALK = `
(function walk(root) {
  const interactiveTags = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMIT']);
  const containerTags = new Set(['DIV','SECTION','ASIDE','NAV','UL','OL','LI','FORM','TABLE','HEADER','FOOTER','MAIN','ARTICLE']);
  function stableSelector(el) {
    if (el.id) return '#' + el.id;
    const dataAttrs = ['data-testid','data-id','data-key','name'];
    for (const a of dataAttrs) { const v = el.getAttribute(a); if (v) return el.tagName.toLowerCase() + '[' + a + '="' + v + '"]'; }
    // 位置路径兜底
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) { parts.unshift(n.tagName.toLowerCase()); n = n.parentElement; }
    return parts.join(' > ');
  }
  function toNode(el) {
    const tag = el.tagName; const role = el.getAttribute('aria-role') || el.getAttribute('role');
    const text = (el.textContent || '').trim().slice(0, 200);
    const type = el.getAttribute('type') || el.getAttribute('data-type') || undefined;
    const name = el.getAttribute('name') || el.getAttribute('aria-label') || el.getAttribute('title') || undefined;
    const href = tag === 'A' ? el.getAttribute('href') : undefined;
    const r = el.getBoundingClientRect();
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const isSubmit = (tag === 'BUTTON' && (type === 'submit' || /提交|保存|新增|删除|修改/.test(text))) || type === 'submit';
    const interactive = interactiveTags.has(tag) || !!role || el.onclick != null;
    const node = {
      tag: tag, role: role || undefined, text: text || undefined, name: name || undefined,
      type: type || undefined, selector: stableSelector(el), href: href || undefined,
      children: [], rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      interactive, isDataControl: isInput || isSubmit,
    };
    for (const child of el.children) {
      if (child.nodeType === 1) {
        const cn = toNode(child);
        // 剪枝：跳过纯文本/无语义叶子，保留交互或容器
        if (cn.interactive || containerTags.has(cn.tag) || cn.children.length) node.children.push(cn);
      }
    }
    return node;
  }
  const roots = root ? [root] : [document.body];
  return roots.map(toNode);
})
`;

export class PlaywrightEngine implements McpEngine {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly config: EngineConfig;

  constructor(config: EngineConfig) {
    this.config = config;
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      executablePath: this.config.executablePath,
      args: this.config.manualTakeover ? ['--remote-debugging-port=0'] : [],
    });
    const context = await this.browser.newContext({
      viewport: this.config.viewport ?? { width: 1366, height: 768 },
    });
    this.page = await context.newPage();
    this.page.setDefaultTimeout(this.config.timeoutMs ?? 30000);
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('engine not launched');
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async extractSemanticDom(rootSelector?: string): Promise<SemanticNode[]> {
    if (!this.page) throw new Error('engine not launched');
    const root = rootSelector ? await this.page.$(rootSelector) : null;
    const result = await this.page.evaluate(
      ({ fn, hasRoot }) => {
        const f = new Function('return ' + fn)();
        return hasRoot ? f(root) : f(null);
      },
      { fn: DOM_WALK, hasRoot: !!root },
    );
    return result as SemanticNode[];
  }

  async exploreModules(): Promise<ModuleNode[]> {
    const dom = await this.extractSemanticDom();
    return this.domToModules(dom, null, 0);
  }

  /** 语义节点 → 模块树：容器=module，可交互叶子=action/page */
  private domToModules(nodes: SemanticNode[], parentId: string | null, depth: number): ModuleNode[] {
    const out: ModuleNode[] = [];
    for (const n of nodes) {
      const id = randomUUID();
      const isContainer = ['DIV', 'SECTION', 'ASIDE', 'NAV', 'UL', 'OL', 'LI', 'FORM', 'TABLE', 'HEADER', 'FOOTER', 'MAIN', 'ARTICLE'].includes(n.tag);
      const type: ModuleNode['type'] = n.interactive && !isContainer ? 'action' : n.children.length ? 'module' : 'page';
      const label = n.text || n.name || n.tag;
      out.push({
        id,
        label: label.slice(0, 60),
        parentId,
        subsystemId: '',
        type,
        status: 'covered',
        children: this.domToModules(n.children, id, depth + 1),
        url: n.href,
        depth,
        evidenceId: 'ev_dom',
      });
    }
    return out;
  }

  async runStep(cmd: BrowserCommand): Promise<ExecutionStepResult> {
    if (!this.page) throw new Error('engine not launched');
    if (this.config.readOnly && (cmd.kind === 'fill' || cmd.kind === 'select' || cmd.kind === 'press')) {
      return { step: cmd.kind, operation: JSON.stringify(cmd), expected: '', actual: '只读模式禁止写操作', result: 'skipped' };
    }
    try {
      switch (cmd.kind) {
        case 'navigate':
          await this.navigate(cmd.url);
          break;
        case 'click':
          await this.page.click(cmd.selector, { timeout: this.config.timeoutMs ?? 30000 });
          break;
        case 'fill':
          await this.page.fill(cmd.selector, cmd.value);
          break;
        case 'select':
          await this.page.selectOption(cmd.selector, cmd.value);
          break;
        case 'press':
          await this.page.press(cmd.selector, cmd.key);
          break;
        case 'wait':
          await this.page.waitForSelector(cmd.selector, { timeout: this.config.timeoutMs ?? 30000 });
          break;
        case 'screenshot':
          await this.page.screenshot({ path: cmd.path });
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

  async runCase(row: CaseRow): Promise<ExecutionStepResult[]> {
    // 基础启发式：操作文本命中语义节点则点击；含"输入"则填充
    const results: ExecutionStepResult[] = [];
    const dom = await this.extractSemanticDom();
    const flat = this.flatten(dom);
    const op = row.operation || row.content;
    const target = flat.find((n) => n.text && op.includes(n.text.slice(0, 4))) || flat.find((n) => n.interactive);
    if (target) {
      results.push(await this.runStep({ kind: 'click', selector: target.selector }));
    } else {
      results.push({ step: row.step, operation: op, expected: row.expected, actual: '未匹配语义节点', result: 'skipped' });
    }
    return results;
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
    if (!this.page) throw new Error('engine not launched');
    await this.page.screenshot({ path, fullPage: true });
    return { id: randomUUID(), fileName: basename(path), path };
  }

  /** 提取当前会话 Cookie（name=value 形式），供登录后捕获与跨子系统复用 */
  async getSessionCookies(): Promise<string[]> {
    if (!this.page) throw new Error('engine not launched');
    const cookies = await this.page.context().cookies();
    return cookies.map((c) => `${c.name}=${c.value}`);
  }

  /** 提取当前会话请求头（扫描文档内鉴权 meta 头，供复用） */
  async getSessionHeaders(): Promise<Record<string, string>> {
    if (!this.page) throw new Error('engine not launched');
    return this.page.evaluate(() => {
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
    if (!this.page) throw new Error('engine not launched');
    return this.page.evaluate(() => {
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
    if (!this.page) throw new Error('engine not launched');
    const page = this.page;
    const cookies = state.cookies.map((c) => {
      const idx = c.indexOf('=');
      const name = idx >= 0 ? c.slice(0, idx) : c;
      const value = idx >= 0 ? c.slice(idx + 1) : '';
      return { name, value, url: page.url() || 'about:blank' };
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

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }
}
