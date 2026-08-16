import { describe, it, expect } from 'vitest';
import { buildCaseInput } from './pipeline';
import type { FeatureRowView, MetaHeader } from '../context';

const featureRows: FeatureRowView[] = [
  {
    seq: '1',
    type: '功能性测试',
    chapter: '3.1',
    system: '区域影像系统',
    mainModule: '配置',
    subModule: '检查室',
    feature: '检查室管理',
    testPoint: '查询',
    testPointId: 'QYYX_PZ_JCX_01',
  },
  {
    seq: '2',
    type: '功能性测试',
    chapter: '3.1',
    system: '区域影像系统',
    mainModule: '配置',
    subModule: '排班',
    feature: '排班管理',
    testPoint: '新增',
    testPointId: 'QYYX_PZ_PB_01',
  },
];

const metaHeader: MetaHeader = {
  system: '区域影像系统',
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

describe('buildCaseInput — 生成测试用例输入契约（case 模块）', () => {
  it('featureTable 必须是 FeatureRow[][]（双层：一分组含整行；不可拍平成单层）', () => {
    const input = buildCaseInput(featureRows, ['排班'], metaHeader, 'selected_modules');
    const ft = input.featureTable;
    expect(Array.isArray(ft)).toBe(true); // 外层分组
    expect(Array.isArray(ft[0])).toBe(true); // 分组内是行数组
    expect(Array.isArray(ft[0][0])).toBe(true); // 关键：第一项是「整行」数组，而非字符
    expect(ft[0][0]).toHaveLength(9); // 每行 9 列
    expect(ft[0][0][8]).toBe('QYYX_PZ_JCX_01'); // 第 8 列为测试点标识
  });

  it('扁平化后是整行而非字符：stage-case 的 featureTable.flat() 能正确取到行', () => {
    const input = buildCaseInput(featureRows, [], metaHeader, 'all');
    const flat = input.featureTable.flat();
    expect(Array.isArray(flat[0])).toBe(true);
    expect(flat[0]).toHaveLength(9);
    expect(flat[0][8]).toBe('QYYX_PZ_JCX_01');
    expect(flat[1][8]).toBe('QYYX_PZ_PB_01');
  });

  it('scope=selected_modules 时透传 selectedModuleIds；scope=all 时为 undefined', () => {
    const sel = buildCaseInput(featureRows, ['排班'], metaHeader, 'selected_modules');
    expect(sel.scope).toBe('selected_modules');
    expect(sel.selectedModuleIds).toEqual(['排班']);
    const all = buildCaseInput(featureRows, ['排班'], metaHeader, 'all');
    expect(all.scope).toBe('all');
    expect(all.selectedModuleIds).toBeUndefined();
  });

  it('metaConfig 由 metaHeader 映射而来（system→systemName 等）', () => {
    const input = buildCaseInput(featureRows, [], metaHeader, 'all');
    expect(input.metaConfig.systemName).toBe('区域影像系统');
    expect(input.metaConfig.testPointId).toBe('QYYX_PZ_JCX');
    expect(input.metaConfig.precondition).toBe('已登录');
  });

  it('透传 featurePaths（来自功能点阶段，根因解法：探索阶段路径传到 case 阶段）', () => {
    const paths = { QYYX_PZ_JCX_01: 'https://x.com/jcx', QYYX_PZ_PB_01: 'https://x.com/pb' };
    const input = buildCaseInput(featureRows, [], metaHeader, 'all', paths);
    expect(input.featurePaths).toEqual(paths);
    // 不传时缺省 undefined
    const def = buildCaseInput(featureRows, [], metaHeader, 'all');
    expect(def.featurePaths).toBeUndefined();
  });

  it('aiEnabled=true => aiConfig.enabled 为 true；缺省为 false（双模开关）', () => {
    const on = buildCaseInput(featureRows, [], metaHeader, 'all', undefined, true);
    expect(on.aiConfig).toEqual({ configId: 'default', enabled: true });
    const off = buildCaseInput(featureRows, [], metaHeader, 'all');
    expect(off.aiConfig).toEqual({ configId: 'default', enabled: false });
  });
});
