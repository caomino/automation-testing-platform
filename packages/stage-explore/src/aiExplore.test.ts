/**
 * @file aiExplore.test.ts
 * @description AI 辅助探索隔离与行为测试（P-B）。
 * 隔离断言（S1）：本文件测的是 aiExplore，而 aiExplore 源码不得 import menu-explorer/nonAiExplore。
 */
import { describe, it, expect } from 'vitest';
import type { McpEngine, ExploredElement } from '@test-platform/engine-mcp';
import type { AIClient, AIRequest } from '@test-platform/infra-ai';
import { exploreWithAi } from './aiExplore.js';

// —— 隔离静态断言（S1）：源码不得交叉 import —— //
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./aiExplore.ts', import.meta.url), 'utf-8');
describe('隔离边界（S1）', () => {
  it('aiExplore 不 import menu-explorer / nonAiExplore / infra-ai 值级实现', () => {
    expect(SRC).not.toMatch(/from\s+['"].*menu-explorer['"]/);
    expect(SRC).not.toMatch(/from\s+['"].*nonAiExplore['"]/);
    // AIClient 仅允许 `import type`，禁止值级 import（避免隐性耦合到 infra-ai 运行时代码）
    expect(SRC).not.toMatch(/import\s+(?!type\b).*AIClient.*from\s+['"]@test-platform\/infra-ai['"]/);
  });
});

// —— stub engine —— //
function makeEngine(): { engine: McpEngine; state: { clicks: string[]; urls: string[] } } {
  const state = { clicks: [] as string[], urls: ['https://sys.test/home'] as string[] };
  let clickIdx = 0;
  const engine = {
    launch: async () => {},
    navigate: async (u: string) => {
      state.urls.push(u);
    },
    extractSemanticDom: async () => [],
    exploreModules: async () => [],
    extractPageElements: async (): Promise<ExploredElement[]> => {
      // 每次点击后切换到一个「新页面」（不同 URL + 含功能按钮）
      const pageIdx = state.urls.length - 1;
      return [
        { ref: `#menu${pageIdx}`, selector: `#menu${pageIdx}`, tag: 'a', text: `菜单${pageIdx}`, interactive: true, label: `菜单${pageIdx}`, isFormControl: false, suggestedAction: 'navigate' },
        { ref: `#add${pageIdx}`, selector: `#add${pageIdx}`, tag: 'button', text: '新增', interactive: true, label: '新增', isFormControl: false, suggestedAction: 'click' },
        { ref: `#del${pageIdx}`, selector: `#del${pageIdx}`, tag: 'button', text: '删除', interactive: true, label: '删除', isFormControl: false, suggestedAction: 'click' },
        { ref: `#q${pageIdx}`, selector: `#q${pageIdx}`, tag: 'button', text: '查询', interactive: true, label: '查询', isFormControl: false, suggestedAction: 'click' },
      ];
    },
    runStep: async (cmd: any) => {
      if (cmd.kind === 'click') {
        state.clicks.push(cmd.selector);
        // 模拟导航到一个新页面
        state.urls.push(`https://sys.test/page${++clickIdx}`);
      }
      return { ok: true, screenshotRef: undefined, details: {} } as any;
    },
    runCase: async () => [],
    screenshot: async () => ({ path: '', width: 0, height: 0 }),
    getStorageState: async () => ({ cookies: [], origins: [] }),
    getCurrentUrl: async () => state.urls[state.urls.length - 1],
    getSessionCookies: async () => [],
    getSessionHeaders: async () => ({}),
    getSessionTokens: async () => [],
    applySession: async () => {},
    getAllStorageTokens: async () => [],
    addInitScript: async () => {},
    waitForTimeout: async () => {},
    evaluate: async <T = any>(_fn: any, ..._a: any[]): Promise<T> => undefined as T,
    close: async () => {},
    getCurrentTitle: async () => 'title',
    getNavigationPath: async () => state.urls,
  };
  return { engine: engine as unknown as McpEngine, state };
}

/** 固定返回某个 ref 的 stub AIClient；传入 'done' 表示终止 */
function stubAi(ref: string): AIClient {
  return {
    complete: async (_req: AIRequest) => ({ text: `ref="${ref}"` }),
  };
}

describe('exploreWithAi 行为（P-B）', () => {
  it('产出 page 节点下挂 action 级功能点（新增/查询等）', async () => {
    const { engine } = makeEngine();
    const tree = await exploreWithAi(engine, stubAi('#menu0'), { subsystemId: 's1' }, { maxSteps: 1 });
    const all = tree.flatMap((p) => [p, ...p.children]);
    const actions = all.filter((n) => n.type === 'action').map((n) => n.label);
    expect(actions).toEqual(expect.arrayContaining(['新增', '查询']));
    // 含「删除」文字的按钮被危险词硬挡，不应作为安全候选被点击（此处仅验证识别到 action 存在）
    expect(tree.length).toBeGreaterThan(0);
  });

  it('AI 返回 done → 立即收束，不无限循环', async () => {
    const { engine, state } = makeEngine();
    const doneAi: AIClient = { complete: async () => ({ text: 'done' }) };
    const tree = await exploreWithAi(engine, doneAi, { subsystemId: 's1' }, { maxSteps: 10 });
    // 起点页 harvest 一次，AI 立即 done → 不再点击
    expect(state.clicks).toHaveLength(0);
    expect(tree).toHaveLength(1); // 仅起点页
  });

  it('超过 maxSteps → 正常收束（封顶保护）', async () => {
    const { engine, state } = makeEngine();
    const tree = await exploreWithAi(engine, stubAi('#menu0'), { subsystemId: 's1' }, { maxSteps: 3 });
    expect(state.clicks.length).toBeLessThanOrEqual(3);
    expect(tree.length).toBeGreaterThan(0);
  });

  it('异常安全降级：AI/引擎抛错时返回已收集节点（标 needs_review），绝不抛崩', async () => {
    const { engine } = makeEngine();
    const boomAi: AIClient = { complete: async () => { throw new Error('llm down'); } };
    const tree = await exploreWithAi(engine, boomAi, { subsystemId: 's1' }, { maxSteps: 2 });
    // 起点页 harvest 已执行，异常后返回已收集节点
    expect(Array.isArray(tree)).toBe(true);
    expect(tree.length).toBe(1);
    expect(tree[0].status).toBe('needs_review');
  });
});
