/**
 * @file TestDesign.test.ts
 * @description T1 契约测试：验证新增动作/证据类型为可选、旧数据兼容、非法输入被拒。
 */
import { describe, it, expect } from 'vitest';
import { validateFeatureOutput, validateFeatureInput } from '../schemas/FeatureSchema';
import {
  validateCaseInput,
  validateCaseOutput,
  CaseRowSchema,
  CaseInputSchema,
  CaseGenerationContextSchema,
  CaseFeatureResultSchema,
} from '../schemas/CaseSchema';
import {
  FeatureEvidenceSchema,
  FeatureProfileSchema,
  ActionKindSchema,
  FeatureArtifactSchema,
  CoverageManifestSchema,
  ScenarioCandidateSchema,
  isV2Artifact,
} from '../schemas/TestDesignSchema';
import { isFeatureArtifactV2 } from '../types/TestDesign';
import type { CaseGenerationContext, CaseInput, CoverageCategory, CoverageDecision } from '../stages/CaseContract';

describe('T1 旧数据兼容（新字段均可省略）', () => {
  it('旧 FeatureOutput（无 featureProfiles）可通过校验', () => {
    const legacy = {
      featureTable: [
        [['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询', 'SYS_SUB_PT_01']],
      ],
      featureIds: ['SYS_SUB_PT_01'],
      provenance: [],
      featurePaths: { SYS_SUB_PT_01: 'https://sys/page' },
    };
    expect(() => validateFeatureOutput(legacy)).not.toThrow();
  });

  it('旧 CaseInput（无 featureEvidence/featureProfiles）可通过校验', () => {
    const legacy = {
      featureTable: [
        [['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询', 'SYS_SUB_PT_01']],
      ],
      scope: 'all' as const,
      metaConfig: {
        systemName: '系统',
        testPointId: 'SYS_SUB_PT_01',
        testPoint: '查询',
        testers: '',
        clientStaff: '',
        developerStaff: '',
        firstTestDate: '',
        regressionDate: '',
        conclusionRule: '',
        precondition: '',
      },
    };
    expect(() => validateCaseInput(legacy)).not.toThrow();
  });

  it('旧 FeatureInput（ModuleNode 无 actionKind）可通过校验', () => {
    const legacy = {
      moduleTree: [
        {
          id: 'n1',
          label: '查询',
          parentId: null,
          subsystemId: 's1',
          type: 'action',
          status: 'covered',
          children: [],
          depth: 2,
        },
      ],
      systemName: '系统',
      confirmedOnly: false,
    };
    expect(() => validateFeatureInput(legacy)).not.toThrow();
  });
});

describe('T1 新契约字段校验', () => {
  it('FeatureProfile（含 actionKind）可通过校验', () => {
    const profile = {
      featureId: 'SYS_SUB_PT_01',
      testPoint: '新增',
      actionKind: 'create',
      pageUrl: 'https://sys/create',
      clickSelector: '#add',
      sourceLabel: '新增',
      sourceSelector: '#add',
    };
    expect(FeatureProfileSchema.parse(profile)).toEqual(profile);
  });

  it('非法 actionKind enum 被拒', () => {
    expect(() => ActionKindSchema.parse('frobnicate')).toThrow();
    expect(() => ActionKindSchema.parse('auth')).not.toThrow();
  });

  it('FeatureEvidence 合法结构通过校验', () => {
    const ev = {
      featureId: 'SYS_SUB_PT_01',
      actionKind: 'create',
      pageUrl: 'https://sys/create',
      states: ['base', 'create'],
      fields: [
        {
          ref: 'e1',
          selector: '#username',
          name: '用户名',
          required: true,
          minLength: 2,
          maxLength: 20,
        },
      ],
      tables: [],
      actionEntries: [],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: ['field_required', 'field_length'],
      needsReview: false,
      uncovered: [],
    };
    expect(FeatureEvidenceSchema.parse(ev).featureId).toBe('SYS_SUB_PT_01');
  });

  it('动作入口可显式标记为精确观察，旧入口省略该字段仍兼容', () => {
    const base = {
      featureId: 'DEL_01',
      actionKind: 'delete',
      states: ['base'],
      fields: [],
      tables: [],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: [],
      needsReview: false,
      uncovered: [],
    };
    expect(
      FeatureEvidenceSchema.parse({
        ...base,
        actionEntries: [
          {
            actionKind: 'delete',
            ref: 'd1',
            selector: '#delete',
            triggerable: false,
            observed: true,
          },
        ],
      }).actionEntries[0]?.observed,
    ).toBe(true);
    expect(() =>
      FeatureEvidenceSchema.parse({
        ...base,
        actionEntries: [
          { actionKind: 'delete', ref: 'd1', selector: '#delete', triggerable: false },
        ],
      }),
    ).not.toThrow();
  });

  it('结构化 API / HIS 工作流细节可序列化且为可选扩展', () => {
    const ev = FeatureEvidenceSchema.parse({
      featureId: 'API_01',
      actionKind: 'create',
      states: ['base'],
      fields: [],
      tables: [],
      actionEntries: [],
      containers: [],
      evidenceLevel: 'observed',
      coverageKeys: ['api.response.201'],
      needsReview: false,
      uncovered: [],
      structuredDesign: {
        source: 'openapi',
        api: {
          method: 'POST',
          path: '/patients',
          parameters: [
            {
              name: 'tenantId',
              in: 'header',
              required: true,
              schema: { type: 'string', minLength: 1 },
            },
          ],
          requestBody: {
            required: true,
            contentType: 'application/json',
            schema: { type: 'object', required: ['name'], properties: ['name'] },
          },
          responses: [
            {
              status: '201',
              description: '患者创建成功',
              schema: { type: 'object', properties: ['id', 'name'] },
            },
          ],
          security: ['bearerAuth'],
        },
      },
    });
    expect(ev.structuredDesign?.api?.parameters[0]?.in).toBe('header');
    expect(ev.structuredDesign?.api?.responses[0]?.description).toBe('患者创建成功');
  });

  it('needsReview=true 但缺 reviewReason → 被拒（数据质量红线）', () => {
    const bad = {
      featureId: 'SYS_SUB_PT_01',
      actionKind: 'update',
      states: [],
      fields: [],
      tables: [],
      actionEntries: [],
      containers: [],
      evidenceLevel: 'needs_review',
      coverageKeys: [],
      needsReview: true,
      uncovered: [],
    };
    expect(() => FeatureEvidenceSchema.parse(bad)).toThrow(/reviewReason/);
  });

  it('needsReview=true 且含 reviewReason → 通过（如"缺少安全样例数据"）', () => {
    const ok = {
      featureId: 'SYS_SUB_PT_01',
      actionKind: 'update',
      states: [],
      fields: [],
      tables: [],
      actionEntries: [],
      containers: [],
      evidenceLevel: 'needs_review',
      coverageKeys: [],
      needsReview: true,
      reviewReason: '缺少安全样例数据',
      uncovered: [{ kind: 'no_safe_sample', reason: '无安全测试样例行' }],
    };
    expect(FeatureEvidenceSchema.parse(ok).reviewReason).toBe('缺少安全样例数据');
  });

  it('待复核场景候选必须有明确原因，旧的未标记场景仍兼容', () => {
    const base = {
      scenarioId: 's1',
      featureId: 'F1',
      actionKind: 'list',
      scenarioName: '列表',
      coverageKey: 'list.display',
      priority: 'P0',
      caseNo: 'F1',
      step: 'Step1',
      operation: '查看列表',
      expected: '列表可见',
      evidenceLevel: 'needs_review' as const,
      needsReview: true,
    };
    expect(() => ScenarioCandidateSchema.parse(base)).toThrow(/reviewReason/);
    expect(() =>
      ScenarioCandidateSchema.parse({ ...base, needsReview: false, evidenceLevel: 'observed' }),
    ).not.toThrow();
  });

  it('ScenarioCandidate 拒绝不等于 featureId 的旧编号后缀', () => {
    expect(() =>
      ScenarioCandidateSchema.parse({
        scenarioId: 's1',
        featureId: 'F1',
        actionKind: 'list',
        scenarioName: '列表',
        coverageKey: 'list.display',
        priority: 'P0',
        caseNo: 'F1_A01',
        step: 'Step1',
        operation: '查看列表',
        expected: '列表可见',
        evidenceLevel: 'observed',
        needsReview: false,
      }),
    ).toThrow(/caseNo|featureId/);
  });
});

describe('T1 CaseRow / CaseInput 新可选字段', () => {
  it('CaseRow 新增 scenarioName/priority/coverageKeys 可省略且可填', () => {
    const base = {
      caseNo: 'SYS_SUB_PT_01',
      content: '新增',
      step: 'Step1',
      operation: '点击新增',
      expected: '打开表单',
      firstResult: '\\',
      regressionResult: '\\',
      conclusion: '\\',
      id: 'r1',
      featureId: 'SYS_SUB_PT_01',
      targetTestPoint: '新增',
    };
    expect(() => CaseRowSchema.parse(base)).not.toThrow();
    const full = {
      ...base,
      scenarioId: 'SYS_SUB_PT_01__create.required',
      scenarioName: '新增-必填校验',
      priority: 'P0',
      coverageKeys: ['field_required'],
    };
    expect(CaseRowSchema.parse(full).priority).toBe('P0');
  });

  it('CaseRow 拒绝 _Axx 旧编号后缀', () => {
    expect(() =>
      CaseRowSchema.parse({
        caseNo: 'SYS_SUB_PT_01_A01',
        content: '新增',
        step: 'Step1',
        operation: '点击新增',
        expected: '打开表单',
        firstResult: '\\',
        regressionResult: '\\',
        conclusion: '\\',
        id: 'r1',
        featureId: 'SYS_SUB_PT_01',
        targetTestPoint: '新增',
      }),
    ).toThrow(/caseNo|featureId/);
  });

  it('CaseRow 拒绝遗留的流水号编号后缀', () => {
    expect(() =>
      CaseRowSchema.parse({
        caseNo: 'SYS_SUB_PT_01_CREATE_001',
        content: '新增',
        step: 'Step1',
        operation: '点击新增',
        expected: '打开表单',
        firstResult: '\\',
        regressionResult: '\\',
        conclusion: '\\',
        id: 'r1',
        featureId: 'SYS_SUB_PT_01',
        targetTestPoint: '新增',
      }),
    ).toThrow(/caseNo|featureId/);
  });

  it('CaseInput 可携带 featureProfiles / featureEvidence（按 featureId 键控）', () => {
    const input = {
      featureTable: [
        [['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询', 'SYS_SUB_PT_01']],
      ],
      scope: 'all' as const,
      metaConfig: {
        systemName: '系统',
        testPointId: 'SYS_SUB_PT_01',
        testPoint: '查询',
        testers: '',
        clientStaff: '',
        developerStaff: '',
        firstTestDate: '',
        regressionDate: '',
        conclusionRule: '',
        precondition: '',
      },
      featureProfiles: [{ featureId: 'SYS_SUB_PT_01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: {
        SYS_SUB_PT_01: {
          featureId: 'SYS_SUB_PT_01',
          actionKind: 'create',
          states: ['base', 'create'],
          fields: [],
          tables: [],
          actionEntries: [],
          containers: [],
          evidenceLevel: 'observed',
          coverageKeys: [],
          needsReview: false,
          uncovered: [],
        },
      },
    };
    expect(() => CaseInputSchema.parse(input)).not.toThrow();
  });
});

describe('T1 FeatureArtifact 新旧双形态', () => {
  it('旧二维数组识别为 version 1（非 v2）', () => {
    const legacy = [
      [['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询', 'SYS_SUB_PT_01']],
    ];
    expect(isFeatureArtifactV2(legacy)).toBe(false);
    expect(() => FeatureArtifactSchema.parse(legacy)).not.toThrow();
  });

  it('v2 对象识别为 version 2 且含 featureProfiles', () => {
    const v2 = {
      version: 2 as const,
      table: [[['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询', 'SYS_SUB_PT_01']]],
      featureProfiles: [{ featureId: 'SYS_SUB_PT_01', testPoint: '新增', actionKind: 'create' }],
    };
    expect(isV2Artifact(v2)).toBe(true);
    expect(() => FeatureArtifactSchema.parse(v2)).not.toThrow();
  });
});

describe('CoverageManifest', () => {
  it('保留 required/observed/needs_review/missing 覆盖键', () => {
    const manifest = CoverageManifestSchema.parse({
      actionKind: 'create',
      requiredKeys: ['create.ready', 'create.required.name'],
      observedKeys: ['create.ready'],
      needsReviewKeys: ['create.required.name'],
      missingKeys: ['create.required.name'],
    });
    expect(manifest.missingKeys).toEqual(['create.required.name']);
  });
});

describe('T1 CaseOutput 兼容（无质量门变动）', () => {
  it('旧形态 CaseOutput 通过校验', () => {
    const out = {
      caseWorkbook: [],
      caseRows: [],
      metaHeader: {
        systemName: '系统',
        testPointId: 'SYS_SUB_PT_01',
        testPoint: '查询',
        testers: '',
        clientStaff: '',
        developerStaff: '',
        firstTestDate: '',
        regressionDate: '',
        conclusionRule: '',
        precondition: '',
      },
      qualityGateIssues: [],
      complexLogicDetected: false,
    };
    expect(() => validateCaseOutput(out)).not.toThrow();
  });
});

describe('feature-driven Case contract', () => {
  const meta = {
    systemName: '系统',
    testPointId: 'SYS_SUB_PT_01',
    testPoint: '查询',
    testers: '',
    clientStaff: '',
    developerStaff: '',
    firstTestDate: '',
    regressionDate: '',
    conclusionRule: '',
    precondition: '',
  };
  const caseRow = {
    caseNo: 'SYS_SUB_PT_01',
    content: '查询',
    step: 'Step 1',
    operation: '查看列表',
    expected: '列表可见',
    firstResult: '\\',
    regressionResult: '\\',
    conclusion: '\\',
    id: 'r1',
    featureId: 'SYS_SUB_PT_01',
    targetTestPoint: '查询',
    batchId: 'batch-1',
  };
  const outputWithFeatureResult = (
    coverageDecisions: Record<CoverageCategory, CoverageDecision>,
    reasons?: string[],
  ) => ({
    caseWorkbook: [{ sheetName: '子', meta, rows: [caseRow] }],
    caseRows: [[caseRow]],
    metaHeader: meta,
    qualityGateIssues: [],
    complexLogicDetected: false,
    featureResults: [
      {
        featureId: 'SYS_SUB_PT_01',
        inputIndex: 0,
        status: 'generated',
        featureFingerprint: 'fingerprint',
        generatedCaseGroup: true,
        coverageDecisions,
        ...(reasons === undefined ? {} : { reasons }),
      },
    ],
  });
  const invalidReasonCases: Array<[string, string[] | undefined]> = [
    ['missing', undefined],
    ['empty', []],
    ['whitespace', ['  ']],
    ['generic placeholder', ['待确认']],
    ['generic placeholder', ['信息不足']],
    ['generic placeholder', ['证据不足']],
  ];
  const concreteCoverageCases: Array<[Record<CoverageCategory, CoverageDecision>, string[]]> = [
    [
      {
        normal: 'covered',
        boundary: 'needs_review',
        exception: 'covered',
        process: 'covered',
        permission: 'covered',
      },
      ['boundary: 当前证据未声明边界条件'],
    ],
    [
      {
        normal: 'covered',
        boundary: 'not_applicable',
        exception: 'covered',
        process: 'covered',
        permission: 'covered',
      },
      ['boundary: 当前查询界面不存在可输入的边界字段'],
    ],
  ];

  it('Given a generation request, When parsed, Then it preserves the current workbook and frozen generation fields', () => {
    const currentCaseWorkbook = [
      {
        sheetName: '子',
        meta,
        rows: [caseRow],
        colWidths: [18],
        remarkRow: '手工备注',
        screenshotRef: 'screen.png',
      },
    ];
    const parsed = validateCaseInput({
      featureTable: [
        [['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询', 'SYS_SUB_PT_01']],
      ],
      scope: 'selected_modules',
      selectedModuleIds: ['子'],
      metaConfig: meta,
      currentCaseWorkbook,
      regenerateSelected: true,
      styleVersion: 'company-v2',
    });

    const reparsed = validateCaseInput(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed.currentCaseWorkbook).toEqual(currentCaseWorkbook);
    expect(reparsed.regenerateSelected).toBe(true);
    expect(reparsed.styleVersion).toBe('company-v2');
  });

  it('Given a generated result, When serialized and reparsed, Then it preserves feature results and generation metadata', () => {
    const generation = {
      batchId: 'batch-1',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'no_ai',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      evidenceDigest: 'sha256:3f8b1d',
      taskId: 'task-1',
    };
    const parsed = validateCaseOutput({
      caseWorkbook: [{ sheetName: '子', meta, rows: [caseRow] }],
      caseRows: [[caseRow]],
      metaHeader: meta,
      qualityGateIssues: [],
      complexLogicDetected: false,
      featureResults: [
        {
          featureId: 'SYS_SUB_PT_01',
          inputIndex: 0,
          status: 'generated',
          featureFingerprint: 'fingerprint',
          generatedCaseGroup: true,
          coverageDecisions: {
            normal: 'covered',
            boundary: 'not_applicable',
            exception: 'needs_review',
            process: 'not_applicable',
            permission: 'not_applicable',
          },
          reasons: [
            'boundary: 当前证据未声明边界条件',
            'exception: 异常路径需要人工复核',
            'process: 当前功能不涉及流程转换',
            'permission: 当前功能未采集权限规则',
          ],
        },
      ],
      generation,
    });

    const reparsed = validateCaseOutput(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed.generation).toEqual(generation);
    expect(reparsed.caseWorkbook[0]?.rows[0]?.batchId).toBe('batch-1');
    expect(reparsed.featureResults).toEqual(parsed.featureResults);
    expect(reparsed.featureResults?.[0]?.reasons).toEqual([
      'boundary: 当前证据未声明边界条件',
      'exception: 异常路径需要人工复核',
      'process: 当前功能不涉及流程转换',
      'permission: 当前功能未采集权限规则',
    ]);
  });

  it.each(invalidReasonCases)(
    'Given needs_review coverage with a %s reason, When parsed, Then it rejects the result',
    (_label, reasons) => {
      expect(() =>
        validateCaseOutput(
          outputWithFeatureResult(
            {
              normal: 'covered',
              boundary: 'needs_review',
              exception: 'covered',
              process: 'covered',
              permission: 'covered',
            },
            reasons,
          ),
        ),
      ).toThrow(/reasons/);
    },
  );

  it.each(invalidReasonCases)(
    'Given not_applicable coverage with a %s reason, When parsed, Then it rejects the result',
    (_label, reasons) => {
      expect(() =>
        validateCaseOutput(
          outputWithFeatureResult(
            {
              normal: 'covered',
              boundary: 'not_applicable',
              exception: 'covered',
              process: 'covered',
              permission: 'covered',
            },
            reasons,
          ),
        ),
      ).toThrow(/reasons/);
    },
  );

  it.each(concreteCoverageCases)(
    'Given a coverage decision with a concrete reason, When parsed, Then it preserves the reason',
    (coverageDecisions, reasons) => {
      expect(
        validateCaseOutput(outputWithFeatureResult(coverageDecisions, reasons)).featureResults?.[0]
          ?.reasons,
      ).toEqual(reasons);
    },
  );

  it('Given generation metadata with only an evidence version, When parsed, Then it preserves the version', () => {
    const generation = {
      batchId: 'batch-1',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'no_ai',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      evidenceDigest: 'sha256:3f8b1d',
      taskId: 'task-1',
    };
    const output = {
      caseWorkbook: [{ sheetName: '子', meta, rows: [caseRow] }],
      caseRows: [[caseRow]],
      metaHeader: meta,
      qualityGateIssues: [],
      complexLogicDetected: false,
      generation,
    };
    const { evidenceDigest: _evidenceDigest, ...versionOnly } = generation;

    expect(validateCaseOutput({ ...output, generation: versionOnly }).generation).toEqual(
      versionOnly,
    );
  });

  it('Given generation metadata with only an evidence digest, When parsed, Then it preserves the digest', () => {
    const generation = {
      batchId: 'batch-1',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'no_ai',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      evidenceDigest: 'sha256:3f8b1d',
      taskId: 'task-1',
    };
    const output = {
      caseWorkbook: [{ sheetName: '子', meta, rows: [caseRow] }],
      caseRows: [[caseRow]],
      metaHeader: meta,
      qualityGateIssues: [],
      complexLogicDetected: false,
      generation,
    };
    const { evidenceVersion: _evidenceVersion, ...digestOnly } = generation;

    expect(validateCaseOutput({ ...output, generation: digestOnly }).generation).toEqual(
      digestOnly,
    );
  });

  it('Given generation metadata without evidence version and digest, When parsed, Then it rejects the result', () => {
    const generation = {
      batchId: 'batch-1',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'no_ai',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      evidenceDigest: 'sha256:3f8b1d',
      taskId: 'task-1',
    };
    const output = {
      caseWorkbook: [{ sheetName: '子', meta, rows: [caseRow] }],
      caseRows: [[caseRow]],
      metaHeader: meta,
      qualityGateIssues: [],
      complexLogicDetected: false,
      generation,
    };
    const {
      evidenceVersion: _evidenceVersion,
      evidenceDigest: _evidenceDigest,
      ...withoutEvidence
    } = generation;

    expect(() => validateCaseOutput({ ...output, generation: withoutEvidence })).toThrow();
  });

  it('Given an empty selected scope, When frozen with only an evidence version, Then it remains a valid no-op context', () => {
    const context = CaseGenerationContextSchema.parse({
      batchId: 'batch-empty',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: [],
      mode: 'no_ai',
      scope: 'selected_modules',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      taskId: 'task-empty',
    });

    expect(CaseGenerationContextSchema.parse(JSON.parse(JSON.stringify(context)))).toEqual(context);
  });

  it('Given an AI task, When it has a config and only an evidence digest, Then parsing preserves it', () => {
    expect(CaseGenerationContextSchema.parse({
      batchId: 'batch-ai',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'ai',
      aiConfigId: 'case-ai-42',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceDigest: 'sha256:3f8b1d',
      taskId: 'task-ai',
    })).toMatchObject({ mode: 'ai', aiConfigId: 'case-ai-42', evidenceDigest: 'sha256:3f8b1d' });
  });

  it('Given an AI task without a config, When parsed, Then it rejects the context', () => {
    expect(() => CaseGenerationContextSchema.parse({
      batchId: 'batch-ai',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'ai',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      taskId: 'task-ai',
    })).toThrow(/aiConfigId/);
  });

  it('Given a no-AI task with a config, When parsed, Then it rejects the context', () => {
    expect(() => CaseGenerationContextSchema.parse({
      batchId: 'batch-no-ai',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'no_ai',
      aiConfigId: 'case-ai-42',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      taskId: 'task-no-ai',
    })).toThrow(/aiConfigId/);
  });

  it('Given generated and skipped results, When parsed, Then only the generated result may carry a group', () => {
    const common = {
      featureId: 'SYS_SUB_PT_01',
      inputIndex: 0,
      featureFingerprint: 'fingerprint',
      coverageDecisions: {
        normal: 'covered',
        boundary: 'covered',
        exception: 'covered',
        process: 'covered',
        permission: 'covered',
      },
    };
    expect(CaseFeatureResultSchema.parse({ ...common, status: 'generated', generatedCaseGroup: true, reasons: [] }))
      .toMatchObject({ status: 'generated', generatedCaseGroup: true });
    expect(CaseFeatureResultSchema.parse({
      ...common,
      status: 'skipped_existing',
      generatedCaseGroup: false,
      reasons: ['该功能点已存在当前有效用例组，保留人工编辑内容'],
    })).toMatchObject({ status: 'skipped_existing', generatedCaseGroup: false });
    expect(() => CaseFeatureResultSchema.parse({ ...common, status: 'generated', generatedCaseGroup: false, reasons: [] }))
      .toThrow(/generatedCaseGroup/);
    expect(() => CaseFeatureResultSchema.parse({ ...common, status: 'skipped_existing', generatedCaseGroup: true, reasons: ['已存在有效组'] }))
      .toThrow(/generatedCaseGroup/);
    expect(() => CaseFeatureResultSchema.parse({ ...common, status: 'skipped_existing', generatedCaseGroup: false, reasons: [] }))
      .toThrow(/reasons/);
  });

  it('Given generic reasons with trailing punctuation, When parsed, Then it rejects them without rejecting concrete reasons', () => {
    const common = {
      featureId: 'SYS_SUB_PT_01',
      inputIndex: 0,
      status: 'needs_review',
      featureFingerprint: 'fingerprint',
      generatedCaseGroup: false,
      coverageDecisions: {
        normal: 'covered',
        boundary: 'needs_review',
        exception: 'covered',
        process: 'covered',
        permission: 'covered',
      },
    };
    expect(() => CaseFeatureResultSchema.parse({ ...common, reasons: ['证据不足。'] })).toThrow(/reasons/);
    expect(() => CaseFeatureResultSchema.parse({ ...common, reasons: ['待确认！'] })).toThrow(/reasons/);
    expect(CaseFeatureResultSchema.parse({
      ...common,
      reasons: ['当前页面证据不足以验证跨角色权限，需要人工补充授权账号。'],
    }).reasons).toEqual(['当前页面证据不足以验证跨角色权限，需要人工补充授权账号。']);
  });

  it.each([
    '证据不足，',
    '待确认；',
    '信息不足：',
    '证据不足…',
    '证据不足,',
    '待确认;;',
    '信息不足::',
    '证据不足...',
    '证据不足？！',
  ])('Given the generic placeholder %s, When parsed, Then trailing punctuation cannot bypass rejection', (reason) => {
    expect(() => CaseFeatureResultSchema.parse({
      featureId: 'SYS_SUB_PT_01',
      inputIndex: 0,
      status: 'needs_review',
      featureFingerprint: 'fingerprint',
      generatedCaseGroup: false,
      coverageDecisions: {
        normal: 'covered',
        boundary: 'needs_review',
        exception: 'covered',
        process: 'covered',
        permission: 'covered',
      },
      reasons: [reason],
    })).toThrow(/reasons/);
  });

  it.each([
    'boundary: 证据不足',
    '【boundary】证据不足',
    'ｂｏｕｎｄａｒｙ：证据不足',
    '证\u200B据不足',
    'boundary ： 信息不足',
    '【Boundary】：待确认',
    'normal（证据不足）',
    '【normal】（证据不足）',
    '!!!证据不足',
    '？！',
    '\u200B\u200C',
  ])('Given a normalized generic placeholder %s, When parsed, Then it is rejected', (reason) => {
    expect(() => CaseFeatureResultSchema.parse({
      featureId: 'SYS_SUB_PT_01',
      inputIndex: 0,
      status: 'needs_review',
      featureFingerprint: 'fingerprint',
      generatedCaseGroup: false,
      coverageDecisions: {
        normal: 'covered',
        boundary: 'needs_review',
        exception: 'covered',
        process: 'covered',
        permission: 'covered',
      },
      reasons: [reason],
    })).toThrow(/reasons/);
  });

  it('Given scope and regeneration combinations, When statically shaped and parsed, Then only selected scope may regenerate', () => {
    const allContext: CaseGenerationContext = {
      batchId: 'batch-all',
      systemId: 'system-1',
      featureRevision: 'rev-1',
      orderedFeatureIds: ['SYS_SUB_PT_01'],
      mode: 'no_ai',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      taskId: 'task-all',
    };
    const allInput: CaseInput = {
      featureTable: [[['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询', 'SYS_SUB_PT_01']]],
      scope: 'all',
      regenerateSelected: false,
      metaConfig: meta,
    };
    expect(CaseGenerationContextSchema.parse(allContext)).toEqual(allContext);
    expect(CaseInputSchema.parse(allInput).scope).toBe('all');
    expect(CaseGenerationContextSchema.parse({ ...allContext, scope: 'selected_modules', regenerateSelected: true }))
      .toMatchObject({ scope: 'selected_modules', regenerateSelected: true });
    expect(() => CaseGenerationContextSchema.parse({ ...allContext, regenerateSelected: true })).toThrow(/regenerateSelected/);
    expect(() => CaseInputSchema.parse({ ...allInput, regenerateSelected: true })).toThrow(/regenerateSelected/);
  });

  it('Given a frozen feature snapshot, When a testPointId is missing, Then parsing rejects it', () => {
    const base = ['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询'];
    expect(() =>
      validateCaseInput({ featureTable: [[base.concat('')]], scope: 'all', metaConfig: meta }),
    ).toThrow();
  });

  it('Given a frozen feature snapshot, When a testPointId is duplicated, Then parsing rejects it', () => {
    const base = ['1', '功能性测试', '§1', '系统', '主', '子', '功能点', '查询'];
    expect(() =>
      validateCaseInput({
        featureTable: [[base.concat('DUP'), base.concat('DUP')]],
        scope: 'all',
        metaConfig: meta,
      }),
    ).toThrow();
  });
});
