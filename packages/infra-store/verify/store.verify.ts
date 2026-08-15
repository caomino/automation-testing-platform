/**
 * @file store.verify.ts
 * @description infra-store 冻结接口校验（创建/落库/读取/删除 + 激活校验）
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import type { FeatureRow, CaseSheet, MetaHeader } from '@test-platform/contracts';
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

describe('infra-store 冻结接口', () => {
  it('创建/读取/删除项目 + 落库三类数据', async () => {
    const store = createStore();
    const p = await store.createProject({ name: '测试项目' });
    expect(p.id).toBeTruthy();
    expect((await store.listProjects())).toHaveLength(1);
    expect((await store.getProject(p.id))?.name).toBe('测试项目');

    const feat: FeatureRow[][] = [['1', '功能性测试', '3.1', '系统', '主', '子', '功能', '测试点', 'ID_01'] as unknown as FeatureRow[]];
    await store.saveFeatureTable('sys1', feat);
    expect(await store.getFeatureTable('sys1')).toEqual(feat);

    const sheet: CaseSheet = { sheetName: 's', meta: mockMeta, rows: [] };
    await store.saveCaseTable('sys1', [sheet]);
    expect((await store.getCaseTable('sys1'))?.[0].sheetName).toBe('s');

    await store.saveExecution('sys1', []);
    expect(await store.getExecution('sys1')).toEqual([]);

    await store.deleteProject(p.id);
    expect(await store.getProject(p.id)).toBeNull();
  });

  it('setActiveSystem 拒绝未归属系统', async () => {
    const store = createStore();
    const p = await store.createProject({ name: 'p' });
    await expect(store.setActiveSystem(p.id, 'nope')).rejects.toThrow();
  });
});
