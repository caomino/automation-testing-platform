/**
 * @file featureEvidenceExplorer.test.ts
 * @description T4 回归：按 featureId 隔离的页面证据采集（替代全局合并，杜绝跨功能点串用）
 */
import { describe, it, expect, vi } from 'vitest';
import type { McpEngine, ExploredElement, FeatureRow } from '@test-platform/contracts';
import { DEFAULT_FEATURE_COLUMNS, FeatureEvidenceSchema } from '@test-platform/contracts';
import { exploreFeatureEvidence, exploreFeatureEvidenceMap } from '../featureEvidenceExplorer.js';

const SAMPLE_ELEMENTS: ExploredElement[] = [
  {
    ref: 'r1', tag: 'input', selector: "input[name='u']", text: '用户名', interactive: true,
    label: '用户名', inputType: 'text', isFormControl: true, required: true, suggestedAction: 'fill',
  },
  {
    ref: 'r2', tag: 'table', selector: 'table', text: '列表', interactive: false,
    label: '列表', isFormControl: false, suggestedAction: 'navigate',
    tableInfo: {
      columns: ['名称', '状态'], rowCount: 2, hasPagination: true, paginationInfo: '第1/5页',
      hasSorting: true, sortableColumns: ['名称'], hasFilter: false, isVirtualList: false,
    },
  },
];

function makeEngine(elements: ExploredElement[]): McpEngine {
  return {
    navigate: vi.fn().mockResolvedValue(undefined),
    runStep: vi.fn().mockResolvedValue(undefined),
    runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: 'https://x.com/users', afterUrl: 'https://x.com/users#dialog' }),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    extractPageElements: vi.fn().mockResolvedValue(elements),
    getCurrentUrl: vi.fn().mockResolvedValue('https://x.com/users'),
    evaluate: vi.fn().mockResolvedValue(true),
  } as unknown as McpEngine;
}

function makeEngineThrowing(): McpEngine {
  return {
    navigate: vi.fn().mockResolvedValue(undefined),
    runStep: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    extractPageElements: vi.fn().mockRejectedValue(new Error('boom')),
  } as unknown as McpEngine;
}

function buildFeatureTable(ids: string[]): FeatureRow[][] {
  const FC = DEFAULT_FEATURE_COLUMNS;
  const rows = ids.map((id) => {
    const row: string[] = [];
    row[FC.mainModule] = '模块A';
    row[FC.subModule] = '模块A';
    row[FC.testPointId] = id;
    return row;
  });
  // 约定形态：[[...行]]（外层再包一层），与 exploreByFeatureNames / stageCase 一致
  return [rows];
}

describe('exploreFeatureEvidence 单功能点采集', () => {
  it('URL 进入 → 表单控件转 fields、表格转 tables，证据 observed 且通过契约校验', async () => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_01', actionKind: 'create', url: 'https://x.com/new' });

    expect(engine.navigate).toHaveBeenCalledWith('https://x.com/new');
    expect(res.evidence.featureId).toBe('tp_01');
    expect(res.evidence.actionKind).toBe('create');
    expect(res.evidence.fields).toHaveLength(1);
    expect(res.evidence.fields[0].name).toBe('用户名');
    expect(res.evidence.fields[0].required).toBe(true);
    expect(res.evidence.tables).toHaveLength(1);
    expect(res.evidence.tables[0].columns).toEqual(['名称', '状态']);
    expect(res.evidence.evidenceLevel).toBe('observed');
    expect(res.evidence.needsReview).toBe(false);
    expect(res.evidence.coverageKeys).not.toContain('create_base');
    expect(res.raw).toHaveLength(2);
    // 三重保护：产出必须经契约校验
    expect(FeatureEvidenceSchema.safeParse(res.evidence).success).toBe(true);
  });

  it('危险 clickSelector（提交/删除等）→ 跳过点击，返回 needsReview，绝不误触', async () => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_02', clickSelector: "button:has-text('提交')" });

    expect(engine.runStep).not.toHaveBeenCalled();
    expect(res.evidence.needsReview).toBe(true);
    expect(res.evidence.reviewReason).toMatch(/未匹配|危险/);
  });

  it('安全 clickSelector（打开详情/菜单常驻）→ 执行点击进入并采集', async () => {
    const engine = makeEngine([...SAMPLE_ELEMENTS, {
      ref: '#open-detail', tag: 'button', selector: '#open-detail', text: '打开详情', interactive: true,
      isFormControl: false, suggestedAction: 'click', ariaHasPopup: 'dialog',
    } as ExploredElement]);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_03', clickSelector: '#open-detail' });

    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('#open-detail', 'action');
    expect(res.evidence.featureId).toBe('tp_03');
    expect(res.evidence.needsReview).toBe(false);
  });

  it.each(['input[type=checkbox]', '.status-switch', '.row-action .icon-only'])('非白名单或有副作用风险的 clickSelector %s → 不点击', async (clickSelector) => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_unsafe', clickSelector });

    expect(engine.runStep).not.toHaveBeenCalled();
    expect(res.evidence).toEqual(expect.objectContaining({ needsReview: true, evidenceLevel: 'needs_review' }));
    expect(res.evidence.reviewReason).toMatch(/未匹配|安全|危险/);
  });

  it('抽取异常 → fail-safe 返回 needsReview，绝不抛出', async () => {
    const engine = makeEngineThrowing();
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_04', url: 'https://x.com' });

    expect(res.evidence.needsReview).toBe(true);
    expect(res.evidence.reviewReason).toMatch(/异常/);
  });

  it.each(['https://x.com/users/delete?id=1', 'https://x.com/orders/remove', 'https://x.com/workflow/approve'])('危险导航 URL %s → 不导航并显式待复核', async (url) => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_dangerous_url', url });

    expect(engine.navigate).not.toHaveBeenCalled();
    expect(res.evidence).toEqual(expect.objectContaining({ needsReview: true, evidenceLevel: 'needs_review' }));
    expect(res.evidence.reviewReason).toMatch(/危险.*URL/);
  });

  it.each(['https://x.com/users/deleteUser', 'https://x.com/orders/batchDelete', 'https://x.com/patient/removePatient', 'https://x.com/workflow?action=approve'])('camelCase/查询参数危险 URL %s → 零导航', async (url) => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_dangerous_camel', url });

    expect(engine.navigate).not.toHaveBeenCalled();
    expect(res.evidence.needsReview).toBe(true);
  });

  it.each([
    { tag: 'button', selector: '[data-safe-opener]', text: undefined, inputType: undefined },
    { tag: 'div', selector: '[data-safe-opener]', text: '未知容器', inputType: undefined },
    { tag: 'input', selector: '[data-safe-opener]', text: '启用', inputType: 'checkbox' },
    { tag: 'div', selector: '[data-safe-opener]', text: '启用', inputType: undefined, role: 'switch' },
  ])('伪安全 selector 但真实节点不安全 (%o) → zero click', async (node) => {
    const engine = makeEngine([{ ref: node.selector, interactive: true, isFormControl: false, suggestedAction: 'click', ...node } as ExploredElement]);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_spoof', clickSelector: node.selector });

    expect(engine.runReadOnlyClick).not.toHaveBeenCalled();
    expect(res.evidence.needsReview).toBe(true);
  });

  it('MCP/未知引擎没有 runReadOnlyClick 时不会回退普通 click', async () => {
    const opener = { ref: '#open-detail', tag: 'button', selector: '#open-detail', text: '打开详情', interactive: true, isFormControl: false, suggestedAction: 'click', ariaHasPopup: 'dialog' } as ExploredElement;
    const engine = makeEngine([opener]);
    delete (engine as { runReadOnlyClick?: unknown }).runReadOnlyClick;
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_mcp_unsupported', clickSelector: '#open-detail' });

    expect(engine.runStep).not.toHaveBeenCalled();
    expect(res.evidence).toEqual(expect.objectContaining({ needsReview: true, reviewReason: expect.stringContaining('未提供只读点击能力') }));
  });

  it('先采 base，再用白名单 actionSelector 打开新增视图并记录状态和入口', async () => {
    const base = [...SAMPLE_ELEMENTS.filter((item) => item.tableInfo), {
      ref: '[data-safe-opener][aria-haspopup=dialog]', tag: 'button', selector: '[data-safe-opener][aria-haspopup=dialog]', text: '打开新增', interactive: true,
      isFormControl: false, suggestedAction: 'click', ariaHasPopup: 'dialog', safeReadOnlyOpener: true,
    } as ExploredElement];
    const create = SAMPLE_ELEMENTS.filter((item) => item.isFormControl);
    const engine = makeEngine(base);
    vi.mocked(engine.extractPageElements).mockResolvedValueOnce(base).mockResolvedValueOnce(create);
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_create',
      actionKind: 'create',
      url: 'https://x.com/users',
      actionSelector: '[data-safe-opener][aria-haspopup=dialog]',
      actionText: '新增用户',
    });

    expect(engine.navigate).toHaveBeenCalledWith('https://x.com/users');
    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('[data-safe-opener][aria-haspopup=dialog]', 'action');
    expect(res.evidence.states).toEqual(['base', 'create']);
    expect(res.evidence.actionEntries).toEqual([expect.objectContaining({ actionKind: 'create', triggerable: true, text: '新增用户' })]);
    expect(res.evidence.fields.map((field) => field.name)).toEqual(['用户名']);
  });

  it('修改入口没有明确安全样例时不点击行操作，并把该功能点待复核', async () => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_update',
      actionKind: 'update',
      url: 'https://x.com/users',
      actionSelector: '[data-safe-opener][aria-haspopup=dialog]',
    });

    expect(engine.runStep).not.toHaveBeenCalled();
    expect(res.evidence.states).toEqual(['base']);
    expect(res.evidence).toEqual(expect.objectContaining({ needsReview: true, reviewReason: expect.stringContaining('安全样例') }));
  });

  it('actionSelector 失效时不标记 observed、不点击，并记录待复核原因', async () => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_stale_selector', actionKind: 'create', url: 'https://x.com/users', actionSelector: '#stale-open',
    });

    expect(engine.runReadOnlyClick).not.toHaveBeenCalled();
    expect(res.evidence.actionEntries).toEqual([expect.objectContaining({ observed: false, triggerable: false })]);
    expect(res.evidence.reviewReason).toContain('未匹配当前页面节点');
  });

  it('只读扩展 Tab/折叠状态后恢复原状态，并对重复快照去重', async () => {
    const base: ExploredElement[] = [{
      ref: 'tab', tag: 'div', selector: '#details-tab', text: '详情', interactive: true, isFormControl: false, suggestedAction: 'click',
      containers: [{ kind: 'tab', ref: 'tab', selector: '#details-tab', expanded: false }],
    }];
    const expanded = [...base, SAMPLE_ELEMENTS[0]];
    const engine = makeEngine(base);
    vi.mocked(engine.extractPageElements).mockResolvedValueOnce(base).mockResolvedValueOnce(expanded);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_tab', actionKind: 'detail', url: 'https://x.com/users' });

    expect(engine.runReadOnlyClick).toHaveBeenCalledTimes(2);
    expect(engine.runReadOnlyClick).toHaveBeenNthCalledWith(1, '#details-tab', 'container');
    expect(engine.runReadOnlyClick).toHaveBeenNthCalledWith(2, '#details-tab', 'container');
    expect(res.evidence.states).toEqual(['base', 'views']);
  });

  it('遍历超过两个安全 Tab/折叠，直至状态预算而非硬编码截断', async () => {
    const base: ExploredElement[] = ['#tab-a', '#tab-b', '#tab-c'].map((selector, index) => ({
      ref: `tab-${index}`, tag: 'div', selector, text: `页签${index}`, interactive: true, isFormControl: false, suggestedAction: 'click',
      containers: [{ kind: index === 1 ? 'collapse' : 'tab', ref: `tab-${index}`, selector, expanded: false }],
    }));
    const engine = makeEngine(base);
    vi.mocked(engine.extractPageElements).mockResolvedValue(base);
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_many_tabs', actionKind: 'detail', url: 'https://x.com/users' });

    expect(engine.runReadOnlyClick).toHaveBeenCalledTimes(6);
    expect(res.evidence.uncovered.some((item) => item.kind === 'budget_exceeded')).toBe(false);
  });

  it('状态/节点预算到达时保留部分证据并标记 budget_exceeded', async () => {
    const base: ExploredElement[] = [{
      ref: 'tab', tag: 'div', selector: '#tab', interactive: true, isFormControl: false, suggestedAction: 'click',
      containers: [{ kind: 'tab', ref: 'tab', selector: '#tab', expanded: false }],
    }];
    const engine = makeEngine(base);
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_budget', actionKind: 'detail', url: 'https://x.com/users', budget: { maxStates: 1 },
    });

    expect(res.evidence.states).toEqual(['base']);
    expect(res.evidence.uncovered).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'budget_exceeded' })]));
    expect(res.evidence.needsReview).toBe(true);
    expect(engine.runStep).not.toHaveBeenCalled();
  });

  it('create 状态采集后恢复 base URL', async () => {
    const base = [...SAMPLE_ELEMENTS.filter((item) => item.tableInfo), {
      ref: '[data-safe-opener][aria-haspopup=dialog]', tag: 'button', selector: '[data-safe-opener][aria-haspopup=dialog]', text: '打开新增', interactive: true,
      isFormControl: false, suggestedAction: 'click', ariaHasPopup: 'dialog', safeReadOnlyOpener: true,
    } as ExploredElement];
    const create = SAMPLE_ELEMENTS.filter((item) => item.isFormControl);
    const engine = makeEngine(base);
    let currentUrl = 'https://x.com/users';
    vi.mocked(engine.getCurrentUrl).mockImplementation(async () => currentUrl);
    vi.mocked(engine.runReadOnlyClick!).mockImplementation(async () => { currentUrl = 'https://x.com/users#dialog'; return { status: 'performed', beforeUrl: 'https://x.com/users', afterUrl: currentUrl }; });
    vi.mocked(engine.navigate).mockImplementation(async (url) => { currentUrl = url; });
    // 同文档 hash 路由恢复：restoreBase 用 evaluate 切 hash，不整页 reload（首页无限刷新修复）
    vi.mocked(engine.evaluate!).mockImplementation(async (_fn: unknown, ...args: unknown[]) => {
      if (typeof args[0] === 'string') {
        // 模拟浏览器内 window.location.hash 赋值：'' 清空 hash，'#x' 设置 hash
        const u = new URL(currentUrl);
        u.hash = args[0];
        currentUrl = u.href;
      }
      return true;
    });
    vi.mocked(engine.extractPageElements).mockResolvedValueOnce(base).mockResolvedValueOnce(create);

    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_restore', actionKind: 'create', url: 'https://x.com/users', actionSelector: '[data-safe-opener][aria-haspopup=dialog]',
    });

    expect(res.evidence.states).toEqual(['base', 'create']);
    // 同文档（仅 hash 变化）：进入页面 navigate 一次后，恢复用 hash 切换，不再整页 reload（避免首页反复刷新）
    expect(engine.navigate).toHaveBeenCalledTimes(1);
    expect(engine.navigate).toHaveBeenCalledWith('https://x.com/users');
    await expect(engine.getCurrentUrl()).resolves.toBe('https://x.com/users');
  });

  it('update 必须先选择显式安全样例，再点击独立安全 opener', async () => {
    const base: ExploredElement[] = [
      { ref: 'sample', tag: 'button', selector: '[data-safe-sample]', text: '选择样例', interactive: true, isFormControl: false, suggestedAction: 'click' },
      { ref: 'edit', tag: 'button', selector: '[data-safe-opener][aria-haspopup=dialog]', text: '打开修改', interactive: true, isFormControl: false, suggestedAction: 'click', ariaHasPopup: 'dialog', safeReadOnlyOpener: true } as ExploredElement,
    ];
    const update = SAMPLE_ELEMENTS.filter((item) => item.isFormControl);
    const engine = makeEngine(base);
    vi.mocked(engine.extractPageElements).mockResolvedValueOnce(base).mockResolvedValueOnce(update);
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_update_two_step', actionKind: 'update', url: 'https://x.com/users', actionSelector: '[data-safe-opener][aria-haspopup=dialog]',
    });

    expect(engine.runReadOnlyClick).toHaveBeenNthCalledWith(1, '[data-safe-sample]', 'sample');
    expect(engine.runReadOnlyClick).toHaveBeenNthCalledWith(2, '[data-safe-opener][aria-haspopup=dialog]', 'action');
    expect(res.evidence.states).toEqual(['base', 'update']);
  });

  it('虚拟列表在指纹稳定时停止，在滚动预算耗尽时显式待复核', async () => {
    const virtual = SAMPLE_ELEMENTS.filter((item) => item.tableInfo).map((item) => ({ ...item, tableInfo: { ...item.tableInfo!, isVirtualList: true } }));
    const later = [...virtual, { ...SAMPLE_ELEMENTS[0], ref: 'later', selector: "input[name='later']", label: '后续字段' }];
    const stableEngine = makeEngine(virtual);
    vi.mocked(stableEngine.extractPageElements).mockResolvedValueOnce(virtual).mockResolvedValueOnce(later).mockResolvedValueOnce(later);
    const stable = await exploreFeatureEvidence(stableEngine, { featureId: 'tp_virtual_stable', actionKind: 'list', url: 'https://x.com/users' });
    expect(stableEngine.evaluate).toHaveBeenCalledTimes(2);
    expect(stable.evidence.uncovered.some((item) => item.kind === 'budget_exceeded')).toBe(false);

    const limitedEngine = makeEngine(virtual);
    vi.mocked(limitedEngine.extractPageElements).mockResolvedValueOnce(virtual).mockResolvedValueOnce(later);
    const limited = await exploreFeatureEvidence(limitedEngine, {
      featureId: 'tp_virtual_limit', actionKind: 'list', url: 'https://x.com/users', budget: { maxVirtualScrollSteps: 1 },
    });
    expect(limited.evidence.uncovered).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'budget_exceeded' })]));
  });

  it('安全点击后跳转危险 URL 时立即恢复并停止状态采集', async () => {
    const base = [...SAMPLE_ELEMENTS.filter((item) => item.tableInfo), {
      ref: '[data-safe-opener][aria-haspopup=dialog]', tag: 'button', selector: '[data-safe-opener][aria-haspopup=dialog]', text: '打开新增', interactive: true,
      isFormControl: false, suggestedAction: 'click', ariaHasPopup: 'dialog', safeReadOnlyOpener: true,
    } as ExploredElement];
    const engine = makeEngine(base);
    let currentUrl = 'https://x.com/users';
    vi.mocked(engine.getCurrentUrl).mockImplementation(async () => currentUrl);
    vi.mocked(engine.runReadOnlyClick!).mockImplementation(async () => { currentUrl = 'https://x.com/users/delete?id=1'; return { status: 'performed', beforeUrl: 'https://x.com/users', afterUrl: currentUrl }; });
    vi.mocked(engine.navigate).mockImplementation(async (url) => { currentUrl = url; });

    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_danger_after_click', actionKind: 'create', url: 'https://x.com/users', actionSelector: '[data-safe-opener][aria-haspopup=dialog]',
    });

    expect(res.evidence.states).toEqual(['base']);
    expect(res.evidence.needsReview).toBe(true);
    expect(res.evidence.reviewReason).toMatch(/危险|非预期/);
    expect(engine.navigate).toHaveBeenLastCalledWith('https://x.com/users');
  });

  it('action opener 可安全进入同源 create 路由并恢复 base URL', async () => {
    const base = [...SAMPLE_ELEMENTS.filter((item) => item.tableInfo), {
      ref: '[data-safe-opener][aria-haspopup=dialog]', tag: 'button', selector: '[data-safe-opener][aria-haspopup=dialog]', text: '打开新增', interactive: true,
      isFormControl: false, suggestedAction: 'click', ariaHasPopup: 'dialog', safeReadOnlyOpener: true,
    } as ExploredElement];
    const create = SAMPLE_ELEMENTS.filter((item) => item.isFormControl);
    const engine = makeEngine(base);
    let currentUrl = 'https://x.com/users';
    vi.mocked(engine.getCurrentUrl).mockImplementation(async () => currentUrl);
    vi.mocked(engine.runReadOnlyClick!).mockImplementation(async () => { currentUrl = 'https://x.com/users/new'; return { status: 'performed', beforeUrl: 'https://x.com/users', afterUrl: currentUrl }; });
    vi.mocked(engine.navigate).mockImplementation(async (url) => { currentUrl = url; });
    vi.mocked(engine.extractPageElements).mockResolvedValueOnce(base).mockResolvedValueOnce(create);

    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_create_route', actionKind: 'create', url: 'https://x.com/users', actionSelector: '[data-safe-opener][aria-haspopup=dialog]',
    });

    expect(res.evidence.states).toEqual(['base', 'create']);
    expect(engine.extractPageElements).toHaveBeenCalledTimes(2);
    expect(engine.navigate).toHaveBeenLastCalledWith('https://x.com/users');
  });

  it('action opener 跨源跳转时停止采集并恢复 base URL', async () => {
    const base = SAMPLE_ELEMENTS.filter((item) => item.tableInfo);
    const engine = makeEngine(base);
    let currentUrl = 'https://x.com/users';
    vi.mocked(engine.getCurrentUrl).mockImplementation(async () => currentUrl);
    vi.mocked(engine.runStep).mockImplementation(async () => { currentUrl = 'https://evil.example/users/new'; return undefined as any; });
    vi.mocked(engine.navigate).mockImplementation(async (url) => { currentUrl = url; });

    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_cross_origin', actionKind: 'detail', url: 'https://x.com/users', actionSelector: '[data-safe-opener][aria-haspopup=dialog]',
    });

    expect(res.evidence.states).toEqual(['base']);
    expect(engine.extractPageElements).toHaveBeenCalledTimes(1);
    expect(res.evidence.needsReview).toBe(true);
    expect(engine.navigate).toHaveBeenLastCalledWith('https://x.com/users');
  });
});

describe('exploreFeatureEvidenceMap 按 featureId 隔离', () => {
  it('逐功能点独立采集 → 产出 Record<featureId, FeatureEvidence>，元素不跨功能点串用', async () => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const featureTable = buildFeatureTable(['tp_01', 'tp_02']);
    const featurePaths = { tp_01: 'https://x.com/new', tp_02: 'click:#open' };

    const coll = await exploreFeatureEvidenceMap(engine, {
      featurePaths,
      featureTable,
      featureProfiles: [
        { featureId: 'tp_01', testPoint: '新增', actionKind: 'create' },
        { featureId: 'tp_02', testPoint: '删除', actionKind: 'delete' },
      ],
      scope: 'all',
      baseUrl: 'https://x.com',
    });

    // 隔离：每个功能点各自一份证据，键与 featureId 一一对应
    expect(Object.keys(coll.evidence).sort()).toEqual(['tp_01', 'tp_02']);
    expect(coll.evidence['tp_01'].fields).toHaveLength(1);
    expect(coll.evidence['tp_02'].fields).toHaveLength(0);
    expect(coll.evidence['tp_01'].actionKind).toBe('create');
    expect(coll.evidence['tp_02'].actionKind).toBe('delete');
    // click: 目标未在当前快照中精确匹配时不点击；仅 URL 功能点贡献兼容元素。
    expect(coll.elements).toHaveLength(2);
  });

  it('featurePaths 缺失 → 返回空（不报错、不串用）', async () => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    const coll = await exploreFeatureEvidenceMap(engine, { featurePaths: undefined, featureTable: buildFeatureTable(['tp_01']), scope: 'all', baseUrl: 'https://x.com' });
    expect(coll.evidence).toEqual({});
    expect(coll.elements).toEqual([]);
  });

  it('按功能点采集不同页面元素，生成用例时不会把新增字段借给删除功能', async () => {
    const engine = makeEngine([]);
    let currentUrl = '';
    vi.mocked(engine.navigate).mockImplementation(async (url) => { currentUrl = url; });
    vi.mocked(engine.extractPageElements).mockImplementation(async () => currentUrl.endsWith('/create')
      ? SAMPLE_ELEMENTS.filter((item) => item.isFormControl)
      : SAMPLE_ELEMENTS.filter((item) => item.tableInfo));
    const featureTable = buildFeatureTable(['create_01', 'delete_01']);
    const coll = await exploreFeatureEvidenceMap(engine, {
      featurePaths: { create_01: 'https://x.com/create', delete_01: 'https://x.com/archive' },
      featureTable,
      scope: 'all',
      baseUrl: 'https://x.com',
    });

    expect(coll.evidence.create_01.fields.map((field) => field.name)).toEqual(['用户名']);
    expect(coll.evidence.delete_01.fields).toEqual([]);
    expect(coll.evidence.delete_01.tables).toHaveLength(1);
  });

  it('保留可达容器和虚拟列表，同时把跨域/closed shadow/canvas 显式标为 needs_review', async () => {
    const engine = makeEngine([
      {
        ref: 'frame-name', tag: 'input', selector: '#same-frame input[name=name]', text: '姓名', label: '姓名', interactive: true,
        inputType: 'text', isFormControl: true, required: true, suggestedAction: 'fill',
      },
      {
        ref: 'shadow-role', tag: 'select', selector: '#open-shadow select[name=role]', text: '角色', label: '角色', interactive: true,
        inputType: 'select', isFormControl: true, options: ['医生', '护士'], suggestedAction: 'select',
      },
      {
        ref: 'virtual-users', tag: 'div', selector: '#virtual-users', interactive: false, isFormControl: false, suggestedAction: 'navigate',
        tableInfo: { columns: ['姓名'], rowCount: 20, hasPagination: false, hasSorting: false, hasFilter: false, isVirtualList: true },
      },
      {
        ref: 'containers', tag: 'div', selector: '#containers', interactive: false, isFormControl: false, suggestedAction: 'navigate',
        containers: [
          { kind: 'tab', ref: 'tab-basic', selector: '#tab-basic', label: '基本信息', expanded: true },
          { kind: 'drawer', ref: 'drawer-detail', selector: '#drawer-detail', label: '详情', expanded: true },
          { kind: 'collapse', ref: 'collapse-extra', selector: '#collapse-extra', label: '更多', expanded: true },
          { kind: 'iframe', ref: 'same-frame', selector: '#same-frame', label: '同源嵌入', crossOrigin: false },
          { kind: 'shadow', ref: 'open-shadow', selector: '#open-shadow', shadowDom: 'open' },
          { kind: 'virtual_list', ref: 'virtual-users', selector: '#virtual-users' },
        ],
        uncovered: [
          { kind: 'cross_origin_iframe', reason: '跨域 iframe 不可读' },
          { kind: 'closed_shadow_dom', reason: 'closed Shadow DOM 不可读' },
          { kind: 'canvas', reason: 'Canvas 像素语义不可读' },
        ],
      },
    ] as unknown as ExploredElement[]);

    const res = await exploreFeatureEvidence(engine, { featureId: 'semantic_01', actionKind: 'list', url: 'https://x.com/users' });

    expect(res.evidence.fields.map((field) => field.name)).toEqual(expect.arrayContaining(['姓名', '角色']));
    expect(res.evidence.tables).toEqual(expect.arrayContaining([expect.objectContaining({ isVirtualList: true })]));
    expect(res.evidence.containers.map((container) => container.kind)).toEqual(expect.arrayContaining(['tab', 'drawer', 'collapse', 'iframe', 'shadow', 'virtual_list']));
    expect(res.evidence.needsReview).toBe(true);
    expect(res.evidence.reviewReason).toContain('跨域 iframe 不可读');
    expect(res.evidence.uncovered.map((item) => item.kind)).toEqual(expect.arrayContaining(['cross_origin_iframe', 'closed_shadow_dom', 'canvas']));
  });

  it('采集超时仅将当前功能点标为 needs_review，不污染其他功能点', async () => {
    const engine = makeEngine(SAMPLE_ELEMENTS);
    vi.mocked(engine.extractPageElements)
      .mockResolvedValueOnce(SAMPLE_ELEMENTS)
      .mockImplementationOnce(() => new Promise<ExploredElement[]>(() => {}));
    const featureTable = buildFeatureTable(['ready_01', 'timeout_01']);
    const coll = await exploreFeatureEvidenceMap(engine, {
      featurePaths: { ready_01: 'https://x.com/ready', timeout_01: 'https://x.com/slow' },
      featureTable,
      scope: 'all',
      baseUrl: 'https://x.com',
      timeoutMs: 100,
    });

    expect(coll.evidence.ready_01.needsReview).toBe(false);
    expect(coll.evidence.timeout_01).toEqual(expect.objectContaining({ needsReview: true, evidenceLevel: 'needs_review' }));
    expect(coll.evidence.timeout_01.reviewReason).toMatch(/timeout/i);
  });
});
