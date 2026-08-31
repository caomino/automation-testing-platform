/**
 * @file store.verify.ts
 * @description infra-store 冻结接口校验 — 核心 CRUD + update + list + 默认值
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import type { FeatureArtifactV2, FeatureRow, CaseSheet, MetaHeader, System } from '@test-platform/contracts';
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

describe('infra-store — FeatureArtifact v2 兼容', () => {
  it('保存 v2 档案并保持旧功能点表读取接口', async () => {
    const store = createStore();
    const table: FeatureRow[][] = [[['1', '功能性测试', '1.0.0', 'HIS', '挂号', '患者', '患者-新增', '新增', 'HIS_GH_HZ_01']]];
    const artifact: FeatureArtifactV2 = {
      version: 2,
      table,
      featurePaths: { HIS_GH_HZ_01: 'https://his.example/patients' },
      featureProfiles: [{ featureId: 'HIS_GH_HZ_01', testPoint: '新增', actionKind: 'create' }],
    };

    await store.saveFeatureArtifact('sys-artifact', artifact);

    expect(await store.getFeatureArtifact('sys-artifact')).toEqual(artifact);
    expect(await store.getFeatureTable('sys-artifact')).toEqual(table);
  });

  it('旧二维功能点表仍能经 getFeatureArtifact 读取', async () => {
    const store = createStore();
    const table: FeatureRow[][] = [['1', '功能性测试', '1.0.0', 'HIS', '挂号', '患者', '患者-查询', '查询', 'HIS_GH_HZ_02'] as unknown as FeatureRow[]];

    await store.saveFeatureTable('sys-legacy-artifact', table);

    expect(await store.getFeatureArtifact('sys-legacy-artifact')).toEqual(table);
  });

  it('九列表编辑通过旧保存接口时保留 v2 的证据和来源元数据', async () => {
    const store = createStore();
    const artifact: FeatureArtifactV2 = {
      version: 2,
      table: [[['1', '功能性测试', '', 'HIS', '用户', '用户', '用户管理', '新增', 'HIS_USER_01']]],
      featureProfiles: [{ featureId: 'HIS_USER_01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: {
        HIS_USER_01: {
          featureId: 'HIS_USER_01', actionKind: 'create', states: ['create'], fields: [], tables: [], actionEntries: [], containers: [], evidenceLevel: 'observed', coverageKeys: ['create.ready'], needsReview: false, uncovered: [],
        },
      },
      provenance: [{ provenanceId: 'source-1', featureRowIndex: 0, source: 'exploration', confirmed: true }],
      designSources: ['users.openapi.yaml'],
    };
    await store.saveFeatureArtifact('sys-v2-edit', artifact);
    const editedTable: FeatureRow[][] = [[['1', '功能性测试', '', 'HIS', '用户', '用户', '用户管理', '新增用户', 'HIS_USER_01']]];

    await store.saveFeatureTable('sys-v2-edit', editedTable);

    expect(await store.getFeatureArtifact('sys-v2-edit')).toEqual({ ...artifact, table: editedTable });
  });
});

describe('infra-store — updateProject', () => {
  it('正确更新字段并刷新 updatedAt', async () => {
    const store = createStore();
    const p = await store.createProject({ name: '原名', description: '原描述' });
    const originalUpdatedAt = p.updatedAt;

    const updated = await store.updateProject(p.id, { name: '新名', description: '新描述' });
    expect(updated.name).toBe('新名');
    expect(updated.description).toBe('新描述');
    expect(updated.id).toBe(p.id);
    expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);

    const fetched = await store.getProject(p.id);
    expect(fetched?.name).toBe('新名');
    expect(fetched?.description).toBe('新描述');
  });

  it('更新不存在的项目抛错', async () => {
    const store = createStore();
    await expect(store.updateProject('nonexistent', { name: 'x' })).rejects.toThrow();
  });

  it('部分更新不影响未指定字段', async () => {
    const store = createStore();
    const p = await store.createProject({ name: '保持名', logRetentionDays: 60, aiAssistEnabled: true });
    const updated = await store.updateProject(p.id, { description: '新增描述' });
    expect(updated.name).toBe('保持名');
    expect(updated.logRetentionDays).toBe(60);
    expect(updated.aiAssistEnabled).toBe(true);
    expect(updated.description).toBe('新增描述');
  });
});

describe('infra-store — listProjects', () => {
  it('返回正确的 systemCount', async () => {
    const store = createStore();
    const p1 = await store.createProject({ name: '无系统项目' });
    expect((await store.listProjects())[0].systemCount).toBe(0);

    const sys1 = makeSystem('sys_1', '系统1');
    await store.updateProject(p1.id, { systems: [sys1] });
    expect((await store.listProjects())[0].systemCount).toBe(1);

    const sys2 = makeSystem('sys_2', '系统2');
    await store.updateProject(p1.id, { systems: [sys1, sys2] });
    expect((await store.listProjects())[0].systemCount).toBe(2);
  });

  it('空项目列表返回空数组', async () => {
    const store = createStore();
    expect(await store.listProjects()).toEqual([]);
  });

  it('列表按创建顺序返回', async () => {
    const store = createStore();
    const p1 = await store.createProject({ name: '第一' });
    const p2 = await store.createProject({ name: '第二' });
    const p3 = await store.createProject({ name: '第三' });
    const list = await store.listProjects();
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe(p1.id);
    expect(list[1].id).toBe(p2.id);
    expect(list[2].id).toBe(p3.id);
  });
});

describe('infra-store — storageState 无失真会话复用', () => {
  it('保存并读取 storageState（cookies+localStorage origins）', async () => {
    const store = createStore();
    const state = {
      cookies: [{ name: 'sid', value: 'abc', domain: 'example.com', path: '/' }],
      origins: [
        {
          origin: 'https://example.com',
          localStorage: [{ name: 'token', value: 'xyz' }],
        },
      ],
    };
    await store.saveStorageState('sys1', state);
    const got = await store.getStorageState('sys1');
    expect(got).not.toBeNull();
    expect(got?.cookies).toEqual(state.cookies);
    expect(got?.origins).toEqual(state.origins);
  });

  it('未保存时返回 null', async () => {
    const store = createStore();
    expect(await store.getStorageState('missing')).toBeNull();
  });

  it('重复保存幂等覆盖', async () => {
    const store = createStore();
    await store.saveStorageState('sys1', { cookies: [{ name: 'a', value: '1', domain: 'x', path: '/' }], origins: [] });
    await store.saveStorageState('sys1', { cookies: [], origins: [] });
    expect((await store.getStorageState('sys1'))?.cookies).toEqual([]);
  });
});

describe('infra-store — metaConfig', () => {
  it('保存并读取系统元配置', async () => {
    const store = createStore();
    const meta = { precondition: 'System ready', conclusionRule: 'all-pass' };
    await store.saveMetaConfig('sys1', meta);
    expect(await store.getMetaConfig('sys1')).toEqual(meta);
  });

  it('未保存时返回 null', async () => {
    const store = createStore();
    expect(await store.getMetaConfig('missing')).toBeNull();
  });
});

describe('infra-store — createProject 默认值', () => {
  it('填充默认值', async () => {
    const store = createStore();
    const p = await store.createProject({ name: '默认值项目' });
    expect(p.type).toBe('standalone');
    expect(p.logRetentionDays).toBe(30);
    expect(p.aiAssistEnabled).toBe(false);
    expect(p.description).toBe('');
    expect(p.systems).toEqual([]);
    expect(p.id).toBeTruthy();
    expect(p.createdAt).toBeTruthy();
    expect(p.updatedAt).toBeTruthy();
  });

  it('自定义参数覆盖默认值', async () => {
    const store = createStore();
    const p = await store.createProject({
      name: '自定义项目',
      description: '自定义描述',
      type: 'portal',
      logRetentionDays: 90,
      aiAssistEnabled: true,
    });
    expect(p.type).toBe('portal');
    expect(p.description).toBe('自定义描述');
    expect(p.logRetentionDays).toBe(90);
    expect(p.aiAssistEnabled).toBe(true);
  });
});
