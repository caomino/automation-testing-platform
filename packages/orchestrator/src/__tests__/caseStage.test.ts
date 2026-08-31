import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineOrchestrator } from '../index';
import type { McpEngine } from '@test-platform/engine-mcp';
import type {
  ActionKind,
  CaseInput,
  CaseOutput,
  FeatureEvidence,
  FeatureProfile,
  FeatureRow,
} from '@test-platform/contracts';
import { getDefault, getProvider, createAIClient } from '@test-platform/infra-ai';
import type { AIProviderConfig } from '@test-platform/infra-ai';
import * as stageFeature from '@test-platform/stage-feature';

vi.mock('@test-platform/infra-ai', () => ({
  getDefault: vi.fn(),
  getProvider: vi.fn(),
  createAIClient: vi.fn(),
}));

vi.mock('@test-platform/stage-feature', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, run: vi.fn(actual.run) };
});

// === Mock 引擎 ===
function makeMockEngine(): McpEngine {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    getCurrentUrl: vi.fn().mockResolvedValue('https://x.com/jcx'),
    extractPageElements: vi.fn().mockResolvedValue([]),
    extractSemanticDom: vi.fn().mockResolvedValue([]),
    exploreModules: vi.fn().mockResolvedValue([]),
    runStep: vi.fn().mockResolvedValue(undefined),
    runReadOnlyClick: vi.fn().mockResolvedValue({ status: 'performed' }),
    runCase: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue({ id: 's1', fileName: 't.png', path: '/t.png' }),
    getSessionCookies: vi.fn().mockResolvedValue(['c=1']),
    getSessionHeaders: vi.fn().mockResolvedValue({}),
    getSessionTokens: vi.fn().mockResolvedValue(['t']),
    applySession: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpEngine;
}

/** 构造一条 9 列功能点行（与 DEFAULT_FEATURE_COLUMNS 顺序一致） */
function fp(
  seq: string,
  type: string,
  system: string,
  mainModule: string,
  subModule: string,
  feature: string,
  testPoint: string,
  testPointId: string,
): FeatureRow {
  return [seq, type, '3.1', system, mainModule, subModule, feature, testPoint, testPointId];
}

/** 构造通过证据门的 FeatureEvidence（feature-driven：按 featureId 隔离） */
function ev(featureId: string, actionKind: ActionKind, fields: string[] = []): FeatureEvidence {
  return {
    featureId,
    actionKind,
    states: actionKind === 'create' ? ['base', 'create'] : ['base'],
    fields: fields.map((name, index) => ({ ref: `${featureId}-field-${index}`, selector: `[name="${name}"]`, name, inputType: 'text', required: false })),
    tables: [],
    actionEntries: [],
    containers: [],
    evidenceLevel: 'observed',
    coverageKeys: [],
    needsReview: false,
    uncovered: [],
  } as FeatureEvidence;
}

/** 构造动作档案（确定 REQUIRED_MATRIX 的动作类型） */
function prof(featureId: string, testPoint: string, actionKind: ActionKind): FeatureProfile {
  return { featureId, testPoint, actionKind, source: 'web' };
}

const meta = {
  systemName: '区域影像系统',
  testPointId: 'QYYX_PZ_JCX',
  testPoint: '检查室',
  testers: '张三',
  clientStaff: '李四',
  developerStaff: '王五',
  firstTestDate: '2026-08-15',
  regressionDate: '',
  conclusionRule: '全部通过为合格',
  precondition: '已登录',
};

describe('orchestrator runStage("case") — 生成测试用例模块 (feature-driven)', () => {
  let orchestrator: PipelineOrchestrator;
  let mockEngine: McpEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEngine = makeMockEngine();
    orchestrator = new PipelineOrchestrator({ engineFactory: () => mockEngine });
    vi.mocked(getDefault).mockReturnValue(undefined);
    vi.mocked(getProvider).mockReturnValue(undefined);
    vi.mocked(createAIClient).mockImplementation(() => ({
      complete: async (req: { prompt: string }) => {
        const match = req.prompt.match(/现有操作步骤：\n([\s\S]*?)\n现有预期结果：\n([\s\S]*?)\n/);
        if (match) {
          return {
            text: JSON.stringify({
              operation: match[1],
              expected: match[2],
            }),
          };
        }
        return {
          text: JSON.stringify({
            operation: '1. 进入【检查室】的【查询】页面\n2. 在 【关键字】 输入页面允许的有效查询条件并执行查询',
            expected: '查询结果与该查询条件匹配。',
          }),
        };
      },
    }));
  });

  afterEach(() => {
    vi.mocked(getDefault).mockReturnValue(undefined);
    vi.mocked(getProvider).mockReturnValue(undefined);
  });

  it('一个功能点 = 一个用例编号(=testPointId)，同一 caseNo 下连续展开多场景', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
          fp(
            '2',
            '功能性测试',
            '区域影像系统',
            '配置',
            '排班',
            '排班管理',
            '新增',
            'QYYX_PZ_PB_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: [
        prof('QYYX_PZ_JCX_01', '查询', 'query'),
        prof('QYYX_PZ_PB_01', '新增', 'create'),
      ],
      featureEvidence: {
        QYYX_PZ_JCX_01: ev('QYYX_PZ_JCX_01', 'query', ['关键字']),
        QYYX_PZ_PB_01: ev('QYYX_PZ_PB_01', 'create', ['名称']),
      },
    };
    const out: CaseOutput = await orchestrator.runStage('case', input);
    expect(stageFeature.run).not.toHaveBeenCalled();
    expect(mockEngine.launch).not.toHaveBeenCalled();
    expect(mockEngine.navigate).not.toHaveBeenCalled();
    expect(mockEngine.extractPageElements).not.toHaveBeenCalled();
    expect(mockEngine.extractSemanticDom).not.toHaveBeenCalled();
    expect(mockEngine.runReadOnlyClick).not.toHaveBeenCalled();
    expect(out.caseWorkbook).toHaveLength(2);
    const names = out.caseWorkbook.map((sheet) => sheet.sheetName);
    expect(names).toEqual(['检查室', '排班']);
    for (const sheet of out.caseWorkbook) {
      const fid = sheet.sheetName === '检查室' ? 'QYYX_PZ_JCX_01' : 'QYYX_PZ_PB_01';
      expect(sheet.rows.length).toBeGreaterThanOrEqual(1);
      for (const r of sheet.rows) {
        expect(r.caseNo).toBe(fid); // 无 _N1.._N5 后缀
        expect(r.featureId).toBe(fid);
        expect(r.content).toBe(sheet.sheetName === '检查室' ? '查询' : '新增');
        expect(r.step).toMatch(/^Step \d+$/); // 连续 Step
      }
    }
    // 功能点级生成结果清单
    expect(out.featureResults).toHaveLength(2);
    expect(out.featureResults?.every((feature) => feature.status === 'generated')).toBe(true);
  });

  it('scope=selected_modules 仅生成选中子系统', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
          fp(
            '2',
            '功能性测试',
            '区域影像系统',
            '配置',
            '排班',
            '排班管理',
            '新增',
            'QYYX_PZ_PB_01',
          ),
        ],
      ],
      scope: 'selected_modules',
      selectedModuleIds: ['排班'],
      metaConfig: meta,
      featureProfiles: [
        prof('QYYX_PZ_JCX_01', '查询', 'query'),
        prof('QYYX_PZ_PB_01', '新增', 'create'),
      ],
      featureEvidence: {
        QYYX_PZ_JCX_01: ev('QYYX_PZ_JCX_01', 'query', ['关键字']),
        QYYX_PZ_PB_01: ev('QYYX_PZ_PB_01', 'create', ['名称']),
      },
    };
    const out: CaseOutput = await orchestrator.runStage('case', input);
    expect(out.caseWorkbook).toHaveLength(1);
    expect(out.caseWorkbook[0].sheetName).toBe('排班');
    expect(out.caseWorkbook[0].rows[0].caseNo).toBe('QYYX_PZ_PB_01');
  });

  // === 需求：打开浏览器完全按照功能点进行探索 ===
  it('提供 featurePaths 但二次探索未获得专属证据时：每个功能点均标记 evidence_missing 且不生成用例', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
          fp(
            '2',
            '功能性测试',
            '区域影像系统',
            '配置',
            '排班',
            '排班管理',
            '新增',
            'QYYX_PZ_PB_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      featurePaths: {
        QYYX_PZ_JCX_01: 'https://x.com/jcx',
        QYYX_PZ_PB_01: 'https://x.com/pb',
      },
      featureProfiles: [
        prof('QYYX_PZ_JCX_01', '查询', 'query'),
        prof('QYYX_PZ_PB_01', '新增', 'create'),
      ],
      featureEvidence: {},
    };
    const out: CaseOutput = await orchestrator.runStage('case', input);
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/jcx');
    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/pb');
    expect(mockEngine.extractPageElements).toHaveBeenCalled();
    expect(mockEngine.close).toHaveBeenCalled();
    expect(out.caseWorkbook).toHaveLength(0);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'QYYX_PZ_JCX_01',
        status: 'evidence_missing',
        generatedCaseGroup: false,
      }),
      expect.objectContaining({
        featureId: 'QYYX_PZ_PB_01',
        status: 'evidence_missing',
        generatedCaseGroup: false,
      }),
    ]);
  });

  it('历史证据缺少当前系统/版本身份时，先触发当前功能点二次探索', async () => {
    const out = await orchestrator.runStage('case', {
      featureTable: [[
        fp('1', '功能性测试', '系统', '模块', '子模块', '查询', '查询', 'IDENTITY_REFRESH_01'),
      ]],
      scope: 'all',
      systemId: 'system-current',
      featureRevision: 'revision-current',
      featurePaths: { IDENTITY_REFRESH_01: 'https://x.com/identity-refresh' },
      featureProfiles: [prof('IDENTITY_REFRESH_01', '查询', 'query')],
      featureEvidence: { IDENTITY_REFRESH_01: ev('IDENTITY_REFRESH_01', 'query', ['关键字']) },
      metaConfig: meta,
    });

    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/identity-refresh');
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'IDENTITY_REFRESH_01',
        status: expect.not.stringMatching(/^generated$/),
      }),
    ]);
  });

  it('路径探索只覆盖部分功能点时，继续对剩余功能点执行名称兜底探索', async () => {
    let currentUrl = '';
    let fallbackClicked = false;
    mockEngine.navigate.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    mockEngine.getCurrentUrl.mockImplementation(async () => currentUrl);
    mockEngine.extractPageElements.mockImplementation(async () => {
      if (currentUrl.endsWith('/a')) {
        return [{
          ref: 'a-name', tag: 'input', selector: '#a-name', text: '', label: '名称',
          interactive: true, isFormControl: true, inputType: 'text', suggestedAction: 'fill',
        }];
      }
      if (fallbackClicked) {
        return [{
          ref: 'b-name', tag: 'input', selector: '#b-name', text: '', label: '名称',
          interactive: true, isFormControl: true, inputType: 'text', required: true, suggestedAction: 'fill',
        }];
      }
      return [];
    });
    mockEngine.extractSemanticDom.mockResolvedValue([
      {
        ref: 'b-menu', tag: 'button', selector: '#b-menu', text: '新增', name: '新增',
        interactive: true, isDataControl: false, safeReadOnlyOpener: true, children: [],
      },
    ] as never);
    mockEngine.runReadOnlyClick.mockImplementation(async () => {
      fallbackClicked = true;
      currentUrl = 'https://x.com/b';
      return { status: 'performed' };
    });

    const out = await orchestrator.runStage('case', {
      featureTable: [[
        fp('1', '功能性测试', 'HIS', 'M', 'S', '查询A', '查询A', 'A'),
        fp('2', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'B'),
      ]],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      metaConfig: meta,
      featurePaths: { A: 'https://x.com/a', B: 'https://x.com/b' },
      featureProfiles: [prof('A', '查询A', 'query'), prof('B', '新增', 'create')],
      featureEvidence: {},
    });

    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/a');
    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/b');
    expect(mockEngine.extractSemanticDom).toHaveBeenCalled();
    expect(out.caseRows.flat().some((row) => row.featureId === 'A')).toBe(true);
    expect(out.caseRows.flat().some((row) => row.featureId === 'B')).toBe(true);
  });

  it('选中模块缺少专属证据且二次探索未获得证据时：只探索选中模块并不生成用例', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
          fp(
            '2',
            '功能性测试',
            '区域影像系统',
            '配置',
            '排班',
            '排班管理',
            '新增',
            'QYYX_PZ_PB_01',
          ),
        ],
      ],
      scope: 'selected_modules',
      selectedModuleIds: ['排班'],
      metaConfig: meta,
      featurePaths: {
        QYYX_PZ_JCX_01: 'https://x.com/jcx',
        QYYX_PZ_PB_01: 'https://x.com/pb',
      },
      featureProfiles: [
        prof('QYYX_PZ_JCX_01', '查询', 'query'),
        prof('QYYX_PZ_PB_01', '新增', 'create'),
      ],
      featureEvidence: {},
    };
    const out = await orchestrator.runStage('case', input);
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/pb');
    expect(mockEngine.navigate).not.toHaveBeenCalledWith('https://x.com/jcx');
    expect(out.caseWorkbook).toHaveLength(0);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'QYYX_PZ_PB_01',
        status: 'evidence_missing',
        generatedCaseGroup: false,
      }),
    ]);
  });

  it('混合 Web 与设计来源且 Web 二次探索未获得证据时：跳过 design profile 并不生成 Web 用例', async () => {
    const out = await orchestrator.runStage('case', {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像', '配置', '用户', '用户管理', '查询', 'WEB_01'),
          fp('2', '接口测试', '区域影像', '接口', '患者', '患者接口', '新增患者', 'API_01'),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      featurePaths: {
        WEB_01: 'https://x.com/users',
        API_01: 'https://x.com/api/patients',
      },
      featureProfiles: [
        prof('WEB_01', '查询', 'query'),
        { featureId: 'API_01', testPoint: '新增患者', actionKind: 'create', source: 'design' },
      ],
      featureEvidence: { API_01: ev('API_01', 'create', ['姓名']) },
    });
    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/users');
    expect(mockEngine.navigate).not.toHaveBeenCalledWith('https://x.com/api/patients');
    expect(
      out.caseWorkbook.flatMap((sheet) => sheet.rows).some((row) => row.featureId === 'WEB_01'),
    ).toBe(false);
    expect(out.featureResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          featureId: 'WEB_01',
          status: 'evidence_missing',
          generatedCaseGroup: false,
        }),
      ]),
    );
  });

  it('Given unrelated global elements and no supplemental feature evidence, When generating cases, Then only the missing feature is evidence_missing with no group', async () => {
    const out = await orchestrator.runStage('case', {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像', '配置', '检查室', '检查室管理', '查询', 'REUSED_01'),
          fp('2', '功能性测试', '区域影像', '配置', '排班', '排班管理', '新增', 'MISSING_01'),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      featurePaths: { REUSED_01: 'https://x.com/reused', MISSING_01: 'https://x.com/missing' },
      featureProfiles: [prof('REUSED_01', '查询', 'query'), prof('MISSING_01', '新增', 'create')],
      featureEvidence: { REUSED_01: ev('REUSED_01', 'query', ['关键字']) },
      exploredElements: [
        {
          ref: 'global',
          tag: 'button',
          selector: '#global-only',
          text: 'GLOBAL_UNRELATED_CONTROL',
          label: 'GLOBAL_UNRELATED_CONTROL',
          interactive: true,
          isFormControl: false,
          suggestedAction: 'click',
        },
      ],
    });

    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/missing');
    expect(mockEngine.navigate).not.toHaveBeenCalledWith('https://x.com/reused');
    expect(out).toEqual(
      expect.objectContaining({
        featureResults: expect.arrayContaining([
          expect.objectContaining({
            featureId: 'MISSING_01',
            status: 'evidence_missing',
            generatedCaseGroup: false,
          }),
        ]),
      }),
    );
    expect(out.caseRows.flat().some((row) => row.featureId === 'MISSING_01')).toBe(false);
  });

  it('无 featurePaths 且不传 exploredElements 时：打开浏览器做名称兜底，仍无证据则 evidence_missing（exploreModules 不再被 case 阶段调用）', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out: CaseOutput = await orchestrator.runStage('case', input);
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.exploreModules).not.toHaveBeenCalled(); // 越界降级已移除
    expect(mockEngine.extractSemanticDom).toHaveBeenCalled(); // 名称兜底
    expect(out.caseWorkbook).toHaveLength(0); // 无证据 → 不生成
    expect(out.featureResults).toHaveLength(1);
    expect(out.featureResults[0].status).toBe('evidence_missing');
  });

  it('featurePaths 缺失但页面有同名功能入口时：按功能点名称点击抓取元素（不再静默模板）', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      systemUrl: 'https://x.com/home',
    };
    vi.mocked(mockEngine.exploreModules).mockResolvedValue([]);
    vi.mocked(mockEngine.extractSemanticDom).mockResolvedValue([
      {
        tag: 'A',
        text: '检查室管理',
        name: '检查室管理',
        selector: '#menu-jcx',
        interactive: true,
        children: [],
        href: '/jcx',
        role: 'menuitem',
        isDataControl: false,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      } as never,
    ]);
    vi.mocked(mockEngine.extractPageElements).mockResolvedValue([
      {
        ref: 'btn-add',
        text: '新增',
        label: '新增',
        interactive: true,
        isFormControl: false,
        suggestedAction: 'click',
      } as never,
    ]);
    await orchestrator.runStage('case', input);
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.runReadOnlyClick).toHaveBeenCalledWith('#menu-jcx', 'action');
    expect(mockEngine.extractPageElements).toHaveBeenCalled();
  });

  it('featurePaths 缺失但名称兜底采到字段时：证据按 featureId 绑定并生成当前功能点用例', async () => {
    const input = {
      featureTable: [[
        fp('1', '功能性测试', '区域影像', '配置', '检查室', '检查室管理', '查询', 'NAME_BOUND_01'),
      ]],
      scope: 'all' as const,
      metaConfig: meta,
      systemUrl: 'https://x.com/home',
      featureProfiles: [prof('NAME_BOUND_01', '查询', 'query')],
    };
    vi.mocked(mockEngine.extractSemanticDom).mockResolvedValue([{
      tag: 'A',
      text: '检查室管理',
      name: '检查室管理',
      selector: '#menu-jcx',
      interactive: true,
      children: [],
      href: '/jcx',
      role: 'menuitem',
      isDataControl: false,
      rect: { x: 0, y: 0, w: 0, h: 0 },
    } as never]);
    vi.mocked(mockEngine.extractPageElements).mockResolvedValue([{
      ref: 'query-field',
      selector: '#keyword',
      label: '关键字',
      inputType: 'text',
      interactive: true,
      isFormControl: true,
      required: false,
    } as never]);

    const out = await orchestrator.runStage('case', input);

    expect(out.featureResults).toEqual([
      expect.objectContaining({ featureId: 'NAME_BOUND_01', status: 'generated', generatedCaseGroup: true }),
    ]);
    expect(out.caseRows.flat().length).toBeGreaterThan(0);
    expect(out.caseRows.flat().every((row) => row.featureId === 'NAME_BOUND_01' && row.caseNo === 'NAME_BOUND_01')).toBe(true);
  });

  it('名称兜底遇到数据控件或非白名单入口时不点击', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      systemUrl: 'https://x.com/home',
    };
    vi.mocked(mockEngine.exploreModules).mockResolvedValue([]);
    vi.mocked(mockEngine.extractSemanticDom).mockResolvedValue([
      {
        tag: 'BUTTON',
        text: '检查室管理',
        name: '检查室管理',
        selector: '#menu-jcx',
        interactive: true,
        children: [],
        isDataControl: true,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      } as never,
    ]);
    await orchestrator.runStage('case', input);
    expect(mockEngine.runReadOnlyClick).not.toHaveBeenCalled();
  });

  it('名称兜底遇到 unsupported 只读能力时零点击、零元素采集', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      systemUrl: 'https://x.com/home',
    };
    vi.mocked(mockEngine.exploreModules).mockResolvedValue([]);
    vi.mocked(mockEngine.extractSemanticDom).mockResolvedValue([
      {
        tag: 'A',
        text: '检查室管理',
        name: '检查室管理',
        selector: '#menu-jcx',
        href: '/jcx',
        interactive: true,
        children: [],
        isDataControl: false,
      } as never,
    ]);
    vi.mocked(mockEngine.runReadOnlyClick!).mockResolvedValue({
      status: 'unsupported',
      reason: 'MCP unavailable',
    });
    const out = await orchestrator.runStage('case', input);
    expect(mockEngine.runStep).not.toHaveBeenCalled();
    expect(mockEngine.extractPageElements).not.toHaveBeenCalled();
    expect(out.caseWorkbook).toHaveLength(0);
    expect(out.caseRows).toEqual([]);
    expect(out).toEqual(
      expect.objectContaining({
        caseRows: [],
        featureResults: [
          expect.objectContaining({
            status: 'needs_review',
            generatedCaseGroup: false,
            reasons: expect.arrayContaining([expect.stringContaining('MCP unavailable')]),
          }),
        ],
      }),
    );
  });

  // === 需求：启用 AI 与不启用 双模（任务级注入） ===
  it('aiConfig.enabled=true 且存在有效 provider 时：任务级注入 AI 客户端生成用例', async () => {
    const provider = {
      id: 'default',
      name: 'Fake provider',
      vendor: 'openai',
      baseUrl: 'https://ai.example.test',
      apiKeyRef: 'fake-key',
      model: 'm',
      enabled: true,
    } satisfies AIProviderConfig;
    vi.mocked(getProvider).mockReturnValue(provider);
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      aiConfig: { configId: 'default', enabled: true },
      featureProfiles: [prof('QYYX_PZ_JCX_01', '查询', 'query')],
      featureEvidence: { QYYX_PZ_JCX_01: ev('QYYX_PZ_JCX_01', 'query', ['关键字']) },
    };
    const out: CaseOutput = await orchestrator.runStage('case', input);
    const rows = out.caseWorkbook[0].rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.caseNo).toBe('QYYX_PZ_JCX_01');
    // AI 润色后的操作文本来自任务级 AI 客户端（安全门通过后才采用，否则回退确定性文本）。
    // 注意：导航前缀 '1. 进入... 2.' 由 assembleFeatureRows 后加，润色只改 simple 部分。
    expect(rows[0].operation).toBe('1. 进入【检查室】的【查询】页面\n2. 在 【关键字】 输入页面允许的有效查询条件并执行查询');
    expect(rows[0].expected).toBe('查询结果与该查询条件匹配。');
  });

  it('aiConfig.enabled=true 但无有效配置：生成前阻断（不静默回退无 AI）', async () => {
    vi.mocked(getProvider).mockReturnValue(undefined);
    vi.mocked(getDefault).mockReturnValue(undefined);
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      aiConfig: { configId: 'default', enabled: true },
    };
    await expect(orchestrator.runStage('case', input)).rejects.toThrow(/未配置有效模型/);
  });

  it.each([
    {
      name: 'provider disabled',
      provider: {
        id: 'default', name: 'Disabled', vendor: 'openai', baseUrl: 'https://ai.example.test',
        apiKeyRef: 'fake-key', model: 'm', enabled: false,
      },
    },
    {
      name: 'provider incomplete',
      provider: {
        id: 'default', name: 'Incomplete', vendor: 'openai', baseUrl: '',
        apiKeyRef: 'fake-key', model: 'm', enabled: true,
      },
    },
  ])('aiConfig.enabled=true 且 $name：生成前阻断', async ({ provider }) => {
    vi.mocked(getProvider).mockReturnValue(provider satisfies AIProviderConfig);
    const input = {
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all' as const,
      metaConfig: meta,
      aiConfig: { configId: 'default', enabled: true },
    };
    await expect(orchestrator.runStage('case', input)).rejects.toThrow(/未配置有效模型/);
    expect(createAIClient).not.toHaveBeenCalled();
  });

  it('aiConfig 未启用时：模板生成，不构造/不调用 AI 客户端', async () => {
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      aiConfig: { configId: 'default', enabled: false },
      featureProfiles: [prof('QYYX_PZ_JCX_01', '查询', 'query')],
      featureEvidence: { QYYX_PZ_JCX_01: ev('QYYX_PZ_JCX_01', 'query', ['关键字']) },
    };
    const out: CaseOutput = await orchestrator.runStage('case', input);
    for (const r of out.caseWorkbook[0].rows) {
      expect(r.caseNo).toBe('QYYX_PZ_JCX_01');
      expect(r.operation).not.toContain('访问【检查室】页面'); // 非 AI 文本
    }
    expect(createAIClient).not.toHaveBeenCalled();
  });

  // === T6 保存闭环：runStage('case') 必须持久化 caseWorkbook 与生成批次元数据 ===
  it('T6 闭环：携带 systemId 生成后落盘 workbook 与 generation，可从 store 复读', async () => {
    const sysId = `sys-t6-${Date.now()}`;
    const input = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            '区域影像系统',
            '配置',
            '检查室',
            '检查室管理',
            '查询',
            'QYYX_PZ_JCX_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
      systemId: sysId,
      featureRevision: 'rev-t6',
      aiConfig: { configId: 'default', enabled: false },
      featureProfiles: [prof('QYYX_PZ_JCX_01', '查询', 'query')],
      exploredElements: [
        {
          ref: 'btn-save',
          tag: 'button',
          text: '保存',
          selector: '#btn-save',
          label: '保存',
          interactive: true,
          isFormControl: false,
          suggestedAction: 'click',
        },
      ],
      featureEvidence: {
        QYYX_PZ_JCX_01: {
          ...ev('QYYX_PZ_JCX_01', 'query', ['关键字']),
          systemId: sysId,
          featureRevision: 'rev-t6',
          pageEntry: sysId,
        },
      },
    } satisfies CaseInput & { systemId: string };
    const out: CaseOutput = await orchestrator.runStage('case', input);
    const store = orchestrator.getStore();

    // ① 用例工作簿落盘（spec §12 / §17.8：刷新不丢失）
    const stored = await store.getCaseTable(sysId);
    expect(stored).not.toBeNull();
    expect(stored![0].rows[0].caseNo).toBe('QYYX_PZ_JCX_01');
    expect(stored![0].rows[0].featureId).toBe('QYYX_PZ_JCX_01');

    // ② 生成批次元数据落盘（batchId / mode 可追溯，§6.5 / §17.7）
    const gens = await store.getCaseGenerations(sysId);
    expect(gens).toHaveLength(1);
    expect(gens[0].mode).toBe('no_ai');
    expect(gens[0].batchId).toBe(out.generation?.batchId);
    expect(gens[0].scope).toBe('all');
  });

  it('case 二次探索在服务重启后恢复持久化 SessionHandle，再进入名称兜底页面', async () => {
    const systemId = 'sys-session-reuse';
    await orchestrator.getStore().saveSession(systemId, {
      sessionId: 'session-1',
      systemId,
      loginStatus: 'ok',
      cookies: ['sid=1'],
      headers: { authorization: 'Bearer test' },
      tokens: ['token=test'],
      expiresAt: Date.now() + 60_000,
      loginAt: Date.now(),
      loginMode: 'manual-takeover',
    });
    const out = await orchestrator.runStage('case', {
      featureTable: [[fp('1', '功能性测试', '系统', '配置', '检查室', '检查室管理', '查询', 'SESSION_01')]],
      scope: 'all',
      systemId,
      systemUrl: 'https://x.com/home',
      metaConfig: meta,
    });

    expect(mockEngine.navigate).toHaveBeenCalledWith('https://x.com/home');
    expect(mockEngine.applySession).toHaveBeenCalledWith({
      cookies: ['sid=1'],
      headers: { authorization: 'Bearer test' },
      tokens: ['token=test'],
    });
    expect(out.featureResults?.[0].status).toBe('evidence_missing');
  });

  it('当前确认功能点表是唯一 case 输入：历史 artifact 行不得重新注入生成批次', async () => {
    const systemId = 'sys-current-table-authority';
    const store = orchestrator.getStore();
    await store.saveFeatureArtifact(systemId, {
      version: 2,
      table: [[fp('1', '功能性测试', '系统', '旧模块', '旧页', '旧功能', '旧查询', 'LEGACY_01')]],
      featurePaths: { LEGACY_01: 'https://x.com/legacy' },
      featureProfiles: [prof('LEGACY_01', '旧查询', 'query')],
      featureEvidence: { LEGACY_01: ev('LEGACY_01', 'query', ['旧字段']) },
      provenance: [],
      designSources: [],
    });

    const out = await orchestrator.runStage('case', {
      systemId,
      featureTable: [[fp('1', '功能性测试', '系统', '当前模块', '当前页', '当前功能', '当前查询', 'CURRENT_01')]],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: [prof('CURRENT_01', '当前查询', 'query')],
      featureEvidence: { CURRENT_01: ev('CURRENT_01', 'query', ['当前字段']) },
    });

    expect(out.featureResults?.map((result) => result.featureId)).toEqual(['CURRENT_01']);
    expect(out.caseRows.flat().every((row) => row.featureId === 'CURRENT_01')).toBe(true);
    expect(out.caseRows.flat().some((row) => row.featureId === 'LEGACY_01')).toBe(false);
  });
});
