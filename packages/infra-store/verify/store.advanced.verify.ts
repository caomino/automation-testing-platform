/**
 * @file store.advanced.verify.ts
 * @description infra-store 高级校验 — 多项目隔离 + 往返一致性 + 反向 + 边界
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import type { FeatureRow, CaseSheet, MetaHeader, System, ExecutionResult } from '@test-platform/contracts';
import { createStore } from '../src';

const mockMeta: MetaHeader = {
  systemName: '系统',
  testPointId: 'ID',
  testPoint: '测试点',
  testers: '',
  clientStaff: '',
  developerStaff: '',
  firstTestDate: '',
  regressionDate: '',
  conclusionRule: '',
  precondition: '',
};

function makeSystem(id: string, name: string): System {
  return {
    id,
    name,
    url: 'https://example.com',
    type: 'standalone',
    credentialMode: 'no-login',
    loginState: 'logged_out',
    progress: { explored: false, featured: false, cased: false, executed: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('infra-store — 多项目隔离', () => {
  it('多个项目独立存储互不影响', async () => {
    const store = createStore();
    const p1 = await store.createProject({ name: '项目A' });
    const p2 = await store.createProject({ name: '项目B' });
    expect((await store.listProjects())).toHaveLength(2);

    const featA: FeatureRow[][] = [['A1', '功能', '1.0', 'sysA', 'm', 's', 'f', 't', 'FP_A'] as unknown as FeatureRow[]];
    const featB: FeatureRow[][] = [['B1', '性能', '2.0', 'sysB', 'm', 's', 'f', 't', 'FP_B'] as unknown as FeatureRow[]];
    await store.saveFeatureTable(p1.id, featA);
    await store.saveFeatureTable(p2.id, featB);
    expect(await store.getFeatureTable(p1.id)).toEqual(featA);
    expect(await store.getFeatureTable(p2.id)).toEqual(featB);

    const sheetA: CaseSheet = { sheetName: 'sheetA', meta: mockMeta, rows: [] };
    const sheetB: CaseSheet = { sheetName: 'sheetB', meta: mockMeta, rows: [] };
    await store.saveCaseTable(p1.id, [sheetA]);
    await store.saveCaseTable(p2.id, [sheetB]);
    expect((await store.getCaseTable(p1.id))?.[0].sheetName).toBe('sheetA');
    expect((await store.getCaseTable(p2.id))?.[0].sheetName).toBe('sheetB');

    const execA: ExecutionResult[] = [{
      caseNo: 'A_01', caseRowId: 'row_a1',
      env: { browser: 'Chrome', os: 'Windows' },
      status: 'passed', steps: [],
    }];
    const execB: ExecutionResult[] = [{
      caseNo: 'B_01', caseRowId: 'row_b1',
      env: { browser: 'Firefox', os: 'Linux' },
      status: 'failed', steps: [],
    }];
    await store.saveExecution(p1.id, execA);
    await store.saveExecution(p2.id, execB);
    expect((await store.getExecution(p1.id))?.[0].caseNo).toBe('A_01');
    expect((await store.getExecution(p2.id))?.[0].caseNo).toBe('B_01');

    await store.deleteProject(p1.id);
    expect(await store.getProject(p1.id)).toBeNull();
    expect(await store.getProject(p2.id)).not.toBeNull();
    expect((await store.listProjects())).toHaveLength(1);
  });
});

describe('infra-store — 往返一致性', () => {
  it('save/get FeatureTable 往返一致', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'feat-roundtrip' });
    const table: FeatureRow[][] = [
      ['1', '功能性测试', '3.1', '系统A', '主模块', '子模块', '功能点1', '测试点1', 'ID_01'],
      ['2', '性能测试', '3.2', '系统A', '主模块', '子模块', '功能点2', '测试点2', 'ID_02'],
    ] as unknown as FeatureRow[][];
    await store.saveFeatureTable(p.id, table);
    const result = await store.getFeatureTable(p.id);
    expect(result).toEqual(table);
    expect(result).toHaveLength(2);
    expect(result?.[0]).toHaveLength(9);
  });

  it('save/get CaseTable 往返一致', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'case-roundtrip' });
    const sheets: CaseSheet[] = [
      { sheetName: 'Sheet1', meta: mockMeta, rows: [] },
      { sheetName: 'Sheet2', meta: { ...mockMeta, testPoint: '另一个测试点' }, rows: [] },
    ];
    await store.saveCaseTable(p.id, sheets);
    const result = await store.getCaseTable(p.id);
    expect(result).toHaveLength(2);
    expect(result?.[0].sheetName).toBe('Sheet1');
    expect(result?.[1].sheetName).toBe('Sheet2');
    expect(result?.[1].meta.testPoint).toBe('另一个测试点');
  });

  it('save/get Execution 往返一致', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'exec-roundtrip' });
    const report: ExecutionResult[] = [{
      caseNo: 'CASE_001', caseRowId: 'row_1',
      env: { browser: 'Chrome', os: 'Windows', version: '120' },
      status: 'passed',
      steps: [
        { step: 'Step1', operation: '点击按钮', expected: '弹窗出现', actual: '弹窗出现', result: 'passed' },
        { step: 'Step2', operation: '输入文本', expected: '文本显示', actual: '文本显示', result: 'passed' },
      ],
      defectRef: 'DEF_001',
    }];
    await store.saveExecution(p.id, report);
    const result = await store.getExecution(p.id);
    expect(result).toHaveLength(1);
    expect(result?.[0].caseNo).toBe('CASE_001');
    expect(result?.[0].status).toBe('passed');
    expect(result?.[0].steps).toHaveLength(2);
    expect(result?.[0].defectRef).toBe('DEF_001');
  });
});

describe('infra-store — 反向测试', () => {
  it('getProject 对不存在的 ID 返回 null', async () => {
    const store = createStore();
    expect(await store.getProject('nonexistent-id')).toBeNull();
  });

  it('updateProject 对不存在的 ID 抛错', async () => {
    const store = createStore();
    await expect(store.updateProject('ghost', { name: 'x' })).rejects.toThrow();
  });

  it('setActiveSystem 对不存在的项目抛错', async () => {
    const store = createStore();
    await expect(store.setActiveSystem('no-project', 'sys-1')).rejects.toThrow();
  });

  it('setActiveSystem 对存在项目但不存在系统抛错', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'test' });
    await expect(store.setActiveSystem(p.id, 'no-such-system')).rejects.toThrow();
  });

  it('setActiveSystem 对存在项目但系统未归属抛错', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'test' });
    const sys = makeSystem('sys_owned', '归属系统');
    await store.updateProject(p.id, { systems: [sys] });
    await expect(store.setActiveSystem(p.id, 'sys_not_owned')).rejects.toThrow();
  });

  it('getFeatureTable 对不存在的 systemId 返回 null', async () => {
    const store = createStore();
    expect(await store.getFeatureTable('no-such-system')).toBeNull();
  });

  it('getCaseTable 对不存在的 systemId 返回 null', async () => {
    const store = createStore();
    expect(await store.getCaseTable('no-such-system')).toBeNull();
  });

  it('getExecution 对不存在的 systemId 返回 null', async () => {
    const store = createStore();
    expect(await store.getExecution('no-such-system')).toBeNull();
  });

  it('setActiveSystem 成功时更新项目 updatedAt', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'active-test' });
    const sys = makeSystem('sys_active', '激活系统');
    await store.updateProject(p.id, { systems: [sys] });
    const before = (await store.getProject(p.id))!.updatedAt;
    await store.setActiveSystem(p.id, 'sys_active');
    const after = (await store.getProject(p.id))!.updatedAt;
    expect(after).toBeGreaterThan(before);
  });
});

describe('infra-store — 边界测试', () => {
  it('空 FeatureRow 数组存储', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'empty-feature' });
    await store.saveFeatureTable(p.id, []);
    const result = await store.getFeatureTable(p.id);
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('空 FeatureRow 二维数组存储', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'empty-feature-2d' });
    await store.saveFeatureTable(p.id, [[]]);
    const result = await store.getFeatureTable(p.id);
    expect(result).toEqual([[]]);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toHaveLength(0);
  });

  it('空 CaseSheet 数组存储', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'empty-case' });
    await store.saveCaseTable(p.id, []);
    const result = await store.getCaseTable(p.id);
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('空 ExecutionResult 数组存储', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'empty-exec' });
    await store.saveExecution(p.id, []);
    const result = await store.getExecution(p.id);
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('单个 FeatureRow 存储', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'single-feature' });
    const row: FeatureRow = ['1', '测试类型', '1.0', '系统', '主', '子', '功能', '测试点', 'ID_01'];
    await store.saveFeatureTable(p.id, [[row]]);
    const result = await store.getFeatureTable(p.id);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toHaveLength(1);
    expect(result?.[0][0]).toHaveLength(9);
    expect(result?.[0][0][0]).toBe('1');
    expect(result?.[0][0][8]).toBe('ID_01');
  });

  it('单条 ExecutionResult 存储', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'single-exec' });
    const result: ExecutionResult = {
      caseNo: 'ONLY_01', caseRowId: 'row_only',
      env: { browser: 'Chrome', os: 'Windows' },
      status: 'failed',
      steps: [{ step: 'S1', operation: 'op', expected: 'exp', actual: 'act', result: 'failed' }],
      defectRef: 'DEF_SINGLE',
    };
    await store.saveExecution(p.id, [result]);
    const loaded = await store.getExecution(p.id);
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0].caseNo).toBe('ONLY_01');
    expect(loaded?.[0].status).toBe('failed');
    expect(loaded?.[0].steps).toHaveLength(1);
  });

  it('空步骤 ExecutionResult 存储', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'empty-steps-exec' });
    const result: ExecutionResult = {
      caseNo: 'NO_STEPS', caseRowId: 'row_ns',
      env: { browser: 'Chrome', os: 'Windows' },
      status: 'skipped', steps: [],
    };
    await store.saveExecution(p.id, [result]);
    const loaded = await store.getExecution(p.id);
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0].steps).toHaveLength(0);
    expect(loaded?.[0].defectRef).toBeUndefined();
  });

  it('重复保存覆盖旧数据', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'overwrite' });
    await store.saveFeatureTable(p.id, [['old'] as unknown as FeatureRow[]]);
    await store.saveFeatureTable(p.id, [['new'] as unknown as FeatureRow[]]);
    const result = await store.getFeatureTable(p.id);
    expect(result?.[0][0]).toBe('new');
  });
});