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

      const command = this.config.mcpCommand || 'npx';
      const args = this.config.mcpArgs || ['@playwright/mcp@latest'];

      const transport = new StdioClientTransport({
        command,
        args,
      });

      const client = new Client(
        { name: 'test-platform-engine-mcp', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);
      this.client = client as unknown as McpClient;
      this.launched = true;
    } catch (err) {
      throw new Error(`[McpPlaywrightAdapter] launch failed: ${(err as Error).message}`);
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
    await this.callTool('browser_navigate', { url });
  }

  async runReadOnlyClick(_selector: string, _purpose: ReadOnlyClickPurpose): Promise<ReadOnlyClickResult> {
    // MCP click cannot install a request route or cancel downloads atomically. Never fall back to browser_click.
    return { status: 'unsupported', reason: 'MCP 引擎未提供可拦截写请求和下载的只读点击能力' };
  }

  async getCurrentUrl(): Promise<string> {
    // 通过 browser_snapshot 获取当前页面 URL（MCP 没有直接的 getCurrentUrl）
    const tabsResult = await this.callTool('browser_tabs', {});
    try {
      const tabs = JSON.parse(tabsResult);
      if (Array.isArray(tabs) && tabs.length > 0) {
        return tabs[0].url ?? '';
      }
    } catch {
      // 忽略解析错误
    }
    return '';
  }

  async evaluate<T = any>(_fn: string | ((...args: any[]) => T), ..._args: any[]): Promise<T> {
    throw new Error('evaluate 在 mcp 模式下不可用，请使用 direct 引擎进行人工补录录制');
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

    const snapshot = await this.callTool('browser_snapshot', {});
    const entries = parseSnapshotEntries(snapshot);

    const elements: ExploredElement[] = [];
    for (const entry of entries) {
      if (!entry.interactive && !this.isFormElement(entry)) continue;

      const tag = this.extractTag(entry);
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

    return elements;
  }

  private isFormElement(entry: { description: string }): boolean {
    const desc = entry.description.toLowerCase();
    return /input|select|textarea|form|field|checkbox|radio|submit|search|email|password|number|date|file/.test(desc);
  }

  private extractTag(entry: { description: string }): string {
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
    const match = entry.description.match(/["'](.+?)["']/);
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
      const text = selector.replace(/^text=/, '').replace(/^#/, '').replace(/^\./, '');
      const regex = /\[ref=(e\d+)\]/g;
      const lines = snapshot.split('\n');

      for (const line of lines) {
        if (line.includes(text)) {
          const match = line.match(regex);
          if (match && match.length > 0) {
            const refMatch = line.match(/\[ref=(e\d+)\]/);
            if (refMatch) return refMatch[1];
          }
        }
      }
      return null;
    } catch {
      return null;
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
