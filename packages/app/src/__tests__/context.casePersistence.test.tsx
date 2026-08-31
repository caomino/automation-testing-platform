import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../context';
import * as dataApi from '../services/dataApi';
import type { BootstrapData } from '../services/dataApi';
import type { CaseInput, CaseOutput, CaseSheet } from '@test-platform/contracts';

vi.mock('../services/dataApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/dataApi')>();
  return {
    ...actual,
    loadBootstrap: vi.fn(),
    getFeatureTable: vi.fn(),
    getFeatureArtifact: vi.fn(),
    getCaseTable: vi.fn(),
    getMetaConfig: vi.fn(),
    getCaseGenerations: vi.fn(),
    saveCaseTable: vi.fn(),
    listAIConfigs: vi.fn(),
  };
});

const canonicalWorkbook: CaseSheet[] = [
  {
    sheetName: '用户管理',
    meta: {
      systemName: '系统',
      testPointId: 'USER_01',
      testPoint: '查询用户',
      testers: '测试员',
      clientStaff: '客户',
      developerStaff: '开发',
      firstTestDate: '2026-08-23',
      regressionDate: '',
      conclusionRule: '全部通过',
      precondition: '已登录',
    },
    rows: [
      {
        id: 'manual-query-step',
        caseNo: 'USER_01',
        featureId: 'USER_01',
        batchId: 'context-persistence-manual-batch',
        targetTestPoint: '查询用户',
        content: '查询用户',
        step: 'Step 1',
        operation: '人工编辑后的查询步骤',
        expected: '保留人工编辑',
        firstResult: '\\',
        regressionResult: '\\',
        conclusion: '\\',
        manualEdited: true,
        origin: 'user_edited',
      },
    ],
    colWidths: [18, 16, 8, 34, 34, 14, 14, 12],
    screenshotRef: 'context-persistence-manual.png',
    remarkRow: '保留用户查询人工用例',
  },
];

const bootstrap: BootstrapData = {
  projects: [
    {
      id: 'project-1',
      name: '项目',
      description: '',
      type: 'standalone',
      activeSystemId: 'system-1',
      systems: [
        {
          id: 'system-1',
          name: '系统',
          url: 'https://example.test',
          type: 'standalone',
          credentialMode: 'no-login',
          loginState: 'logged_in',
          progress: { explored: true, featured: true, cased: false, executed: false },
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      logRetentionDays: 30,
      aiAssistEnabled: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  systemData: { 'system-1': { caseTable: canonicalWorkbook } },
  knowledge: [],
};

const caseInput: CaseInput = {
  featureTable: [],
  scope: 'all',
  metaConfig: {
    systemName: '系统',
    testPointId: 'USER_01',
    testPoint: '查询',
    testers: '测试员',
    clientStaff: '',
    developerStaff: '',
    firstTestDate: '',
    regressionDate: '',
    conclusionRule: '',
    precondition: '已登录',
  },
};

const caseOutput: CaseOutput = {
  caseWorkbook: [],
  caseRows: [],
  metaHeader: caseInput.metaConfig,
  qualityGateIssues: [],
  complexLogicDetected: false,
};

const fetchMock = vi.fn();

describe('AppProvider case persistence failure', () => {
  beforeEach(() => {
    vi.mocked(dataApi.loadBootstrap).mockResolvedValue(bootstrap);
    vi.mocked(dataApi.getFeatureTable).mockResolvedValue(null);
    vi.mocked(dataApi.getFeatureArtifact).mockResolvedValue(null);
    vi.mocked(dataApi.getCaseTable).mockResolvedValue(null);
    vi.mocked(dataApi.getMetaConfig).mockResolvedValue(null);
    vi.mocked(dataApi.getCaseGenerations).mockResolvedValue(null);
    vi.mocked(dataApi.listAIConfigs).mockResolvedValue([
      {
        id: 'case-ai-42',
        name: 'Case AI',
        vendor: 'openai',
        baseUrl: 'https://api.example.test',
        apiKeyRef: 'key-ref',
        model: 'gpt-5',
        enabled: true,
        isDefault: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    vi.mocked(dataApi.saveCaseTable).mockRejectedValue(new Error('case table write failed'));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: caseOutput }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('Given case table persistence rejects, When runPipelineCase completes, Then it returns null and emits no success activity', async () => {
    const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

    await waitFor(() => expect(result.current.bootstrapping).toBe(false));

    let output: CaseOutput | null = null;
    await act(async () => {
      output = await result.current.runPipelineCase(caseInput);
    });

    expect(dataApi.saveCaseTable).toHaveBeenCalledWith('project-1', 'system-1', []);
    expect(output).toBeNull();
    expect(result.current.activities).toEqual([]);
    expect(result.current.toastMsg).toContain('用例生成失败');
  });

  it.each([
    {
      entry: 'generate selected',
      scope: 'selected_modules' as const,
      selectedModuleIds: ['用户管理'],
      regenerateSelected: false,
      aiEnabled: true,
    },
    {
      entry: 'regenerate selected',
      scope: 'selected_modules' as const,
      selectedModuleIds: ['用户管理'],
      regenerateSelected: true,
      aiEnabled: true,
    },
    {
      entry: 'generate all',
      scope: 'all' as const,
      selectedModuleIds: [],
      regenerateSelected: false,
      aiEnabled: false,
    },
  ])(
    'Given bootstrap loaded the canonical manual workbook, When $entry runs through AppProvider, Then fetch receives the frozen case request',
    async ({ scope, selectedModuleIds, regenerateSelected, aiEnabled }) => {
      vi.mocked(dataApi.saveCaseTable).mockResolvedValue(undefined);
      const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

      await waitFor(() => expect(result.current.aiCurrentDefault).toBe('case-ai-42'));
      expect(result.current.caseGroups[0]?.steps[0]?.manualEdited).toBe(true);
      expect(result.current.caseGroups[0]?.steps[0]?.operation).toBe('人工编辑后的查询步骤');

      const input: CaseInput = {
        ...caseInput,
        scope,
        selectedModuleIds: scope === 'selected_modules' ? selectedModuleIds : undefined,
        aiConfig: { configId: 'case-ai-42', enabled: aiEnabled },
        regenerateSelected,
      };
      await act(async () => {
        await result.current.runPipelineCase(input);
      });

      const request = fetchMock.mock.calls[0]?.[1];
      const submitted = JSON.parse(String(request?.body));
      expect(submitted.stage).toBe('case');
      expect(submitted.input.currentCaseWorkbook).toEqual(canonicalWorkbook);
      expect(submitted.input.currentCaseWorkbook[0].rows[0]).toEqual(canonicalWorkbook[0].rows[0]);
      expect(submitted.input.currentCaseWorkbook[0]).toMatchObject({
        colWidths: [18, 16, 8, 34, 34, 14, 14, 12],
        screenshotRef: 'context-persistence-manual.png',
        remarkRow: '保留用户查询人工用例',
      });
      expect(submitted.input.currentCaseWorkbook[0].rows[0].batchId).toBe(
        'context-persistence-manual-batch',
      );
      expect(submitted.input.scope).toBe(scope);
      expect(submitted.input.selectedModuleIds).toEqual(
        scope === 'selected_modules' ? selectedModuleIds : undefined,
      );
      expect(submitted.input.regenerateSelected).toBe(regenerateSelected);
      expect(submitted.input.aiConfig).toEqual({ configId: 'case-ai-42', enabled: aiEnabled });
    },
  );
});
