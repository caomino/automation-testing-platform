import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CaseOutput, FeatureEvidence, FeatureRow } from '@test-platform/contracts';
import type { McpEngine } from '@test-platform/engine-mcp';

vi.mock('@test-platform/stage-login', () => ({
  createLoginStage: vi.fn(() => ({
    run: vi.fn(async (input: { systemId: string }) => ({
      loginStatus: 'ok',
      sessionHandle: {
        sessionId: 'full-session',
        systemId: input.systemId,
        loginStatus: 'ok',
        cookies: [],
        expiresAt: Date.now() + 60_000,
      },
    })),
  })),
  getTakeoverEngine: vi.fn(() => undefined),
  detectLoginState: vi.fn(),
  extractDomWithRetry: vi.fn(),
}));

vi.mock('@test-platform/stage-explore', () => ({ run: vi.fn() }));
vi.mock('@test-platform/stage-feature', () => ({ run: vi.fn() }));
vi.mock('@test-platform/stage-execute', () => ({ run: vi.fn() }));
vi.mock('@test-platform/stage-defect', () => ({ run: vi.fn() }));
vi.mock('@test-platform/stage-case', async () => {
  const actual = await vi.importActual<typeof import('@test-platform/stage-case')>('@test-platform/stage-case');
  return { ...actual, run: vi.fn() };
});

import { PipelineOrchestrator } from '../index';
import * as stageExplore from '@test-platform/stage-explore';
import * as stageFeature from '@test-platform/stage-feature';
import * as stageCase from '@test-platform/stage-case';
import * as stageExecute from '@test-platform/stage-execute';
import * as stageDefect from '@test-platform/stage-defect';

function engine(): McpEngine {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    getStorageState: vi.fn().mockResolvedValue(undefined),
    getCurrentUrl: vi.fn().mockResolvedValue('https://system.test/home'),
    extractPageElements: vi.fn().mockResolvedValue([]),
    extractSemanticDom: vi.fn().mockResolvedValue([]),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpEngine;
}

const featureRow: FeatureRow = [
  '1', '功能性测试', '3.1', '系统', '模块', '子模块', '查询', '查询', 'F_FULL',
];

const evidence: FeatureEvidence = {
  featureId: 'F_FULL',
  actionKind: 'query',
  systemId: 'sys-full',
  featureRevision: 'rev-current',
  pageEntry: 'https://system.test/query',
  pageUrl: 'https://system.test/query',
  states: ['base'],
  fields: [{ ref: 'keyword', selector: '#keyword', name: '关键字', inputType: 'text' }],
  tables: [],
  actionEntries: [],
  containers: [],
  evidenceLevel: 'observed',
  coverageKeys: ['query.field.关键字'],
  needsReview: false,
  uncovered: [],
};

const fakeCaseOutput: CaseOutput = {
  caseWorkbook: [],
  caseRows: [],
  metaHeader: { precondition: '已登录' },
  qualityGateIssues: [],
  complexLogicDetected: false,
};

describe('完整流水线 case 输入契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stageExplore.run).mockResolvedValue({
      moduleTree: [],
      coverage: { visited: 0, total: 0, frontier: [] },
      needsReview: [],
      checkpoint: { checkpointId: 'cp', visitedNodeIds: [], frontier: [], savedAt: Date.now() },
    });
    vi.mocked(stageFeature.run).mockResolvedValue({
      featureTable: [[featureRow]],
      featureIds: ['F_FULL'],
      featurePaths: { F_FULL: 'https://system.test/query' },
      featureProfiles: [{ featureId: 'F_FULL', testPoint: '查询', actionKind: 'query', source: 'web' }],
      featureEvidence: { F_FULL: evidence },
      provenance: [],
    });
    vi.mocked(stageCase.run).mockResolvedValue(fakeCaseOutput);
    vi.mocked(stageExecute.run).mockResolvedValue({
      executionReport: [],
      dataSnapshotBefore: { id: 'before', data: {} },
      dataSnapshotAfter: { id: 'after', data: {} },
      isolationVerified: true,
    });
    vi.mocked(stageDefect.run).mockResolvedValue({ defectTable: [], screenshots: [] });
  });

  it('透传 system/revision/current workbook/regenerateSelected 到 case stage', async () => {
    const currentCaseWorkbook = [{ sheetName: '旧', meta: { precondition: '旧' }, rows: [], colWidths: [] }];
    const orchestrator = new PipelineOrchestrator({ engineFactory: () => engine() });

    await orchestrator.run({
      login: { systemId: 'sys-full', systemUrl: 'https://system.test', mode: 'no-login' },
      case: {
        scope: 'selected_modules',
        selectedModuleIds: ['子模块'],
        featureRevision: 'rev-current',
        currentCaseWorkbook,
        regenerateSelected: true,
        metaConfig: { precondition: '已登录' },
      },
    });

    const caseInput = vi.mocked(stageCase.run).mock.calls[0]?.[0];
    expect(caseInput).toEqual(expect.objectContaining({
      systemId: 'sys-full',
      featureRevision: 'rev-current',
      scope: 'selected_modules',
      selectedModuleIds: ['子模块'],
      currentCaseWorkbook,
      regenerateSelected: true,
    }));
  });
});
