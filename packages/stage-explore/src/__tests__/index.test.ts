/**
 * @file index.test.ts
 * @description stage-explore 单元/边界测试：mergeManualSupplement + run 边界
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  ClickPath,
  ManualSupplement,
  ModuleNode,
  SessionHandle,
} from '@test-platform/contracts';
import type { McpEngine } from '@test-platform/engine-mcp';
import { mergeManualSupplement, run, assertActionGranularity } from '../index.js';

/** 可观测假引擎类型：在 McpEngine 基础上暴露 applySession 供断言 */
type SpyEngine = McpEngine & {
  applySession: (state: {
    cookies: string[];
    headers?: Record<string, string>;
    tokens?: string[];
  }) => Promise<void>;
};

/** 构造不启动浏览器的假引擎（exploreModules 返回注入的树，applySession 可观测） */
function makeFakeEngine(tree: ModuleNode[]): SpyEngine {
  const notImpl = async (): Promise<never> => {
    throw new Error('fake engine: method not implemented');
  };
  return {
    launch: notImpl,
    navigate: notImpl,
    extractSemanticDom: notImpl,
    exploreModules: async () => tree,
    runStep: notImpl,
    runCase: notImpl,
    screenshot: notImpl,
    getSessionCookies: notImpl,
    getSessionHeaders: notImpl,
    getSessionTokens: notImpl,
    getStorageState: async () => ({ cookies: [], origins: [] }),
    getCurrentUrl: notImpl,
    applySession: vi.fn(async () => undefined),
    getAllStorageTokens: async () => [],
    addInitScript: async () => {},
    extractPageElements: async () => [],
    waitForTimeout: notImpl,
    evaluate: async <T = any>(_fn: string | ((...args: any[]) => T), ..._args: any[]): Promise<T> => undefined as T,
    close: notImpl,
  };
}

const sessionHandle: SessionHandle = {
  sessionId: 'sess_1',
  systemId: 'sys_1',
  loginStatus: 'ok',
  cookies: ['c=1'],
  expiresAt: Date.now() + 10_000,
};

/** 根级三节点基树 */
function baseTree(): ModuleNode[] {
  const mk = (id: string, label: string): ModuleNode => ({
    id,
    label,
    parentId: null,
    subsystemId: 'sys_1',
    type: 'module',
    status: 'covered',
    children: [],
    depth: 0,
  });
  return [mk('A', 'A'), mk('B', 'B'), mk('C', 'C')];
}

/** 生成 n 条 clickPath，inferredModule 用以标识顺序 */
function clickPaths(n: number): ClickPath[] {
  return Array.from({ length: n }, (_, i) => ({
    steps: [{ selector: `#b${i}`, text: `t${i}`, url: 'https://x/y', timestamp: i }],
    inferredModule: `p${i}`,
    confidence: 1,
  }));
}

function supplement(
  clickPath: ClickPath[],
  insertPosition: ManualSupplement['insertPosition'],
  relativeToNodeId: string | null,
): ManualSupplement {
  return { clickPath, insertPosition, relativeToNodeId };
}

describe('assertActionGranularity 粒度闸门（P-A#4）', () => {
  it('只有目录级叶子、零 action → 整体标 needs_review', () => {
    const tree: ModuleNode[] = [
      {
        id: 'm',
        label: '系统管理',
        parentId: null,
        subsystemId: 'sys_1',
        type: 'module',
        status: 'covered',
        children: [
          { id: 'p', label: '用户管理', parentId: 'm', subsystemId: 'sys_1', type: 'page', status: 'covered', children: [], depth: 1 },
        ],
        depth: 0,
      },
    ];
    const r = assertActionGranularity(tree);
    expect(r.actionCount).toBe(0);
    expect(r.flagged).toBe(1);
    // 目录级叶子被标 needs_review 且带原因
    const leaf = tree[0].children[0];
    expect(leaf.status).toBe('needs_review');
    expect(leaf.reviewReason).toContain('操作级功能点');
  });

  it('含足够 action 功能点 → 不误标', () => {
    const tree: ModuleNode[] = [
      {
        id: 'm',
        label: '系统管理',
        parentId: null,
        subsystemId: 'sys_1',
        type: 'module',
        status: 'covered',
        children: [
          {
            id: 'p',
            label: '用户管理',
            parentId: 'm',
            subsystemId: 'sys_1',
            type: 'page',
            status: 'covered',
            depth: 1,
            children: [
              { id: 'a1', label: '列表', parentId: 'p', subsystemId: 'sys_1', type: 'action', status: 'covered', children: [], depth: 2 },
              { id: 'a2', label: '新增', parentId: 'p', subsystemId: 'sys_1', type: 'action', status: 'covered', children: [], depth: 2 },
            ],
          },
        ],
        depth: 0,
      },
    ];
    const r = assertActionGranularity(tree);
    expect(r.actionCount).toBe(2);
    expect(r.flagged).toBe(0);
    expect(tree[0].children[0].status).toBe('covered');
  });

  it('目录级叶子（即使已 covered 但无 action）也会被标 needs_review（颗粒度不足）', () => {
    const tree: ModuleNode[] = [
      { id: 'p', label: '老页面', parentId: null, subsystemId: 'sys_1', type: 'page', status: 'covered', children: [], depth: 0 },
    ];
    const r = assertActionGranularity(tree);
    expect(r.flagged).toBe(1); // 即便 covered，无 action 子节点仍视为颗粒度不足
    expect(tree[0].status).toBe('needs_review');
    expect(tree[0].reviewReason).toContain('操作级功能点');
  });
});

describe('run 集成（闸门 + 退化）', () => {
  it('引擎产出目录级树 → run 输出 needsReview 非空', async () => {
    const dirTree: ModuleNode[] = [
      { id: 'p', label: '用户管理', parentId: null, subsystemId: 'sys_1', type: 'page', status: 'covered', children: [], depth: 0 },
    ];
    const engine = makeFakeEngine(dirTree);
    const out = await run(
      { subsystemId: 'sys_1', sessionHandle },
      engine,
      { engineHasActiveSession: true },
    );
    expect(out.needsReview).toContain('p');
  });
});

describe('mergeManualSupplement / 批量兄弟插入顺序', () => {
  it('(s1) [Minor] 同 target 批量 below 插入保持 clickPath 顺序', () => {
    const out = mergeManualSupplement(
      baseTree(),
      supplement(clickPaths(3), 'below', 'B'),
      'sys_1',
    );
    expect(out.map((n) => n.label)).toEqual(['A', 'B', 'p0', 'p1', 'p2', 'C']);
  });

  it('(s2) [Minor] 同 target 批量 above 插入保持 clickPath 顺序', () => {
    const out = mergeManualSupplement(
      baseTree(),
      supplement(clickPaths(3), 'above', 'B'),
      'sys_1',
    );
    expect(out.map((n) => n.label)).toEqual(['A', 'p0', 'p1', 'p2', 'B', 'C']);
  });

  it('(s3) 单条 above/below 插入位置正确', () => {
    const below = mergeManualSupplement(
      baseTree(),
      supplement(clickPaths(1), 'below', 'B'),
      'sys_1',
    );
    expect(below.map((n) => n.label)).toEqual(['A', 'B', 'p0', 'C']);

    const above = mergeManualSupplement(
      baseTree(),
      supplement(clickPaths(1), 'above', 'B'),
      'sys_1',
    );
    expect(above.map((n) => n.label)).toEqual(['A', 'p0', 'B', 'C']);
  });

  it('(s4) end：作为目标子节点追加', () => {
    const out = mergeManualSupplement(
      baseTree(),
      supplement(clickPaths(1), 'end', 'B'),
      'sys_1',
    );
    const b = out.find((n) => n.id === 'B');
    expect(b?.children).toHaveLength(1);
    expect(b?.children[0].parentId).toBe('B');
    expect(b?.children[0].depth).toBe(1);
  });
});

describe('mergeManualSupplement / 去重与父节点校验', () => {
  it('(d1) [Minor] 重复 clickPath 仅入树一次（去重守卫）', () => {
    const dup = clickPaths(2);
    dup[1] = structuredClone(dup[0]); // 完全重复
    const out = mergeManualSupplement(baseTree(), supplement(dup, 'end', null), 'sys_1');
    const added = out.filter((n) => n.manuallyAdded === true);
    expect(added).toHaveLength(1);
  });

  it('(d2) [Minor] relativeToNodeId 不存在时显式报错（不静默回退根级）', () => {
    expect(() =>
      mergeManualSupplement(baseTree(), supplement(clickPaths(1), 'below', 'Z'), 'sys_1'),
    ).toThrow(/relativeToNodeId "Z" 不存在/);
  });

  it('(d3) [Minor] 空 clickPath 不产生任何节点', () => {
    const out = mergeManualSupplement(
      baseTree(),
      supplement([], 'end', null),
      'sys_1',
    );
    expect(out).toHaveLength(3);
    expect(out.some((n) => n.manuallyAdded === true)).toBe(false);
  });
});

describe('run / 边界', () => {
  it('(r1) [Minor] 空 clickPath 的 manualSupplement 不产生人工节点', async () => {
    const out = await run(
      {
        sessionHandle,
        subsystemId: 'sys_1',
        manualSupplement: supplement([], 'end', null),
      },
      makeFakeEngine(baseTree()),
    );
    expect(out.moduleTree.some((n) => n.manuallyAdded === true)).toBe(false);
    expect(out.coverage.total).toBe(3);
  });

  it('(r2) relativeToNodeId 不存在时 run 抛错', async () => {
    await expect(
      run(
        {
          sessionHandle,
          subsystemId: 'sys_1',
          manualSupplement: supplement(clickPaths(1), 'below', 'NOPE'),
        },
        makeFakeEngine(baseTree()),
      ),
    ).rejects.toThrow(/relativeToNodeId "NOPE" 不存在/);
  });
});
