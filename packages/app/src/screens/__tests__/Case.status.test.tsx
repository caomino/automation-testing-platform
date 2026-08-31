import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Case } from '../Case';
import { initialState } from '../../context';
import type { AppState } from '../../context';

const mockedUseApp = vi.hoisted(() => vi.fn());

vi.mock('../../context', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useApp: mockedUseApp };
});

function setupCase(overrides: Partial<AppState> = {}): void {
  mockedUseApp.mockReturnValue({
    ...initialState,
    featureRows: [
      {
        seq: '1',
        type: '功能性测试',
        chapter: '',
        system: 'HIS',
        mainModule: '用户',
        subModule: '用户',
        feature: '用户管理',
        testPoint: '新增',
        testPointId: 'HIS_USER_01',
      },
    ],
    featureConfirmed: true,
    featureEvidence: {
      HIS_USER_01: {
        featureId: 'HIS_USER_01',
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
        coverageManifest: {
          actionKind: 'create',
          requiredKeys: ['create.ready'],
          observedKeys: ['create.ready'],
          needsReviewKeys: [],
          missingKeys: ['create.required.userName'],
        },
      },
    },
    caseGroups: [
      {
        groupId: 'group-1',
        caseNo: 'HIS_USER_01',
        content: '新增',
        moduleName: '用户',
        precondition: '',
        featureId: 'HIS_USER_01',
        scenarioId: 'HIS_USER_01.create.01',
        coverageKeys: ['create.ready'],
        evidenceLevel: 'needs_review',
        needsReview: true,
        reviewReason: '缺少安全样例',
        steps: [
          {
            stepId: 'step-1',
            stepNumber: 'Step_1',
            operation: '查看表单',
            expected: '表单可读',
            firstResult: '\\',
            regressionResult: '\\',
            conclusion: '\\',
          },
        ],
      },
    ],
    getFeatureModules: () => ({ subModules: ['用户'], mainModules: ['用户'] }),
    runPipelineCase: vi.fn(),
    caseGroupAdd: vi.fn(),
    caseGroupRemove: vi.fn(),
    caseStepAdd: vi.fn(),
    caseStepRemove: vi.fn(),
    caseStepUpdate: vi.fn(),
    caseGroupUpdate: vi.fn(),
    caseUpdateMeta: vi.fn(),
    caseSetSelection: vi.fn(),
    caseToggleAi: vi.fn(),
    toast: vi.fn(),
    addActivity: vi.fn(),
    ...overrides,
  });
}

describe('Case coverage status', () => {
  it('全为 needs_review 或存在 manifest 缺项时，不显示可执行并显示阻塞问题', () => {
    setupCase();
    render(<Case />);
    expect(screen.queryByText('可执行')).not.toBeInTheDocument();
    expect(screen.queryByText('查看表单')).not.toBeInTheDocument();
    expect(screen.getByText('阻塞问题 1')).toBeInTheDocument();
    expect(
      screen.getByText('HIS_USER_01 缺少已观测覆盖：create.required.userName'),
    ).toBeInTheDocument();
  });

  it('隐藏 manifest 缺项仍计入覆盖分母并阻断执行，已生成组可见', () => {
    setupCase({
      featureRows: [
        {
          seq: '1',
          type: '功能性测试',
          chapter: '',
          system: 'HIS',
          mainModule: '用户',
          subModule: '用户',
          feature: '用户管理',
          testPoint: '列表',
          testPointId: 'HIS_LIST_A',
        },
        {
          seq: '2',
          type: '功能性测试',
          chapter: '',
          system: 'HIS',
          mainModule: '用户',
          subModule: '用户',
          feature: '用户管理',
          testPoint: '刷新列表',
          testPointId: 'HIS_LIST_B',
        },
      ],
      featureEvidence: {
        HIS_LIST_A: {
          featureId: 'HIS_LIST_A',
          actionKind: 'query',
          states: ['base'],
          fields: [],
          tables: [],
          actionEntries: [],
          containers: [],
          evidenceLevel: 'observed',
          coverageKeys: ['list.display'],
          needsReview: false,
          uncovered: [],
          coverageManifest: {
            actionKind: 'query',
            requiredKeys: ['list.display'],
            observedKeys: ['list.display'],
            needsReviewKeys: [],
            missingKeys: [],
          },
        },
        HIS_LIST_B: {
          featureId: 'HIS_LIST_B',
          actionKind: 'query',
          states: ['base'],
          fields: [],
          tables: [],
          actionEntries: [],
          containers: [],
          evidenceLevel: 'needs_review',
          coverageKeys: ['list.display'],
          needsReview: true,
          uncovered: [{ kind: 'no_safe_sample', reason: '缺少已观测覆盖：list.display' }],
          coverageManifest: {
            actionKind: 'query',
            requiredKeys: ['list.display'],
            observedKeys: [],
            needsReviewKeys: ['list.display'],
            missingKeys: ['list.display'],
          },
        },
      },
      caseGroups: [
        {
          groupId: 'observed',
          caseNo: 'HIS_LIST_A',
          content: '列表',
          moduleName: '用户',
          precondition: '',
          featureId: 'HIS_LIST_A',
          scenarioId: 'HIS_LIST_A.list.01',
          coverageKeys: ['list.display'],
          evidenceLevel: 'observed',
          steps: [
            {
              stepId: 'step-1',
              stepNumber: 'Step_1',
              operation: '查看列表',
              expected: '列表显示',
              firstResult: '\\',
              regressionResult: '\\',
              conclusion: '\\',
            },
          ],
        },
      ],
    });
    render(<Case />);
    expect(screen.getByText('覆盖 1/2')).toBeInTheDocument();
    expect(screen.getByText('查看列表')).toBeInTheDocument();
    expect(screen.queryByText('查看表单')).not.toBeInTheDocument();
    expect(screen.queryByText('可执行')).not.toBeInTheDocument();
    expect(screen.getByText('HIS_LIST_B 缺少已观测覆盖：list.display')).toBeInTheDocument();
  });

  it('覆盖统计可读取仅保存在步骤上的功能点标识', () => {
    setupCase({
      caseGroups: [
        {
          groupId: 'step-metadata',
          caseNo: 'HIS_USER_01',
          content: '新增',
          moduleName: '用户',
          precondition: '',
          coverageKeys: ['create.ready'],
          evidenceLevel: 'observed',
          steps: [
            {
              stepId: 'step-1',
              stepNumber: 'Step_1',
              operation: '查看表单',
              expected: '表单可读',
              firstResult: '\\',
              regressionResult: '\\',
              conclusion: '\\',
              featureId: 'HIS_USER_01',
              scenarioId: 'HIS_USER_01.create.01',
              coverageKeys: ['create.ready'],
            },
          ],
        },
      ],
    });
    render(<Case />);
    expect(screen.getByText('覆盖 1/1')).toBeInTheDocument();
  });

  it('手工空用例或缺少追溯元数据时立即阻断执行', () => {
    setupCase({
      featureEvidence: {},
      caseGroups: [
        {
          groupId: 'manual',
          caseNo: '',
          content: '',
          moduleName: '',
          precondition: '',
          steps: [
            {
              stepId: 'step-1',
              stepNumber: '',
              operation: '',
              expected: '',
              firstResult: '',
              regressionResult: '',
              conclusion: '',
            },
          ],
        },
      ],
    });
    render(<Case />);
    expect(screen.queryByText('可执行')).not.toBeInTheDocument();
    expect(screen.getByText(/存在空白的八列用例字段/)).toBeInTheDocument();
    expect(screen.getByText(/缺少功能点标识/)).toBeInTheDocument();
    expect(screen.getByText(/缺少场景标识/)).toBeInTheDocument();
    expect(screen.getByText(/缺少覆盖键/)).toBeInTheDocument();
  });
});
