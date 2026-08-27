import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCaseInput, createPipelineService, toCaseView } from './pipeline';
import type { FeatureRowView, MetaHeader } from '../context';
import type { CaseInput, CaseSheet, FeatureEvidence } from '@test-platform/contracts';

const featureRows: FeatureRowView[] = [
  {
    seq: '1',
    type: '功能性测试',
    chapter: '3.1',
    system: '区域影像系统',
    mainModule: '配置',
    subModule: '检查室',
    feature: '检查室管理',
    testPoint: '查询',
    testPointId: 'QYYX_PZ_JCX_01',
  },
  {
    seq: '2',
    type: '功能性测试',
    chapter: '3.1',
    system: '区域影像系统',
    mainModule: '配置',
    subModule: '排班',
    feature: '排班管理',
    testPoint: '新增',
    testPointId: 'QYYX_PZ_PB_01',
  },
];

const metaHeader: MetaHeader = {
  system: '区域影像系统',
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

const currentCaseWorkbook: CaseSheet[] = [
  {
    sheetName: '检查室',
    meta: {
      systemName: '区域影像系统',
      testPointId: 'QYYX_PZ_JCX_01',
      testPoint: '查询',
      testers: '张三',
      clientStaff: '李四',
      developerStaff: '王五',
      firstTestDate: '2026-08-15',
      regressionDate: '',
      conclusionRule: '全部通过为合格',
      precondition: '已登录',
    },
    rows: [
      {
        caseNo: 'QYYX_PZ_JCX_01',
        content: '查询',
        step: 'Step 1',
        operation: '保留人工查询步骤',
        expected: '保留人工编辑',
        firstResult: '\\',
        regressionResult: '\\',
        conclusion: '\\',
        id: 'manual-query-step',
        featureId: 'QYYX_PZ_JCX_01',
        batchId: 'pipeline-case-manual-batch',
        targetTestPoint: '查询',
        manualEdited: true,
        origin: 'user_edited',
      },
    ],
    colWidths: [18, 16, 8, 34, 34, 14, 14, 12],
    screenshotRef: 'pipeline-case-manual.png',
    remarkRow: '保留检查室人工查询用例',
  },
];

describe('buildCaseInput — 生成测试用例输入契约（case 模块）', () => {
  it('featureTable 必须是 FeatureRow[][]（双层：一分组含整行；不可拍平成单层）', () => {
    const input = buildCaseInput(featureRows, ['排班'], metaHeader, 'selected_modules');
    const ft = input.featureTable;
    expect(Array.isArray(ft)).toBe(true); // 外层分组
    expect(Array.isArray(ft[0])).toBe(true); // 分组内是行数组
    expect(Array.isArray(ft[0][0])).toBe(true); // 关键：第一项是「整行」数组，而非字符
    expect(ft[0][0]).toHaveLength(9); // 每行 9 列
    expect(ft[0][0][8]).toBe('QYYX_PZ_JCX_01'); // 第 8 列为测试点标识
  });

  it('扁平化后是整行而非字符：stage-case 的 featureTable.flat() 能正确取到行', () => {
    const input = buildCaseInput(featureRows, [], metaHeader, 'all');
    const flat = input.featureTable.flat();
    expect(Array.isArray(flat[0])).toBe(true);
    expect(flat[0]).toHaveLength(9);
    expect(flat[0][8]).toBe('QYYX_PZ_JCX_01');
    expect(flat[1][8]).toBe('QYYX_PZ_PB_01');
  });

  it('scope=selected_modules 时透传 selectedModuleIds；scope=all 时为 undefined', () => {
    const sel = buildCaseInput(featureRows, ['排班'], metaHeader, 'selected_modules');
    expect(sel.scope).toBe('selected_modules');
    expect(sel.selectedModuleIds).toEqual(['排班']);
    const all = buildCaseInput(featureRows, ['排班'], metaHeader, 'all');
    expect(all.scope).toBe('all');
    expect(all.selectedModuleIds).toBeUndefined();
  });

  it('metaConfig 由 metaHeader 映射而来（system→systemName 等）', () => {
    const input = buildCaseInput(featureRows, [], metaHeader, 'all');
    expect(input.metaConfig.systemName).toBe('区域影像系统');
    expect(input.metaConfig.testPointId).toBe('QYYX_PZ_JCX');
    expect(input.metaConfig.precondition).toBe('已登录');
  });

  it('透传 featurePaths（来自功能点阶段，根因解法：探索阶段路径传到 case 阶段）', () => {
    const paths = { QYYX_PZ_JCX_01: 'https://x.com/jcx', QYYX_PZ_PB_01: 'https://x.com/pb' };
    const input = buildCaseInput(featureRows, [], metaHeader, 'all', paths);
    expect(input.featurePaths).toEqual(paths);
    // 不传时缺省 undefined
    const def = buildCaseInput(featureRows, [], metaHeader, 'all');
    expect(def.featurePaths).toBeUndefined();
  });

  it('透传按 featureId 隔离的结构化页面证据', () => {
    const evidence: Record<string, FeatureEvidence> = {
      QYYX_PZ_PB_01: {
        featureId: 'QYYX_PZ_PB_01',
        actionKind: 'create',
        states: ['create'],
        fields: [],
        tables: [],
        actionEntries: [],
        containers: [],
        evidenceLevel: 'observed',
        coverageKeys: ['create.ready'],
        needsReview: false,
        uncovered: [],
      },
    };
    const input = buildCaseInput(
      featureRows,
      [],
      metaHeader,
      'all',
      undefined,
      false,
      undefined,
      evidence,
    );
    expect(input.featureEvidence).toEqual(evidence);
  });

  it('aiEnabled=true => aiConfig.enabled 为 true；缺省为 false（双模开关）', () => {
    const on = buildCaseInput(featureRows, [], metaHeader, 'all', undefined, true);
    expect(on.aiConfig?.enabled).toBe(true);
    const off = buildCaseInput(featureRows, [], metaHeader, 'all');
    expect(off.aiConfig?.enabled).toBe(false);
  });

  it('regenerateSelected=true => 透传（明确重新生成选中模块，定点替换不覆盖其他模块）', () => {
    const regen = buildCaseInput(
      featureRows,
      ['排班'],
      metaHeader,
      'selected_modules',
      undefined,
      false,
      undefined,
      undefined,
      true,
    );
    expect(regen.regenerateSelected).toBe(true);
    expect(regen.scope).toBe('selected_modules');
    // 缺省不携带，避免误触发定点替换
    const normal = buildCaseInput(featureRows, ['排班'], metaHeader, 'selected_modules');
    expect(normal.regenerateSelected).toBeUndefined();
  });
});

describe('case generation request boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      entry: 'generate selected',
      scope: 'selected_modules' as const,
      selectedModules: ['检查室'],
      regenerateSelected: false,
    },
    {
      entry: 'regenerate selected',
      scope: 'selected_modules' as const,
      selectedModules: ['检查室'],
      regenerateSelected: true,
    },
    {
      entry: 'generate all',
      scope: 'all' as const,
      selectedModules: [],
      regenerateSelected: false,
    },
  ])(
    'Given the canonical workbook, When $entry is sent, Then the case request freezes workbook, scope, regeneration, and AI config',
    async ({ scope, selectedModules, regenerateSelected }) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            caseWorkbook: [],
            caseRows: [],
            metaHeader: {},
            qualityGateIssues: [],
            complexLogicDetected: false,
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const baseInput = buildCaseInput(
        featureRows,
        selectedModules,
        metaHeader,
        scope,
        undefined,
        true,
        undefined,
        undefined,
        regenerateSelected,
      );
      const input: CaseInput = {
        ...baseInput,
        currentCaseWorkbook,
        aiConfig: { configId: 'case-ai-42', enabled: true },
        regenerateSelected,
      };
      await createPipelineService().runStageCase(input);

      const request = fetchMock.mock.calls[0]?.[1];
      const submitted = JSON.parse(String(request?.body));
      const expectedInput = {
        currentCaseWorkbook,
        scope,
        regenerateSelected,
        aiConfig: { configId: 'case-ai-42', enabled: true },
        ...(scope === 'selected_modules' ? { selectedModuleIds: selectedModules } : {}),
      };
      expect(submitted).toEqual({
        stage: 'case',
        input: expect.objectContaining(expectedInput),
      });
      expect(submitted.input.currentCaseWorkbook[0]).toMatchObject({
        colWidths: [18, 16, 8, 34, 34, 14, 14, 12],
        screenshotRef: 'pipeline-case-manual.png',
        remarkRow: '保留检查室人工查询用例',
      });
      expect(submitted.input.currentCaseWorkbook[0].rows[0].batchId).toBe(
        'pipeline-case-manual-batch',
      );
    },
  );
});

describe('toCaseView — 生成用例元数据', () => {
  it('保留覆盖键和场景供 Case 页面展示', () => {
    const result = toCaseView([
      {
        sheetName: '用户',
        meta: currentCaseWorkbook[0].meta,
        rows: [
          {
            caseNo: 'HIS_USER_01',
            content: '新增用户',
            step: 'Step_create_1',
            operation: '查看表单',
            expected: '表单可读',
            firstResult: '\\',
            regressionResult: '\\',
            conclusion: '\\',
            id: 'scenario-1',
            featureId: 'HIS_USER_01',
            targetTestPoint: '新增用户',
            scenarioId: 'HIS_USER_01.create.01',
            scenarioName: '新增表单准备',
            priority: 'P0',
            coverageKeys: ['create.ready'],
            evidenceLevel: 'observed',
            needsReview: false,
          },
        ],
      },
    ]);
    expect(result.groups[0].coverageKeys).toEqual(['create.ready']);
    expect(result.groups[0].scenarioId).toBe('HIS_USER_01.create.01');
    expect(result.groups[0].needsReview).toBe(false);
  });
});
