/**
 * @file mcp-adapter.ts
 * @description McpPlaywrightAdapter — 通过 @playwright/mcp 实现 McpEngine 接口
 * @frozen v1.0
 */
import type {
  McpEngine,
  EngineConfig,
  BrowserCommand,
  SemanticNode,
  McpToolName,
  McpToolCallParams,
  ExploredElement,
  PlaywrightStorageState,
  ReadOnlyClickPurpose,
  ReadOnlyClickResult,
} from './types.js';
import { snapshotToSemanticNodes, parseSnapshotEntries } from './snapshot-converter.js';
import { semanticNodesToElements } from './semantic-elements.js';
import { buildNavHierarchy, toModuleNodes, dedupModuleTree, type RawNavItem } from './nav-tree.js';
import type { ModuleNode, CaseRow, ExecutionStepResult, ScreenshotRef } from '@test-platform/contracts';

interface McpClient {
  callTool(name: string, params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  close(): Promise<void>;
}

/** 从 browser_snapshot 文本按缩进重建导航层级（parentSelector 由缩进推导） */
function buildNavFromSnapshot(snapshot: string): RawNavItem[] {
  const NAV_TYPES = new Set(['link', 'a', 'button', 'menuitem', 'tab', 'treeitem']);
  const items: RawNavItem[] = [];
  const stack: Array<{ level: number; ref: string }> = [];

  for (const line of snapshot.split('\n')) {
    const indent = line.length - line.trimStart().length;
    const level = Math.floor(indent / 2);
    const refM = line.match(/\[ref=([^\]]+)\]/);
    if (!refM) continue;
    const ref = `[data-ref="${refM[1]}"]`;
    const textM = line.match(/"([^"]*)"|'([^']*)'/);
    const text = textM ? textM[1] || textM[2] || '' : '';
    const type = (line.trim().split(/\s+/)[0] || '').toLowerCase();
    if (text.length < 1 || text.length > 40) continue;
    if (!NAV_TYPES.has(type)) continue;

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].ref : null;
    stack.push({ level, ref });
    items.push({ selector: ref, text, href: undefined, expandable: false, parentSelector: parent });
  }

  const parentRefs = new Set(items.map((i) => i.parentSelector).filter(Boolean) as string[]);
  for (const it of items) if (parentRefs.has(it.selector)) it.expandable = true;
  return items;
}

export class McpPlaywrightAdapter implements McpEngine {
  private config: EngineConfig;
  private client: McpClient | null = null;
  private launched = false;
  private transportLabel = 'stdio';

  constructor(config: EngineConfig) {
    this.config = config;
  }

  async launch(): Promise<void> {
    if (this.launched) return;

    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- dynamic import of untyped/optional dep
      // @ts-ignore - types not available for dynamic import
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- dynamic import of untyped/optional dep
      // @ts-ignore - types not available for dynamic import
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- dynamic import of untyped/optional dep
      // @ts-ignore - types not available for dynamic import
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- dynamic import of untyped/optional dep
      // @ts-ignore - types not available for dynamic import
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');

      // 默认用本仓库已安装的 @playwright/mcp（node 直跑 cli.js）——
      // npx @playwright/mcp@latest 需联网解析包，离线/代理环境下会连接超时（真实事故）。
      let cliPath: string;
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - createRequire untyped in this context
        const { createRequire } = await import('node:module');
        // @playwright/mcp 的 exports 不导出 ./cli.js（ERR_PACKAGE_PATH_NOT_EXPORTED），
        // 故 resolve 包目录后拼接 —— 兜底字符串会让 node 找不到脚本、连接立即关闭（真实事故）
        const pkgJsonPath = createRequire(import.meta.url).resolve('@playwright/mcp/package.json');
        cliPath = pkgJsonPath.replace(/package\.json$/, 'cli.js');
      } catch {
        cliPath = '@playwright/mcp/cli.js';
      }
      const command = this.config.mcpCommand || process.execPath;
      // 浏览器可执行文件：@playwright/mcp 内置的 playwright-core 版本可能与本机已下载的
      // chromium revision 不一致（真实事故：mcp 要 chromium-1237 而本机是 1234 → launch
      // 静默失败 → 所有工具挂死）。用本包 playwright 解析出的可执行文件显式传给 mcp server。
      let browserArgs: string[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - dynamic import of bundled playwright-core
        const { chromium } = await import('playwright-core');
        const exe = chromium.executablePath() as string;
        if (exe && (await import('node:fs')).existsSync(exe)) browserArgs = ['--executable-path', exe];
      } catch { /* 无本地浏览器时交由 mcp 自行解析 */ }
      // cli.js 必须在首位（node 的脚本入口），其余为 MCP server 的 flags
      const args = [cliPath, ...browserArgs, ...(this.config.mcpArgs ?? [])];

      // transport 优先级（对齐 D://Test）：
      //   ① 长驻 HTTP 服务 http://localhost:8931/mcp（server 由 scripts/start-visible-playwright-mcp.mjs
      //      独立启动 —— stdio 模式在 Windows 有管道死锁：navigate 工具永久挂起，真实事故）
      //   ② /sse 回退（0.0.79 的 StreamableHTTP 实现与新版 SDK 存在 Parse error 兼容问题）
      //   ③ 服务不可达时自动拉起长驻服务（每轮 case 各自 spawn 浏览器会争抢同一持久 profile ——
      //      "Browser is already in use" 真实事故：引擎半死 → 只导航不点击、任务卡死）
      //   ④ stdio 最终兜底（脱机场景）
      const mcpHttpUrl = this.config.mcpHttpUrl ?? 'http://localhost:8931/mcp';
      const client = new Client(
        { name: 'test-platform-engine-mcp', version: '1.0.0' },
        { capabilities: {} },
      );

      let connected = false;
      const httpUrl = new URL(mcpHttpUrl);
      const sseUrl = new URL(mcpHttpUrl.replace(/\/mcp$/, '/sse'));
      connected = await this.tryConnectHttp(client, httpUrl, sseUrl);
      if (!connected && (await this.ensureHttpSidecarServer(mcpHttpUrl))) {
        // 服务拉起后重试 HTTP/SSE（全新 Client，断过的 transport 不可复用）
        const retryClient = new Client(
          { name: 'test-platform-engine-mcp', version: '1.0.0' },
          { capabilities: {} },
        );
        connected = await this.tryConnectHttp(retryClient as never, httpUrl, sseUrl);
        if (connected) {
          const retrySdk = retryClient as unknown as {
            callTool(req: { name: string; arguments?: Record<string, unknown> }, schema?: unknown, opts?: { timeout?: number }): Promise<{ content?: Array<{ type: string; text: string }>; isError?: boolean }>;
            close(): Promise<void>;
          };
          this.client = {
            callTool: (name, params) => retrySdk.callTool({ name, arguments: params }, undefined, { timeout: 90_000 }) as unknown as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>,
            close: () => retrySdk.close(),
          };
          this.launched = true;
          return;
        }
      }
      if (!connected) {
        // ④ stdio 最终兜底
        const transport = new StdioClientTransport({ command, args });
        await client.connect(transport);
        this.transportLabel = 'stdio';
      }
      // SDK 的 callTool 是单参对象签名 callTool({ name, arguments })；
      // 统一适配为两参形式（name, params），隔离上层调用差异。
      const sdk = client as unknown as {
        callTool(req: { name: string; arguments?: Record<string, unknown> }, schema?: unknown, opts?: { timeout?: number }): Promise<{ content?: Array<{ type: string; text: string }>; isError?: boolean }>;
        close(): Promise<void>;
      };
      this.client = {
        callTool: (name, params) => sdk.callTool({ name, arguments: params }, undefined, { timeout: 90_000 }) as unknown as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>,
        close: () => sdk.close(),
      };
      this.launched = true;
    } catch (err) {
      throw new Error(`[McpPlaywrightAdapter] launch failed: ${(err as Error).message}`);
    }
  }

  /** ①② HTTP/SSE 连接探测（以 listTools 探测真实可用性，connect 成功不代表工具可用 —— 真实事故） */
  private async tryConnectHttp(
    client: unknown,
    httpUrl: URL,
    sseUrl: URL,
  ): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- dynamic import of untyped/optional dep
    // @ts-ignore - types not available for dynamic import
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- dynamic import of untyped/optional dep
    // @ts-ignore - types not available for dynamic import
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const c = client as unknown as { connect(t: unknown): Promise<void>; listTools(): Promise<unknown>; close(): Promise<void> };
    for (const [label, make] of [
      ['streamable-http', (): unknown => new StreamableHTTPClientTransport(httpUrl)],
      ['sse', (): unknown => new SSEClientTransport(sseUrl)],
    ] as const) {
      const probe = c;
      try {
        await probe.connect(make() as never);
        await probe.listTools();
        this.transportLabel = label;
        return true;
      } catch {
        await probe.close().catch(() => {});
      }
    }
    return false;
  }

  /** ③ 自动拉起长驻 HTTP 侧车服务并等待就绪（最多 40s）；返回是否就绪 */
  private async ensureHttpSidecarServer(mcpHttpUrl: string): Promise<boolean> {
    try {
      const scriptPath = await this.resolveSidecarStartupScript();
      if (!scriptPath) return false;
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [scriptPath], {
        cwd: (await import('node:path')).dirname(scriptPath),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        env: process.env,
      });
      child.unref();
      // 就绪轮询：任何 HTTP 响应（含 4xx）都代表 server 已监听；连接被拒 = 未就绪
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          await fetch(mcpHttpUrl, { method: 'GET', signal: AbortSignal.timeout(1500) });
          return true;
        } catch { /* 未就绪，继续等 */ }
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 定位长驻服务启动脚本（仓库 scripts/，dist 与 src 目录深度一致：向上三级即仓库根） */
  private async resolveSidecarStartupScript(): Promise<string | null> {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const envPath = process.env.TEST_PLATFORM_MCP_SIDECAR_SCRIPT;
      if (envPath && fs.existsSync(envPath)) return envPath;
      const { fileURLToPath } = await import('node:url');
      const here = path.dirname(fileURLToPath(import.meta.url));
      const candidate = path.resolve(here, '..', '..', '..', 'scripts', 'start-visible-playwright-mcp.mjs');
      return fs.existsSync(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }

  private async callTool(name: McpToolName, params: McpToolCallParams = {}): Promise<string> {
    if (!this.client) {
      throw new Error('[McpPlaywrightAdapter] not launched, call launch() first');
    }
    const result = await this.client.callTool(name, params);
    if (result.isError) {
      throw new Error(`[McpPlaywrightAdapter] tool ${name} failed: ${result.content.map(c => c.text).join(', ')}`);
    }
    return result.content.map(c => c.text).join('\n');
  }

  async navigate(url: string): Promise<void> {
    // 不用 browser_navigate：它等待页面 load 事件 —— 目标系统存在挂起请求（统计/心跳/
    // 慢外域）时 goto 永不返回，MCP server 整体死锁（真实事故）。改用 browser_evaluate
    // 触发 location.href（fire-and-forget，不等 load），调用方用 waitForTimeout 等待渲染。
    try {
      await this.evaluate((u: string) => {
        setTimeout(() => { try { window.location.href = u; } catch { /* ignore */ } }, 0);
      }, url);
      // 后台页面重载+XHR 数据渲染需要时间；就绪不足会导致后续 click 全部 TimeoutError 级联
      await this.waitForTimeout(6000);
    } catch {
      // evaluate 失败（context 销毁等）时回退 browser_navigate
      await this.callTool('browser_navigate', { url });
    }
  }

  async runReadOnlyClick(selector: string, purpose: ReadOnlyClickPurpose): Promise<ReadOnlyClickResult> {
    // playwright-mcp 模式：browser_click 直接在可见侧车 Chrome 的真实页面上点击
    // （等价"测试者手动点击"，页面永远真实渲染，无沙箱/无请求拦截）。安全策略与 direct
    // 引擎同源：从 snapshot 行取元素语义，写操作词/无文本 icon-only 一律拒绝。
    const beforeUrl = await this.getCurrentUrl().catch(() => '');
    try {
      const snapshot = await this.callTool('browser_snapshot', {});
      let ref = await this.resolveRefBySelector(selector);
      if (!ref) {
        // 快照定位失败 → 尝试「iframe 内点击」通道（iframe 承载内容页的形态里，功能页内容在 iframe，
        // 快照只给 `- text: 新增`（无 [ref]），browser_click 无法命中；实测 iframe 内
        // el.click() 走完整 onclick 事件链、行为与人工点击一致）。仍受同一套写操作词拦截。
        const inFrame = await this.runReadOnlyClickInFrames(selector);
        if (inFrame) {
          const afterFrame = await this.getCurrentUrl().catch(() => '');
          return { status: 'performed', beforeUrl, afterUrl: afterFrame };
        }
        return { status: 'blocked', beforeUrl, reason: `快照中未定位到目标元素: ${selector}` };
      }
      // 语义安全：ref 所在行的描述文案做硬危险词检查（与 direct 引擎同一张表）
      const line = snapshot.split('\n').find((l) => l.includes(`[ref=${ref}]`)) ?? '';
      const textM = line.match(/"([^"]*)"|'([^']*)'/);
      const text = (textM ? (textM[1] || textM[2] || '') : '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
      if (!text) {
        return { status: 'blocked', beforeUrl, reason: '目标元素无可见文本（icon-only），拒绝点击' };
      }
      if (this.isWriteOperationText(text)) {
        return { status: 'blocked', beforeUrl, reason: `写操作按钮，拒绝点击: ${text}` };
      }
      if (purpose === 'sample' && !/data-safe-sample|data-readonly-sample/i.test(line)) {
        return { status: 'blocked', beforeUrl, reason: '非安全样例行，拒绝点击' };
      }
      // 0.0.79 的 browser_click 参数：{ target: ref, element: 可读文案 }
      await this.callTool('browser_click', { target: ref, element: text });
      await this.waitForTimeout(600);
      const afterUrl = await this.getCurrentUrl().catch(() => '');
      return { status: 'performed', beforeUrl, afterUrl };
    } catch (err) {
      return { status: 'blocked', beforeUrl, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * iframe 内点击（通用判据，无框架指纹）：快照的 aria 树**不递归同源 iframe**，
   * iframe 内控件在快照里没有 [ref]，`browser_click` 无法命中（实测某 iframe 承载型系统的
   * 「新增/导出」均为 `- text:` 形态）。这里在**可见**同源 iframe 的 contentDocument 内
   * 按可见文本精确定位并 `el.click()` —— 走完整 onclick 事件链，等价人工点击，且不涉及任何
   * 地址跳转。安全约束与 runReadOnlyClick 同源：写操作词、icon-only 无文本一律拒绝。
   */
  private async runReadOnlyClickInFrames(selector: string): Promise<boolean> {
    if (typeof this.evaluate !== 'function') return false;
    // 仅在 selector 表达可见文本时使用（快照通道已覆盖 id/class/tag 选择器）。
    // 支持三种文本载体：iframe 内动作控件自带的 `iframe-action:N:text=X`、
    // `text=X`、以及 Playwright 的 `tag:has-text("X")`。
    const iframeAction = selector.match(/^iframe-action:[^:]*:text=(.+)$/);
    const hasText = selector.match(/:has-text\("([^"]*)"\)/);
    const textFilter = iframeAction ? iframeAction[1] : hasText ? hasText[1] : selector.replace(/^text=/, '');
    if (!textFilter) return false;
    if (this.isWriteOperationText(textFilter)) return false;
    try {
      const raw = await this.evaluate((text: string): unknown => {
        const g = globalThis as any;
        const doc = g.document;
        if (!doc || !text) return 0;
        const vis = (el: any): boolean => {
          const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
          return !!r && r.width > 0 && r.height > 0;
        };
        const label = (el: any): string => String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const want = label({ innerText: text, textContent: text });
        const docs: any[] = [];
        for (const f of Array.from(doc.querySelectorAll('iframe')) as any[]) {
          if (!vis(f)) continue;
          let idoc: any = null;
          try { idoc = f.contentDocument; } catch { continue; }
          if (idoc && idoc.body) docs.push(idoc);
        }
        for (const d of docs) {
          // 优先 button/a（真实可点击控件），再退到任意带 onclick 的元素
          const cands = Array.from(d.querySelectorAll('button,a')) as any[];
          const wider = Array.from(d.querySelectorAll('[onclick],[role="button"]')) as any[];
          const hit = [...cands, ...wider].find((el) => vis(el) && label(el) === want);
          if (hit) { hit.click(); return 1; }
        }
        return 0;
      }, textFilter);
      if (raw !== 1) return false;
      await this.waitForTimeout(900);
      return true;
    } catch {
      return false;
    }
  }

  async evaluate<T = any>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T> {
    // browser_evaluate 接受函数源码字符串；参数以 JSON 内联展开（MCP 参数不可携带闭包）。
    const src = typeof fn === 'function' ? fn.toString() : String(fn);
    // tsx/esbuild keepNames 会在函数体注入 __name(...) 等模块级 helper 调用，但 helper
    // 本身不随 fn.toString() 序列化 → 浏览器端 ReferenceError（真实事故：编排侧
    // findMenuEntrySelector 全部静默失败 → 菜单点击进入退化为直接导航地址）。
    // 在表达式作用域预置 no-op shim 兜底（仅 name 保留语义，无副作用）。
    // shim 必须在 IIFE 内声明（browser_evaluate 按表达式求值 —— 裸 var 语句会导致
    // SyntaxError: Unexpected token 'var'，全部 evaluate 全灭 —— 真实事故）
    const expr = `(function(){ var __name = (t, v) => t; var __publicField = (o, k, v) => (o[k] = v); return (${src})(...${JSON.stringify(args)}); })()`;
    const out = await this.callTool('browser_evaluate', { function: expr });
    const text = out.trim();
    if (!text) return undefined as T;
    try { return JSON.parse(text) as T; } catch {
      // 0.0.79 返回 markdown 包装（### Result … ### Ran Playwright code）—— 提取 Result 段
      // 的 JSON 字面量；裸字符串再剥引号。此前整段文本被当返回值 → selector/布尔全变垃圾
      // （真实事故：打标 selector 变 '### …' → querySelector SyntaxError → 探索全灭）。
      const m = text.match(/###\s*Result\s*\n([\s\S]*?)(?:\n###|$)/);
      const payload = (m ? m[1] : text).trim();
      try { return JSON.parse(payload) as T; } catch {
        return payload.replace(/^"/, '').replace(/"$/, '') as unknown as T;
      }
    }
  }

  /** 写操作硬拦截（两条点击通道同源共用，与 direct 引擎同一张通用词表） */
  private isWriteOperationText(text: string): boolean {
    return /提交|保存|删除|移除|导入|导出|发布|审批|同意|驳回|submit|save|delete|remove|import|export|publish|approve|reject/i.test(text);
  }

  async hasLoginForm(): Promise<boolean> {
    try {
      const out = (await this.evaluate(() => {
        try { return !!document.querySelector('input[type="password"]'); } catch { return false; }
      })) as unknown;
      return out === true || out === 'true';
    } catch {
      return false;
    }
  }

  async getCurrentUrl(): Promise<string> {
    // 从 snapshot 的 "- Page URL: xxx" 行提取当前地址（0.0.79 的 browser_tabs list
    // 返回纯文本非 JSON，无法解析；snapshot 每次都带最新 Page URL）
    try {
      const snapshot = await this.callTool('browser_snapshot', {});
      const m = snapshot.match(/-\s*Page URL:\s*(\S+)/);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  async extractSemanticDom(rootSelector?: string): Promise<SemanticNode[]> {
    const snapshot = await this.callTool('browser_snapshot', {});
    let nodes = snapshotToSemanticNodes(snapshot);
    if (rootSelector) {
      nodes = nodes.filter(n => n.selector.includes(rootSelector));
    }
    return nodes;
  }

  async exploreModules(): Promise<ModuleNode[]> {
    const snapshot = await this.callTool('browser_snapshot', {});
    const subsystemId = this.config.subsystemId ?? 'default';
    const systemId = this.config.systemId ?? subsystemId;

    // 按快照缩进重建导航层级（不铺平），复用 nav-tree 纯函数建带 parentId 的树
    const navItems = buildNavFromSnapshot(snapshot);
    if (navItems.length === 0) return [];
    const nav = buildNavHierarchy(navItems);
    const tree = toModuleNodes(nav, { subsystemId, systemId });
    return dedupModuleTree(tree);
  }

  async extractPageElements(url?: string): Promise<ExploredElement[]> {
    if (url) {
      await this.navigate(url);
      await this.waitForTimeout(500);
    }

    // 优先 browser_evaluate 跑 DOM_WALK（与 direct 引擎同一套语义提取，**递归同源 iframe** ——
    // iframe 承载型形态的功能页内容在 iframe 里，snapshot 只取主文档会全部漏采，
    // 真实事故：fields/tables 全空 → 「证据缺少可生成场景」）。snapshot 作为降级。
    try {
      const { DOM_WALK } = await import('./playwright-engine.js');
      const raw = await this.evaluate(new Function('return (' + DOM_WALK.trim() + ')')() as (...args: unknown[]) => unknown, null);
      const nodes = (Array.isArray(raw) ? raw : []) as SemanticNode[];
      if (nodes.length > 0) {
        // DOM_WALK 主文档语义 + 同源 iframe 字段/表格直读合并（功能页在 iframe 里时；
        // DOM_WALK 的 iframe 子树在此链路下不稳定 —— 真实事故：fields/tables 全空）
        const iframeEls = await this.collectIframeElements();
        return [...semanticNodesToElements(nodes), ...iframeEls];
      }
    } catch { /* evaluate 不可用时降级 snapshot */ }

    const snapshot = await this.callTool('browser_snapshot', {});
    const entries = parseSnapshotEntries(snapshot);

    const elements: ExploredElement[] = [];
    for (const entry of entries) {
      if (!entry.interactive && !this.isFormElement(entry)) continue;

      const tag = this.extractTag(entry, entry.element);
      const isFormControl = ['input', 'select', 'textarea', 'form'].includes(tag);
      const suggestedAction = this.inferAction(tag, entry);

      elements.push({
        ref: entry.ref,
        tag,
        text: entry.description,
        selector: entry.ref,
        interactive: entry.interactive,
        label: this.extractLabel(entry),
        inputType: this.extractInputType(entry),
        href: this.extractHref(entry),
        isFormControl,
        suggestedAction,
      });
    }

    // 同源 iframe 字段/表格直读（快照的 iframe 子树解析不稳定，直读 DOM 最可靠）
    elements.push(...(await this.collectIframeElements()));
    return elements;
  }

  private isFormElement(entry: { description: string }): boolean {
    const desc = entry.description.toLowerCase();
    return /input|select|textarea|form|field|checkbox|radio|submit|search|email|password|number|date|file/.test(desc);
  }

  private extractTag(entry: { description: string }, role?: string): string {
    // 优先按 snapshot 的 aria role 映射（0.0.79 实证 role 名），description 英文词匹配兜底
    const roleMap: Record<string, string> = {
      textbox: 'input', searchbox: 'input', spinbutton: 'input',
      checkbox: 'input', radio: 'input', slider: 'input',
      combobox: 'select', listbox: 'select', option: 'option',
      link: 'a', button: 'button', textarea: 'textarea',
    };
    if (role && roleMap[role.toLowerCase()]) return roleMap[role.toLowerCase()];
    const desc = entry.description.toLowerCase();
    if (desc.includes('button')) return 'button';
    if (desc.includes('link') || desc.startsWith('a ')) return 'link';
    if (desc.includes('input')) return 'input';
    if (desc.includes('select')) return 'select';
    if (desc.includes('textarea')) return 'textarea';
    if (desc.includes('form')) return 'form';
    if (desc.includes('checkbox')) return 'input';
    if (desc.includes('radio')) return 'input';
    if (desc.includes('text')) return 'input';
    return 'element';
  }

  private extractLabel(entry: { description: string }): string | undefined {
    const desc = entry.description;
    // 优先从「中文标签前置」模式提取真实文案（中文后台常见「标签文字 [控件]」「标签：控件」）。
    // 通用判据，不依赖任何系统/框架；仅当存在中文标签前缀时使用，避免把 id/name 当成标签。
    const cjkLabel = desc.match(/([\u4e00-\u9fff][\u4e00-\u9fff\w\s·•:：\-]*?)\s*(?:\[|:|：)\s*(?:textbox|searchbox|combobox|checkbox|radio|select|button|spinbutton|switch)/i);
    if (cjkLabel) return cjkLabel[1].trim();
    // 退化场景：取快照首个引号 token（可能是合成 id/name）；无引号则视为无标签（如实返回 undefined，不编造中文）。
    const match = desc.match(/["'](.+?)["']/);
    return match ? match[1] : undefined;
  }

  private extractInputType(entry: { description: string }): string | undefined {
    const desc = entry.description.toLowerCase();
    if (desc.includes('email')) return 'email';
    if (desc.includes('password')) return 'password';
    if (desc.includes('number')) return 'number';
    if (desc.includes('date')) return 'date';
    if (desc.includes('checkbox')) return 'checkbox';
    if (desc.includes('radio')) return 'radio';
    if (desc.includes('file')) return 'file';
    if (desc.includes('search')) return 'search';
    if (desc.includes('tel')) return 'tel';
    if (desc.includes('url')) return 'url';
    return 'text';
  }

  private extractHref(entry: { description: string }): string | undefined {
    const match = entry.description.match(/href=["'](.+?)["']/);
    return match ? match[1] : undefined;
  }

  private inferAction(tag: string, entry: { interactive: boolean; description: string }): 'click' | 'fill' | 'select' | 'navigate' {
    if (!entry.interactive) return 'navigate';
    if (tag === 'button') return 'click';
    if (tag === 'link') return 'navigate';
    if (tag === 'select') return 'select';
    if (tag === 'input' || tag === 'textarea' || tag === 'form') return 'fill';
    return 'click';
  }

  async runStep(cmd: BrowserCommand): Promise<ExecutionStepResult> {
    const action = cmd.kind;
    const target = this.getTarget(cmd);

    try {
      switch (cmd.kind) {
        case 'navigate':
          await this.callTool('browser_navigate', { url: cmd.url });
          break;

        case 'click': {
          const ref = await this.resolveRefBySelector(cmd.selector);
          await this.callTool('browser_click', ref ? { ref } : { selector: cmd.selector });
          break;
        }

        case 'fill': {
          const ref = await this.resolveRefBySelector(cmd.selector);
          await this.callTool('browser_type', ref ? { ref, text: cmd.value } : { selector: cmd.selector, text: cmd.value });
          break;
        }

        case 'select': {
          const ref = await this.resolveRefBySelector(cmd.selector);
          await this.callTool('browser_select_option', ref ? { ref, values: [cmd.value] } : { selector: cmd.selector, values: [cmd.value] });
          break;
        }

        case 'press':
          await this.callTool('browser_press_key', { key: cmd.key });
          break;

        case 'wait':
          await this.callTool('browser_wait_for', { text: cmd.selector });
          break;

        case 'screenshot':
          await this.callTool('browser_take_screenshot', {});
          break;

        case 'dom': {
          const snapshot = await this.callTool('browser_snapshot', {});
          return {
            step: 'dom',
            operation: 'snapshot',
            expected: '页面快照获取成功',
            actual: snapshot,
            result: 'passed',
          };
        }

        default:
          return {
            step: action,
            operation: action,
            expected: '未知命令',
            actual: '',
            result: 'failed',
          };
      }

      return {
        step: action,
        operation: action,
        expected: `${target} 执行成功`,
        actual: 'passed',
        result: 'passed',
      };
    } catch (err) {
      return {
        step: action,
        operation: action,
        expected: `${target} 执行成功`,
        actual: (err as Error).message,
        result: 'failed',
      };
    }
  }

  private getTarget(cmd: BrowserCommand): string {
    switch (cmd.kind) {
      case 'navigate': return cmd.url;
      case 'click': return cmd.selector;
      case 'fill': return cmd.selector;
      case 'select': return cmd.selector;
      case 'press': return cmd.key;
      case 'wait': return cmd.selector;
      case 'screenshot': return cmd.path;
      case 'dom': return cmd.selector ?? '';
      default: return '';
    }
  }

  async runCase(row: CaseRow): Promise<ExecutionStepResult[]> {
    const results: ExecutionStepResult[] = [];
    const steps = this.parseCaseSteps(row);

    for (const step of steps) {
      const result = await this.runStep(step);
      results.push(result);
      if (result.result === 'failed') break;
    }

    return results;
  }

  private parseCaseSteps(row: CaseRow): BrowserCommand[] {
    const steps: BrowserCommand[] = [];
    const op = row.operation || '';

    if (op.includes('点击') || op.toLowerCase().includes('click')) {
      const selector = this.extractSelector(op, row.content);
      steps.push({ kind: 'click', selector });
    } else if (op.includes('录入') || op.includes('输入') || op.toLowerCase().includes('fill') || op.toLowerCase().includes('type')) {
      const selector = this.extractSelector(op, row.content);
      const value = this.extractValue(op);
      steps.push({ kind: 'fill', selector, value });
    } else if (op.includes('访问') || op.toLowerCase().includes('navigate') || op.toLowerCase().includes('goto')) {
      steps.push({ kind: 'navigate', url: row.content });
    } else if (op.includes('等待') || op.toLowerCase().includes('wait')) {
      const selector = this.extractSelector(op, row.content);
      steps.push({ kind: 'wait', selector });
    } else if (op.includes('选择') || op.toLowerCase().includes('select')) {
      const selector = this.extractSelector(op, row.content);
      const value = this.extractValue(op);
      steps.push({ kind: 'select', selector, value });
    } else if (op.includes('回车') || op.includes('Enter') || op.toLowerCase().includes('press')) {
      steps.push({ kind: 'press', selector: row.content, key: 'Enter' });
    } else {
      steps.push({ kind: 'dom', selector: row.content });
    }

    return steps;
  }

  private extractSelector(operation: string, fallback: string): string {
    if (fallback) return fallback;
    const match = operation.match(/[【[](.+?)[】\]]/);
    if (match) return match[1];
    return operation;
  }

  private extractValue(operation: string): string {
    const match = operation.match(/['"](.+?)['"]/);
    if (match) return match[1];
    return '';
  }

  private async resolveRefBySelector(selector: string): Promise<string | null> {
    try {
      const snapshot = await this.callTool('browser_snapshot', {});
      // 支持 Playwright 定位语法：button:has-text("X") / a:has-text("X") / text=X / #id / .cls
      // 提取 (tag?, 文本?) 两个信号，在 snapshot 行内同时匹配（0.0.79 行形如 `- button "X" [ref=eN]`）
      const hasText = selector.match(/:has-text\("([^"]*)"\)/);
      const textFilter = hasText ? hasText[1] : selector.replace(/^text=/, '').replace(/^#/, '').replace(/^\./, '');
      const tagFilter = hasText ? (selector.split(':')[0] ?? '').toLowerCase() : '';
      const regex = /\[ref=(e\d+)\]/g;
      const lines = snapshot.split('\n');

      // 文本双向包含匹配：DOM innerText（嵌套 span 会重复文本，如 "标题 标题"）与
      // 快照可访问名（"标题"）往往不一致 —— 单向 includes 会漏配（真实事故：按钮遍历全灭）
      const norm = (v: string): string => v.replace(/\s+/g, ' ').trim();
      const want = norm(textFilter);
      for (const line of lines) {
        if (!want) continue;
        const nameMatch = line.match(/"([^"]*)"/);
        const lineName = nameMatch ? norm(nameMatch[1]) : '';
        const textOk = line.includes(textFilter)
          || (lineName !== '' && (want.includes(lineName) || lineName.includes(want)));
        if (textOk) {
          // tag 宽松匹配：link 行代表 <a>（a 的 snapshot role 是 link），button 精确
          if (tagFilter && !line.toLowerCase().includes(tagFilter) && !(tagFilter === 'a' && /link/i.test(line))) continue;
          const refMatch = line.match(/\[ref=([^\]]+)\]/);
          if (refMatch) return refMatch[1];
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 同源 iframe 字段/表格直读（通用判据，无框架指纹）：iframe 承载型形态的功能页
   * （表单/表格）在 iframe 里 —— 直读 contentDocument 的表单控件与表格列，转为
   * ExploredElement（isFormControl/tableInfo），供证据采集与用例生成使用。
   */
  private async collectIframeElements(): Promise<ExploredElement[]> {
    try {
      const raw = await this.evaluate((): unknown => {
        const out: any[] = [];
        const visible = (el: any): boolean => { const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null; return !!r && r.width > 0 && r.height > 0; };
        const labelOf = (el: any): string => {
          const id = el.id ? (el.ownerDocument.querySelector('label[for="' + el.id + '"]')?.textContent ?? '') : '';
          // 近邻标签：沿**通用标签祖先**向上找最近的一行容器，再在其中取 label。
          // 不用任何框架类名（写死即发布阻断项）；找不到 label[for] 时仍有 placeholder/name 兜底。
          const row = el.closest('fieldset, tr, li, p, section, article');
          const near = row ? (row.querySelector('label')?.textContent ?? '') : '';
          return String(id || near || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().slice(0, 40);
        };
        let seq = 0;
        for (const f of Array.from(document.querySelectorAll('iframe'))) {
          if (!visible(f)) continue; // 隐藏 iframe（旧 tab 残留）跳过，只采可见功能页
          let idoc: any = null;
          try { idoc = (f as any).contentDocument; } catch { continue; }
          if (!idoc || !idoc.body) continue;
          for (const el of Array.from(idoc.querySelectorAll('input,select,textarea'))) {
            const t = el as any;
            if (t.type === 'hidden' || !visible(t)) continue;
            seq += 1;
            out.push({
              ref: 'fi' + seq, tag: t.tagName.toLowerCase(), text: '', selector: 'iframe ' + t.tagName.toLowerCase() + ':' + seq,
              interactive: true, label: labelOf(t), inputType: t.getAttribute('type') ?? undefined,
              isFormControl: true, suggestedAction: 'fill', required: t.required || undefined,
            });
          }
          // iframe 内的动作控件（按钮/链接/带 onclick 的元素）：快照不进 iframe，
          // 若只采表单与表格，则功能页的「查询/新增/详情」等按钮对全按钮遍历完全不可见
          //（真实事故：候选为 0 → states 只剩 base → 无 create/detail 证据）。
          // 文本取可见文本：点击通道按文本在 iframe 内定位（browser_click 拿不到 ref）。
          const ACTION_SEL = 'button,a,[onclick],[role="button"]';
          for (const act of Array.from(idoc.querySelectorAll(ACTION_SEL)) as any[]) {
            if (!visible(act)) continue;
            // 表格内部的行级操作（每行一份编辑/删除/详情）不作为功能按钮遍历：
            // 一是同一功能有 N 份、重复无意义，二是它们作用于**具体数据行**（可能触发写操作）。
            // 判据是「是否位于 table 内」这一结构属性，与任何系统无关，非写死。
            if (act.closest && act.closest('table')) continue;
            const txt = String(act.innerText || act.textContent || '').replace(/\s+/g, ' ').trim();
            if (!txt || txt.length > 40) continue;
            seq += 1;
            out.push({
              ref: 'fa' + seq, tag: act.tagName.toLowerCase(), text: txt,
              selector: 'iframe-action:' + seq + ':text=' + txt,
              interactive: true, isFormControl: false, suggestedAction: 'click',
            });
          }
          for (const tb of Array.from(idoc.querySelectorAll('table')) as any[]) {
            const columns = Array.from(tb.querySelectorAll('th')).map((h: any) => (h.textContent || '').trim()).filter(Boolean);
            if (!columns.length) continue;
            seq += 1;
            out.push({
              ref: 'ft' + seq, tag: 'table', text: columns.join('|'), selector: 'iframe table:' + seq,
              interactive: false, isFormControl: false, suggestedAction: 'click',
              tableInfo: {
                columns,
                rowCount: tb.querySelectorAll('tbody tr').length,
                // 分页判据 = **可读语义**（页码/上一页/总条数…）或分页导航角色，
                // 不依赖任何 UI 框架的分页容器类名（写死即发布阻断项）。
                hasPagination: /上一页|下一页|首\s*页|末\s*页|第\s*\d+\s*\/|共\s*[\d,]+\s*(条|页|项)|\b(prev|next|page)\b/i.test(String(idoc.body?.innerText ?? '').slice(0, 4000))
                  || !!idoc.querySelector('[role="navigation"] nav, nav[aria-label]'),
                hasSorting: false,
                hasFilter: false,
                isVirtualList: false,
              },
            });
          }
        }
        return out;
      });
      return Array.isArray(raw) ? (raw as unknown as ExploredElement[]) : [];
    } catch {
      return [];
    }
  }

  async screenshot(path: string): Promise<ScreenshotRef> {
    await this.callTool('browser_take_screenshot', {});
    return {
      id: `screenshot-${Date.now()}`,
      fileName: path.split(/[\\/]/).pop() || path,
      path,
    };
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async getSessionCookies(): Promise<string[]> {
    const result = await this.callTool('browser_cookies', {});
    try {
      const cookies = JSON.parse(result);
      if (Array.isArray(cookies)) {
        return cookies
          .filter((c: unknown): c is { name: string; value: string } =>
            typeof c === 'object' && c !== null && 'name' in c && 'value' in c,
          )
          .map((c) => `${c.name}=${c.value}`);
      }
    } catch {
      // 非 JSON 格式
    }
    return [result];
  }

  async getSessionHeaders(): Promise<Record<string, string>> {
    const result = await this.callTool('browser_localstorage_get_all', {});
    const headers: Record<string, string> = {};
    try {
      const tokens = JSON.parse(result);
      if (tokens && typeof tokens === 'object') {
        for (const [key, value] of Object.entries(tokens)) {
          if (typeof value !== 'string') continue;
          const lowerKey = key.toLowerCase();
          // 捕获所有鉴权相关 headers：token/auth/jwt/session/csrf/api-key 等
          if (/token|auth|jwt|session|csrf|api[_-]?key|bearer|credential/i.test(lowerKey)) {
            if (lowerKey.includes('token') || lowerKey.includes('bearer')) {
              headers['Authorization'] = `Bearer ${value}`;
            } else {
              headers[key] = value;
            }
          }
        }
      }
    } catch {
      // ignore non-JSON response
    }
    return headers;
  }

  async getSessionTokens(): Promise<string[]> {
    const result = await this.callTool('browser_localstorage_get_all', {});
    const tokens: string[] = [];
    try {
      const all = JSON.parse(result);
      if (all && typeof all === 'object') {
        for (const [key, value] of Object.entries(all)) {
          if (typeof value === 'string' && /token|auth|jwt|session/i.test(key)) {
            tokens.push(value);
          }
        }
      }
    } catch {
      // ignore non-JSON response
    }
    return tokens.length > 0 ? tokens : [result];
  }

  async applySession(state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }): Promise<void> {
    if (state.cookies.length > 0) {
      const cookieObjs = state.cookies.map(c => {
        const [name, value] = c.split('=');
        return { name, value };
      });
      await this.callTool('browser_cookies_set', { cookies: cookieObjs });
    }

    if (state.tokens && state.tokens.length > 0) {
      const tokenMap: Record<string, string> = {};
      state.tokens.forEach((t, i) => {
        tokenMap[`token_${i}`] = t;
      });
      await this.callTool('browser_localstorage_set', { items: tokenMap });
    }

    if (state.headers && Object.keys(state.headers).length > 0) {
      const headerMap: Record<string, string> = {};
      for (const [key, value] of Object.entries(state.headers)) {
        headerMap[`header_${key}`] = value;
      }
      await this.callTool('browser_localstorage_set', { items: headerMap });
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = null;
      this.launched = false;
    }
  }

  async getStorageState(): Promise<PlaywrightStorageState> {
    try {
      const result = await this.callTool('browser_storage_state', {});
      const parsed = JSON.parse(result);
      // MCP 返回的 storage state 可能是 JSON 字符串
      if (typeof parsed === 'string') {
        return JSON.parse(parsed) as PlaywrightStorageState;
      }
      return parsed as PlaywrightStorageState;
    } catch {
      return { cookies: [], origins: [] };
    }
  }

  async getAllStorageTokens(): Promise<Array<{ storage: 'local' | 'session'; name: string; value: string }>> {
    try {
      const result = await this.callTool('browser_localstorage_get_all', {});
      const all = JSON.parse(result);
      const out: Array<{ storage: 'local' | 'session'; name: string; value: string }> = [];
      if (all && typeof all === 'object') {
        for (const [name, value] of Object.entries(all)) {
          if (typeof value === 'string') out.push({ storage: 'local', name, value });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  // MCP 适配器无 addInitScript 等价能力：降级为 no-op。
  // 会话保持由 direct 引擎（PlaywrightEngine）路径完整处理；mcp 路径非默认引擎。
  async addInitScript(_fn: (arg?: unknown) => void, _arg?: unknown): Promise<void> {
    return;
  }
}
