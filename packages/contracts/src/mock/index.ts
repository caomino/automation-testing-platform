/**
 * @file mock/index.ts
 * @description 金标准对齐样例数据（区域影像 QYYX_PZ_JCX）
 * @frozen v1.0 — 仅作契约校验与冒烟，不写入业务库
 */
import type { System } from '../types/SystemConfig';
import type { ModuleNode } from '../types/ModuleNode';
import type { FeatureInput, FeatureOutput } from '../stages/FeatureContract';
import type { CaseInput, CaseOutput } from '../stages/CaseContract';
import type { MetaHeader } from '../types/CaseSheet';

/** 样例系统（区域影像系统） */
export const mockSystem: System = {
  id: 'sys_qyyx',
  name: '区域影像系统',
  url: 'https://example.com/qyyx',
  type: 'standalone',
  credentialMode: 'credential',
  credentials: { username: 'tester', credentialRef: 'cred_qyyx' },
  loginState: 'logged_out',
  progress: { explored: false, featured: false, cased: false, executed: false },
  createdAt: 0,
  updatedAt: 0,
};

/** 样例模块树（检查室管理） */
export const mockModuleTree: ModuleNode[] = [
  {
    id: 'mod_jcs',
    label: '检查室管理',
    parentId: null,
    subsystemId: 'sys_qyyx',
    type: 'module',
    status: 'covered',
    children: [
      {
        id: 'page_jcs_list',
        label: '检查室列表',
        parentId: 'mod_jcs',
        subsystemId: 'sys_qyyx',
        type: 'page',
        status: 'covered',
        children: [],
        url: 'https://example.com/qyyx/checkroom/list',
        pageTitle: '检查室列表',
        evidenceId: 'ev_001',
        depth: 1,
      },
    ],
    depth: 0,
  },
];

/** 样例 meta 头（对齐金标准 R4-R12） */
export const mockMetaHeader: MetaHeader = {
  systemName: '区域影像系统',
  testPointId: 'QYYX_PZ_JCX',
  testPoint: '检查室',
  testers: '张三',
  clientStaff: '李四',
  developerStaff: '王五',
  firstTestDate: '2026-08-15',
  regressionDate: '',
  conclusionRule: '全部通过为合格',
  precondition: '已登录系统且拥有检查室管理权限',
};

/** 样例功能点输入 */
export const mockFeatureInput: FeatureInput = {
  moduleTree: mockModuleTree,
  systemName: '区域影像系统',
  confirmedOnly: false,
};

/** 样例功能点输出（九列，测试点标识 = base_NN） */
export const mockFeatureOutput: FeatureOutput = {
  featureTable: [
    [
      ['1', '功能性测试', '3.1', '区域影像系统', '检查室管理', '检查室', '查询', '查询', 'QYYX_PZ_JCX_01'],
      ['2', '功能性测试', '3.1', '区域影像系统', '检查室管理', '检查室', '新增', '新增', 'QYYX_PZ_JCX_02'],
      ['3', '功能性测试', '3.1', '区域影像系统', '检查室管理', '检查室', '删除', '删除', 'QYYX_PZ_JCX_03'],
    ],
  ],
  featureIds: ['QYYX_PZ_JCX_01', 'QYYX_PZ_JCX_02', 'QYYX_PZ_JCX_03'],
  provenance: [
    { provenanceId: 'FP-001', featureRowIndex: 0, source: 'exploration', evidenceId: 'ev_001', confirmed: true },
    { provenanceId: 'FP-002', featureRowIndex: 1, source: 'exploration', evidenceId: 'ev_001', confirmed: true },
    { provenanceId: 'FP-003', featureRowIndex: 2, source: 'exploration', evidenceId: 'ev_001', confirmed: true },
  ],
};

/** 样例用例输入 */
export const mockCaseInput: CaseInput = {
  featureTable: mockFeatureOutput.featureTable,
  scope: 'all',
  metaConfig: mockMetaHeader,
};

/** 样例用例输出（八列 + 绑定元数据） */
export const mockCaseOutput: CaseOutput = {
  caseWorkbook: [
    {
      sheetName: '检查室',
      meta: mockMetaHeader,
      rows: [
        {
          caseNo: 'QYYX_PZ_JCX_01',
          content: '查询',
          step: 'Step1',
          operation: '进入检查室列表页',
          expected: '展示检查室列表',
          firstResult: '\\',
          regressionResult: '\\',
          conclusion: '\\',
          id: 'case_001',
          featureId: 'QYYX_PZ_JCX_01',
          targetTestPoint: '查询',
          origin: 'system_generated',
          evidenceLevel: 'observed',
          confidence: 0.95,
        },
      ],
      colWidths: [18, 16, 8, 34, 34, 14, 14, 12],
      remarkRow: '排班策略，核医学检查项目',
    },
  ],
  caseRows: [
    [
      {
        caseNo: 'QYYX_PZ_JCX_01',
        content: '查询',
        step: 'Step1',
        operation: '进入检查室列表页',
        expected: '展示检查室列表',
        firstResult: '\\',
        regressionResult: '\\',
        conclusion: '\\',
        id: 'case_001',
        featureId: 'QYYX_PZ_JCX_01',
        targetTestPoint: '查询',
        origin: 'system_generated',
        evidenceLevel: 'observed',
        confidence: 0.95,
      },
    ],
  ],
  metaHeader: mockMetaHeader,
  qualityGateIssues: [],
  complexLogicDetected: false,
};
