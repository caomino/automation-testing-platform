/**
 * @file contracts.verify.ts
 * @description 契约冻结校验 — 验证 schema 与金标准对齐、mock 可 round-trip
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import {
  validateLoginInput,
  validateExploreInput,
  validateFeatureInput,
  validateCaseInput,
  validateCaseOutput,
  validateExecuteInput,
  validateDefectInput,
  validateDefectOutput,
  LoginOutputSchema,
  ExploreOutputSchema,
  FeatureOutputSchema,
  CaseOutputSchema,
  ExecuteOutputSchema,
  DefectOutputSchema,
} from '../src';
import * as mock from '../src/mock/index';

describe('contracts 冻结校验', () => {
  it('金标准-功能点九列长度固定为 9', () => {
    for (const group of mock.mockFeatureOutput.featureTable) {
      for (const row of group) {
        expect(row).toHaveLength(9);
      }
    }
  });

  it('金标准-测试用例八列 + meta 十字段对齐', () => {
    const sheet = mock.mockCaseOutput.caseWorkbook[0];
    // 八列可见字段齐全
    const row = sheet.rows[0];
    for (const k of [
      'caseNo',
      'content',
      'step',
      'operation',
      'expected',
      'firstResult',
      'regressionResult',
      'conclusion',
    ]) {
      expect(row[k as keyof typeof row]).toBeDefined();
    }
    // meta 十字段齐全
    const metaKeys = Object.keys(sheet.meta);
    expect(metaKeys).toHaveLength(10);
  });

  it('金标准-测试点标识格式 base_NN（4 段）', () => {
    for (const id of mock.mockFeatureOutput.featureIds) {
      expect(id).toMatch(/^[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9]+_\d+$/);
    }
  });

  it('用例编号 = 功能点测试点标识（绑定一致）', () => {
    const sheet = mock.mockCaseOutput.caseWorkbook[0];
    const feat = mock.mockFeatureOutput.featureTable[0][0];
    expect(sheet.rows[0].caseNo).toBe(feat[8]); // 列8 = 测试点标识
    expect(sheet.rows[0].featureId).toBe(feat[8]);
  });

  it('LoginInput 校验通过', () => {
    const v = validateLoginInput({
      projectId: 'p1',
      systemId: 'sys_qyyx',
      mode: 'credential',
      credentialRef: 'cred_1',
      systemUrl: 'https://example.com/x',
    });
    expect(v.mode).toBe('credential');
  });

  it('LoginInput 非法 URL 报错', () => {
    expect(() =>
      validateLoginInput({
        projectId: 'p',
        systemId: 's',
        mode: 'no-login',
        systemUrl: 'not-a-url',
      }),
    ).toThrow();
  });

  it('ExploreInput/Output 校验通过', () => {
    const input = validateExploreInput({
      sessionHandle: {
        sessionId: 's1',
        systemId: 'sys_qyyx',
        loginStatus: 'ok',
        cookies: [],
        expiresAt: 0,
      },
      subsystemId: 'sys_qyyx',
    });
    expect(input.subsystemId).toBe('sys_qyyx');
    const out = ExploreOutputSchema.parse({
      moduleTree: mock.mockModuleTree,
      coverage: { visited: 1, total: 1, frontier: [] },
      needsReview: [],
      checkpoint: { checkpointId: 'c1', visitedNodeIds: [], frontier: [], savedAt: 0 },
    });
    expect(out.moduleTree).toHaveLength(1);
  });

  it('FeatureInput/Output 校验通过', () => {
    const input = validateFeatureInput(mock.mockFeatureInput);
    expect(input.systemName).toBe('区域影像系统');
    const out = FeatureOutputSchema.parse(mock.mockFeatureOutput);
    expect(out.featureIds).toHaveLength(3);
  });

  it('CaseInput/Output round-trip 保真', () => {
    const input = validateCaseInput(mock.mockCaseInput);
    expect(input.scope).toBe('all');
    const out = validateCaseOutput(mock.mockCaseOutput);
    // round-trip：导出再解析，结构一致
    const serialized = JSON.parse(JSON.stringify(out));
    const reparsed = CaseOutputSchema.parse(serialized);
    expect(reparsed.caseWorkbook[0].rows[0].caseNo).toBe('QYYX_PZ_JCX_01');
    expect(reparsed.caseWorkbook[0].colWidths).toEqual([18, 16, 8, 34, 34, 14, 14, 12]);
  });

  it('feature-driven CaseInput/Output round-trip 保留追加生成字段', () => {
    const meta = mock.mockCaseOutput.metaHeader;
    const currentCaseWorkbook = mock.mockCaseOutput.caseWorkbook.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({ ...row, batchId: 'batch-1' })),
    }));
    const input = validateCaseInput({
      ...mock.mockCaseInput,
      scope: 'selected_modules',
      selectedModuleIds: ['检查室'],
      currentCaseWorkbook,
      regenerateSelected: true,
      styleVersion: 'company-v2',
    });
    const generation = {
      batchId: 'batch-1',
      systemId: 'sys_qyyx',
      featureRevision: 'revision-1',
      orderedFeatureIds: ['QYYX_PZ_JCX_01'],
      mode: 'no_ai',
      scope: 'all',
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      evidenceDigest: 'sha256:3f8b1d',
      taskId: 'task-1',
    };
    const reasons = [
      'boundary: 当前证据未声明边界条件',
      'exception: 异常路径需要人工复核',
      'process: 当前功能不涉及流程转换',
      'permission: 当前功能未采集权限规则',
    ];
    const output = validateCaseOutput({
      ...mock.mockCaseOutput,
      caseWorkbook: currentCaseWorkbook,
      caseRows: currentCaseWorkbook.map((sheet) => sheet.rows),
      featureResults: [
        {
          featureId: 'QYYX_PZ_JCX_01',
          inputIndex: 0,
          status: 'generated',
          featureFingerprint: 'f1',
          generatedCaseGroup: true,
          coverageDecisions: {
            normal: 'covered',
            boundary: 'not_applicable',
            exception: 'needs_review',
            process: 'not_applicable',
            permission: 'not_applicable',
          },
          reasons,
        },
      ],
      generation,
    });

    const reparsedInput = validateCaseInput(JSON.parse(JSON.stringify(input)));
    const reparsedOutput = validateCaseOutput(JSON.parse(JSON.stringify(output)));
    expect(reparsedOutput.generation).toEqual(generation);
    expect(reparsedOutput.featureResults?.[0]?.reasons).toEqual(reasons);
    expect(reparsedInput.currentCaseWorkbook).toEqual(currentCaseWorkbook);
    expect(reparsedInput.regenerateSelected).toBe(true);
    expect(reparsedInput.styleVersion).toBe('company-v2');
    expect(reparsedOutput.caseWorkbook[0]?.rows[0]?.batchId).toBe('batch-1');
    expect(reparsedOutput.featureResults).toEqual(output.featureResults);
    expect(output.metaHeader).toEqual(meta);
  });

  it('feature-driven CaseOutput preserves legacy and explicit row provenance', () => {
    const legacyRow = { ...mock.mockCaseOutput.caseWorkbook[0].rows[0] };
    const generatedRow = {
      ...legacyRow,
      id: 'generated-row',
      batchId: 'batch-new',
      generationMode: 'no_ai' as const,
      featureFingerprint: 'fingerprint-new',
    };
    const generation = {
      batchId: 'batch-current',
      systemId: 'sys_qyyx',
      featureRevision: 'revision-1',
      orderedFeatureIds: ['QYYX_PZ_JCX_01'],
      mode: 'no_ai' as const,
      scope: 'all' as const,
      regenerateSelected: false,
      styleVersion: 'company-v2',
      evidenceVersion: 'evidence-v3',
      taskId: 'task-1',
    };
    const rows = [legacyRow, generatedRow];
    const output = validateCaseOutput({
      ...mock.mockCaseOutput,
      caseWorkbook: [{ ...mock.mockCaseOutput.caseWorkbook[0], rows }],
      caseRows: [rows],
      generation,
    });

    expect(output.caseWorkbook[0]?.rows).toEqual(rows);
    expect(output.caseRows[0]).toEqual(rows);
  });

  it('ExecuteInput 校验通过', () => {
    const v = validateExecuteInput({
      caseWorkbook: mock.mockCaseOutput.caseWorkbook,
      scope: 'all',
      browserOSMatrix: [{ browser: 'chromium', os: 'windows' }],
    });
    expect(v.browserOSMatrix).toHaveLength(1);
  });

  it('ExecuteInput 空矩阵报错', () => {
    expect(() =>
      validateExecuteInput({ caseWorkbook: [], scope: 'all', browserOSMatrix: [] }),
    ).toThrow();
  });

  it('DefectInput/Output 校验通过', () => {
    const input = validateDefectInput({ executionReport: [] });
    expect(input.moduleFilter).toBeUndefined();
    const out = DefectOutputSchema.parse({
      defectTable: [
        [
          {
            sequence: 1,
            description: 'd',
            level: '高',
            qualityAttribute: '功能',
            environment: 'win/chromium',
          },
        ],
      ],
      screenshots: [],
    });
    expect(out.defectTable[0][0].level).toBe('高');
  });
});
