/**
 * @file featureEvidenceExplorer.test.ts
 * @description T4 回归：按 featureId 隔离的页面证据采集（替代全局合并，杜绝跨功能点串用）
 */
import { describe, it, expect, vi } from 'vitest';
import type { McpEngine, ExploredElement, FeatureRow } from '@test-platform/contracts';
import { DEFAULT_FEATURE_COLUMNS, FeatureEvidenceSchema } from '@test-platform/contracts';
import { exploreFeatureEvidence, exploreFeatureEvidenceMap, isLeakedToken } from '../featureEvidenceExplorer.js';

describe('isLeakedToken（防止 DOM token 泄漏为字段名）', () => {
  it('识别纯英文标识 token（theSelect / btSelectItem / userName）为泄漏', () => {
    expect(isLeakedToken('theSelect')).toBe(true);
    expect(isLeakedToken('btSelectItem')).toBe(true);
    expect(isLeakedToken('btSelectAll')).toBe(true);
    expect(isLeakedToken('userName')).toBe(true);
  });
  it('带中文的标签（含 placeholder/aria-label）不算泄漏', () => {
    expect(isLeakedToken('请输入用户名')).toBe(false);
    expect(isLeakedToken('查询条件')).toBe(false);
    expect(isLeakedToken('status状态')).toBe(false);
  });
  it('空/undefined 不算泄漏', () => {
    expect(isLeakedToken(undefined)).toBe(false);
    expect(isLeakedToken('')).toBe(false);
  });
});

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
    expect(res.evidence).toEqual(expect.objectContaining({ needsReview: true, reviewReason: expect.stringContaining('样例行') }));
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

describe('Fix-B create/detail 只读打开放行（不误拦新增/详情页）', () => {
  const addBtn = {
    ref: '#add-btn', selector: '#add-btn', tag: 'button', text: '新增用户', label: '新增用户',
    interactive: true, isFormControl: false, role: 'button', suggestedAction: 'click',
  } as unknown as ExploredElement;

  function engineFor(btn: ExploredElement) {
    return {
      navigate: vi.fn().mockResolvedValue(undefined),
      runStep: vi.fn().mockResolvedValue(undefined),
      runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: 'https://x.com/users', afterUrl: 'https://x.com/users/new' }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: vi.fn().mockResolvedValue([btn]),
      getCurrentUrl: vi.fn().mockResolvedValue('https://x.com/users'),
      evaluate: vi.fn().mockResolvedValue(true),
    } as unknown as McpEngine;
  }

  it('actionKind=create 且 clickSelector 非 SAFE_READ_ONLY_OPENER → 仍允许只读点击进入（修复前会被误拦）', async () => {
    const engine = engineFor(addBtn);
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_create', actionKind: 'create', clickSelector: '#add-btn', actionText: '新增用户',
    });
    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('#add-btn', 'action');
    expect(res.evidence.needsReview).toBe(false);
  });

  it('actionKind=other 且 clickSelector 非 SAFE_READ_ONLY_OPENER → 维持原安全门拦截', async () => {
    const engine = engineFor(addBtn);
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_other', actionKind: 'other', clickSelector: '#add-btn', actionText: '新增用户',
    });
    expect(engine.runReadOnlyClick).not.toHaveBeenCalled();
    expect(res.evidence.needsReview).toBe(true);
  });
});

describe('Fix-A entry_only 跨路径改由菜单点击进入（复用登录会话）', () => {
  const addBtn = {
    ref: '#add-btn', selector: '#add-btn', tag: 'button', text: '新增用户', label: '新增用户',
    interactive: true, isFormControl: false, role: 'button', suggestedAction: 'click',
  } as unknown as ExploredElement;
  const baseUrl = 'https://x.com/home';
  const featureUrl = 'https://x.com/cross/path';
  const common = {
    featurePaths: { tp_01: featureUrl } as Record<string, string>,
    featureTable: buildFeatureTable(['tp_01']),
    featureProfiles: [{ featureId: 'tp_01', actionKind: 'create', sourceSelector: '#add-btn', sourceLabel: '新增用户' }] as any,
    selectedModuleIds: [] as string[],
    scope: 'all' as const,
    baseUrl,
    featureIds: new Set(['tp_01']),
    systemId: 'sys1',
    featureRevision: 'rev1',
  };

  function recordingEngine() {
    return {
      navigate: vi.fn().mockResolvedValue(undefined),
      runStep: vi.fn().mockResolvedValue(undefined),
      runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: baseUrl, afterUrl: baseUrl + '#new' }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: vi.fn().mockResolvedValue([addBtn]),
      getCurrentUrl: vi.fn().mockResolvedValue(baseUrl),
      evaluate: vi.fn().mockResolvedValue(true),
    } as unknown as McpEngine;
  }

  it('entry_only：已在入口同文档时**不整页 reload**，直接经菜单点击进入（不直接打开目标 URL）', async () => {
    const engine = recordingEngine();
    await exploreFeatureEvidenceMap(engine, { ...common, crossPathNavigation: 'entry_only' });
    const navCalls = (engine.navigate as any).mock.calls.map((c: string[]) => c[0]);
    // 已在入口同文档（getCurrentUrl 恒为 baseUrl）→ 不应再 reload 回首页。
    // 真实事故：每个功能点前都 navigate(baseUrl)，iframe 形态下连带重置菜单与页签，
    // 用户可见症状就是「每次第一跳都回首页」，且菜单被重置后点不动。
    expect(navCalls).not.toContain(baseUrl);
    expect(navCalls).not.toContain(featureUrl);
    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('#add-btn', 'action');
  });

  it('entry_only：确实离开入口文档时才导航回入口（不是无条件 reload）', async () => {
    const engine = recordingEngine();
    // 模拟上一个功能点把浏览器带离了入口文档（如被重定向到其它路径）
    (engine.getCurrentUrl as any).mockResolvedValue('https://x.com/elsewhere');
    await exploreFeatureEvidenceMap(engine, { ...common, crossPathNavigation: 'entry_only' });
    const navCalls = (engine.navigate as any).mock.calls.map((c: string[]) => c[0]);
    expect(navCalls).toContain(baseUrl);
    expect(navCalls).not.toContain(featureUrl);
  });

  it('allow（默认兼容）：跨路径功能点仍直接打开目标 URL', async () => {
    const engine = recordingEngine();
    await exploreFeatureEvidenceMap(engine, { ...common, crossPathNavigation: 'allow' });
    const navCalls = (engine.navigate as any).mock.calls.map((c: string[]) => c[0]);
    expect(navCalls).toContain(featureUrl);
  });

  it('entry_only 且无显式 clickSelector：回到系统入口后按目标 URL 定位菜单链接并点击进入（不直接打开深链）', async () => {
    const menuLink = {
      ref: 'menu-user', tag: 'a', selector: 'a[href="/cross/path"]', href: 'https://x.com/cross/path',
      text: '用户管理', label: '用户管理', interactive: true, isFormControl: false, suggestedAction: 'click',
    } as unknown as ExploredElement;
    const engine = {
      navigate: vi.fn().mockResolvedValue(undefined),
      runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: baseUrl, afterUrl: baseUrl }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: vi.fn().mockResolvedValue([menuLink, addBtn]),
      getCurrentUrl: vi.fn().mockResolvedValue(baseUrl),
      evaluate: vi.fn().mockResolvedValue('a[href="/cross/path"]'),
    } as unknown as McpEngine;
    await exploreFeatureEvidenceMap(engine, {
      featurePaths: { tp_01: featureUrl } as Record<string, string>,
      featureTable: buildFeatureTable(['tp_01']),
      featureProfiles: [{ featureId: 'tp_01', actionKind: 'list', sourceLabel: '用户管理' }] as any,
      selectedModuleIds: [],
      scope: 'all' as const,
      baseUrl,
      featureIds: new Set(['tp_01']),
      systemId: 'sys1',
      featureRevision: 'rev1',
      crossPathNavigation: 'entry_only',
    });
    const navCalls = (engine.navigate as any).mock.calls.map((c: string[]) => c[0]);
    // 已在入口同文档（getCurrentUrl 恒为 baseUrl）→ 不 reload；无论如何都不打开深链
    expect(navCalls).not.toContain(baseUrl);
    expect(navCalls).not.toContain(featureUrl);
    // 经菜单链接点击进入目标页（满足 #1：点击而非直接跳转）
    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('a[href="/cross/path"]', 'action');
  });
});

describe('Fix-B 自动发现动作入口并采集新增/详情页字段（满足 #2：探索页面所有功能、拿到完整字段）', () => {
  // 列表页：含表格 + "新增用户"按钮 + "查看"按钮（无显式 actionSelector，应自动发现并点击）
  const listPage: ExploredElement[] = [
    {
      ref: 'r2', tag: 'table', selector: 'table', text: '列表', interactive: false,
      label: '列表', isFormControl: false, suggestedAction: 'navigate',
      tableInfo: { columns: ['名称', '状态'], rowCount: 2, hasPagination: true, paginationInfo: '第1/5页', hasSorting: false, sortableColumns: [], hasFilter: false, isVirtualList: false },
    },
    { ref: 'add', tag: 'button', selector: '#add', text: '新增用户', interactive: true, isFormControl: false, suggestedAction: 'click' },
    { ref: 'detail', tag: 'button', selector: '#detail', text: '查看', interactive: true, isFormControl: false, suggestedAction: 'click' },
  ];
  const createForm: ExploredElement[] = [
    { ref: 'c1', tag: 'input', selector: '#cname', label: '用户名称', inputType: 'text', interactive: true, isFormControl: true, required: true, suggestedAction: 'fill' },
    { ref: 'c2', tag: 'input', selector: '#cphone', label: '手机号', inputType: 'text', interactive: true, isFormControl: true, suggestedAction: 'fill' },
  ];
  const detailForm: ExploredElement[] = [
    { ref: 'd1', tag: 'input', selector: '#dname', label: '用户名称', inputType: 'text', interactive: true, isFormControl: true, readonly: true, suggestedAction: 'fill' },
  ];

  function engineWithFlow() {
    const extract = vi.fn();
    extract.mockResolvedValueOnce(listPage).mockResolvedValueOnce(createForm).mockResolvedValueOnce(detailForm).mockResolvedValue(listPage);
    return {
      navigate: vi.fn().mockResolvedValue(undefined),
      runStep: vi.fn().mockResolvedValue(undefined),
      runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: 'https://x.com/users', afterUrl: 'https://x.com/users#dialog' }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: extract,
      getCurrentUrl: vi.fn().mockResolvedValue('https://x.com/users'),
      evaluate: vi.fn().mockResolvedValue(true),
    } as unknown as McpEngine;
  }

  it('无 actionSelector 时：自动发现"新增用户"并点击，采集新增表单字段（含中文 label，无 token 泄漏）', async () => {
    const engine = engineWithFlow();
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_list', url: 'https://x.com/users' });

    // 必须点击了"新增用户"按钮（而非直接跳转）
    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('#add', 'action');
    // 必须点击了"查看"按钮（详情页）
    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('#detail', 'action');
    // 证据含 create 状态与新增表单字段
    expect(res.evidence.states).toContain('create');
    expect(res.evidence.states).toContain('detail');
    const fieldNames = res.evidence.fields.map((field) => field.name);
    expect(fieldNames).toContain('用户名称');
    expect(fieldNames).toContain('手机号');
    // 不得出现任何 DOM token 泄漏字段名
    expect(fieldNames.some((name) => isLeakedToken(name))).toBe(false);
    // 动作入口被记录
    expect(res.evidence.actionEntries.some((entry) => entry.actionKind === 'create' && entry.triggerable)).toBe(true);
    expect(res.evidence.actionEntries.some((entry) => entry.actionKind === 'detail' && entry.triggerable)).toBe(true);
  });

  it('仅发现一个 create 与一个 detail，不重复采集同名模态', async () => {
    const engine = engineWithFlow();
    const res = await exploreFeatureEvidence(engine, { featureId: 'tp_dedup', url: 'https://x.com/users' });
    // create / detail 各一个入口
    expect(res.evidence.actionEntries.filter((entry) => entry.actionKind === 'create').length).toBe(1);
    expect(res.evidence.actionEntries.filter((entry) => entry.actionKind === 'detail').length).toBe(1);
  });
});

describe('Fix-E 无 href 菜单点击进入 + entryClick 基础安全 + 有界全按钮遍历（真实若依 AdminLTE 形态回归）', () => {
  const baseUrl = 'https://x.com/index';
  const featureUrl = 'https://x.com/system/role';
  // AdminLTE 形态：菜单 a[data-id] 无 href、无 opener 动词 —— 路径信号在 data-id 上
  const menuNoHref = {
    ref: 'menu-role', tag: 'a', selector: 'a[data-id="/system/role"]',
    'data-id': '/system/role',
    text: '角色管理', label: '角色管理', interactive: true, isFormControl: false, suggestedAction: 'click',
  } as unknown as ExploredElement;

  it('findMenuEntrySelector：无 href 菜单按 data-id 路径信号定位并打标返回 selector，点击进入不 navigate 深链', async () => {
    const engine = {
      navigate: vi.fn().mockResolvedValue(undefined),
      runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: baseUrl, afterUrl: baseUrl }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: vi.fn().mockResolvedValue([menuNoHref]),
      getCurrentUrl: vi.fn().mockResolvedValue(featureUrl),
      evaluate: vi.fn().mockResolvedValue('[data-explore-target="mabc123"]'),
    } as unknown as McpEngine;
    await exploreFeatureEvidenceMap(engine, {
      featurePaths: { tp_01: featureUrl } as Record<string, string>,
      featureTable: buildFeatureTable(['tp_01']),
      featureProfiles: [{ featureId: 'tp_01', actionKind: 'list', sourceLabel: '角色管理' }] as any,
      selectedModuleIds: [],
      scope: 'all' as const,
      baseUrl,
      featureIds: new Set(['tp_01']),
      systemId: 'sys1',
      featureRevision: 'rev1',
      crossPathNavigation: 'entry_only',
    });
    const navCalls = (engine.navigate as any).mock.calls.map((c: string[]) => c[0]);
    expect(navCalls).toContain(baseUrl);
    expect(navCalls).not.toContain(featureUrl); // 不直接打开深链
    // 点击经打标 selector（runReadOnlyClick 由 clickSelector 驱动）
    const clickCalls = (engine.runReadOnlyClick as any).mock.calls.map((c: string[]) => c[0]);
    expect(clickCalls.some((s: string) => typeof s === 'string' && s.includes('data-explore-target'))).toBe(true);
  });

  it('entryClick 模式：无 href、无 opener 动词的菜单按基础安全放行（isSafeCurrentNode 的动作级校验不再误拒）', async () => {
    const engine = {
      navigate: vi.fn().mockResolvedValue(undefined),
      runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: baseUrl, afterUrl: baseUrl }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: vi.fn().mockResolvedValue([menuNoHref]),
      getCurrentUrl: vi.fn().mockResolvedValue(featureUrl),
      evaluate: vi.fn().mockResolvedValue('[data-explore-target="mxyz"]'),
    } as unknown as McpEngine;
    const { evidence } = await exploreFeatureEvidenceMap(engine, {
      featurePaths: { tp_01: featureUrl } as Record<string, string>,
      featureTable: buildFeatureTable(['tp_01']),
      featureProfiles: [{ featureId: 'tp_01', actionKind: 'list', sourceLabel: '角色管理' }] as any,
      selectedModuleIds: [],
      scope: 'all' as const,
      baseUrl,
      featureIds: new Set(['tp_01']),
      systemId: 'sys1',
      featureRevision: 'rev1',
      crossPathNavigation: 'entry_only',
    });
    const ev = (evidence as any).tp_01;
    // 菜单点击进入成功（此前误拒 → needs_review「clickSelector 未匹配当前安全语义节点」）
    expect(ev.needsReview).toBe(false);
  });

  it('②-extra-b 全按钮遍历：普通安全按钮（如「查询」）也被点击并采集 views 状态', async () => {
    const queryBtn = {
      ref: '#q-btn', selector: '#q-btn', tag: 'button', text: '查询', label: '查询',
      interactive: true, isFormControl: false, suggestedAction: 'click',
    } as unknown as ExploredElement;
    const engine = {
      navigate: vi.fn().mockResolvedValue(undefined),
      runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed', beforeUrl: featureUrl, afterUrl: featureUrl }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: vi.fn().mockResolvedValue([queryBtn]),
      getCurrentUrl: vi.fn().mockResolvedValue(featureUrl),
    } as unknown as McpEngine;
    const { evidence } = await exploreFeatureEvidence(engine, {
      featureId: 'tp_02',
      actionKind: 'list',
      url: featureUrl,
    });
    // 「查询」按钮被点击（此前 create/detail 两类之外完全不点）
    expect(engine.runReadOnlyClick).toHaveBeenCalledWith('#q-btn', 'action');
    const ev = (evidence as any);
    expect(ev.needsReview).toBe(false);
  });
});

describe('二次探索「只点不跳」回归（用户裁定：禁止按地址跳转功能页）', () => {
  const baseUrl = 'https://x.com/index';
  const featureUrl = 'https://x.com/system/user';

  const mkEngine = (opts: { elements: any[]; clickStatus?: string } = { elements: [] }) => {
    const calls: { navigate: string[]; click: string[] } = { navigate: [], click: [] };
    const engine = {
      navigate: vi.fn(async (u: string) => { calls.navigate.push(u); }),
      runReadOnlyClick: vi.fn(async (sel: string) => {
        calls.click.push(sel);
        return { status: (opts.clickStatus ?? 'performed') as 'performed', beforeUrl: baseUrl, afterUrl: baseUrl };
      }),
      waitForTimeout: vi.fn(async () => {}),
      extractPageElements: vi.fn(async () => opts.elements),
      getCurrentUrl: vi.fn(async () => baseUrl),
      // 菜单路径打标：clickMenuByPath 先用 evaluate 给目标元素打 data-explore-target，
      // 再回读可见文本按 text= 点击。mock 需如实模拟这两步，否则菜单点击链路走不到。
      evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
        const text = typeof args[0] === 'string' ? (args[0] as string) : '';
        if (text) return `[data-explore-target="m-${text}"]`;   // 打标结果
        return text;                                             // 回读元素文本
      }),
    };
    return { engine: engine as unknown as McpEngine, calls };
  };

  const mkProfile = (extra: Record<string, unknown> = {}) => [{
    featureId: 'F1', testPoint: '用户管理', actionKind: 'list', sourceLabel: '用户管理',
    sourceSelector: 'menu:系统管理>用户管理', ...extra,
  }] as any;

  it('① 菜单路径进入：绝不导航功能页 URL（navigate 只允许系统入口）', async () => {
    const { engine, calls } = mkEngine();
    await exploreFeatureEvidenceMap(engine, {
      featurePaths: { F1: featureUrl } as Record<string, string>,
      featureTable: [[['1', '功能性测试', '1.0.0', 'A', 'B', '用户管理', '用户管理', '用户列表', 'F1']]] as any,
      featureProfiles: mkProfile(),
      selectedModuleIds: [], scope: 'all' as const, baseUrl,
      featureIds: new Set(['F1']), systemId: 's1', featureRevision: 'r1',
      crossPathNavigation: 'entry_only',
    });
    expect(calls.navigate.some((u) => u.includes('/system/user'))).toBe(false);
    expect(calls.click.length).toBeGreaterThan(0);
  });

  it('② 全按钮遍历跳过导航链接（带真实 href 的 <a>）：点它会离开当前功能页，导致后续按钮全超时', async () => {
    const navLink = { ref: 'a1', selector: '#menu-role', tag: 'a', text: '角色管理', label: '角色管理',
      href: '/system/role', interactive: true, isFormControl: false, suggestedAction: 'navigate' } as unknown as ExploredElement;
    const queryBtn = { ref: '#q', selector: '#q', tag: 'button', text: '查询', label: '查询',
      interactive: true, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement;
    const { engine, calls } = mkEngine({ elements: [navLink, queryBtn] });
    await exploreFeatureEvidenceMap(engine, {
      featurePaths: { F1: featureUrl } as Record<string, string>,
      featureTable: [[['1', '功能性测试', '1.0.0', 'A', 'B', '用户管理', '用户管理', '用户列表', 'F1']]] as any,
      featureProfiles: mkProfile(),
      selectedModuleIds: [], scope: 'all' as const, baseUrl,
      featureIds: new Set(['F1']), systemId: 's1', featureRevision: 'r2',
      crossPathNavigation: 'entry_only',
    });
    expect(calls.click).not.toContain('#menu-role');   // 导航链接不作为功能按钮遍历
  });

  it('③ entryClick 模式下菜单点击失败：诚实记 needs_review，不退回按地址打开功能页', async () => {
    const { engine, calls } = mkEngine({ elements: [], clickStatus: 'blocked' });
    const { evidence } = await exploreFeatureEvidenceMap(engine, {
      featurePaths: { F1: featureUrl } as Record<string, string>,
      featureTable: [[['1', '功能性测试', '1.0.0', 'A', 'B', '用户管理', '用户管理', '用户列表', 'F1']]] as any,
      featureProfiles: [{ featureId: 'F1', testPoint: '用户管理', actionKind: 'list', sourceLabel: '用户管理',
        sourceSelector: 'click:#menu-user' }] as any,
      selectedModuleIds: [], scope: 'all' as const, baseUrl,
      featureIds: new Set(['F1']), systemId: 's1', featureRevision: 'r3',
      crossPathNavigation: 'entry_only',
    });
    expect(calls.navigate.some((u) => u.includes('/system/user'))).toBe(false);
    expect((evidence as any).F1.needsReview).toBe(true);
  });
});

describe('全按钮遍历：事前跳过导航/结构标签（点了就离开当前功能页）', () => {
  const baseUrl = 'https://x.com/index';
  const navLi = { ref: 'li1', selector: 'div > div > ul > li', tag: 'li', text: '用户管理 用户管理',
    label: '用户管理 用户管理', interactive: true, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement;
  const addBtn = { ref: '#add', selector: '#add', tag: 'button', text: '新增', label: '新增',
    interactive: true, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement;

  it('侧栏 li 菜单项不进遍历，动作按钮进遍历', async () => {
    const clicks: string[] = [];
    const engine = {
      navigate: vi.fn(async () => {}),
      runReadOnlyClick: vi.fn(async (sel: string) => { clicks.push(sel); return { status: 'performed' as const, beforeUrl: baseUrl, afterUrl: baseUrl }; }),
      waitForTimeout: vi.fn(async () => {}),
      extractPageElements: vi.fn(async () => [navLi, addBtn]),
      getCurrentUrl: vi.fn(async () => baseUrl),
      evaluate: vi.fn(async (_fn: unknown, ...args: unknown[]) => {
        const t = typeof args[0] === 'string' ? (args[0] as string) : '';
        return t ? `[data-explore-target="m-${t}"]` : t;
      }),
    };
    await exploreFeatureEvidenceMap(engine as unknown as McpEngine, {
      featurePaths: { F1: 'https://x.com/system/user' } as Record<string, string>,
      featureTable: [[['1', '功能性测试', '1.0.0', 'A', 'B', '用户管理', '用户管理', '用户列表', 'F1']]] as any,
      featureProfiles: [{ featureId: 'F1', testPoint: '用户管理', actionKind: 'list', sourceLabel: '用户管理',
        sourceSelector: 'menu:系统管理>用户管理' }] as any,
      selectedModuleIds: [], scope: 'all' as const, baseUrl,
      featureIds: new Set(['F1']), systemId: 's1', featureRevision: 'r-nav',
      crossPathNavigation: 'entry_only',
    });
    expect(clicks).not.toContain('div > div > ul > li');
    expect(clicks).toContain('#add');
  });
});

describe('导航 vs 动作：判据是 href 而非标签（大量后台把按钮写成 <a href="javascript:;">）', () => {
  const baseUrl = 'https://x.com/index';
  it('<a href="javascript:;">动作按钮应被遍历；<a href="/path">导航链接应被跳过', async () => {
    const jsBtn = { ref: 'j1', selector: 'a.btn-primary', tag: 'a', text: '新增', label: '新增',
      href: 'javascript:;', interactive: true, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement;
    const navLink = { ref: 'n1', selector: 'a[href="/system/role"]', tag: 'a', text: '角色管理', label: '角色管理',
      href: '/system/role', interactive: true, isFormControl: false, suggestedAction: 'navigate' } as unknown as ExploredElement;
    const clicks: string[] = [];
    const engine = {
      navigate: vi.fn(async () => {}),
      runReadOnlyClick: vi.fn(async (sel: string) => { clicks.push(sel); return { status: 'performed' as const, beforeUrl: baseUrl, afterUrl: baseUrl }; }),
      waitForTimeout: vi.fn(async () => {}),
      extractPageElements: vi.fn(async () => [jsBtn, navLink]),
      getCurrentUrl: vi.fn(async () => baseUrl),
      evaluate: vi.fn(async (_fn: unknown, ...args: unknown[]) => {
        const t = typeof args[0] === 'string' ? (args[0] as string) : '';
        return t ? `[data-explore-target="m-${t}"]` : t;
      }),
    };
    await exploreFeatureEvidenceMap(engine as unknown as McpEngine, {
      featurePaths: { F1: 'https://x.com/system/user' } as Record<string, string>,
      featureTable: [[['1', '功能性测试', '1.0.0', 'A', 'B', '用户管理', '用户管理', '用户列表', 'F1']]] as any,
      featureProfiles: [{ featureId: 'F1', testPoint: '用户管理', actionKind: 'list', sourceLabel: '用户管理',
        sourceSelector: 'menu:系统管理>用户管理' }] as any,
      selectedModuleIds: [], scope: 'all' as const, baseUrl,
      featureIds: new Set(['F1']), systemId: 's1', featureRevision: 'r-href',
      crossPathNavigation: 'entry_only',
    });
    expect(clicks).toContain('a.btn-primary');                                   // 动作按钮必须进遍历
    expect(clicks).not.toContain('a[href="/system/role"]');                     // 导航链接必须跳过
  });
});

describe('浮层关闭：跨系统通用性（不依赖可见文本、不依赖框架类名）', () => {
  const baseUrl = 'https://x.com/index';
  const listPage: ExploredElement[] = [
    { ref: 'btn', selector: '#btn', tag: 'button', text: '新增', label: '新增', interactive: true, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement,
  ];
  // 弹窗态：多出若干表单字段（特征变化 ⇒ 同页叠加层）+ 一个关闭控件
  const withOverlay = (closeEl: ExploredElement): ExploredElement[] => [
    ...listPage,
    closeEl,
    { ref: 'f1', selector: '#f1', tag: 'input', label: '用户名称', interactive: true, isFormControl: true, suggestedAction: 'fill' } as unknown as ExploredElement,
    { ref: 'f2', selector: '#f2', tag: 'input', label: '手机号', interactive: true, isFormControl: true, suggestedAction: 'fill' } as unknown as ExploredElement,
    { ref: 'f3', selector: '#f3', tag: 'input', label: '邮箱', interactive: true, isFormControl: true, suggestedAction: 'fill' } as unknown as ExploredElement,
  ];
  const build = (closeEl: ExploredElement | undefined) => {
    const clicks: string[] = [];
    const extract = vi.fn();
    extract.mockResolvedValueOnce(listPage);                                  // base
    if (closeEl) extract.mockResolvedValueOnce(withOverlay(closeEl));           // 点击后：弹窗打开
    extract.mockResolvedValue(listPage);                                       // 恢复后
    const engine = {
      navigate: vi.fn(async () => {}),
      runStep: vi.fn(async () => ({})),
      runReadOnlyClick: vi.fn(async (sel: string) => { clicks.push(sel); return { status: 'performed' as const, beforeUrl: baseUrl, afterUrl: baseUrl }; }),
      waitForTimeout: vi.fn(async () => {}),
      extractPageElements: extract,
      getCurrentUrl: vi.fn(async () => baseUrl),
      evaluate: vi.fn(async (_fn: unknown, ...args: unknown[]) => {
        const t = typeof args[0] === 'string' ? (args[0] as string) : '';
        return t ? `[data-explore-target="m-${t}"]` : t;
      }),
    };
    return { engine: engine as unknown as McpEngine, clicks };
  };
  const opts = {
    featurePaths: { F1: 'https://x.com/system/user' } as Record<string, string>,
    featureTable: [[['1', '功能性测试', '1.0.0', 'A', 'B', '用户管理', '用户管理', '用户列表', 'F1']]] as any,
    featureProfiles: [{ featureId: 'F1', testPoint: '用户管理', actionKind: 'list', sourceLabel: '用户管理',
      sourceSelector: 'menu:系统管理>用户管理' }] as any,
    selectedModuleIds: [], scope: 'all' as const, baseUrl,
    featureIds: new Set(['F1']), systemId: 's1', featureRevision: 'r-ov',
    crossPathNavigation: 'entry_only' as const,
  };

  it('图标化关闭钮（无可见文本、只有 aria-label）也能被点掉', async () => {
    const { engine, clicks } = build({ ref: 'x', selector: '.icon-x', tag: 'i', text: '', label: '', ariaLabel: 'Close',
      interactive: true, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement);
    await exploreFeatureEvidenceMap(engine, opts);
    expect(clicks).toContain('.icon-x');
  });

  it('英文关闭语义（Close）同样命中 —— 非中文专属清单', async () => {
    const { engine, clicks } = build({ ref: 'c', selector: '#close-btn', tag: 'button', text: 'Close', label: 'Close',
      interactive: true, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement);
    await exploreFeatureEvidenceMap(engine, opts);
    expect(clicks).toContain('#close-btn');
  });

  it('弹窗里没有任何可识别关闭控件时，退化为 Escape 键（零文案依赖兜底）', async () => {
    // 弹窗打开但没有关闭语义控件 → 关闭控件通道落空 → 走 Escape
    const { engine } = build({ ref: 'junk', selector: '#junk', tag: 'span', text: '提示', label: '提示',
      interactive: false, isFormControl: false, suggestedAction: 'click' } as unknown as ExploredElement);
    await exploreFeatureEvidenceMap(engine, opts);
    const keys = (engine.runStep as any).mock.calls.map((c: any[]) => c[0]?.key);
    expect(keys).toContain('Escape');
  });
});

/**
 * 回归锁定：本次两个用户可见问题的修复
 *  ① 每个功能点「首跳回首页」—— 已在入口同文档时不得再整页 reload
 *  ② 「新增/修改」按钮未被探索 —— 修改类入口必须与新增同等可达
 * 判据全部为通用动作语义，无任何系统/框架指纹。
 */
describe('回归：修改/编辑入口与新增同等可达（打开表单≠写入）', () => {
  /** 列表页：含表格 + 「修改」按钮 + 「保存」按钮（后者必须永不点击） */
  const listWithEdit: ExploredElement[] = [
    {
      ref: 't1', tag: 'table', selector: 'table', text: '列表', interactive: false,
      label: '列表', isFormControl: false, suggestedAction: 'navigate',
      tableInfo: {
        columns: ['用户ID', '登录名称', '用户状态'], rowCount: 2, hasPagination: true,
        paginationInfo: '第1/2页', hasSorting: false, sortableColumns: [], hasFilter: false, isVirtualList: false,
      },
    },
    {
      ref: 'b1', tag: 'button', selector: 'button:has-text("修改")', text: '修改', interactive: true,
      label: '修改', isFormControl: false, suggestedAction: 'click',
    },
    {
      ref: 'b2', tag: 'button', selector: 'button:has-text("保存")', text: '保存', interactive: true,
      label: '保存', isFormControl: false, suggestedAction: 'click',
    },
  ];
  /** 点击「修改」后弹出的编辑表单（含只读字段） */
  const editForm: ExploredElement[] = [
    ...listWithEdit,
    {
      ref: 'f1', tag: 'input', selector: "input[name='loginName']", text: '登录名称', interactive: true,
      label: '登录名称', inputType: 'text', isFormControl: true, readonly: true, suggestedAction: 'fill',
    },
    {
      ref: 'f2', tag: 'input', selector: "input[name='nickName']", text: '用户名称', interactive: true,
      label: '用户名称', inputType: 'text', isFormControl: true, required: true, suggestedAction: 'fill',
    },
  ];

  function editEngine(): McpEngine {
    return {
      navigate: vi.fn().mockResolvedValue(undefined),
      runStep: vi.fn().mockResolvedValue(undefined),
      // 只有「修改」能点成功；「保存」一律被引擎层拦截（模拟写请求守卫）
      runReadOnlyClick: vi.fn().mockImplementation(async (selector: string) =>
        /保存/.test(selector)
          ? { status: 'blocked', beforeUrl: 'https://x.com/users', afterUrl: 'https://x.com/users', reason: '写操作已拦截' }
          : { status: 'performed', beforeUrl: 'https://x.com/users', afterUrl: 'https://x.com/users' }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      extractPageElements: vi
        .fn()
        .mockResolvedValueOnce(listWithEdit)   // base
        .mockResolvedValueOnce(editForm)      // 点「修改」后
        .mockResolvedValue(listWithEdit),
      getCurrentUrl: vi.fn().mockResolvedValue('https://x.com/users'),
      evaluate: vi.fn().mockResolvedValue(true),
    } as unknown as McpEngine;
  }

  it('「修改」按钮进入遍历候选并被点击，采集到编辑表单字段（states 含 update）', async () => {
    const engine = editEngine();
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_edit',
      actionKind: 'list',
      url: 'https://x.com/users',
    });

    const clicked = (engine.runReadOnlyClick as any).mock.calls.map((c: string[]) => c[0]);
    expect(clicked.some((s: string) => /修改/.test(s))).toBe(true);
    expect(res.evidence.states).toContain('update');
    expect(res.evidence.actionEntries.some((e) => e.actionKind === 'update' && e.observed)).toBe(true);
    // 编辑表单独有的字段被采到
    expect(res.evidence.fields.map((f) => f.name)).toContain('用户名称');
  });

  it('「保存」按钮永不被点击（提交类写操作红线）', async () => {
    const engine = editEngine();
    const res = await exploreFeatureEvidence(engine, {
      featureId: 'tp_edit2',
      actionKind: 'list',
      url: 'https://x.com/users',
    });
    const clicked = (engine.runReadOnlyClick as any).mock.calls.map((c: string[]) => c[0]);
    expect(clicked.some((s: string) => /保存/.test(s))).toBe(false);
    // 未因「保存」不可点而阻断：编辑表单证据仍应保留
    expect(res.evidence.fields.length).toBeGreaterThan(0);
  });
});
