/**
 * @file case.verify.ts
 * @description stage-case 契约校验 + 真实生成逻辑验证（P1 绑定内核，feature-driven 重写）
 * @frozen v1.1 — 替换旧的错误行为断言（固定五条 / 编号后缀 / 全局证据 / 进程级 AI / 覆盖式选中生成）
 *            转而证明新硬契约：一个功能点 = 一个用例编号(=testPointId) = 一组连续 Step；
 *            五类是覆盖维度而非五条；证据按 featureId 隔离；AI 客户端任务级注入；scope 与模式正交。
 */
import { describe, it, expect, vi } from 'vitest';
import { run, CaseGenerationBlockedError } from '../src/index';
import { computeFeatureFingerprint } from '../src/featureSnapshot';
import { createEvidenceDigest } from '../src/evidenceDigest';
import type {
  CaseAIClient,
  CaseInput,
  CaseOutput,
  CaseSheet,
  FeatureEvidence,
  FeatureProfile,
  FeatureRow,
  MetaHeader,
} from '@test-platform/contracts';
import { CASE_COLUMN_WIDTHS, validateCaseOutput } from '@test-platform/contracts';

const baseMeta: MetaHeader = {
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

/** 构造一条功能点行（九列顺序） */
function fp(
  sequence: string,
  testType: string,
  systemName: string,
  mainModule: string,
  subModule: string,
  featureName: string,
  testPoint: string,
  testPointId: string,
): FeatureRow {
  return [
    sequence,
    testType,
    '3.1',
    systemName,
    mainModule,
    subModule,
    featureName,
    testPoint,
    testPointId,
  ];
}

function createEvidence(featureId: string, withManifest = false): FeatureEvidence {
  const base: FeatureEvidence = {
    featureId,
    actionKind: 'create',
    states: ['base', 'create'],
    fields: [
      { ref: 'name', selector: '#name', name: '姓名', required: true },
      { ref: 'phone', selector: '#phone', name: '手机号', pattern: '^1\\d{10}$' },
    ],
    tables: [],
    actionEntries: [
      {
        actionKind: 'create',
        ref: 'save',
        selector: '#save',
        text: '保存',
        triggerable: false,
        observed: true,
      },
    ],
    containers: [],
    evidenceLevel: 'observed',
    coverageKeys: ['create.ready', 'create.required.姓名', 'create.pattern.手机号'],
    needsReview: false,
    uncovered: [],
  };
  if (!withManifest) return base;
  return {
    ...base,
    coverageManifest: {
      actionKind: 'create',
      requiredKeys: [
        'create.ready',
        'create.required.姓名',
        'create.pattern.手机号',
        'create.cancel',
      ],
      observedKeys: ['create.ready', 'create.required.姓名', 'create.pattern.手机号'],
      needsReviewKeys: ['create.cancel'],
      missingKeys: ['create.cancel'],
    },
  };
}

function queryEvidence(featureId: string): FeatureEvidence {
  return {
    featureId,
    actionKind: 'query',
    states: ['base'],
    fields: [
      { ref: 'name', selector: '#qname', name: '姓名', inputType: 'text' },
      { ref: 'date', selector: '#qdate', name: '日期', inputType: 'date' },
    ],
    tables: [
      {
        ref: 't',
        selector: '#t',
        columns: ['姓名'],
        rowCount: 0,
        hasPagination: false,
        hasSorting: false,
        hasFilter: false,
        hasEmptyState: true,
      },
    ],
    actionEntries: [
      {
        actionKind: 'query',
        ref: 'search',
        selector: '#search',
        text: '查询',
        triggerable: false,
        observed: true,
      },
    ],
    containers: [],
    evidenceLevel: 'observed',
    coverageKeys: ['query.clear', 'query.empty', 'query.combination'],
    needsReview: false,
    uncovered: [],
  };
}

/** 带覆盖 manifest 的列表证据，供五类覆盖结论测试 */
function hisListEvidence(featureId: string): FeatureEvidence {
  return {
    featureId,
    actionKind: 'list',
    states: ['base'],
    fields: [],
    tables: [
      {
        ref: 'table',
        selector: '#users',
        columns: ['用户名', '角色'],
        rowCount: 2,
        hasPagination: true,
        hasSorting: true,
        sortableColumns: ['用户名'],
        hasFilter: true,
        filterFields: ['用户名'],
        hasEmptyState: true,
      },
    ],
    actionEntries: [],
    containers: [],
    evidenceLevel: 'observed',
    coverageKeys: [],
    needsReview: false,
    uncovered: [],
  };
}

/** 构造一份"当前已保存产物"（用于 scope 合并测试） */
function currentSheet(rows: { featureId: string; content: string }[]): CaseSheet[] {
  return [
    {
      sheetName: 'S',
      meta: baseMeta,
      rows: rows.map((r) => ({
        caseNo: r.featureId,
        content: r.content,
        step: 'Step 1',
        operation: `在 [S] 页面操作 [${r.content}]`,
        expected: '列表展示',
        firstResult: '\\',
        regressionResult: '\\',
        conclusion: '\\',
        id: `${r.featureId}__old`,
        featureId: r.featureId,
        targetTestPoint: r.content,
        scenarioId: `${r.featureId}__old`,
        coverageKeys: ['old'],
        evidenceLevel: 'observed',
        origin: 'system_generated',
        confidence: 1,
      })),
      colWidths: CASE_COLUMN_WIDTHS,
    },
  ];
}

function preservedWorkbook(): CaseSheet[] {
  return [
    {
      sheetName: 'Unrelated',
      meta: { ...baseMeta, testPoint: '未选模块', precondition: '保留未选模块前置条件' },
      rows: [
        {
          caseNo: 'UNRELATED',
          content: '未选模块',
          step: 'Step 1',
          operation: '人工操作',
          expected: '人工结果',
          firstResult: '通过',
          regressionResult: '通过',
          conclusion: '通过',
          id: 'unrelated-manual',
          featureId: 'UNRELATED',
          targetTestPoint: '未选模块',
          manualEdited: true,
          origin: 'user_edited',
          scenarioId: 'unrelated.manual',
          coverageKeys: ['manual'],
          evidenceLevel: 'observed',
        },
      ],
      screenshotRef: 'unrelated.png',
      colWidths: [11, 12, 13],
      remarkRow: '保留未选模块备注',
    },
    {
      sheetName: 'S',
      meta: { ...baseMeta, testPoint: '选中模块', precondition: '保留选中模块前置条件' },
      rows: [
        {
          caseNo: 'TARGET',
          content: '旧目标组',
          step: 'Step 1',
          operation: '旧人工操作',
          expected: '旧人工结果',
          firstResult: '通过',
          regressionResult: '通过',
          conclusion: '通过',
          id: 'target-manual',
          featureId: 'TARGET',
          targetTestPoint: '旧目标组',
          manualEdited: true,
          origin: 'user_edited',
          scenarioId: 'target.manual',
          coverageKeys: ['manual'],
          evidenceLevel: 'observed',
        },
      ],
      screenshotRef: 'target.png',
      colWidths: [21, 22, 23],
      remarkRow: '保留选中模块备注',
    },
  ];
}

type EvidenceIdentityFixture = FeatureEvidence & {
  readonly systemId: string;
  readonly featureRevision: string;
  readonly pageEntry: string;
};

function identifiedEvidence(
  featureId: string,
  actionKind: FeatureProfile['actionKind'],
): EvidenceIdentityFixture {
  return {
    ...createEvidence(featureId),
    actionKind,
    systemId: 'system-current',
    featureRevision: 'revision-current',
    pageEntry: '#entry-current',
  };
}

describe('stage-case 骨架契约（feature-driven）', () => {
  it('run 返回 CaseOutput 形状（含 featureResults / generation，meta 头克隆不共享引用）', async () => {
    const input: CaseInput = {
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
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'QYYX_PZ_JCX_01', testPoint: '查询', actionKind: 'query' }],
      featureEvidence: { QYYX_PZ_JCX_01: queryEvidence('QYYX_PZ_JCX_01') },
    };
    const out = await run(input);
    expect(Array.isArray(out.caseWorkbook)).toBe(true);
    expect(Array.isArray(out.caseRows)).toBe(true);
    expect(out.metaHeader).toEqual(baseMeta); // 值等价，仍可编辑
    expect(out.metaHeader).not.toBe(baseMeta); // 非同一引用，round-trip 不污染输入
    expect(out.qualityGateIssues).toEqual([]);
    expect(out.complexLogicDetected).toBe(false);
    expect(out.featureResults).toHaveLength(1);
    expect(out.generation?.mode).toBe('no_ai');
  });

  it('meta 头可编辑（编辑输出不应污染原始输入）', async () => {
    const input: CaseInput = {
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
      metaConfig: baseMeta,
      aiConfig: { configId: 'cfg-1', enabled: false },
      featureProfiles: [{ featureId: 'QYYX_PZ_JCX_01', testPoint: '查询', actionKind: 'query' }],
      featureEvidence: { QYYX_PZ_JCX_01: queryEvidence('QYYX_PZ_JCX_01') },
    };
    const out = await run(input);
    out.metaHeader.testers = '改后';
    expect(baseMeta.testers).toBe('张三');
  });

  it('一个功能点 = 一个用例编号(=testPointId) + 连续 Step，无 _N1.._N5 / _Axx 后缀', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', '患者', '门诊', '新增患者', '新增患者', 'F01'),
          fp('2', '功能性测试', 'HIS', '患者', '门诊', '查询患者', '查询患者', 'F02'),
          fp('3', '功能性测试', 'HIS', '患者', '门诊', '查询患者详情', '查询患者详情', 'F03'),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'F01', testPoint: '新增患者', actionKind: 'create' },
        { featureId: 'F02', testPoint: '查询患者', actionKind: 'query' },
        { featureId: 'F03', testPoint: '查询患者详情', actionKind: 'query' },
      ],
      featureEvidence: {
        F01: createEvidence('F01'),
        F02: queryEvidence('F02'),
        F03: queryEvidence('F03'),
      },
    };
    const out = await run(input);
    const rows = out.caseRows.flat();
    expect(rows.every((r) => r.caseNo === r.featureId)).toBe(true);
    expect(rows.every((r) => !/_(_N[1-5]|_A\d{2})$/.test(r.caseNo))).toBe(true);
    for (const featureId of ['F01', 'F02', 'F03']) {
      const group = rows.filter((row) => row.featureId === featureId);
      expect(group.length).toBeGreaterThan(0);
      expect(group.map((row) => row.step)).toEqual(group.map((_, index) => `Step ${index + 1}`));
    }
    const featureGroupOrder = out.caseWorkbook[0].rows
      .map((row) => row.featureId)
      .filter((featureId, index, all) => index === 0 || featureId !== all[index - 1]);
    expect(featureGroupOrder).toEqual(['F01', 'F02', 'F03']);
  });

  it('动态场景数量：查询按证据生成多条，不强制固定五条', async () => {
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '查询', '查询', 'Q1')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'Q1', testPoint: '查询', actionKind: 'query' }],
      featureEvidence: { Q1: queryEvidence('Q1') },
    };
    const qRows = (await run(input)).caseRows.flat().filter((r) => r.featureId === 'Q1');
    expect(qRows.length).toBeGreaterThan(0);
    expect(qRows.map((r) => r.coverageKeys?.[0])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('query.clear'),
        expect.stringContaining('query.empty'),
      ]),
    );
  });

  it('Given two distinct valid evidence packages, When run generates their groups, Then it preserves their exact coverage-key sets and counts', async () => {
    const createObservedEvidence: FeatureEvidence = {
      featureId: 'CREATE_EVIDENCE',
      actionKind: 'create',
      states: ['create'],
      fields: [
        { ref: 'name', selector: '#name', name: '姓名', required: true },
        { ref: 'phone', selector: '#phone', name: '手机号', pattern: '^1\\d{10}$' },
      ],
      tables: [],
      actionEntries: [
        {
          actionKind: 'create',
          ref: 'save',
          selector: '#save',
          text: '保存',
          triggerable: false,
          observed: true,
        },
      ],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: ['create.ready', 'create.required.姓名', 'create.pattern.手机号'],
      needsReview: false,
      uncovered: [],
    };
    const listObservedEvidence: FeatureEvidence = {
      featureId: 'LIST_EVIDENCE',
      actionKind: 'list',
      states: ['base'],
      fields: [{ ref: 'keyword', selector: '#keyword', name: '关键词', inputType: 'text' }],
      tables: [
        {
          ref: 'users',
          selector: '#users',
          columns: ['用户', '状态'],
          rowCount: 1,
          hasPagination: false,
          hasSorting: false,
          hasFilter: true,
          hasEmptyState: false,
        },
      ],
      actionEntries: [],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: ['list.display', 'list.headers', 'list.column.用户', 'list.search.keyword'],
      needsReview: false,
      uncovered: [],
    };
    const out = await run({
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'CREATE_EVIDENCE'),
          fp('2', '功能性测试', 'HIS', 'M', 'S', '列表', '列表', 'LIST_EVIDENCE'),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'CREATE_EVIDENCE', testPoint: '新增', actionKind: 'create' },
        { featureId: 'LIST_EVIDENCE', testPoint: '列表', actionKind: 'list' },
      ],
      featureEvidence: {
        CREATE_EVIDENCE: createObservedEvidence,
        LIST_EVIDENCE: listObservedEvidence,
      },
    });

    const createCoverageKeys = out.caseRows
      .flat()
      .filter((row) => row.featureId === 'CREATE_EVIDENCE')
      .map((row) => row.coverageKeys?.[0]);
    const listCoverageKeys = out.caseRows
      .flat()
      .filter((row) => row.featureId === 'LIST_EVIDENCE')
      .map((row) => row.coverageKeys?.[0]);
    expect(createCoverageKeys).toEqual(createObservedEvidence.coverageKeys);
    expect(createCoverageKeys).toHaveLength(3);
    expect(listCoverageKeys).toEqual(listObservedEvidence.coverageKeys);
    expect(listCoverageKeys).toHaveLength(4);
  });

  it('Given no AI and observed page controls, When generating, Then it renders real names in Chinese brackets', async () => {
    const queryEvidenceWithClearControl: FeatureEvidence = {
      featureId: 'ROOM_QUERY',
      actionKind: 'query',
      states: ['base'],
      fields: [{ ref: 'username', selector: '#username', name: '用户名', inputType: 'text' }],
      tables: [],
      actionEntries: [
        {
          actionKind: 'query',
          ref: 'clear',
          selector: '#clear',
          text: '清空',
          triggerable: false,
          observed: true,
        },
      ],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: ['query.clear'],
      needsReview: false,
      uncovered: [],
    };
    const createEvidenceWithUsername: FeatureEvidence = {
      featureId: 'ROOM_CREATE',
      actionKind: 'create',
      states: ['create'],
      fields: [{ ref: 'username', selector: '#username', name: '用户名', required: true }],
      tables: [],
      actionEntries: [
        {
          actionKind: 'create',
          ref: 'save',
          selector: '#save',
          text: '保存',
          triggerable: false,
          observed: true,
        },
      ],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: ['create.required.用户名'],
      needsReview: false,
      uncovered: [],
    };
    const out = await run({
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', '配置', '检查室', '查询', '查询', 'ROOM_QUERY'),
          fp('2', '功能性测试', 'HIS', '配置', '检查室', '新增用户', '新增用户', 'ROOM_CREATE'),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'ROOM_QUERY', testPoint: '查询', actionKind: 'query' },
        { featureId: 'ROOM_CREATE', testPoint: '新增用户', actionKind: 'create' },
      ],
      featureEvidence: {
        ROOM_QUERY: queryEvidenceWithClearControl,
        ROOM_CREATE: createEvidenceWithUsername,
      },
      aiConfig: { enabled: false, configId: 'no-ai' },
    });

    const queryClear = out.caseRows
      .flat()
      .find((row) => row.featureId === 'ROOM_QUERY' && row.coverageKeys?.[0] === 'query.clear');
    const createRequired = out.caseRows
      .flat()
      .find(
        (row) =>
          row.featureId === 'ROOM_CREATE' && row.coverageKeys?.[0] === 'create.required.用户名',
      );
    expect(queryClear?.operation).toBe(
      '1. 进入【检查室】的【查询】页面\n2. 清空【用户名】查询条件并点击【清空】控件执行查询',
    );
    expect(createRequired?.operation).toBe(
      '1. 进入【检查室】的【新增用户】页面\n2. 保持【用户名】为空并点击【保存】控件提交',
    );
  });

  it('多子系统 => 一子系统一 sheet，caseRows 与 caseWorkbook 一致', async () => {
    const input: CaseInput = {
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
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'QYYX_PZ_JCX_01', testPoint: '查询', actionKind: 'query' },
        { featureId: 'QYYX_PZ_PB_01', testPoint: '新增', actionKind: 'create' },
      ],
      featureEvidence: {
        QYYX_PZ_JCX_01: queryEvidence('QYYX_PZ_JCX_01'),
        QYYX_PZ_PB_01: createEvidence('QYYX_PZ_PB_01'),
      },
    };
    const out = await run(input);
    expect(out.caseWorkbook).toHaveLength(2);
    expect(out.caseRows).toHaveLength(2);
    const names = out.caseWorkbook.map((s) => s.sheetName);
    expect(names).toEqual(['检查室', '排班']);
    out.caseWorkbook.forEach((sheet, i) => {
      expect(sheet.rows).toBe(out.caseRows[i]);
      expect(sheet.colWidths).toEqual(CASE_COLUMN_WIDTHS);
      const prefix = sheet.sheetName === '检查室' ? 'QYYX_PZ_JCX' : 'QYYX_PZ_PB';
      expect(sheet.rows.every((r) => r.caseNo.startsWith(prefix))).toBe(true);
    });
  });
});

describe('证据隔离（按 featureId，无全局 exploredElements）', () => {
  it('只消费同 featureId 的证据，删除功能点不引用新增字段', async () => {
    const profiles: FeatureProfile[] = [
      { featureId: 'C1', testPoint: '新增', actionKind: 'create' },
      { featureId: 'D1', testPoint: '删除', actionKind: 'delete' },
    ];
    const delEvidence: FeatureEvidence = {
      featureId: 'D1',
      actionKind: 'delete',
      states: ['base'],
      fields: [],
      tables: [],
      actionEntries: [
        {
          actionKind: 'delete',
          ref: 'del',
          selector: '#del',
          text: '删除',
          triggerable: false,
          observed: true,
        },
      ],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: ['delete.entry'],
      needsReview: false,
      uncovered: [],
    };
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'C1'),
          fp('2', '功能性测试', 'HIS', 'M', 'S', '删除', '删除', 'D1'),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: profiles,
      featureEvidence: { C1: createEvidence('C1'), D1: delEvidence },
    };
    const out = await run(input);
    const delRows = out.caseRows.flat().filter((r) => r.featureId === 'D1');
    expect(
      delRows.every((r) => !r.operation.includes('姓名') && !r.operation.includes('手机号')),
    ).toBe(true);
    const cRows = out.caseRows.flat().filter((r) => r.featureId === 'C1');
    expect(cRows.some((r) => r.coverageKeys?.includes('create.required.姓名'))).toBe(true);
  });
});

describe('scope 合并语义', () => {
  it('scope=all 整体替换当前完整产物', async () => {
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'F01')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'F01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { F01: createEvidence('F01') },
      currentCaseWorkbook: currentSheet([{ featureId: 'OLD', content: '旧查询' }]),
    };
    const rows = (await run(input)).caseRows.flat();
    expect(rows.every((r) => r.featureId === 'F01')).toBe(true);
    expect(rows.some((r) => r.featureId === 'OLD')).toBe(false);
  });

  it('scope=selected_modules 仅生成选中子系统并跳过已存在功能点', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', 'M', 'S', '旧查询', '旧查询', 'OLD'),
          fp('2', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'NEW'),
        ],
      ],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'OLD', testPoint: '旧查询', actionKind: 'query' },
        { featureId: 'NEW', testPoint: '新增', actionKind: 'create' },
      ],
      featureEvidence: { NEW: createEvidence('NEW') },
      currentCaseWorkbook: currentSheet([{ featureId: 'OLD', content: '旧查询' }]),
    };
    const out = await run(input);
    const rows = out.caseRows.flat();
    expect(rows.some((r) => r.featureId === 'OLD')).toBe(true); // 原有保留
    expect(rows.some((r) => r.featureId === 'NEW')).toBe(true); // 新功能点追加
    expect(out.featureResults!.find((r) => r.featureId === 'OLD')!.status).toBe('skipped_existing');
    expect(out.featureResults!.find((r) => r.featureId === 'NEW')!.status).toBe('generated');
  });

  it('Given selected_modules without selected IDs, When generating, Then it produces no workbook instead of falling back to all', async () => {
    const input: CaseInput = {
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
      selectedModuleIds: [],
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'QYYX_PZ_JCX_01', testPoint: '查询', actionKind: 'query' },
        { featureId: 'QYYX_PZ_PB_01', testPoint: '新增', actionKind: 'create' },
      ],
      featureEvidence: {
        QYYX_PZ_JCX_01: queryEvidence('QYYX_PZ_JCX_01'),
        QYYX_PZ_PB_01: createEvidence('QYYX_PZ_PB_01'),
      },
    };
    const out = await run(input);
    expect(out.caseWorkbook).toHaveLength(0);
  });

  it('Given selected_modules with malformed IDs and no selected modules, When generating, Then boundary validation still rejects the input', async () => {
    await expect(run({
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '空标识', '空标识', '   ')]],
      scope: 'selected_modules',
      selectedModuleIds: [],
      metaConfig: baseMeta,
    })).rejects.toThrow(/testPointId/);
  });

  it('scope=selected_modules + regenerateSelected 定点替换对应功能点旧组', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', 'M', 'S', '旧查询', '旧查询', 'OLD'),
          fp('2', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'NEW'),
        ],
      ],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      regenerateSelected: true,
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'OLD', testPoint: '旧查询', actionKind: 'query' },
        { featureId: 'NEW', testPoint: '新增', actionKind: 'create' },
      ],
      featureEvidence: { NEW: createEvidence('NEW'), OLD: queryEvidence('OLD') },
      currentCaseWorkbook: currentSheet([
        { featureId: 'OLD', content: '旧查询' },
        { featureId: 'NEW', content: '新增' },
      ]),
    };
    const out = await run(input);
    const oldRows = out.caseRows.flat().filter((r) => r.featureId === 'OLD');
    expect(oldRows).not.toHaveLength(0);
    expect(oldRows.map((row) => row.id)).not.toContain('OLD__old');
  });

  it('Given a selected append, When a new group is generated, Then unrelated sheets retain identity, order, metadata, and manual edits', async () => {
    const current = preservedWorkbook();
    const before = structuredClone(current);
    const out = await run({
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'NEW')]],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'NEW', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { NEW: createEvidence('NEW') },
      currentCaseWorkbook: current,
    });

    expect(out.caseWorkbook.map((sheet) => sheet.sheetName)).toEqual(['Unrelated', 'S']);
    expect(out.caseWorkbook[0]).toEqual(before[0]);
    expect(out.caseWorkbook[1]).toEqual(
      expect.objectContaining({
        sheetName: 'S',
        meta: before[1]?.meta,
        screenshotRef: 'target.png',
        colWidths: [21, 22, 23],
        remarkRow: '保留选中模块备注',
        rows: expect.arrayContaining([before[1]?.rows[0]]),
      }),
    );
    const appendedGroupOrder = out.caseWorkbook[1].rows
      .map((row) => row.featureId)
      .filter((featureId, index, all) => index === 0 || featureId !== all[index - 1]);
    expect(appendedGroupOrder).toEqual(['TARGET', 'NEW']);
    expect(current).toEqual(before);
  });

  it('Given explicit regeneration, When the selected group is replaced, Then unrelated sheets retain identity, order, metadata, and manual edits', async () => {
    const current = preservedWorkbook();
    const before = structuredClone(current);
    const out = await run({
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新目标组', '新目标组', 'TARGET')]],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      regenerateSelected: true,
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'TARGET', testPoint: '新目标组', actionKind: 'create' }],
      featureEvidence: { TARGET: createEvidence('TARGET') },
      currentCaseWorkbook: current,
    });

    const targetRows = out.caseRows.flat().filter((row) => row.featureId === 'TARGET');
    expect(targetRows).not.toHaveLength(0);
    expect(targetRows.map((row) => row.id)).not.toContain('target-manual');
    expect(targetRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureId: 'TARGET', origin: 'system_generated' }),
      ]),
    );
    expect(out.featureResults?.find((result) => result.featureId === 'TARGET')).toEqual(
      expect.objectContaining({
        status: 'generated',
        generatedCaseGroup: true,
      }),
    );
    expect(out.caseWorkbook.map((sheet) => sheet.sheetName)).toEqual(['Unrelated', 'S']);
    expect(out.caseWorkbook[0]).toEqual(before[0]);
    expect(out.caseWorkbook[1]).toEqual(
      expect.objectContaining({
        sheetName: 'S',
        meta: before[1]?.meta,
        screenshotRef: 'target.png',
        colWidths: [21, 22, 23],
        remarkRow: '保留选中模块备注',
      }),
    );
    expect(current).toEqual(before);
  });

  it('Given regeneration evidence has a stale revision, When regenerating the selected group, Then the previous target group remains unchanged', async () => {
    const current = preservedWorkbook();
    const before = structuredClone(current);
    const staleRevision: EvidenceIdentityFixture = {
      ...identifiedEvidence('TARGET', 'create'),
      featureRevision: 'revision-stale',
    };
    const out = await run({
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新目标组', '新目标组', 'TARGET')]],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      regenerateSelected: true,
      metaConfig: baseMeta,
      featureRevision: 'revision-current',
      featureProfiles: [{ featureId: 'TARGET', testPoint: '新目标组', actionKind: 'create' }],
      featureEvidence: { TARGET: staleRevision },
      currentCaseWorkbook: current,
    });

    expect(out.caseWorkbook).toEqual(before);
    expect(current).toEqual(before);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'TARGET',
        status: 'revision_conflict',
        generatedCaseGroup: false,
        reasons: ['证据功能点版本与当前版本不一致'],
      }),
    ]);
  });
});

describe('all-scope failure preservation', () => {
  it('Given one all-scope feature is evidence_missing, When generation runs, Then the complete current workbook is preserved', async () => {
    const current = preservedWorkbook();
    const before = structuredClone(current);
    const out = await run({
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'READY'),
          fp('2', '功能性测试', 'HIS', 'M', 'S', '导出', '导出', 'MISSING'),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'READY', testPoint: '新增', actionKind: 'create' },
        { featureId: 'MISSING', testPoint: '导出', actionKind: 'export' },
      ],
      featureEvidence: { READY: createEvidence('READY') },
      currentCaseWorkbook: current,
    });

    expect(out.featureResults).toHaveLength(2);
    expect(
      out.featureResults.map(({ featureId, inputIndex, status, generatedCaseGroup, reasons }) => ({
        featureId,
        inputIndex,
        status,
        generatedCaseGroup,
        reasons,
      })),
    ).toEqual([
      {
        featureId: 'READY',
        inputIndex: 0,
        status: 'generated',
        generatedCaseGroup: true,
        reasons: expect.arrayContaining([
          expect.stringContaining('[normal] 已覆盖'),
        ]),
      },
      {
        featureId: 'MISSING',
        inputIndex: 1,
        status: 'evidence_missing',
        generatedCaseGroup: false,
        reasons: ['无当前功能点专属证据'],
      },
    ]);
    expect(out.caseWorkbook).toEqual(before);
    expect(current).toEqual(before);
  });

  it('Given AI fails for one all-scope feature, When generation runs, Then the complete current workbook is preserved', async () => {
    const current = preservedWorkbook();
    const before = structuredClone(current);
    const client: CaseAIClient = {
      complete: async () => {
        throw new Error('AI unavailable');
      },
    };
    const out = await run(
      {
        featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'AI_FAILED')]],
        scope: 'all',
        metaConfig: baseMeta,
        aiConfig: { configId: 'cfg', enabled: true },
        featureProfiles: [{ featureId: 'AI_FAILED', testPoint: '新增', actionKind: 'create' }],
        featureEvidence: { AI_FAILED: createEvidence('AI_FAILED', true) },
        currentCaseWorkbook: current,
      },
      { aiClient: client },
    );

    expect(out.caseWorkbook).toEqual(before);
    expect(current).toEqual(before);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'AI_FAILED',
        status: 'ai_failed',
        generatedCaseGroup: false,
      }),
    ]);
  });

  it('Given one all-scope feature has a revision conflict, When generation runs, Then the complete current workbook is preserved', async () => {
    const current = preservedWorkbook();
    const before = structuredClone(current);
    const staleRevision: EvidenceIdentityFixture = {
      ...identifiedEvidence('REVISION_CONFLICT', 'create'),
      featureRevision: 'revision-stale',
    };
    const out = await run({
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'REVISION_CONFLICT')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureRevision: 'revision-current',
      featureProfiles: [
        { featureId: 'REVISION_CONFLICT', testPoint: '新增', actionKind: 'create' },
      ],
      featureEvidence: { REVISION_CONFLICT: staleRevision },
      currentCaseWorkbook: current,
    });

    expect(out.caseWorkbook).toEqual(before);
    expect(current).toEqual(before);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'REVISION_CONFLICT',
        status: 'revision_conflict',
        generatedCaseGroup: false,
        reasons: ['证据功能点版本与当前版本不一致'],
      }),
    ]);
  });
});

describe('feature evidence hard gate', () => {
  it('Given evidence with a different action kind but matching identity fields, When generating, Then it rejects the evidence', async () => {
    const wrongActionKind: EvidenceIdentityFixture = {
      ...identifiedEvidence('ACTION_KIND_MISMATCH', 'delete'),
      pageUrl: 'https://current.test/create',
      actionEntries: [
        {
          actionKind: 'delete',
          ref: 'delete',
          selector: '#entry-current',
          text: '删除',
          triggerable: false,
          observed: true,
        },
      ],
    };
    const out = await run({
      systemId: 'system-current',
      featureRevision: 'revision-current',
      featureTable: [
        [fp('1', '功能性测试', 'system-current', 'M', 'S', '新增', '新增', 'ACTION_KIND_MISMATCH')],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featurePaths: { ACTION_KIND_MISMATCH: 'https://current.test/create' },
      featureProfiles: [
        {
          featureId: 'ACTION_KIND_MISMATCH',
          testPoint: '新增',
          actionKind: 'create',
          clickSelector: '#entry-current',
          pageUrl: 'https://current.test/create',
        },
      ],
      featureEvidence: { ACTION_KIND_MISMATCH: wrongActionKind },
    });

    expect(
      out.caseRows.flat().filter((row) => row.featureId === 'ACTION_KIND_MISMATCH'),
    ).toHaveLength(0);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'ACTION_KIND_MISMATCH',
        status: 'evidence_missing',
        generatedCaseGroup: false,
        reasons: ['证据动作类型与功能点档案不一致'],
      }),
    ]);
  });

  it('Given evidence with the wrong action entry, When generating, Then it rejects the evidence', async () => {
    const wrongActionEntry: EvidenceIdentityFixture = {
      ...identifiedEvidence('ACTION_ENTRY_MISMATCH', 'create'),
      actionEntries: [
        {
          actionKind: 'create',
          ref: 'save',
          selector: '#entry-other',
          text: '保存',
          triggerable: false,
          observed: true,
        },
      ],
    };
    const out = await run({
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            'system-current',
            'M',
            'S',
            '新增',
            '新增',
            'ACTION_ENTRY_MISMATCH',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        {
          featureId: 'ACTION_ENTRY_MISMATCH',
          testPoint: '新增',
          actionKind: 'create',
          clickSelector: '#entry-current',
        },
      ],
      featureEvidence: { ACTION_ENTRY_MISMATCH: wrongActionEntry },
    });

    expect(
      out.caseRows.flat().filter((row) => row.featureId === 'ACTION_ENTRY_MISMATCH'),
    ).toHaveLength(0);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'ACTION_ENTRY_MISMATCH',
        status: 'evidence_missing',
        generatedCaseGroup: false,
        reasons: ['证据动作入口与功能点档案不一致'],
      }),
    ]);
  });

  it('Given evidence from another system, When generating, Then it rejects the evidence', async () => {
    const foreignSystem: EvidenceIdentityFixture = {
      ...identifiedEvidence('SYSTEM_MISMATCH', 'create'),
      systemId: 'system-other',
    };
    const out = await run({
      systemId: 'system-current',
      featureTable: [
        [fp('1', '功能性测试', 'system-current', 'M', 'S', '新增', '新增', 'SYSTEM_MISMATCH')],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'SYSTEM_MISMATCH', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { SYSTEM_MISMATCH: foreignSystem },
    });

    expect(out.caseRows.flat().filter((row) => row.featureId === 'SYSTEM_MISMATCH')).toHaveLength(
      0,
    );
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'SYSTEM_MISMATCH',
        status: 'evidence_missing',
        generatedCaseGroup: false,
        reasons: ['证据系统与当前系统不一致'],
      }),
    ]);
  });

  it('Given evidence from a stale feature revision, When generating, Then it rejects the evidence', async () => {
    const staleRevision: EvidenceIdentityFixture = {
      ...identifiedEvidence('REVISION_MISMATCH', 'create'),
      featureRevision: 'revision-stale',
    };
    const out = await run({
      featureRevision: 'revision-current',
      featureTable: [
        [fp('1', '功能性测试', 'system-current', 'M', 'S', '新增', '新增', 'REVISION_MISMATCH')],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'REVISION_MISMATCH', testPoint: '新增', actionKind: 'create' },
      ],
      featureEvidence: { REVISION_MISMATCH: staleRevision },
    });

    expect(out.caseRows.flat().filter((row) => row.featureId === 'REVISION_MISMATCH')).toHaveLength(
      0,
    );
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'REVISION_MISMATCH',
        status: 'revision_conflict',
        generatedCaseGroup: false,
        reasons: ['证据功能点版本与当前版本不一致'],
      }),
    ]);
  });

  it('Given evidence from another page path, When generating, Then it rejects the evidence', async () => {
    const wrongPage: EvidenceIdentityFixture = {
      ...identifiedEvidence('PAGE_MISMATCH', 'create'),
      pageUrl: 'https://current.test/other',
    };
    const out = await run({
      featureTable: [
        [fp('1', '功能性测试', 'system-current', 'M', 'S', '新增', '新增', 'PAGE_MISMATCH')],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featurePaths: { PAGE_MISMATCH: 'https://current.test/create' },
      featureProfiles: [
        {
          featureId: 'PAGE_MISMATCH',
          testPoint: '新增',
          actionKind: 'create',
          pageUrl: 'https://current.test/create',
          clickSelector: '#entry-current',
        },
      ],
      featureEvidence: { PAGE_MISMATCH: wrongPage },
    });

    expect(out.caseRows.flat().filter((row) => row.featureId === 'PAGE_MISMATCH')).toHaveLength(0);
    expect(out.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'PAGE_MISMATCH',
        status: 'evidence_missing',
        generatedCaseGroup: false,
        reasons: ['证据页面路径与功能点入口不一致'],
      }),
    ]);
  });
});

describe('featureResults 与生成上下文', () => {
  it('Given identical feature content from different systems, When fingerprinted, Then system identity separates the fingerprints', () => {
    const row = fp('1', '功能性测试', 'HIS', 'M', 'S', '查询', '查询', 'SAME');
    expect(computeFeatureFingerprint('SAME', row, undefined, undefined, 'system-a'))
      .not.toBe(computeFeatureFingerprint('SAME', row, undefined, undefined, 'system-b'));
  });

  it('Given a frozen feature row/profile, When any stable identity field changes, Then the fingerprint changes', () => {
    const row = fp('1', '功能性测试', 'HIS', 'M', 'S', '查询', '查询', 'FINGERPRINT');
    const profile: FeatureProfile = {
      featureId: 'FINGERPRINT',
      testPoint: '查询',
      actionKind: 'query',
      pageUrl: '/query',
      clickSelector: 'click:query',
      parentModule: 'M',
      subsystemId: 'S',
      sourceLabel: '查询入口',
      sourceSelector: '#query',
      source: 'web',
    };
    const baseline = computeFeatureFingerprint('FINGERPRINT', row, profile, '/query', 'system-a');
    const rowVariants = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => {
      const changed = [...row];
      changed[index] = `${changed[index]}-changed`;
      return changed;
    });
    const profileVariants: FeatureProfile[] = [
      { ...profile, featureId: 'FINGERPRINT-2' },
      { ...profile, testPoint: '查询-2' },
      { ...profile, actionKind: 'list' },
      { ...profile, pageUrl: '/query-2' },
      { ...profile, clickSelector: 'click:query-2' },
      { ...profile, parentModule: 'M-2' },
      { ...profile, subsystemId: 'S-2' },
      { ...profile, sourceLabel: '查询入口-2' },
      { ...profile, sourceSelector: '#query-2' },
      { ...profile, source: 'manual' },
    ];

    for (const changedRow of rowVariants) {
      expect(computeFeatureFingerprint('FINGERPRINT', changedRow, profile, '/query', 'system-a')).not.toBe(baseline);
    }
    for (const changedProfile of profileVariants) {
      expect(computeFeatureFingerprint('FINGERPRINT', row, changedProfile, '/query', 'system-a')).not.toBe(baseline);
    }
    expect(computeFeatureFingerprint('FINGERPRINT', row, profile, '/query-2', 'system-a')).not.toBe(baseline);
  });

  it('Given omitted input systemId, When generating, Then fingerprint and generation use the same metadata identity', async () => {
    const row = fp('1', '功能性测试', 'ROW_SYSTEM', 'M', 'S', '新增', '新增', 'IDENTITY');
    const profile: FeatureProfile = { featureId: 'IDENTITY', testPoint: '新增', actionKind: 'create' };
    const out = await run({
      featureTable: [[row]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [profile],
      featureEvidence: { IDENTITY: createEvidence('IDENTITY', true) },
    });

    expect(out.generation?.systemId).toBe(baseMeta.systemName);
    expect(out.caseRows.flat()[0]?.featureFingerprint).toBe(
      computeFeatureFingerprint('IDENTITY', row, profile, undefined, baseMeta.systemName),
    );
  });

  it('Given omitted input featureRevision, When a later frozen feature changes, Then the generated revision changes', async () => {
    const firstTable = [[
      fp('1', '功能性测试', 'HIS', 'M', 'S', '首个', '首个', 'REV_1'),
      fp('2', '功能性测试', 'HIS', 'M', 'S', '后续', '后续', 'REV_2'),
    ]];
    const makeInput = (featureTable: FeatureRow[][]): CaseInput => ({
      featureTable,
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'REV_1', testPoint: '首个', actionKind: 'query' },
        { featureId: 'REV_2', testPoint: '后续', actionKind: 'query' },
      ],
      featureEvidence: {
        REV_1: queryEvidence('REV_1'),
        REV_2: queryEvidence('REV_2'),
      },
    });
    const changedTable = [[firstTable[0]![0]!, fp('3', '功能性测试', 'HIS', 'M', 'S', '后续变化', '后续变化', 'REV_2')]];
    const first = await run(makeInput(firstTable));
    const changed = await run(makeInput(changedTable));

    expect(first.generation?.featureRevision).not.toBe(changed.generation?.featureRevision);
  });

  it('Given legacy evidence without a coverage manifest, When generating, Then it returns review status accepted by the output contract', async () => {
    const out = await run({
      featureTable: [[fp('1', '功能性测试', 'META_SYSTEM', 'M', 'S', '新增', '新增', 'LEGACY')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'LEGACY', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { LEGACY: createEvidence('LEGACY', true) },
    });

    expect(out.featureResults).toEqual([
      expect.objectContaining({ featureId: 'LEGACY', status: 'generated', generatedCaseGroup: true }),
    ]);
    expect(out.caseRows.flat().filter((row) => row.featureId === 'LEGACY')).not.toHaveLength(0);
    expect(() => validateCaseOutput(out)).not.toThrow();
  });

  it('Given selected scope with an unselected feature first, When generating, Then the result keeps its original input index', async () => {
    const out = await run({
      featureTable: [[
        fp('1', '功能性测试', 'HIS', 'M', 'OTHER', '未选中', '未选中', 'OUTSIDE'),
        fp('2', '功能性测试', 'HIS', 'M', 'S', '选中', '选中', 'INSIDE'),
      ]],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      systemId: 'system-index',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'INSIDE', testPoint: '选中', actionKind: 'query' }],
      featureEvidence: { INSIDE: createEvidence('INSIDE', true) },
    });

    expect(out.featureResults?.map(({ featureId, inputIndex }) => [featureId, inputIndex])).toEqual([
      ['INSIDE', 1],
    ]);
    expect(out.generation?.orderedFeatureIds).toEqual(['INSIDE']);
  });

  it('Given a selected snapshot with an existing first feature, When generating, Then featureResults keep original order and input indexes', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('0', '功能性测试', 'HIS', 'M', 'OTHER', '未选中', '未选中', 'OUTSIDE'),
          fp('1', '功能性测试', 'HIS', 'M', 'S', '既有查询', '既有查询', 'OLD'),
          fp('2', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'NEW'),
        ],
      ],
      scope: 'selected_modules',
      selectedModuleIds: ['S'],
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'OLD', testPoint: '既有查询', actionKind: 'query' },
        { featureId: 'NEW', testPoint: '新增', actionKind: 'create' },
      ],
      featureEvidence: { NEW: createEvidence('NEW', true) },
      currentCaseWorkbook: currentSheet([{ featureId: 'OLD', content: '既有查询' }]),
    };
    const out = await run(input);
    expect(out.featureResults).toHaveLength(2);
    expect(
      out.featureResults?.map((result) => [result.featureId, result.inputIndex, result.status]),
    ).toEqual([
      ['OLD', 1, 'skipped_existing'],
      ['NEW', 2, 'generated'],
    ]);
  });

  it('证据缺失的功能点标记 evidence_missing 且不生成占位用例', async () => {
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '导出', '导出', 'X')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'X', testPoint: '导出', actionKind: 'export' }],
      featureEvidence: {},
    };
    const out = await run(input);
    const x = out.featureResults!.find((r) => r.featureId === 'X')!;
    expect(x.status).toBe('evidence_missing');
    expect(x.generatedCaseGroup).toBe(false);
    expect(out.caseRows.flat().filter((r) => r.featureId === 'X')).toHaveLength(0);
  });

  it('Given a frozen snapshot with an empty testPointId, When generating, Then it rejects the invalid snapshot', async () => {
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '查询', '查询', '')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: '', testPoint: '查询', actionKind: 'query' }],
    };
    await expect(run(input)).rejects.toThrow(/testPointId/);
  });

  it('Given a frozen snapshot with duplicate testPointIds, When generating, Then it rejects the invalid snapshot', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'DUPLICATE'),
          fp('2', '功能性测试', 'HIS', 'M', 'S', '修改', '修改', 'DUPLICATE'),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'DUPLICATE', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { DUPLICATE: createEvidence('DUPLICATE') },
    };

    await expect(run(input)).rejects.toThrow(/duplicate|testPointId/i);
  });
});

describe('双模式任务级 AI 注入（禁止进程级全局 AI 客户端）', () => {
  it('无 AI 模式不构造/不调用 AI 客户端', async () => {
    const client: CaseAIClient = {
      complete: vi.fn(async () => ({ text: '' })),
    };
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'F01')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'F01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { F01: createEvidence('F01') },
      aiConfig: { enabled: false, configId: 'cfg1' },
    };
    await run(input, { aiClient: client });
    expect(client.complete).not.toHaveBeenCalled();
  });

  it('AI 启用但缺少有效客户端 => 生成前阻断', async () => {
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'F01')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'F01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { F01: createEvidence('F01', true) },
      aiConfig: { enabled: true, configId: 'cfg1' },
    };
    await expect(run(input)).rejects.toBeInstanceOf(CaseGenerationBlockedError);
  });

  it('AI 模式调用客户端润色，mode 冻结为 ai', async () => {
    const client: CaseAIClient = {
      complete: vi.fn(async () => ({
        text: JSON.stringify({
          operation: '1. 在 [S] 页面打开新增\n2. 输入 [姓名]',
          expected: '表单字段校验提示可见',
        }),
      })),
    };
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'F01')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'F01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { F01: createEvidence('F01', true) },
      aiConfig: { enabled: true, configId: 'cfg1' },
    };
    const out = await run(input, { aiClient: client });
    expect(client.complete).toHaveBeenCalled();
    expect(out.generation!.mode).toBe('ai');
    expect(out.generation!.aiConfigId).toBe('cfg1');
  });

  it('AI 客户端异步期间修改输入配置时，生成结果仍使用任务开始时的冻结模式和配置', async () => {
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'FROZEN_AI')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'FROZEN_AI', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { FROZEN_AI: createEvidence('FROZEN_AI', true) },
      aiConfig: { enabled: true, configId: 'cfg-original' },
    };
    const client: CaseAIClient = {
      complete: vi.fn(async () => {
        input.aiConfig = { enabled: false, configId: 'cfg-mutated' };
        return { text: JSON.stringify({ operation: '打开新增页面', expected: '表单可见' }) };
      }),
    };

    const out = await run(input, { aiClient: client });

    expect(out.generation).toMatchObject({ mode: 'ai', aiConfigId: 'cfg-original' });
    expect(out.caseRows.flat().every((row) => row.generationMode === 'ai' && row.aiConfigId === 'cfg-original')).toBe(true);
  });

  it('AI 客户端异步期间修改 revision/style/evidence/profile 时，生成元数据仍使用任务快照', async () => {
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'FROZEN_META')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureRevision: 'revision-original',
      styleVersion: 'style-original',
      featureProfiles: [{ featureId: 'FROZEN_META', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { FROZEN_META: createEvidence('FROZEN_META', true) },
      aiConfig: { enabled: true, configId: 'cfg-original' },
    };
    const expectedDigest = createEvidenceDigest(input.featureEvidence, input.featureProfiles);
    const client: CaseAIClient = {
      complete: vi.fn(async () => {
        input.featureRevision = 'revision-mutated';
        input.styleVersion = 'style-mutated';
        input.featureEvidence = {};
        input.featureProfiles = [];
        return { text: JSON.stringify({ operation: '打开新增页面', expected: '表单可见' }) };
      }),
    };

    const out = await run(input, { aiClient: client });

    expect(out.generation).toMatchObject({
      featureRevision: 'revision-original',
      styleVersion: 'style-original',
      evidenceDigest: expectedDigest,
    });
  });

  it('AI 调用失败 => 该功能点 ai_failed，不静默降级为无 AI', async () => {
    const client: CaseAIClient = {
      complete: vi.fn(async () => {
        throw new Error('network');
      }),
    };
    const input: CaseInput = {
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'F01')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'F01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { F01: createEvidence('F01', true) },
      aiConfig: { enabled: true, configId: 'cfg1' },
    };
    const out = await run(input, { aiClient: client });
    const f = out.featureResults!.find((r) => r.featureId === 'F01')!;
    expect(f.status).toBe('ai_failed');
    expect(out.caseRows.flat().filter((r) => r.featureId === 'F01')).toHaveLength(0);
  });

  it('AI 模式遇到无 coverageManifest 的遗留证据时，在润色前标记 needs_review', async () => {
    const client: CaseAIClient = {
      complete: vi.fn(async () => {
        throw new Error('network');
      }),
    };
    const out = await run({
      featureTable: [[fp('1', '功能性测试', 'HIS', 'M', 'S', '新增', '新增', 'LEGACY_AI')]],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [{ featureId: 'LEGACY_AI', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { LEGACY_AI: createEvidence('LEGACY_AI') },
      aiConfig: { enabled: true, configId: 'cfg1' },
    }, { aiClient: client });

    expect(client.complete).not.toHaveBeenCalled();
    expect(out.featureResults).toEqual([
      expect.objectContaining({ featureId: 'LEGACY_AI', status: 'needs_review', generatedCaseGroup: false }),
    ]);
    expect(out.caseRows.flat().filter((row) => row.featureId === 'LEGACY_AI')).toHaveLength(0);
  });
});

describe('动作矩阵（端到端）+ AI 仅润色', () => {
  it('按动作生成不同覆盖键，且只消费同 featureId 证据', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            'HIS',
            '用户',
            '用户管理',
            '用户管理',
            '用户列表',
            'HIS_USER_LIST_01',
          ),
          fp(
            '2',
            '功能性测试',
            'HIS',
            '用户',
            '用户管理',
            '用户管理',
            '新增用户',
            'HIS_USER_CREATE_01',
          ),
          fp(
            '3',
            '功能性测试',
            'HIS',
            '用户',
            '用户管理',
            '用户管理',
            '删除用户',
            'HIS_USER_DELETE_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'HIS_USER_LIST_01', testPoint: '用户列表', actionKind: 'list' },
        { featureId: 'HIS_USER_CREATE_01', testPoint: '新增用户', actionKind: 'create' },
        { featureId: 'HIS_USER_DELETE_01', testPoint: '删除用户', actionKind: 'delete' },
      ],
      featureEvidence: {
        HIS_USER_LIST_01: hisListEvidence('HIS_USER_LIST_01'),
        HIS_USER_CREATE_01: createEvidence('HIS_USER_CREATE_01'),
        HIS_USER_DELETE_01: {
          featureId: 'HIS_USER_DELETE_01',
          actionKind: 'delete',
          states: ['base'],
          fields: [],
          tables: [],
          actionEntries: [
            {
              actionKind: 'delete',
              ref: 'delete',
              selector: '#delete',
              text: '删除',
              triggerable: false,
              observed: true,
            },
          ],
          containers: [],
          evidenceLevel: 'observed',
          coverageKeys: ['delete.entry'],
          needsReview: false,
          uncovered: [],
        },
      },
    };
    const out = await run(input);
    const rows = out.caseRows.flat();
    const byFeature = (id: string) => rows.filter((row) => row.featureId === id);
    expect(
      byFeature('HIS_USER_LIST_01').some((row) => row.coverageKeys?.includes('list.pagination')),
    ).toBe(true);
    expect(
      byFeature('HIS_USER_LIST_01').some((row) => row.coverageKeys?.includes('list.sort.用户名')),
    ).toBe(true);
    expect(
      byFeature('HIS_USER_CREATE_01').some((row) =>
        row.coverageKeys?.includes('create.required.姓名'),
      ),
    ).toBe(true);
    expect(
      byFeature('HIS_USER_CREATE_01').some((row) =>
        row.coverageKeys?.includes('create.pattern.手机号'),
      ),
    ).toBe(true);
    expect(byFeature('HIS_USER_DELETE_01').every((row) => !row.operation.includes('姓名'))).toBe(
      true,
    );
    expect(
      out.qualityGateIssues.some((issue) => issue.message.includes('应生成 5 条场景用例')),
    ).toBe(false);
  });

  it('AI 仅润色操作与预期，不改变动作矩阵的身份和证据状态', async () => {
    const ai: CaseAIClient = {
      async complete(request) {
        const operation =
          request.prompt.match(/现有操作步骤：\n([\s\S]*?)\n现有预期结果：/)?.[1] ?? '';
        const expected = request.prompt.match(/现有预期结果：\n([\s\S]*?)\n允许证据：/)?.[1] ?? '';
        return { text: JSON.stringify({ operation: `${operation}\n验证结果`, expected }) };
      },
    };
    const input: CaseInput = {
      featureTable: [
        [
          fp(
            '1',
            '功能性测试',
            'HIS',
            '用户',
            '用户管理',
            '用户管理',
            '用户列表',
            'HIS_USER_LIST_01',
          ),
        ],
      ],
      scope: 'all',
      metaConfig: baseMeta,
      featureProfiles: [
        { featureId: 'HIS_USER_LIST_01', testPoint: '用户列表', actionKind: 'list' },
      ],
      featureEvidence: { HIS_USER_LIST_01: hisListEvidence('HIS_USER_LIST_01') },
      aiConfig: { enabled: true, configId: 'cfg1' },
    };
    const out = await run(input, { aiClient: ai });
    const row = out.caseRows.flat()[0];
    expect(row.operation).toContain('验证结果');
    expect(row.expected).toContain('列表');
    expect(row.scenarioId).toBe('HIS_USER_LIST_01__list.display');
    expect(row.coverageKeys).toEqual(['list.display']);
    expect(row.evidenceLevel).toBe('observed');
    expect(row.needsReview).toBe(false);
  });
});
