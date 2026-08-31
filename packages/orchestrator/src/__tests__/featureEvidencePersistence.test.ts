import { describe, expect, it, vi } from 'vitest';
import { PipelineOrchestrator } from '../index.js';
import type { FeatureArtifactV2, FeatureEvidence, FeatureRow } from '@test-platform/contracts';

const table: FeatureRow[][] = [
  [['1', '功能', '3.1', '系统', '主模块', '子模块', '用户', '用户列表', 'F_01']],
];
const apiTable: FeatureRow[][] = [
  [['2', '接口', '3.1', '系统', '接口模块', '患者', '患者接口', '创建患者', 'API_01']],
];

function evidence(featureId: string, identity?: { systemId?: string; featureRevision?: string; pageEntry?: string }): FeatureEvidence {
  return {
    featureId,
    ...(identity?.systemId ? { systemId: identity.systemId } : {}),
    ...(identity?.featureRevision ? { featureRevision: identity.featureRevision } : {}),
    ...(identity?.pageEntry ? { pageEntry: identity.pageEntry } : {}),
    actionKind: 'list',
    pageUrl: 'https://x.test/users',
    states: ['base'],
    fields: [],
    tables: [
      {
        ref: 'users',
        selector: '#users',
        columns: ['用户'],
        rowCount: 1,
        hasPagination: false,
        hasSorting: false,
        hasFilter: false,
        hasEmptyState: false,
      },
    ],
    actionEntries: [],
    containers: [],
    evidenceLevel: 'observed',
    coverageKeys: ['list.display'],
    needsReview: false,
    uncovered: [],
  };
}

describe('runStage(case) evidence persistence', () => {
  it('以当前确认的功能点快照为准，移除不在快照内的 API_01 并保留当前 F_01 证据', async () => {
    const existing: FeatureArtifactV2 = {
      version: 2,
      table: apiTable,
      featurePaths: { API_01: 'https://x.test/api' },
      featureEvidence: { API_01: evidence('API_01') },
      designSources: ['openapi.json'],
    };
    const store = {
      getFeatureArtifact: vi.fn().mockResolvedValue(existing),
      saveFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveCaseTable: vi.fn().mockResolvedValue(undefined),
      saveCaseGeneration: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const orchestrator = new PipelineOrchestrator({
      store: store as never,
      logger: logger as never,
    });

    await orchestrator.runStage('case', {
      systemId: 'sys-evidence',
      featureTable: table,
      metaConfig: {
        systemName: '系统',
        testPointId: '',
        testPoint: '',
        testers: '',
        clientStaff: '',
        developerStaff: '',
        firstTestDate: '2026-08-21',
        regressionDate: '',
        conclusionRule: '默认',
        precondition: '已登录',
      },
      exploredElements: [
        {
          ref: 'table',
          tag: 'table',
          selector: 'table',
          interactive: false,
          isFormControl: false,
          suggestedAction: 'navigate',
        },
      ],
      featureEvidence: { F_01: evidence('F_01', { systemId: 'sys-evidence', pageEntry: 'https://x.test/users' }) },
    });

    expect(store.saveFeatureArtifact).toHaveBeenCalledWith('sys-evidence', expect.anything());
    const saved = vi.mocked(store.saveFeatureArtifact).mock.calls[0][1]!;
    expect(saved.table.flat()).toEqual(expect.arrayContaining([table[0][0]]));
    expect(saved.table.flat()).not.toEqual(expect.arrayContaining([apiTable[0][0]]));
    expect(saved.designSources).toEqual(['openapi.json']);
    expect(saved.featureEvidence).toEqual(
      expect.objectContaining({ F_01: expect.objectContaining({ featureId: 'F_01' }) }),
    );
  });

  it('同一 featureId 的 OpenAPI 与当前 Web 快照冲突时以当前 Web 快照为准', async () => {
    const existingTable: FeatureRow[][] = [
      [['1', '接口测试', '3.1', '系统', '接口', '患者', '患者接口', '创建患者', 'F_01']],
    ];
    const incomingWebTable: FeatureRow[][] = [
      [['1', '功能测试', '3.1', '系统', '用户', '用户', '用户管理', '用户列表', 'F_01']],
    ];
    const existing: FeatureArtifactV2 = {
      version: 2,
      table: existingTable,
      featurePaths: { F_01: 'https://api.test/users' },
      featureEvidence: {
        F_01: {
          ...evidence('F_01'),
          coverageKeys: ['api.request', 'api.response.201'],
          structuredDesign: {
            source: 'openapi',
            api: { method: 'POST', path: '/users', parameters: [], responses: [], security: [] },
          },
        },
      },
      featureProfiles: [
        { featureId: 'F_01', testPoint: '创建用户', actionKind: 'create', source: 'openapi' },
      ],
    };
    const store = {
      getFeatureArtifact: vi.fn().mockResolvedValue(existing),
      saveFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveCaseTable: vi.fn().mockResolvedValue(undefined),
      saveCaseGeneration: vi.fn().mockResolvedValue(undefined),
    };
    const orchestrator = new PipelineOrchestrator({
      store: store as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    const output = await orchestrator.runStage('case', {
      systemId: 'sys-evidence',
      featureTable: incomingWebTable,
      metaConfig: {
        systemName: '系统',
        testPointId: '',
        testPoint: '',
        testers: '',
        clientStaff: '',
        developerStaff: '',
        firstTestDate: '2026-08-21',
        regressionDate: '',
        conclusionRule: '默认',
        precondition: '已登录',
      },
      exploredElements: [
        {
          ref: 'table',
          tag: 'table',
          selector: 'table',
          interactive: false,
          isFormControl: false,
          suggestedAction: 'navigate',
        },
      ],
      featureProfiles: [
        { featureId: 'F_01', testPoint: '用户列表', actionKind: 'list', source: 'web' },
      ],
      featurePaths: { F_01: 'https://web.test/users' },
      featureEvidence: { F_01: evidence('F_01', { systemId: 'sys-evidence', pageEntry: 'https://x.test/users' }) },
    });

    const saved = vi.mocked(store.saveFeatureArtifact).mock.calls[0][1]!;
    expect(saved.table).toEqual(incomingWebTable);
    expect(saved.featurePaths?.F_01).toBe('https://web.test/users');
    expect(saved.featureProfiles?.find((profile) => profile.featureId === 'F_01')).toMatchObject({
      actionKind: 'list',
      source: 'web',
    });
    expect(saved.featureEvidence?.F_01).toMatchObject({
      featureId: 'F_01',
      pageUrl: 'https://x.test/users',
      coverageKeys: ['list.display'],
    });
    expect(saved.featureEvidence?.F_01.structuredDesign).toBeUndefined();
    expect(output.caseRows.flat().filter((row) => row.featureId === 'F_01')).toHaveLength(0);
    expect(output.featureResults).toEqual([
      expect.objectContaining({
        featureId: 'F_01',
        status: 'evidence_missing',
        generatedCaseGroup: false,
      }),
    ]);
  });

  it('同一 featureId 的同源 Web bundle 由当前结果整体更新', async () => {
    const existing: FeatureArtifactV2 = {
      version: 2,
      table,
      featurePaths: { F_01: 'https://x.test/old' },
      featureProfiles: [
        { featureId: 'F_01', testPoint: '旧列表', actionKind: 'list', source: 'web' },
      ],
      featureEvidence: { F_01: evidence('F_01') },
    };
    const store = {
      getFeatureArtifact: vi.fn().mockResolvedValue(existing),
      saveFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveCaseTable: vi.fn().mockResolvedValue(undefined),
      saveCaseGeneration: vi.fn().mockResolvedValue(undefined),
    };
    const orchestrator = new PipelineOrchestrator({
      store: store as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });
    const currentEvidence = {
      ...evidence('F_01'),
      pageUrl: 'https://x.test/current',
      coverageKeys: ['list.display'],
    };

    await orchestrator.runStage('case', {
      systemId: 'sys-evidence',
      featureTable: table,
      metaConfig: {
        systemName: '系统',
        testPointId: '',
        testPoint: '',
        testers: '',
        clientStaff: '',
        developerStaff: '',
        firstTestDate: '2026-08-21',
        regressionDate: '',
        conclusionRule: '默认',
        precondition: '已登录',
      },
      exploredElements: [
        {
          ref: 'table',
          tag: 'table',
          selector: 'table',
          interactive: false,
          isFormControl: false,
          suggestedAction: 'navigate',
        },
      ],
      featurePaths: { F_01: 'https://x.test/current' },
      featureProfiles: [
        { featureId: 'F_01', testPoint: '当前列表', actionKind: 'list', source: 'web' },
      ],
      featureEvidence: { F_01: { ...currentEvidence, systemId: 'sys-evidence', pageEntry: 'https://x.test/current' } },
    });

    const saved = vi.mocked(store.saveFeatureArtifact).mock.calls[0][1]!;
    expect(saved.featurePaths?.F_01).toBe('https://x.test/current');
    expect(saved.featureProfiles?.find((profile) => profile.featureId === 'F_01')?.testPoint).toBe(
      '当前列表',
    );
    expect(saved.featureEvidence?.F_01.coverageKeys).toEqual(['list.display']);
  });

  it('Given case workbook persistence fails, When case generation completes, Then runStage rejects instead of reporting success', async () => {
    const store = {
      getFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveCaseTable: vi.fn().mockRejectedValue(new Error('case workbook write failed')),
      saveCaseGeneration: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const orchestrator = new PipelineOrchestrator({
      store: store as never,
      logger: logger as never,
    });

    await expect(
      orchestrator.runStage('case', {
        systemId: 'sys-save-failure',
        featureTable: table,
        metaConfig: {
          systemName: '系统',
          testPointId: '',
          testPoint: '',
          testers: '',
          clientStaff: '',
          developerStaff: '',
          firstTestDate: '',
          regressionDate: '',
          conclusionRule: '',
          precondition: '',
        },
        featureProfiles: [{ featureId: 'F_01', testPoint: '用户列表', actionKind: 'list' }],
        featureEvidence: { F_01: evidence('F_01', { systemId: 'sys-save-failure', pageEntry: 'sys-save-failure' }) },
      }),
    ).rejects.toThrow('case workbook write failed');
    expect(store.saveCaseTable).toHaveBeenCalledWith(
      'sys-save-failure',
      expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([expect.objectContaining({ featureId: 'F_01' })]),
        }),
      ]),
    );
  });

  it('Given case generation metadata persistence fails, When case generation completes, Then runStage rejects instead of reporting success', async () => {
    const store = {
      getFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveCaseTable: vi.fn().mockResolvedValue(undefined),
      saveCaseGeneration: vi.fn().mockRejectedValue(new Error('case generation write failed')),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const orchestrator = new PipelineOrchestrator({
      store: store as never,
      logger: logger as never,
    });

    await expect(
      orchestrator.runStage('case', {
        systemId: 'sys-generation-save-failure',
        featureTable: table,
        metaConfig: {
          systemName: '系统',
          testPointId: '',
          testPoint: '',
          testers: '',
          clientStaff: '',
          developerStaff: '',
          firstTestDate: '',
          regressionDate: '',
          conclusionRule: '',
          precondition: '',
        },
        featureProfiles: [{ featureId: 'F_01', testPoint: '用户列表', actionKind: 'list' }],
        featureEvidence: { F_01: evidence('F_01', { systemId: 'sys-generation-save-failure', pageEntry: 'sys-generation-save-failure' }) },
      }),
    ).rejects.toThrow('case generation write failed');
    expect(store.saveCaseGeneration).toHaveBeenCalledTimes(1);
  });
});
