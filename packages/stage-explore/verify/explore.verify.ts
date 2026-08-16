/**
 * @file explore.verify.ts
 * @description stage-explore 质量门验证：使用内存假引擎（不启动真实浏览器）驱动 run
 */
import { describe, it, expect, vi } from 'vitest';
import type { McpEngine, ModuleNode } from '@test-platform/engine-mcp';
import type {
  ExploreInput,
  ManualSupplement,
  SessionHandle,
} from '@test-platform/contracts';
import { run, mergeManualSupplement, dedupeClickPath } from '../src/index';

/** 可观测假引擎类型：在 McpEngine 基础上暴露 applySession 供断言 */
type SpyEngine = McpEngine & {
  applySession: (state: {
    cookies: string[];
    headers?: Record<string, string>;
    tokens?: string[];
  }) => Promise<void>;
};

/** 构造一个不启动浏览器的假引擎，exploreModules 返回手搓模块树 */
function makeFakeEngine(tree: ModuleNode[]): SpyEngine {
  const notImpl = async (): Promise<never> => {
    throw new Error('fake engine: method not implemented');
  };
  return {
    launch: notImpl,
    navigate: vi.fn(async () => undefined),
    extractSemanticDom: notImpl,
    exploreModules: async () => tree,
    runStep: notImpl,
    runCase: notImpl,
    screenshot: notImpl,
    // applySession 必须为可观测 no-op：run() 会话衔接依赖它，测试据此断言被调用
    applySession: vi.fn(async () => undefined),
    waitForTimeout: notImpl,
    evaluate: async <T = any>(_fn: string | ((...args: any[]) => T), ..._args: any[]): Promise<T> => undefined as T,
    close: notImpl,
  };
}

const sessionHandle: SessionHandle = {
  sessionId: 'sess_1',
  systemId: 'sys_1',
  loginStatus: 'ok',
  cookies: [],
  expiresAt: Date.now() + 10_000,
};

/** 含完整会话快照（cookies/headers/tokens），用于会话衔接测试 */
const richSession: SessionHandle = {
  sessionId: 'sess_rich',
  systemId: 'sys_1',
  loginStatus: 'ok',
  cookies: ['c1=abc', 'c2=def'],
  headers: { Authorization: 'Bearer tk' },
  tokens: ['tok_a'],
  expiresAt: Date.now() + 10_000,
};

/** 手搓模块树：4 个节点，覆盖 2 个、needs_review 1 个、unexplored 1 个 */
const sampleTree: ModuleNode[] = [
  {
    id: 'mod_a',
    label: '模块A',
    parentId: null,
    subsystemId: 'sys_1',
    type: 'module',
    status: 'covered',
    children: [
      {
        id: 'page_a1',
        label: '页面A1',
        parentId: 'mod_a',
        subsystemId: 'sys_1',
        type: 'page',
        status: 'covered',
        children: [],
        depth: 1,
      },
      {
        id: 'page_a2',
        label: '页面A2',
        parentId: 'mod_a',
        subsystemId: 'sys_1',
        type: 'page',
        status: 'needs_review',
        reviewReason: '待核对',
        children: [],
        depth: 1,
      },
    ],
    depth: 0,
  },
  {
    id: 'mod_b',
    label: '模块B',
    parentId: null,
    subsystemId: 'sys_1',
    type: 'module',
    status: 'unexplored',
    children: [],
    depth: 0,
  },
];

describe('stage-explore / run', () => {
  it('(a) 返回 moduleTree 且 coverage 合法（visited<=total，frontier 为 id 数组）', async () => {
    const out = await run(
      { sessionHandle, subsystemId: 'sys_1' },
      makeFakeEngine(sampleTree),
    );

    expect(out.moduleTree).toHaveLength(2);
    expect(out.coverage.total).toBe(4);
    expect(out.coverage.visited).toBe(2);
    expect(out.coverage.visited).toBeLessThanOrEqual(out.coverage.total);
    expect(Array.isArray(out.coverage.frontier)).toBe(true);
    expect(out.coverage.frontier.sort()).toEqual(['mod_b', 'page_a2']);
  });

  it('(b) needsReview 等于所有 needs_review 节点 id', async () => {
    const out = await run(
      { sessionHandle, subsystemId: 'sys_1' },
      makeFakeEngine(sampleTree),
    );
    expect(out.needsReview).toEqual(['page_a2']);
  });

  it('(c) manualSupplement 合并新增节点并更新 coverage', async () => {
    const supplement: ManualSupplement = {
      clickPath: [
        {
          steps: [
            {
              selector: '#btn',
              text: '新增',
              url: 'https://example.com/x',
              timestamp: 1,
            },
          ],
          inferredModule: '人工补录M',
          confidence: 1,
        },
      ],
      insertPosition: 'end',
      relativeToNodeId: null,
    };

    const out = await run(
      { sessionHandle, subsystemId: 'sys_1', manualSupplement: supplement },
      makeFakeEngine(sampleTree),
    );

    expect(out.moduleTree).toHaveLength(3); // 根级追加一枚
    const added = out.moduleTree.find((n) => n.manuallyAdded === true);
    expect(added).toBeDefined();
    expect(added?.status).toBe('covered');
    expect(added?.type).toBe('action');

    expect(out.coverage.total).toBe(5);
    expect(out.coverage.visited).toBe(3); // 2 原覆盖 + 1 人工覆盖
    expect(out.coverage.frontier).toEqual(['page_a2', 'mod_b']);
  });

  it('(d) checkpoint 具备 visitedNodeIds + frontier + savedAt', async () => {
    const out = await run(
      { sessionHandle, subsystemId: 'sys_1' },
      makeFakeEngine(sampleTree),
    );

    expect(typeof out.checkpoint.checkpointId).toBe('string');
    expect(out.checkpoint.checkpointId.length).toBeGreaterThan(0);
    expect(Array.isArray(out.checkpoint.visitedNodeIds)).toBe(true);
    expect(out.checkpoint.visitedNodeIds).toEqual(
      expect.arrayContaining(['mod_a', 'page_a1']),
    );
    expect(out.checkpoint.frontier).toEqual(out.coverage.frontier);
    expect(typeof out.checkpoint.savedAt).toBe('number');
  });

  it('(e) resumeFrom 字段被接受且不报错', async () => {
    const out = await run(
      { sessionHandle, subsystemId: 'sys_1', resumeFrom: 'cp-legacy-1' },
      makeFakeEngine(sampleTree),
    );
    expect(out.moduleTree).toHaveLength(2);
    expect(out.coverage.total).toBe(4);
  });

  it('(f) [Major] ①登录→②探索 会话衔接：engine.applySession 被调用并注入 sessionHandle', async () => {
    const engine = makeFakeEngine(sampleTree);
    const out = await run(
      { sessionHandle: richSession, subsystemId: 'sys_1' },
      engine,
    );
    expect(engine.applySession).toHaveBeenCalledTimes(1);
    expect(engine.applySession).toHaveBeenCalledWith({
      cookies: ['c1=abc', 'c2=def'],
      headers: { Authorization: 'Bearer tk' },
      tokens: ['tok_a'],
    });
    expect(out.moduleTree).toHaveLength(2);
  });

  it('(h) [Major] engineHasActiveSession=true 时不注入会话（保护登录浏览器内有效会话，避免被覆盖登出）', async () => {
    const engine = makeFakeEngine(sampleTree);
    const out = await run(
      { sessionHandle: richSession, subsystemId: 'sys_1' },
      engine,
      { engineHasActiveSession: true },
    );
    expect(engine.applySession).not.toHaveBeenCalled();
    expect(out.moduleTree).toHaveLength(2);
  });

  it('(i) [Major] 自建引擎 + systemUrl + 会话 → applySession 被调用以恢复登录（非活跃浏览器复用路径）', async () => {
    const engine = makeFakeEngine(sampleTree);
    const out = await run(
      { sessionHandle: richSession, subsystemId: 'sys_1', systemUrl: 'https://example.com/app' },
      engine,
    );
    expect(engine.applySession).toHaveBeenCalledTimes(1);
    expect(engine.applySession).toHaveBeenCalledWith({
      cookies: ['c1=abc', 'c2=def'],
      headers: { Authorization: 'Bearer tk' },
      tokens: ['tok_a'],
    });
    expect(out.moduleTree).toHaveLength(2);
  });

  it('(g) [Major] resumeFrom 命中断点后续跑：已探索节点被合并为 covered', async () => {
    // 第一次运行产出一个断点（visitedNodeIds=['mod_a']）
    const first = await run(
      { sessionHandle, subsystemId: 'sys_1' },
      makeFakeEngine(sampleTree),
    );
    expect(first.checkpoint.visitedNodeIds).toContain('mod_a');
    const cpId = first.checkpoint.checkpointId;

    // 续跑：引擎返回同一棵树，但 mod_a 被重置为 needs_review（模拟重新遍历丢失状态）
    const resumedTree: ModuleNode[] = structuredClone(sampleTree);
    const a = resumedTree[0];
    a.status = 'needs_review';
    a.reviewReason = 're-explored';

    const second = await run(
      { sessionHandle, subsystemId: 'sys_1', resumeFrom: cpId },
      makeFakeEngine(resumedTree),
    );

    const resumedA = second.moduleTree.find((n) => n.id === 'mod_a');
    expect(resumedA?.status).toBe('covered'); // 续跑合并：已探索节点保持 covered
    expect(second.checkpoint.visitedNodeIds).toContain('mod_a'); // 合并进新断点
  });

  it('[Major] 同 target 批量 above/below 插入顺序保持与 clickPath 顺序一致', async () => {
    // 父节点 mod_a，子节点 page_a1 为 target
    const multi: ManualSupplement = {
      clickPath: [
        {
          steps: [{ selector: '#b1', text: 'b1', url: 'https://e.com/b1', timestamp: 1 }],
          inferredModule: 'B1',
          confidence: 1,
        },
        {
          steps: [{ selector: '#b2', text: 'b2', url: 'https://e.com/b2', timestamp: 1 }],
          inferredModule: 'B2',
          confidence: 1,
        },
        {
          steps: [{ selector: '#b3', text: 'b3', url: 'https://e.com/b3', timestamp: 1 }],
          inferredModule: 'B3',
          confidence: 1,
        },
      ],
      insertPosition: 'above',
      relativeToNodeId: 'page_a1',
    };
    const out = await run(
      { sessionHandle, subsystemId: 'sys_1', manualSupplement: multi },
      makeFakeEngine(structuredClone(sampleTree)),
    );
    // 新节点全部在 page_a1 之上，且顺序为 B1→B2→B3（与 clickPath 顺序一致）
    const modA = out.moduleTree.find((n) => n.id === 'mod_a')!;
    const ids = modA.children.map((c) => c.label);
    const aIdx = ids.indexOf('页面A1');
    const aboveIds = ids.slice(Math.max(0, aIdx - 3), aIdx);
    expect(aboveIds).toEqual(['B1', 'B2', 'B3']);

    // below 插入同样保持顺序
    const below: ManualSupplement = { ...multi, insertPosition: 'below' };
    const out2 = await run(
      { sessionHandle, subsystemId: 'sys_1', manualSupplement: below },
      makeFakeEngine(structuredClone(sampleTree)),
    );
    const modA2 = out2.moduleTree.find((n) => n.id === 'mod_a')!;
    const ids2 = modA2.children.map((c) => c.label);
    const aIdx2 = ids2.indexOf('页面A1');
    const belowIds = ids2.slice(aIdx2 + 1, aIdx2 + 4);
    expect(belowIds).toEqual(['B1', 'B2', 'B3']);
  });

  it('[Minor] 重复 clickPath 被去重（原型要求人工补录已去重）', async () => {
    const dup: ManualSupplement = {
      clickPath: [
        {
          steps: [{ selector: '#btn', text: 'x', url: 'https://e.com/x', timestamp: 1 }],
          inferredModule: 'M',
          confidence: 1,
        },
        {
          steps: [{ selector: '#btn', text: 'x', url: 'https://e.com/x', timestamp: 1 }],
          inferredModule: 'M',
          confidence: 1,
        },
      ],
      insertPosition: 'end',
      relativeToNodeId: null,
    };
    const out = await run(
      { sessionHandle, subsystemId: 'sys_1', manualSupplement: dup },
      makeFakeEngine(structuredClone(sampleTree)),
    );
    const man = out.moduleTree.filter((n) => n.manuallyAdded);
    expect(man).toHaveLength(1); // 被去重
  });

  it('[Minor] 指定 relativeToNodeId 不存在 → 显式抛错（不再静默回退）', () => {
    const bad: ManualSupplement = {
      clickPath: [
        {
          steps: [{ selector: '#x', text: 'x', url: 'https://e.com/x', timestamp: 1 }],
          inferredModule: 'X',
          confidence: 1,
        },
      ],
      insertPosition: 'end',
      relativeToNodeId: 'non_existent_id',
    };
    expect(() =>
      mergeManualSupplement(structuredClone(sampleTree), bad, 'sys_1'),
    ).toThrow(/relativeToNodeId.*不存在/);
  });

  it('[Minor] dedupeClickPath 对重复 clickPath 返回仅一条（纯函数可独立单测）', () => {
    const cp = (sel: string) => ({
      steps: [{ selector: sel, text: sel, url: 'https://e.com/' + sel, timestamp: 1 }],
      inferredModule: 'M',
      confidence: 1,
    });
    const input = [cp('#a'), cp('#a'), cp('#b'), cp('#a')];
    const out = dedupeClickPath(input);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.steps[0].selector)).toEqual(['#a', '#b']);
  });

  it('边界：manualSupplement 为空 clickPath → 不增节点、覆盖不变', async () => {
    const empty: ManualSupplement = {
      clickPath: [],
      insertPosition: 'end',
      relativeToNodeId: null,
    };
    const out = await run(
      { sessionHandle, subsystemId: 'sys_1', manualSupplement: empty },
      makeFakeEngine(structuredClone(sampleTree)),
    );
    expect(out.moduleTree).toHaveLength(2);
    expect(out.coverage.visited).toBe(2); // 与基线一致
    expect(out.coverage.total).toBe(4);
  });
});
