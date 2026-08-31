/**
 * @file _helpers.ts
 * @description engine-mcp 测试辅助 — Mock Page 构建器 + DOM 逻辑常量
 */
import type { PlaywrightEngine } from '../src/playwright-engine';

export type MockCall = { method: string; args: unknown[] };

export interface MockPageOptions {
  evaluateReturn?: unknown;
  cookies?: Array<{ name: string; value: string }>;
}

export function createMockPage(opts: MockPageOptions = {}) {
  const calls: MockCall[] = [];

  const mockContext = {
    cookies: async () => opts.cookies ?? [],
    addCookies: async (cookies: unknown[]) => {
      calls.push({ method: 'context.addCookies', args: [cookies] });
    },
  };

  const mockPage = {
    goto: async (...args: unknown[]) => { calls.push({ method: 'goto', args }); },
    click: async (...args: unknown[]) => { calls.push({ method: 'click', args }); },
    fill: async (...args: unknown[]) => { calls.push({ method: 'fill', args }); },
    selectOption: async (...args: unknown[]) => { calls.push({ method: 'selectOption', args }); },
    press: async (...args: unknown[]) => { calls.push({ method: 'press', args }); },
    waitForSelector: async (...args: unknown[]) => { calls.push({ method: 'waitForSelector', args }); },
    screenshot: async (...args: unknown[]) => { calls.push({ method: 'screenshot', args }); },
    evaluate: async (_fn: unknown, _arg?: unknown) => {
      calls.push({ method: 'evaluate', args: [_fn, _arg] });
      return opts.evaluateReturn ?? null;
    },
    $: async (...args: unknown[]) => { calls.push({ method: '$', args }); return null; },
    context: () => mockContext,
    url: () => 'https://example.com',
    setDefaultTimeout: () => {},
  };

  return { mockPage: mockPage as unknown as any, calls };
}

export function injectPage(engine: PlaywrightEngine, mockPage: unknown) {
  (engine as unknown as { page: unknown }).page = mockPage;
}

// ─── DOM_WALK 逻辑常量（与源脚本同步） ────────────────────────

export const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMIT']);
export const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ASIDE', 'NAV', 'UL', 'OL', 'LI', 'FORM', 'TABLE', 'HEADER', 'FOOTER', 'MAIN', 'ARTICLE']);

export function stableSelector(el: {
  id?: string;
  tagName: string;
  getAttribute(name: string): string | null;
  parentElement: { tagName: string; parentElement: unknown } | null;
  nodeType: number;
}): string {
  if (el.id) return '#' + el.id;
  const dataAttrs = ['data-testid', 'data-id', 'data-key', 'name'];
  for (const a of dataAttrs) {
    const v = el.getAttribute(a);
    if (v) return el.tagName.toLowerCase() + '[' + a + '="' + v + '"]';
  }
  const parts: string[] = [];
  let n: typeof el | null = el;
  while (n && n.nodeType === 1 && parts.length < 4) {
    parts.unshift(n.tagName.toLowerCase());
    n = n.parentElement as typeof el | null;
  }
  return parts.join(' > ');
}