import type { CaseRow, DefectRow, FeatureRow } from '@test-platform/contracts';

/** 功能点表：九列（string[9]），对齐 contracts.FeatureRow */
export const mockFeatureTable: FeatureRow[] = [
  ['1', '功能性测试', '3.2.1', '企业营销系统', '配置', '基础配置', '参数校验', '必填项校验', 'QYYX_PZ_JCX_01'],
  ['2', '功能性测试', '3.2.1', '企业营销系统', '配置', '基础配置', '参数校验', '格式校验', 'QYYX_PZ_JCX_02'],
  ['3', '性能测试', '3.3', '企业营销系统', '查询', '订单查询', '响应时间', '万级数据查询', 'QYYX_CX_DD_01'],
];

/** 用例表：八列可见 + 绑定元数据，对齐 contracts.CaseRow */
export const mockCaseRows: CaseRow[] = [
  {
    caseNo: 'QYYX_PZ_JCX_01_N1',
    content: '必填项校验',
    step: 'Step1',
    operation: '清空必填项后提交',
    expected: '提示必填项不能为空',
    firstResult: '\\',
    regressionResult: '\\',
    conclusion: '\\',
    id: 'case-1',
    featureId: 'QYYX_PZ_JCX_01',
    targetTestPoint: '必填项校验',
    scenarioId: 'normal',
    origin: 'system_generated',
    quality: 'high',
  },
  {
    caseNo: 'QYYX_PZ_JCX_02_N1',
    content: '格式校验',
    step: 'Step1',
    operation: '输入非法格式并提交',
    expected: '提示格式错误',
    firstResult: '\\',
    regressionResult: '\\',
    conclusion: '\\',
    id: 'case-2',
    featureId: 'QYYX_PZ_JCX_02',
    targetTestPoint: '格式校验',
    scenarioId: 'normal',
    origin: 'system_generated',
    quality: 'high',
  },
];

/** 缺陷表：六列，对齐 contracts.DefectRow */
export const mockDefects: DefectRow[] = [
  {
    sequence: 1,
    description: '提交后页面无响应',
    level: '高',
    qualityAttribute: '功能性',
    environment: 'Win11·Chrome·QYYX_PZ_JCX_01/S2',
    screenshotRef: 'shot-1',
  },
  {
    sequence: 2,
    description: '万级数据查询超时',
    level: '中',
    qualityAttribute: '性能',
    environment: 'Win11·Chrome·QYYX_CX_DD_01/S1',
  },
];
