/**
 * @file playwright-engine.test.ts
 * @description 探索退化路径的护栏测试（P-A#1：禁止静默降级）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModuleNode } from '@test-platform/contracts';

vi.mock('./menu-explorer.js', () => ({
  exploreViaMenus: vi.fn(),
}));

import { exploreViaMenus } from './menu-explorer.js';
import { PlaywrightEngine, markTreeNeedsReview } from './playwright-engine.js';

const mockedExplore = vi.mocked(exploreViaMenus);

/** 构造一棵最小模块树（covered 状态） */
function tree(): ModuleNode[] {
  return [
    {
      id: 'a',
      label: '系统管理',
      parentId: null,
      subsystemId: 's1',
      type: 'module',
      status: 'covered',
      depth: 0,
      children: [
        {
          id: 'b',
          label: '用户管理',
          parentId: 'a',
          subsystemId: 's1',
          type: 'page',
          status: 'covered',
          depth: 1,
          children: [],
        },
      ],
    },
  ];
}

/** 把引擎内部私有 page 与 DOM 提取替换为可控假对象 */
function stubEngine(engine: PlaywrightEngine, domNodes: ModuleNode[]): void {
  const anyEngine = engine as unknown as {
    page: unknown;
    extractSemanticDom: () => Promise<unknown[]>;
    domToModules: () => ModuleNode[];
  };
  anyEngine.page = { url: () => 'http://example.test/home' };
  anyEngine.extractSemanticDom = async () => [];
  anyEngine.domToModules = () => domNodes;
}

describe('markTreeNeedsReview', () => {
  it('递归把整树标为 needs_review 并写入原因', () => {
    const t = markTreeNeedsReview(tree(), '兜底原因');
    expect(t[0].status).toBe('needs_review');
    expect(t[0].reviewReason).toBe('兜底原因');
    expect(t[0].children[0].status).toBe('needs_review');
    expect(t[0].children[0].reviewReason).toBe('兜底原因');
  });
});

describe('PlaywrightEngine.exploreModules 退化路径', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedExplore.mockReset();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('菜单遍历抛错时：不再静默降级 —— 整树 needs_review + 醒目告警 + 退化标志置位', async () => {
    mockedExplore.mockRejectedValue(new Error('boom'));
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 's1' });
    stubEngine(engine, tree());

    const out = await engine.exploreModules();

    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('needs_review');
    expect(out[0].reviewReason).toContain('退化为单页 DOM 提取');
    expect(out[0].children[0].status).toBe('needs_review');
    expect(engine.lastExploreDegraded).toBe(true);
    const logged = errSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('[explore][DEGRADED]');
  });

  it('菜单遍历返回空数组时：同样视为退化，不得当成成功', async () => {
    mockedExplore.mockResolvedValue([]);
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 's1' });
    stubEngine(engine, tree());

    const out = await engine.exploreModules();

    expect(out[0].status).toBe('needs_review');
    expect(engine.lastExploreDegraded).toBe(true);
  });

  it('菜单遍历成功时：原样返回，不标记、不置退化标志', async () => {
    mockedExplore.mockResolvedValue(tree());
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 's1' });
    stubEngine(engine, tree());

    const out = await engine.exploreModules();

    expect(out[0].status).toBe('covered');
    expect(engine.lastExploreDegraded).toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('降级路径 domToModules：叶子无有效 href 时补当前页 URL（保证 featurePaths 非空，杜绝静默模板）', async () => {
    mockedExplore.mockResolvedValue([]); // 触发降级
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 's1' });
    const anyEngine = engine as unknown as {
      page: { url: () => string };
      extractSemanticDom: () => Promise<unknown[]>;
    };
    anyEngine.page = { url: () => 'http://example.test/home' };
    anyEngine.extractSemanticDom = async () => [
      { tag: 'DIV', text: '待办', name: '待办', selector: '#todo', interactive: false, children: [], href: undefined, isDataControl: false, rect: { x: 0, y: 0, w: 0, h: 0 } },
      { tag: 'A', text: '链接页', name: '链接页', selector: '#link', interactive: true, children: [], href: 'https://x.com/a', isDataControl: false, rect: { x: 0, y: 0, w: 0, h: 0 } },
      { tag: 'A', text: '空链接', name: '空链接', selector: '#js', interactive: true, children: [], href: 'javascript:;', isDataControl: false, rect: { x: 0, y: 0, w: 0, h: 0 } },
    ];

    const out = await engine.exploreModules();

    const flat = (nodes: ModuleNode[]): ModuleNode[] => nodes.flatMap((n) => [n, ...flat(n.children)]);
    const leaves = flat(out).filter((n) => n.children.length === 0);
    const todo = leaves.find((n) => n.label === '待办');
    const link = leaves.find((n) => n.label === '链接页');
    const js = leaves.find((n) => n.label === '空链接');
    // 无 href → 补当前页 URL
    expect(todo?.url).toBe('http://example.test/home');
    // 有效 href → 保留
    expect(link?.url).toBe('https://x.com/a');
    // javascript:; 等无效 href → 忽略，补当前页 URL
    expect(js?.url).toBe('http://example.test/home');
    // 仍标记降级（不伪装成功）
    expect(out[0].status).toBe('needs_review');
  });
});
