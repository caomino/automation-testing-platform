import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineOrchestrator } from '../index';
import type { McpEngine } from '@test-platform/engine-mcp';
import type { FeatureRow } from '@test-platform/contracts';
import { setAIClient } from '@test-platform/stage-case';
import { getDefault, createAIClient } from '@test-platform/infra-ai';

// 模拟 infra-ai：默认无默认 provider（模板生成）；测试可临时注入
vi.mock('@test-platform/infra-ai', () => ({
  getDefault: vi.fn(),
  createAIClient: vi.fn(),
}));

// === Mock 引擎 ===
function makeMockEngine(): McpEngine {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    extractPageElements: vi.fn().mockResolvedValue([]), // exploreByFeaturePaths 依赖此方法
    extractSemanticDom: vi.fn().mockResolvedValue([]),
    exploreModules: vi.fn().mockResolvedValue([]),
    runStep: vi.fn().mockResolvedValue(undefined),
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

const SCENARIO_KEYS = ['normal', 'boundary', 'exception', 'process', 'permission'] as const;

describe('orchestrator runStage("case") — 生成测试用例模块', () => {
  let orchestrator: PipelineOrchestrator;
  let mockEngine: McpEngine;

  beforeEach(() => {
    mockEngine = makeMockEngine();
    orchestrator = new PipelineOrchestrator({ engineFactory: () => mockEngine });
    // 默认无默认 provider → 模板生成；createAIClient 返回可控 mock
    vi.mocked(getDefault).mockReturnValue(undefined);
    vi.mocked(createAIClient).mockImplementation(
      () =>
        ({
          complete: async () => ({
            text: '【操作步骤】\n1. 访问页面\n2. 执行操作\n【预期结果】\n系统正常响应',
          }),
        }) as any,
    );
  });

  afterEach(() => {
    setAIClient(null); // 复位 AI 客户端，避免跨用例泄漏
    vi.mocked(getDefault).mockReturnValue(undefined);
  });

  it('按子系统分 sheet，每功能点生成 5 类场景（正常/边界/异常/流程/权限），用例编号绑定功能点标识', async () => {
    const input = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
          fp('2', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '新增', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'all' as const,
      metaConfig: meta,
    };
    const out = await orchestrator.runStage('case', input);

    expect(out.caseWorkbook).toHaveLength(2);
    const names = out.caseWorkbook.map((s) => s.sheetName);
    expect(names).toEqual(['检查室', '排班']);

    for (const sheet of out.caseWorkbook) {
      expect(sheet.rows).toHaveLength(5); // 五类场景
      expect(sheet.rows.map((r) => r.scenarioId).sort()).toEqual([...SCENARIO_KEYS].sort());
      // 用例编号 = 功能点 4 段标识 + 场景后缀 _N1.._N5，绑定正确
      const expected = [
        `${sheet.rows[0].featureId}_N1`,
        `${sheet.rows[0].featureId}_N2`,
        `${sheet.rows[0].featureId}_N3`,
        `${sheet.rows[0].featureId}_N4`,
        `${sheet.rows[0].featureId}_N5`,
      ];
      expect(sheet.rows.map((r) => r.caseNo).sort()).toEqual(expected.sort());
      // 测试内容 = 功能点.测试点
      for (const r of sheet.rows) {
        expect(r.content).toBe(sheet.sheetName === '检查室' ? '查询' : '新增');
        expect(r.firstResult).toBe('\\');
        expect(r.regressionResult).toBe('\\');
        expect(r.conclusion).toBe('\\');
        expect(r.featureId).toBe(sheet.sheetName === '检查室' ? 'QYYX_PZ_JCX_01' : 'QYYX_PZ_PB_01');
      }
    }
  });

  it('scope=selected_modules 仅生成选中子系统', async () => {
    const input = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
          fp('2', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '新增', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'selected_modules' as const,
      selectedModuleIds: ['排班'],
      metaConfig: meta,
    };
    const out = await orchestrator.runStage('case', input);
    expect(out.caseWorkbook).toHaveLength(1);
    expect(out.caseWorkbook[0].sheetName).toBe('排班');
    expect(out.caseWorkbook[0].rows[0].caseNo).toBe('QYYX_PZ_PB_01_N1');
    // 无 featurePaths + 无 exploredElements → 打开浏览器重跑探索兜底（不再静默模板直出）
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
  });

  // === 需求 #2：需要打开浏览器完全按照功能点进行探索 ===
  it('无 exploredElements 且提供 featurePaths 时：打开浏览器并按功能点 URL 二次探索', async () => {
    const input = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
          fp('2', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '新增', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'all' as const,
      metaConfig: meta,
      featurePaths: {
        QYYX_PZ_JCX_01: 'https://x.com/jcx',
        QYYX_PZ_PB_01: 'https://x.com/pb',
      },
    };
    const out = await orchestrator.runStage('case', input);
    // 关键：打开真实浏览器并按每个功能点路径探索（修复空白页根因①）
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.extractPageElements).toHaveBeenCalledWith('https://x.com/jcx');
    expect(mockEngine.extractPageElements).toHaveBeenCalledWith('https://x.com/pb');
    expect(mockEngine.close).toHaveBeenCalled();
    // 探索后仍正确生成 5 场景
    expect(out.caseWorkbook).toHaveLength(2);
    for (const sheet of out.caseWorkbook) expect(sheet.rows).toHaveLength(5);
  });

  it('featurePaths 仅含选中模块 URL 时：只探索选中模块（按 selectedModuleIds 过滤）', async () => {
    const input = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
          fp('2', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '新增', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'selected_modules' as const,
      selectedModuleIds: ['排班'],
      metaConfig: meta,
      featurePaths: {
        QYYX_PZ_JCX_01: 'https://x.com/jcx',
        QYYX_PZ_PB_01: 'https://x.com/pb',
      },
    };
    await orchestrator.runStage('case', input);
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.extractPageElements).toHaveBeenCalledWith('https://x.com/pb');
    expect(mockEngine.extractPageElements).not.toHaveBeenCalledWith('https://x.com/jcx');
  });

  it('已透传 exploredElements 时不打开浏览器（避免重复探索）', async () => {
    const input = {
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all' as const,
      metaConfig: meta,
      exploredElements: [
        { ref: 'btn-save', text: '保存', label: '保存', interactive: true, isFormControl: false, suggestedAction: 'click' },
      ],
    };
    const out = await orchestrator.runStage('case', input);
    expect(mockEngine.launch).not.toHaveBeenCalled(); // 上游已探索，不再开浏览器
    expect(out.caseWorkbook[0].rows).toHaveLength(5);
  });

  it('无 featurePaths 且不传 exploredElements 时：打开浏览器重跑探索兜底（仍无证据才模板）', async () => {
    const input = {
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all' as const,
      metaConfig: meta,
    };
    await orchestrator.runStage('case', input);
    // 需求：生成用例必须驱动浏览器（重跑探索 + 按功能点名称兜底），绝不静默模板直出
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.exploreModules).toHaveBeenCalled();
  });

  it('featurePaths 缺失但页面有同名功能入口时：按功能点名称点击抓取元素（不再静默模板）', async () => {
    const input = {
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all' as const,
      metaConfig: meta,
      systemUrl: 'https://x.com/home',
    };
    // 重跑探索仍返回空（菜单识别失败场景），但页面 DOM 里有文本匹配「检查室管理」的可交互入口
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
      { ref: 'btn-add', text: '新增', label: '新增', interactive: true, isFormControl: false, suggestedAction: 'click' } as never,
    ]);
    await orchestrator.runStage('case', input);
    // 打开浏览器 → 按名称定位并点击功能入口 → 抓取当前页元素
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
    expect(mockEngine.runStep).toHaveBeenCalledWith({ kind: 'click', selector: '#menu-jcx' });
    expect(mockEngine.extractPageElements).toHaveBeenCalled();
  });

  // === 需求 #1：启用 AI 与不启用 双模 ===
  it('aiConfig.enabled=true 且存在默认 provider 时注入 AI 生成 needs_review 用例', async () => {
    vi.mocked(getDefault).mockReturnValue({ id: 'default', provider: 'fake', model: 'm' } as any);
    const input = {
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all' as const,
      metaConfig: meta,
      aiConfig: { configId: 'default', enabled: true },
    };
    const out = await orchestrator.runStage('case', input);
    const rows = out.caseWorkbook[0].rows;
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.evidenceLevel).toBe('needs_review'); // AI 生成需人工复核
      expect(r.needsReview).toBe(true);
    }
    // 无 featurePaths → 打开浏览器重跑探索兜底（不再静默模板）
    expect(mockEngine.launch).toHaveBeenCalledTimes(1);
  });

  it('aiConfig 未启用时：模板生成，不注入 AI（evidenceLevel=derived）', async () => {
    const input = {
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all' as const,
      metaConfig: meta,
      aiConfig: { configId: 'default', enabled: false },
    };
    const out = await orchestrator.runStage('case', input);
    for (const r of out.caseWorkbook[0].rows) {
      expect(r.evidenceLevel).toBe('derived');
      expect(r.needsReview).toBeFalsy();
    }
  });
});
