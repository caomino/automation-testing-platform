import { describe, expect, it } from 'vitest';
import type {
  CaseRow,
  CaseInput,
  FeatureEvidence,
  FeatureProfile,
  FeatureRow,
} from '@test-platform/contracts';
import { validateCaseOutput } from '@test-platform/contracts';
import { run, type CaseRunOptions } from '../index.js';
import { buildCoverageManifest, generateActionScenarios } from '../actionScenarioEngine.js';
import { refineScenarioText, type CaseAIClient } from '../aiCaseRows.js';
import { sanitizeCaseRowsAgainstFeatureRows } from '../caseRows.js';

const meta = {
  systemName: 'HIS',
  testPointId: '',
  testPoint: '',
  testers: '',
  clientStaff: '',
  developerStaff: '',
  firstTestDate: '2026-08-21',
  regressionDate: '',
  conclusionRule: '默认',
  precondition: '已登录',
};

function row(testPoint: string, featureId: string): FeatureRow {
  return [
    '1',
    '功能性测试',
    '1.0.0',
    'HIS',
    '患者',
    '患者',
    `患者-${testPoint}`,
    testPoint,
    featureId,
  ];
}

function evidence(featureId: string, actionKind: FeatureProfile['actionKind']): FeatureEvidence {
  return {
    featureId,
    actionKind,
    states: actionKind === 'create' ? ['base', 'create'] : ['base'],
    fields:
      actionKind === 'create'
        ? [{ ref: 'name', selector: '[name=name]', name: '姓名', required: true }]
        : [],
    tables: [],
    actionEntries:
      actionKind === 'delete'
        ? [
            {
              actionKind: 'delete',
              ref: 'delete',
              selector: '#delete',
              text: '删除',
              triggerable: false,
              observed: true,
            },
          ]
        : [],
    containers: [],
    evidenceLevel: 'observed',
    coverageKeys: [],
    needsReview: false,
    uncovered: [],
  };
}

describe('T10 action scenario integration', () => {
  it('每个功能点只消费自己的证据，删除用例不会引用新增字段', async () => {
    const profiles: FeatureProfile[] = [
      { featureId: 'PATIENT_01', testPoint: '新增患者', actionKind: 'create' },
      { featureId: 'PATIENT_02', testPoint: '删除患者', actionKind: 'delete' },
    ];
    const output = await run({
      featureTable: [[row('新增患者', 'PATIENT_01'), row('删除患者', 'PATIENT_02')]],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: profiles,
      featureEvidence: {
        PATIENT_01: evidence('PATIENT_01', 'create'),
        PATIENT_02: evidence('PATIENT_02', 'delete'),
      },
    });
    const rows = output.caseRows.flat();
    const createRows = rows.filter((item) => item.featureId === 'PATIENT_01');
    const deleteRows = rows.filter((item) => item.featureId === 'PATIENT_02');
    const observedDeleteRows = deleteRows.filter(
      (item) => item.evidenceLevel === 'observed' && !item.needsReview,
    );

    expect(createRows.map((item) => item.coverageKeys)).toEqual(
      expect.arrayContaining([['create.required.姓名']]),
    );
    expect(observedDeleteRows.map((item) => item.coverageKeys)).toEqual([['delete.entry']]);
    expect(deleteRows.every((item) => !item.operation.includes('姓名'))).toBe(true);
  });

  it('Given unreadable evidence, When generating, Then it records review without visible placeholder rows', async () => {
    const unreadable: FeatureEvidence = {
      ...evidence('PATIENT_03', 'list'),
      evidenceLevel: 'needs_review',
      needsReview: true,
      reviewReason: '跨域 iframe 不可读; closed Shadow DOM 不可读',
      uncovered: [
        { kind: 'cross_origin_iframe', reason: '跨域 iframe 不可读' },
        { kind: 'closed_shadow_dom', reason: 'closed Shadow DOM 不可读' },
      ],
    };
    const output = await run({
      featureTable: [[row('患者列表', 'PATIENT_03')]],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: [{ featureId: 'PATIENT_03', testPoint: '患者列表', actionKind: 'list' }],
      featureEvidence: { PATIENT_03: unreadable },
    });

    expect(output.caseRows.flat().filter((item) => item.featureId === 'PATIENT_03')).toHaveLength(
      0,
    );
    expect(output.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'PATIENT_03',
        generatedCaseGroup: false,
        status: 'needs_review',
        reasons: expect.arrayContaining([expect.stringContaining('跨域 iframe 不可读')]),
      }),
    ]);
  });

  it('Given unsafe-to-explore evidence, When generating, Then it records the safety reason without a visible group', async () => {
    const unsafeEvidence: FeatureEvidence = {
      ...evidence('PATIENT_04', 'delete'),
      evidenceLevel: 'needs_review',
      needsReview: true,
      reviewReason: '页面存在写入风险，无法安全探索',
    };
    const output = await run({
      featureTable: [[row('删除患者', 'PATIENT_04')]],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: [{ featureId: 'PATIENT_04', testPoint: '删除患者', actionKind: 'delete' }],
      featureEvidence: { PATIENT_04: unsafeEvidence },
    });

    expect(output.caseRows.flat().filter((item) => item.featureId === 'PATIENT_04')).toHaveLength(
      0,
    );
    expect(output.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'PATIENT_04',
        generatedCaseGroup: false,
        status: 'needs_review',
        reasons: expect.arrayContaining([
          expect.stringContaining('页面存在写入风险，无法安全探索'),
        ]),
      }),
    ]);
  });
});

describe('review batch 2 coverage and AI gates', () => {
  it('Given evidence for one query scenario, When candidates are generated, Then only that observed scenario is visible', () => {
    const ctx = { featureName: '用户管理', subModule: '用户', testPoint: '操作' };
    const observed: FeatureEvidence = {
      ...evidence('F_QUERY', 'query'),
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
      coverageKeys: ['query.clear'],
    };
    const candidates = generateActionScenarios(
      { featureId: 'F_QUERY', testPoint: '操作', actionKind: 'query' },
      observed,
      ctx,
    );

    expect(candidates.map((candidate) => candidate.coverageKey)).toEqual(['query.clear']);
  });

  it('将 API 响应/安全与工作流 coverageKeys 转为同 featureId 的候选', () => {
    const apiEvidence: FeatureEvidence = {
      ...evidence('API_01', 'create'),
      coverageKeys: ['api.response.201', 'api.security.bearerAuth'],
    };
    const workflowEvidence: FeatureEvidence = {
      ...evidence('WF_01', 'workflow'),
      coverageKeys: [
        'workflow.transition.admit',
        'workflow.role.doctor',
        'workflow.precondition.admit.0',
        'workflow.postcondition.admit.0',
      ],
    };
    const ctx = { featureName: '入院', subModule: '住院', testPoint: '办理入院' };

    const api = generateActionScenarios(
      { featureId: 'API_01', testPoint: '创建患者', actionKind: 'create' },
      apiEvidence,
      ctx,
    );
    const workflow = generateActionScenarios(
      { featureId: 'WF_01', testPoint: '办理入院', actionKind: 'workflow' },
      workflowEvidence,
      ctx,
    );

    expect(api).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ coverageKey: 'api.response.201', evidenceLevel: 'observed' }),
        expect.objectContaining({
          coverageKey: 'api.security.bearerAuth',
          evidenceLevel: 'observed',
        }),
      ]),
    );
    expect(workflow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coverageKey: 'workflow.transition.admit',
          evidenceLevel: 'observed',
        }),
        expect.objectContaining({ coverageKey: 'workflow.role.doctor', evidenceLevel: 'observed' }),
        expect.objectContaining({
          coverageKey: 'workflow.precondition.admit.0',
          evidenceLevel: 'observed',
        }),
        expect.objectContaining({
          coverageKey: 'workflow.postcondition.admit.0',
          evidenceLevel: 'observed',
        }),
      ]),
    );
  });

  it('结构化 API / HIS 细节生成具体步骤且不混入 Web 表单矩阵', () => {
    const ctx = { featureName: '患者管理', subModule: '患者', testPoint: '新增患者' };
    const apiEvidence = {
      ...evidence('API_DETAIL', 'create'),
      coverageKeys: ['api.parameter.path.patientId', 'api.response.201', 'api.security.bearerAuth'],
      structuredDesign: {
        source: 'openapi',
        api: {
          method: 'POST',
          path: '/patients/{patientId}',
          parameters: [
            {
              name: 'patientId',
              in: 'path',
              required: true,
              description: '患者标识',
              schema: { type: 'string', pattern: '^P\\d+$' },
            },
          ],
          requestBody: {
            required: true,
            contentType: 'application/json',
            description: '患者资料',
            schema: { type: 'object', required: ['name'], properties: ['name'] },
          },
          responses: [
            {
              status: '201',
              description: '创建成功',
              schema: { type: 'object', properties: ['id', 'name'] },
            },
          ],
          security: ['bearerAuth'],
        },
      },
    } as FeatureEvidence;
    const workflowEvidence = {
      ...evidence('WF_DETAIL', 'workflow'),
      coverageKeys: [
        'workflow.transition.admit',
        'workflow.role.admit.doctor',
        'workflow.role.admit.nurse',
        'workflow.precondition.admit.0',
        'workflow.postcondition.admit.0',
      ],
      structuredDesign: {
        source: 'workflow',
        workflow: {
          roles: ['doctor', 'nurse'],
          transitions: [
            {
              id: 'admit',
              action: '办理入院',
              from: '待入院',
              to: '已入院',
              actorRoles: ['doctor'],
              preconditions: ['患者已登记'],
              postconditions: ['生成住院记录'],
            },
          ],
        },
      },
    } as FeatureEvidence;
    const api = generateActionScenarios(
      {
        featureId: 'API_DETAIL',
        testPoint: 'POST /patients',
        actionKind: 'create',
        source: 'openapi',
      },
      apiEvidence,
      ctx,
    );
    const workflow = generateActionScenarios(
      { featureId: 'WF_DETAIL', testPoint: '办理入院', actionKind: 'workflow', source: 'workflow' },
      workflowEvidence,
      ctx,
    );
    expect(api.map((item) => item.coverageKey)).not.toContain('create.cancel');
    expect(api.find((item) => item.coverageKey === 'api.parameter.path.patientId')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('患者标识'),
        expected: expect.stringContaining('^P\\d+$'),
      }),
    );
    expect(api.find((item) => item.coverageKey === 'api.body')).toEqual(
      expect.objectContaining({ operation: expect.stringContaining('患者资料') }),
    );
    expect(api.find((item) => item.coverageKey === 'api.response.201')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('201'),
        expected: expect.stringContaining('创建成功'),
      }),
    );
    expect(workflow.find((item) => item.coverageKey === 'workflow.transition.admit')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('待入院'),
        expected: expect.stringContaining('已入院'),
      }),
    );
    expect(workflow.find((item) => item.coverageKey === 'workflow.role.admit.nurse')).toEqual(
      expect.objectContaining({ needsReview: false, expected: expect.stringContaining('拒绝') }),
    );
  });

  it('混合 evidence 不会让已读取列表结构被全局 needs_review 吞掉', () => {
    const ctx = { featureName: '患者管理', subModule: '患者', testPoint: '患者列表' };
    const mixed: FeatureEvidence = {
      ...evidence('LIST_MIXED', 'list'),
      tables: [
        {
          ref: 'list',
          selector: '#list',
          columns: ['患者姓名'],
          rowCount: 1,
          hasPagination: false,
          hasSorting: false,
          hasFilter: false,
          hasEmptyState: false,
        },
      ],
      evidenceLevel: 'needs_review',
      needsReview: true,
      reviewReason: '跨域 iframe 不可读',
      coverageManifest: {
        actionKind: 'list',
        requiredKeys: ['list.display', 'list.headers', 'iframe.cross_origin'],
        observedKeys: ['list.display', 'list.headers'],
        needsReviewKeys: ['iframe.cross_origin'],
      },
      uncovered: [{ kind: 'cross_origin_iframe', reason: '跨域 iframe 不可读' }],
    };
    const rows = generateActionScenarios(
      { featureId: 'LIST_MIXED', testPoint: '患者列表', actionKind: 'list' },
      mixed,
      ctx,
    );
    expect(rows.find((item) => item.coverageKey === 'list.display')).toEqual(
      expect.objectContaining({ needsReview: false, evidenceLevel: 'observed' }),
    );
    expect(rows.find((item) => item.coverageKey === 'iframe.cross_origin')).toEqual(
      expect.objectContaining({ needsReview: true, reviewReason: '跨域 iframe 不可读' }),
    );
  });

  it('任意 dialog 不能将删除确认或取消伪装为已观察', () => {
    const ctx = { featureName: '患者管理', subModule: '患者', testPoint: '删除患者' };
    const deleteEvidence: FeatureEvidence = {
      ...evidence('DEL_DIALOG', 'delete'),
      containers: [{ kind: 'dialog', ref: 'dialog', selector: '#dialog' }],
    };
    const rows = generateActionScenarios(
      { featureId: 'DEL_DIALOG', testPoint: '删除', actionKind: 'delete' },
      deleteEvidence,
      ctx,
    );
    expect(rows.find((item) => item.coverageKey === 'delete.confirm')).toEqual(
      expect.objectContaining({ needsReview: true }),
    );
    expect(rows.find((item) => item.coverageKey === 'delete.cancel')).toEqual(
      expect.objectContaining({ needsReview: true }),
    );
  });

  it('未精确观察到的删除、导入、导出入口保持 needs_review', () => {
    const ctx = { featureName: '患者管理', subModule: '患者', testPoint: '删除患者' };
    const staleDelete: FeatureEvidence = {
      ...evidence('DEL_STALE', 'delete'),
      actionEntries: [
        {
          actionKind: 'delete',
          ref: 'delete',
          selector: '#old-delete',
          text: '删除',
          triggerable: false,
          observed: false,
        },
      ],
    };
    const staleImport: FeatureEvidence = {
      ...evidence('IMPORT_STALE', 'import'),
      actionEntries: [
        {
          actionKind: 'import',
          ref: 'import',
          selector: '#old-import',
          text: '导入',
          triggerable: false,
          observed: false,
        },
      ],
    };
    const staleExport: FeatureEvidence = {
      ...evidence('EXPORT_STALE', 'export'),
      actionEntries: [
        {
          actionKind: 'export',
          ref: 'export',
          selector: '#old-export',
          text: '导出',
          triggerable: false,
          observed: false,
        },
      ],
    };
    expect(
      generateActionScenarios(
        { featureId: 'DEL_STALE', testPoint: '删除', actionKind: 'delete' },
        staleDelete,
        ctx,
      ).find((row) => row.coverageKey === 'delete.entry')?.needsReview,
    ).toBe(true);
    expect(
      generateActionScenarios(
        { featureId: 'IMPORT_STALE', testPoint: '导入', actionKind: 'import' },
        staleImport,
        ctx,
      ).find((row) => row.coverageKey === 'import.entry')?.needsReview,
    ).toBe(true);
    expect(
      generateActionScenarios(
        { featureId: 'EXPORT_STALE', testPoint: '导出', actionKind: 'export' },
        staleExport,
        ctx,
      ).find((row) => row.coverageKey === 'export.entry')?.needsReview,
    ).toBe(true);
  });

  it('按 coverage key 渲染可执行中文步骤，并只引用同功能点证据', () => {
    const createEvidence: FeatureEvidence = {
      ...evidence('CREATE_RENDER', 'create'),
      states: ['base', 'create'],
      fields: [
        { ref: 'username', selector: '#username', name: '用户名', required: true },
        { ref: 'phone', selector: '#phone', name: '手机号', pattern: '^1\\d{10}$' },
      ],
      coverageKeys: ['api.response.201'],
    };
    const workflowEvidence: FeatureEvidence = {
      ...evidence('WORKFLOW_RENDER', 'workflow'),
      coverageKeys: ['workflow.transition.admit'],
    };
    const ctx = { featureName: '用户管理', subModule: '用户', testPoint: '新增用户' };
    const create = generateActionScenarios(
      { featureId: 'CREATE_RENDER', testPoint: '新增用户', actionKind: 'create' },
      createEvidence,
      ctx,
    );
    const list = generateActionScenarios(
      { featureId: 'LIST_RENDER', testPoint: '用户列表', actionKind: 'list' },
      {
        ...evidence('LIST_RENDER', 'list'),
        tables: [
          {
            ref: 'users',
            selector: '#users',
            columns: ['用户名'],
            rowCount: 1,
            hasPagination: true,
            hasSorting: true,
            sortableColumns: ['用户名'],
            hasFilter: false,
            hasEmptyState: true,
          },
        ],
      },
      { featureName: '用户管理', subModule: '用户', testPoint: '用户列表' },
    );
    const update = generateActionScenarios(
      { featureId: 'UPDATE_RENDER', testPoint: '修改用户', actionKind: 'update' },
      {
        ...evidence('UPDATE_RENDER', 'update'),
        states: ['base', 'update'],
        fields: [{ ref: 'username', selector: '#username', name: '用户名', defaultValue: '旧值' }],
      },
      { featureName: '用户管理', subModule: '用户', testPoint: '修改用户' },
    );
    const remove = generateActionScenarios(
      { featureId: 'DELETE_RENDER', testPoint: '删除用户', actionKind: 'delete' },
      {
        ...evidence('DELETE_RENDER', 'delete'),
        containers: [{ kind: 'dialog', ref: 'delete-dialog', selector: '#delete-dialog' }],
      },
      { featureName: '用户管理', subModule: '用户', testPoint: '删除用户' },
    );
    const workflow = generateActionScenarios(
      { featureId: 'WORKFLOW_RENDER', testPoint: '办理入院', actionKind: 'workflow' },
      workflowEvidence,
      { featureName: '住院管理', subModule: '住院', testPoint: '办理入院' },
    );

    const byKey = (rows: ReturnType<typeof generateActionScenarios>, key: string) =>
      rows.find((row) => row.coverageKey === key)!;
    expect(byKey(list, 'list.column.用户名')).toEqual(
      expect.objectContaining({
        scenarioName: expect.stringContaining('用户名'),
        operation: expect.stringContaining('列表'),
        expected: expect.stringContaining('用户名'),
      }),
    );
    expect(byKey(create, 'create.required.用户名')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('【用户名】'),
        expected: expect.stringContaining('必填'),
      }),
    );
    expect(byKey(create, 'create.pattern.手机号')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('【手机号】'),
        expected: expect.stringContaining('^1\\d{10}$'),
      }),
    );
    expect(byKey(update, 'update.echo.用户名')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('【旧值】'),
        expected: expect.stringContaining('【旧值】'),
      }),
    );
    const missingEcho = generateActionScenarios(
      { featureId: 'UPDATE_MISSING_ECHO', testPoint: '修改用户', actionKind: 'update' },
      {
        ...evidence('UPDATE_MISSING_ECHO', 'update'),
        states: ['base', 'update'],
        fields: [{ ref: 'username', selector: '#username', name: '用户名' }],
        coverageKeys: ['update.echo.不存在'],
      },
      { featureName: '用户管理', subModule: '用户', testPoint: '修改用户' },
    );
    expect(missingEcho).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coverageKey: 'update.echo.不存在',
          needsReview: true,
          evidenceLevel: 'needs_review',
          reviewReason: expect.stringContaining('具体回显值'),
        }),
      ]),
    );
    const customAction = generateActionScenarios(
      { featureId: 'IMPORT_ACTION', testPoint: '导入患者', actionKind: 'import' },
      {
        ...evidence('IMPORT_ACTION', 'import'),
        actionEntries: [{ actionKind: 'import', ref: 'upload', selector: '#upload', text: '上传文件', triggerable: false, observed: true }],
      },
      { featureName: '患者管理', subModule: '患者', testPoint: '导入患者' },
    );
    expect(customAction).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coverageKey: 'import.entry',
          evidenceLevel: 'observed',
          operation: expect.stringContaining('【上传文件】'),
        }),
      ]),
    );
    const customOther = generateActionScenarios(
      { featureId: 'OTHER_ACTION', testPoint: '推送宣教', actionKind: 'other' },
      {
        ...evidence('OTHER_ACTION', 'other'),
        actionEntries: [{ actionKind: 'other', ref: 'push', selector: '#push', text: '推送宣教', triggerable: false, observed: true }],
      },
      { featureName: '患者管理', subModule: '患者', testPoint: '推送宣教' },
    );
    expect(customOther).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coverageKey: 'other.entry',
          evidenceLevel: 'observed',
          needsReview: false,
          operation: expect.stringContaining('【推送宣教】'),
          expected: expect.stringContaining('【推送宣教】'),
        }),
      ]),
    );
    const dialogEvidence: FeatureEvidence = {
      ...evidence('DELETE_MANIFEST', 'delete'),
      containers: [{ kind: 'dialog', ref: 'dialog', selector: '#dialog' }],
    };
    const dialogManifest = buildCoverageManifest(
      { featureId: 'DELETE_MANIFEST', testPoint: '删除用户', actionKind: 'delete' },
      dialogEvidence,
      { featureName: '用户管理', subModule: '用户', testPoint: '删除用户' },
    );
    expect(dialogManifest.needsReviewKeys).toEqual(expect.arrayContaining(['delete.confirm', 'delete.cancel']));
    expect(dialogManifest.missingKeys).toEqual(expect.arrayContaining(['delete.confirm', 'delete.cancel']));
    expect(byKey(remove, 'delete.confirm')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('确认'),
        expected: expect.stringContaining('不执行'),
      }),
    );
    expect(byKey(create, 'api.response.201')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('响应'),
        expected: expect.stringContaining('201'),
      }),
    );
    expect(byKey(workflow, 'workflow.transition.admit')).toEqual(
      expect.objectContaining({
        operation: expect.stringContaining('admit'),
        expected: expect.stringContaining('状态'),
      }),
    );
    expect(byKey(remove, 'delete.confirm').operation).not.toContain('用户名');
  });

  it('质量门阻断缺失 observed coverage、重复身份和不完整八列', () => {
    const profile: FeatureProfile = { featureId: 'LIST_01', testPoint: '列表', actionKind: 'list' };
    const observed: FeatureEvidence = {
      ...evidence('LIST_01', 'list'),
      tables: [
        {
          ref: 'list',
          selector: '#list',
          columns: ['姓名'],
          rowCount: 1,
          hasPagination: false,
          hasSorting: false,
          hasFilter: false,
          hasEmptyState: false,
        },
      ],
    };
    const invalid: CaseRow = {
      caseNo: 'LIST_01_A01',
      content: '列表',
      step: '',
      operation: '',
      expected: '',
      firstResult: '\\',
      regressionResult: '\\',
      conclusion: '\\',
      id: 'duplicate',
      featureId: 'LIST_01',
      targetTestPoint: '列表',
      scenarioId: 'duplicate',
      coverageKeys: ['list.display'],
    };
    const issues = sanitizeCaseRowsAgainstFeatureRows(
      [[invalid, { ...invalid }]],
      [[row('列表', 'LIST_01')]],
      [profile],
      { LIST_01: observed },
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blocking: true,
          message: expect.stringContaining('缺少 coverageKey'),
        }),
        expect.objectContaining({ blocking: true, message: expect.stringContaining('重复') }),
        expect.objectContaining({ blocking: true, message: expect.stringContaining('八列') }),
      ]),
    );
  });

  it('质量门将编号或测试点错绑判为阻断', () => {
    const wrong: CaseRow = {
      caseNo: 'OTHER_01_A01',
      content: '列表',
      step: 'Step1',
      operation: '操作',
      expected: '预期',
      firstResult: '\\',
      regressionResult: '\\',
      conclusion: '\\',
      id: 'wrong',
      featureId: 'LIST_BIND',
      targetTestPoint: '错误测试点',
    };
    const issues = sanitizeCaseRowsAgainstFeatureRows([[wrong]], [[row('列表', 'LIST_BIND')]]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blocking: true, message: expect.stringContaining('未绑定') }),
        expect.objectContaining({ blocking: true, message: expect.stringContaining('未对齐') }),
      ]),
    );
  });

  it('质量门阻断缺失元数据、未知功能点与用待复核行冒充 observed coverage', () => {
    const malformed: CaseRow = {
      caseNo: 'UNKNOWN_A01',
      content: '列表',
      step: 'Step1',
      operation: '操作',
      expected: '预期',
      firstResult: '\\',
      regressionResult: '\\',
      conclusion: '\\',
      id: '',
      featureId: 'UNKNOWN',
      targetTestPoint: '列表',
    };
    const profile: FeatureProfile = {
      featureId: 'LIST_OBS',
      testPoint: '列表',
      actionKind: 'list',
    };
    const observed = {
      ...evidence('LIST_OBS', 'list'),
      coverageManifest: {
        actionKind: 'list' as const,
        requiredKeys: ['list.display'],
        observedKeys: ['list.display'],
        needsReviewKeys: [],
      },
    };
    const reviewOnly: CaseRow = {
      caseNo: 'LIST_OBS_A01',
      content: '列表',
      step: 'Step1',
      operation: '查看',
      expected: '可见',
      firstResult: '\\',
      regressionResult: '\\',
      conclusion: '\\',
      id: 'review',
      featureId: 'LIST_OBS',
      targetTestPoint: '列表',
      scenarioId: 'list.display',
      coverageKeys: ['list.display'],
      evidenceLevel: 'needs_review',
      needsReview: true,
      reviewReason: '尚未确认',
    };
    const issues = sanitizeCaseRowsAgainstFeatureRows(
      [[malformed, reviewOnly]],
      [[row('列表', 'LIST_OBS')]],
      [profile],
      { LIST_OBS: observed },
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blocking: true, message: expect.stringContaining('缺少行标识') }),
        expect.objectContaining({ blocking: true, message: expect.stringContaining('未知功能点') }),
        expect.objectContaining({
          blocking: true,
          message: expect.stringContaining('缺少 scenarioId'),
        }),
        expect.objectContaining({
          blocking: true,
          message: expect.stringContaining('缺少 coverageKeys'),
        }),
        expect.objectContaining({ blocking: true, message: expect.stringContaining('仅由待复核') }),
      ]),
    );
  });

  it('AI 只接受带候选或证据锚点的严格 JSON，非法、泛化或虚构字段回退', async () => {
    const candidate = generateActionScenarios(
      { featureId: 'CREATE_01', testPoint: '新增用户', actionKind: 'create' },
      evidence('CREATE_01', 'create'),
      { featureName: '用户管理', subModule: '用户', testPoint: '新增用户' },
    )[0];
    const invalidJson: CaseAIClient = {
      async complete() {
        return { text: '【操作步骤】\n随意点击\n【预期结果】\n成功' };
      },
    };
    const unanchoredJson: CaseAIClient = {
      async complete() {
        return { text: JSON.stringify({ operation: '随意点击', expected: '成功' }) };
      },
    };
    const inventedField: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({
            operation: '1. 在【身份证号】输入数据',
            expected: '保存成功',
          }),
        };
      },
    };
    const hiddenInventedControl: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({
            operation: '1. 在【姓名】输入框输入数据并点击【发布】',
            expected: '发布成功',
          }),
        };
      },
    };
    const hiddenInventedEntities: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({
            operation: `${candidate.operation}\n录入身份证号并调用fakeToken，患者变为已出院，点击批准`,
            expected: candidate.expected,
          }),
        };
      },
    };
    const verbFreeLeak: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({
            operation: `${candidate.operation}\n身份证号与fakeToken可用，患者状态已出院`,
            expected: candidate.expected,
          }),
        };
      },
    };
    const genericWordControlLeak: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({
            operation: `${candidate.operation}\n点击确认按钮并查看默认状态`,
            expected: candidate.expected,
          }),
        };
      },
    };
    const semanticRuleLeak: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({
            operation: candidate.operation,
            expected: `${candidate.expected}\n系统拒绝操作并返回500`,
          }),
        };
      },
    };
    const normalRewrite: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({
            operation: `${candidate.operation}\n验证结果`,
            expected: candidate.expected,
          }),
        };
      },
    };
    const valid: CaseAIClient = {
      async complete() {
        return {
          text: JSON.stringify({ operation: candidate.operation, expected: candidate.expected }),
        };
      },
    };
    const context = {
      subModule: '用户',
      featureName: '用户管理',
      testPoint: '新增用户',
      precondition: '',
    };
    const featureEvidence = evidence('CREATE_01', 'create');

    await expect(
      refineScenarioText(context, candidate, featureEvidence, invalidJson),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, unanchoredJson),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, inventedField),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, hiddenInventedControl),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, hiddenInventedEntities),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, verbFreeLeak),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, genericWordControlLeak),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, semanticRuleLeak),
    ).resolves.toBeNull();
    await expect(
      refineScenarioText(context, candidate, featureEvidence, normalRewrite),
    ).resolves.toEqual({
      operation: `${candidate.operation}\n验证结果`,
      expected: candidate.expected,
    });
    await expect(refineScenarioText(context, candidate, featureEvidence, valid)).resolves.toEqual({
      operation: candidate.operation,
      expected: candidate.expected,
    });
  });
});

describe('feature-driven evidence gate', () => {
  it('Given evidence keyed to a feature but carrying another featureId, When generating, Then it creates no visible case rows', async () => {
    const output = await run({
      featureTable: [[row('查询患者', 'PATIENT_01')]],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: [{ featureId: 'PATIENT_01', testPoint: '查询患者', actionKind: 'query' }],
      featureEvidence: { PATIENT_01: evidence('PATIENT_02', 'query') },
    });

    expect(output.caseRows.flat().filter((item) => item.featureId === 'PATIENT_01')).toHaveLength(
      0,
    );
  });

  it('Given contentless observed evidence, When generating, Then it records review without a visible placeholder row', async () => {
    const output = await run({
      featureTable: [[row('查询患者', 'PATIENT_03')]],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: [{ featureId: 'PATIENT_03', testPoint: '查询患者', actionKind: 'query' }],
      featureEvidence: { PATIENT_03: evidence('PATIENT_03', 'query') },
    });

    expect(output.caseRows.flat().filter((item) => item.featureId === 'PATIENT_03')).toHaveLength(
      0,
    );
    expect(output.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'PATIENT_03',
        generatedCaseGroup: false,
        status: 'needs_review',
        reasons: expect.arrayContaining([expect.stringContaining('无可生成的覆盖场景')]),
      }),
    ]);
  });
});

describe('frozen generation context', () => {
  const aiClient: CaseAIClient = {
    async complete() {
      return { text: '{}' };
    },
  };

  const generationCases: Array<{
    name: string;
    mode: 'ai' | 'no_ai';
    scope: CaseInput['scope'];
    regenerateSelected: boolean;
    options?: CaseRunOptions;
  }> = [
    { name: 'no_ai all', mode: 'no_ai', scope: 'all', regenerateSelected: false },
    { name: 'ai all', mode: 'ai', scope: 'all', regenerateSelected: false, options: { aiClient } },
    { name: 'no_ai selected', mode: 'no_ai', scope: 'selected_modules', regenerateSelected: false },
    { name: 'ai selected regenerate', mode: 'ai', scope: 'selected_modules', regenerateSelected: true, options: { aiClient } },
  ];

  it.each(generationCases)('Given $name mode and scope, When generating, Then its frozen context validates with evidence metadata', async ({ mode, scope, regenerateSelected, options }) => {
    const inputBase = {
      featureTable: [[row('查询患者', 'PATIENT_CONTEXT_01')]],
      metaConfig: meta,
      featureProfiles: [{ featureId: 'PATIENT_CONTEXT_01', testPoint: '查询患者', actionKind: 'query' as const }],
      featureEvidence: {
        PATIENT_CONTEXT_01: {
          ...evidence('PATIENT_CONTEXT_01', 'query'),
          actionEntries: [{ actionKind: 'query' as const, ref: 'search', selector: '#search', text: '查询', triggerable: false, observed: true }],
          coverageManifest: {
            actionKind: 'query' as const,
            requiredKeys: ['query.entry', 'query.clear', 'query.performance', 'workflow.transition', 'query.permission'],
            observedKeys: ['query.entry', 'query.clear', 'query.performance', 'workflow.transition', 'query.permission'],
            needsReviewKeys: [],
          },
        },
      },
    };
    const input: CaseInput = scope === 'all'
      ? {
        ...inputBase,
        scope: 'all',
        regenerateSelected: false,
        ...(mode === 'ai' ? { aiConfig: { configId: 'case-ai', enabled: true } } : {}),
      }
      : {
        ...inputBase,
        scope: 'selected_modules',
        selectedModuleIds: ['患者'],
        regenerateSelected,
        ...(mode === 'ai' ? { aiConfig: { configId: 'case-ai', enabled: true } } : {}),
      };

    const output = await run(input, options);

    expect(() => validateCaseOutput(output)).not.toThrow();
    expect(output.generation).toMatchObject({
      mode: input.aiConfig?.enabled ? 'ai' : 'no_ai',
      scope: input.scope,
      evidenceDigest: expect.any(String),
    });
    for (const row of output.caseRows.flat()) {
      expect(row).toMatchObject({
        batchId: output.generation?.batchId,
        generationMode: output.generation?.mode,
        featureFingerprint: expect.any(String),
      });
      expect(row.aiConfigId).toBe(input.aiConfig?.enabled ? 'case-ai' : undefined);
    }
  });

  it('Given frozen evidence and profiles, When either snapshot changes, Then the evidence digest changes deterministically', async () => {
    const input = (sourceLabel: string, pageUrl: string): CaseInput => ({
      featureTable: [[row('查询患者', 'PATIENT_DIGEST_01')]],
      scope: 'all',
      metaConfig: meta,
      featureProfiles: [{ featureId: 'PATIENT_DIGEST_01', testPoint: '查询患者', actionKind: 'query', sourceLabel }],
      featureEvidence: {
        PATIENT_DIGEST_01: {
          ...evidence('PATIENT_DIGEST_01', 'query'),
          pageUrl,
          actionEntries: [{ actionKind: 'query', ref: 'search', selector: '#search', text: '查询', triggerable: false, observed: true }],
        },
      },
    });

    const [first, repeated, changedEvidence, changedProfile] = await Promise.all([
      run(input('search-v1', 'https://his.example/patients')),
      run(input('search-v1', 'https://his.example/patients')),
      run(input('search-v1', 'https://his.example/patients-v2')),
      run(input('search-v2', 'https://his.example/patients')),
    ]);

    expect(first.generation?.evidenceDigest).toBe(repeated.generation?.evidenceDigest);
    expect(first.generation?.evidenceDigest).not.toBe(changedEvidence.generation?.evidenceDigest);
    expect(first.generation?.evidenceDigest).not.toBe(changedProfile.generation?.evidenceDigest);
  });

  it('Given concurrent AI and no-AI runs, When both start together, Then batch attribution stays unique and mode-specific', async () => {
    const base: CaseInput = {
      featureTable: [[row('查询患者', 'PATIENT_CONCURRENT_01')]],
      scope: 'all',
      regenerateSelected: false,
      metaConfig: meta,
      featureProfiles: [{ featureId: 'PATIENT_CONCURRENT_01', testPoint: '查询患者', actionKind: 'query' }],
      featureEvidence: {
        PATIENT_CONCURRENT_01: {
          ...evidence('PATIENT_CONCURRENT_01', 'query'),
          actionEntries: [{ actionKind: 'query', ref: 'search', selector: '#search', text: '查询', triggerable: false, observed: true }],
          coverageManifest: {
            actionKind: 'query',
            requiredKeys: ['query.entry', 'query.clear', 'query.performance', 'workflow.transition', 'query.permission'],
            observedKeys: ['query.entry', 'query.clear', 'query.performance', 'workflow.transition', 'query.permission'],
            needsReviewKeys: [],
          },
        },
      },
    };
    const [noAi, ai] = await Promise.all([
      run(base),
      run({ ...base, aiConfig: { configId: 'case-ai', enabled: true } }, { aiClient }),
    ]);
    expect(noAi.generation?.mode).toBe('no_ai');
    expect(ai.generation?.mode).toBe('ai');
    expect(noAi.generation?.batchId).not.toBe(ai.generation?.batchId);
  });
});
