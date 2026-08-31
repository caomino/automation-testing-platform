/**
 * @file feature.verify.ts
 * @description stage-feature 契约测试（九列 / 测试点标识 base_NN / 子系统维度递增 / round-trip / 合并过滤）
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import type { FeatureInput, ModuleNode } from '@test-platform/contracts';
import { mock, validateFeatureOutput } from '@test-platform/contracts';
import { run } from '../src';
import { toAbbrToken, shortHash, systemAbbrFromSubsystemId } from '../src/abbreviation';

/** 构造最小 ModuleNode（契约必填字段齐全） */
function node(partial: Partial<ModuleNode> & Pick<ModuleNode, 'id' | 'label' | 'subsystemId' | 'type' | 'parentId' | 'status' | 'depth'>): ModuleNode {
  return { children: [], ...partial };
}

/**
 * 树结构：
 * sys_root(根)
 *  └ mod_jcs(检查室管理)
 *      ├ sub_jcx(检查室)  → p_jcx_a(查询, exploration) / p_jcx_b(新增, exploration) / p_jcx_c(导出, ai_generated)
 *      └ sub_pz(配置)     → p_pz_a(修改, exploration) / p_pz_b(删除, manual)
 * 子系统维度：sub_jcx 一组、sub_pz 一组，NN 各自从 01 递增。
 */
function buildInput(): FeatureInput {
  const pJcxA = node({ id: 'p_jcx_a', label: '查询', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_jcx', status: 'covered', depth: 3, evidenceId: 'ev_1' });
  const pJcxB = node({ id: 'p_jcx_b', label: '新增', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_jcx', status: 'covered', depth: 3, evidenceId: 'ev_2' });
  const pJcxC = node({ id: 'p_jcx_c', label: '导出', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_jcx', status: 'needs_review', depth: 3 });
  const subJcx = node({ id: 'sub_jcx', label: '检查室', subsystemId: 'sys_qyyx', type: 'module', parentId: 'mod_jcs', status: 'covered', depth: 2, children: [pJcxA, pJcxB, pJcxC] });

  const pPzA = node({ id: 'p_pz_a', label: '修改', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_pz', status: 'covered', depth: 3, evidenceId: 'ev_3' });
  const pPzB = node({ id: 'p_pz_b', label: '删除', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_pz', status: 'covered', depth: 3, manuallyAdded: true });
  const subPz = node({ id: 'sub_pz', label: '配置', subsystemId: 'sys_qyyx', type: 'module', parentId: 'mod_jcs', status: 'covered', depth: 2, children: [pPzA, pPzB] });

  const modJcs = node({ id: 'mod_jcs', label: '检查室管理', subsystemId: 'sys_qyyx', type: 'module', parentId: 'sys_root', status: 'covered', depth: 1, children: [subJcx, subPz] });
  const root = node({ id: 'sys_root', label: '区域影像系统', subsystemId: 'sys_qyyx', type: 'system', parentId: null, status: 'covered', depth: 0, children: [modJcs] });

  return { moduleTree: [root], systemName: '区域影像系统', confirmedOnly: false };
}

describe('stage-feature 契约', () => {
  it('九列：每行恰好 9 列', async () => {
    const out = await run(buildInput());
    const flat = out.featureTable.flat();
    expect(flat.length).toBeGreaterThan(0);
    for (const row of flat) {
      expect(row).toHaveLength(9);
    }
  });

  it('测试点标识格式：base_NN（4 段，结尾为数字）', async () => {
    const out = await run(buildInput());
    expect(out.featureIds.length).toBe(5);
    for (const id of out.featureIds) {
      expect(id).toMatch(/^.+\d+$/);
      const parts = id.split('_');
      expect(parts).toHaveLength(4); // 系统缩写_父目录缩写_子系统缩写_NN
      expect(parts[3]).toMatch(/^\d{2}$/);
    }
  });

  it('子系统维度递增：每组 NN 从 01 起递增且组内连续', async () => {
    const out = await run(buildInput());
    for (const group of out.featureTable) {
      group.forEach((row, idx) => {
        const nn = row[8].split('_')[3];
        expect(nn).toBe(String(idx + 1).padStart(2, '0'));
      });
    }
    // 两个子系统分组
    expect(out.featureTable).toHaveLength(2);
    const jcx = out.featureTable[0].map((r) => r[8]);
    const pz = out.featureTable[1].map((r) => r[8]);
    // 缩写改为按中文 label：系统(区域影像系统=QYYXXT)、主模块(检查室管理=JCSGL)、子模块(检查室=JCX/配置=PZ)
    expect(jcx).toEqual(['QYYX_JCSGL_JCX_01', 'QYYX_JCSGL_JCX_02', 'QYYX_JCSGL_JCX_03']);
    expect(pz).toEqual(['QYYX_JCSGL_PZ_01', 'QYYX_JCSGL_PZ_02']);
  });

  it('round-trip 一致：确定性、与末列一致、通过契约 schema、JSON 可还原', async () => {
    const out1 = await run(buildInput());
    const out2 = await run(buildInput());
    expect(out1).toEqual(out2);

    const flat = out1.featureTable.flat();
    expect(out1.featureIds).toHaveLength(flat.length);
    out1.featureIds.forEach((id, i) => expect(id).toBe(flat[i][8]));

    expect(() => validateFeatureOutput(out1)).not.toThrow();

    const restored = JSON.parse(JSON.stringify(out1));
    expect(restored).toEqual(out1);
  });

  it('合并人工补充：manuallyAdded 节点标记为 manual 且被纳入', async () => {
    const out = await run(buildInput());
    const manual = out.provenance.filter((p) => p.source === 'manual');
    expect(manual).toHaveLength(1);
    expect(manual[0].featureRowIndex).toBeTypeOf('number');
    // 人工补充节点（删除）确实出现在表中 — 测试点列为 '删除'
    const flat = out.featureTable.flat();
    expect(flat.some((r) => r[7] === '删除')).toBe(true);
  });

  it('confirmedOnly 过滤：丢弃未确认的 ai_generated，保留 exploration/manual', async () => {
    const full = await run(buildInput());
    expect(full.featureIds).toHaveLength(5); // 含 ai_generated 的「导出」

    const filtered = await run({ ...buildInput(), confirmedOnly: true });
    expect(filtered.featureIds).toHaveLength(4);
    expect(filtered.featureIds).not.toContain('QYYX_JCSGL_JCX_03');
    // 组内 NN 重新从 01 连续（检查室组仅剩查询/新增）
    expect(filtered.featureTable[0].map((r) => r[8])).toEqual(['QYYX_JCSGL_JCX_01', 'QYYX_JCSGL_JCX_02']);
    // 所有保留行均为已确认
    expect(filtered.provenance.every((p) => p.confirmed)).toBe(true);
    // 人工补充（删除）在 confirmedOnly 下仍保留 — 测试点列为 '删除'
    expect(filtered.featureTable.flat().some((r) => r[7] === '删除')).toBe(true);
  });

  it('边界：空树返回空结果（不抛错）', async () => {
    const out = await run({ moduleTree: [], systemName: 'X', confirmedOnly: false });
    expect(out.featureTable).toEqual([]);
    expect(out.featureIds).toEqual([]);
    expect(out.provenance).toEqual([]);
  });

  it('金标准 mock 输入可跑通且不破坏契约', async () => {
    const out = await run(mock.mockFeatureInput);
    const flat = out.featureTable.flat();
    expect(flat.every((r) => r.length === 9)).toBe(true);
    expect(() => validateFeatureOutput(out)).not.toThrow();
  });

  it('纵向合并分组结构：同组行 系统名称/主模块/子模块 列恒定（rowspan 就绪）', async () => {
    const out = await run(buildInput());
    // 每个子系统分组内，列 3/4/5（系统名称/主模块/子模块）应保持一致，
    // 这正是原型屏③对同组行做纵向合并（rowspan）的前置不变量。
    for (const group of out.featureTable) {
      expect(group.length).toBeGreaterThan(0);
      const [sys, main, sub] = [group[0][3], group[0][4], group[0][5]];
      for (const row of group) {
        expect(row[3]).toBe(sys);
        expect(row[4]).toBe(main);
        expect(row[5]).toBe(sub);
      }
    }
  });
});

describe('stage-feature 缩写兜底', () => {
  it('ASCII 语义 id：去已知前缀、取首段（单段 token）', () => {
    expect(toAbbrToken('sys_qyyx')).toBe('QYYX');
    expect(toAbbrToken('mod_jcs')).toBe('JCS');
    expect(toAbbrToken('')).toBe('X');
  });

  it('UUID / 路径哈希 / 多词元 id 收敛为单段 token（不按 - 拆成多段）', () => {
    // UUID：多段 → 稳定哈希单段
    const uuid = toAbbrToken('550e8400-e29b-41d4-a716-446655440000');
    expect(uuid).toMatch(/^[0-9A-F]{6}$/); // 单段、无下划线
    expect(uuid).not.toContain('_');
    // 路径哈希：多段 → 单段
    const path = toAbbrToken('mod_/a/b/c/d');
    expect(path).not.toContain('_');
    // 多词元 id：a-b-c-d → 单段哈希
    const multi = toAbbrToken('a-b-c-d');
    expect(multi).not.toContain('_');
    // 确定性：同输入同输出
    expect(toAbbrToken('a-b-c-d')).toBe(multi);
  });

  it('base 严格 = 3 段（系统_父目录_子系统），任意 id 不溢出', () => {
    const cases: Array<[string, string, string]> = [
      ['sys_qyyx', 'mod_jcs', 'sub_jcx'],
      ['550e8400-e29b-41d4-a716-446655440000', 'mod_/a/b/c', 'sub_x-y-z'],
      ['', 'SYS_ROOT', 'SUB_PZ'],
      ['企业管理系统', '影像检查室', '配置模块'], // 全中文
      ['a-b-c-d-e-f', 'x/y/z', 's1_s2_s3_s4'], // 多段
    ];
    for (const [sys, main, sub] of cases) {
      const base = `${systemAbbrFromSubsystemId(sys, '区域影像系统')}_${toAbbrToken(main)}_${toAbbrToken(sub)}`;
      const segs = base.split('_');
      expect(segs).toHaveLength(3);
      for (const s of segs) expect(s).not.toContain('_');
      // base 非空（极端情况如空系统 id + 空主模块也产生有效 token）
      expect(base.length).toBeGreaterThan(0);
    }
  });

  it('UUID / 路径哈希 / 多词元 id → 单段 token（不含 _），为 base_NN 4 段规则保障', () => {
    // UUID
    const uuid = toAbbrToken('550e8400-e29b-41d4-a716-446655440000');
    expect(uuid).not.toContain('_');
    expect(uuid).toMatch(/^[0-9A-F]{6}$/);
    // 多段路径（包含 /）
    const path = toAbbrToken('/a/b/c/d/e');
    expect(path).not.toContain('_');
    // 多段语义 id（含 -）
    const multi = toAbbrToken('SYS_MOD_PAGE_A_B_C_D');
    expect(multi).not.toContain('_');
    // 确定性
    expect(toAbbrToken('/a/b/c/d/e')).toBe(path);
    expect(toAbbrToken('SYS_MOD_PAGE_A_B_C_D')).toBe(multi);
  });

  it('中文 id / 标签 → 拼音首字母大写（R-A-01），不含原生中文', () => {
    expect(toAbbrToken('企业营销')).toBe('QYYX');
    expect(toAbbrToken('sub_配置')).toBe('PZ'); // 去前缀 SUB + 配置→PZ
    expect(toAbbrToken('检查室管理')).toBe('JCSGL');
    const t = toAbbrToken('区域影像系统');
    expect(t).toBe('QYYX'); // 冻结词条：金标准 docs 约定 QYYX = 区域影像系统（QYYX_PZ_JCX 示例）
    expect(/[一-鿿]/.test(t)).toBe(false); // 无原生中文
    // 纯中文系统名回退路径（仅前缀/无词元 + CJK）
    expect(toAbbrToken('企业')).toBe('QY');
  });

  it('仅含已知前缀/无词元时回退到 shortHash（6 位大写十六进制）', () => {
    const fallback = toAbbrToken('MOD');
    expect(fallback).toBe(shortHash('MOD'));
    expect(fallback).toMatch(/^[0-9A-F]{6}$/);
  });
});

describe('stage-feature 测试点标识全局唯一', () => {
  /**
   * 两个子系统分组：label 完全相同（配置 / 配置），
   * 与同一主模块「检查室管理」、系统「区域影像系统」组合 → 两组 base 完全相同（QYYX_JCSGL_PZ），
   * 跨分组出现 base 碰撞。验证 testPointId 仍整表行内全局唯一。
   */
  function collisionInput(): FeatureInput {
    const pA = node({ id: 'p_a', label: '查询', subsystemId: 'sys_qyyx', type: 'page', parentId: 'SUB_PZ', status: 'covered', depth: 3, evidenceId: 'e1' });
    const subA = node({ id: 'SUB_PZ', label: '配置', subsystemId: 'sys_qyyx', type: 'module', parentId: 'mod_jcs', status: 'covered', depth: 2, children: [pA] });
    const pB = node({ id: 'p_b', label: '查询', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_pz', status: 'covered', depth: 3, evidenceId: 'e2' });
    const subB = node({ id: 'sub_pz', label: '配置', subsystemId: 'sys_qyyx', type: 'module', parentId: 'mod_jcs', status: 'covered', depth: 2, children: [pB] });
    const modJcs = node({ id: 'mod_jcs', label: '检查室管理', subsystemId: 'sys_qyyx', type: 'module', parentId: 'sys_root', status: 'covered', depth: 1, children: [subA, subB] });
    const root = node({ id: 'sys_root', label: '区域影像系统', subsystemId: 'sys_qyyx', type: 'system', parentId: null, status: 'covered', depth: 0, children: [modJcs] });
    return { moduleTree: [root], systemName: '区域影像系统', confirmedOnly: false };
  }

  it('跨分组 base 碰撞 → testPointId 整表行内全局唯一', async () => {
    const out = await run(collisionInput());
    expect(out.featureIds).toHaveLength(2);
    // 全局唯一（无重复）
    expect(new Set(out.featureIds).size).toBe(2);
    // 碰撞方被追加去重后缀
    expect(out.featureIds.some((id) => id.includes('_C0'))).toBe(true);
    // 整表每行末列与 featureIds 一一对应且唯一
    const flat = out.featureTable.flat();
    expect(flat).toHaveLength(2);
    flat.forEach((row, i) => expect(row[8]).toBe(out.featureIds[i]));
    expect(() => validateFeatureOutput(out)).not.toThrow();
  });

  it('同组重复 label → NN 仍区分，testPointId 唯一', async () => {
    // 同一子系统下两个功能点 label 相同（均「查询」），NN 01/02 区分
    const p1 = node({ id: 'p_1', label: '查询', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_jcx', status: 'covered', depth: 3, evidenceId: 'e1' });
    const p2 = node({ id: 'p_2', label: '查询', subsystemId: 'sys_qyyx', type: 'page', parentId: 'sub_jcx', status: 'covered', depth: 3, evidenceId: 'e2' });
    const subJcx = node({ id: 'sub_jcx', label: '检查室', subsystemId: 'sys_qyyx', type: 'module', parentId: 'mod_jcs', status: 'covered', depth: 2, children: [p1, p2] });
    const modJcs = node({ id: 'mod_jcs', label: '检查室管理', subsystemId: 'sys_qyyx', type: 'module', parentId: 'sys_root', status: 'covered', depth: 1, children: [subJcx] });
    const root = node({ id: 'sys_root', label: '区域影像系统', subsystemId: 'sys_qyyx', type: 'system', parentId: null, status: 'covered', depth: 0, children: [modJcs] });
    const out = await run({ moduleTree: [root], systemName: '区域影像系统', confirmedOnly: false });
    expect(out.featureIds).toEqual(['QYYX_JCSGL_JCX_01', 'QYYX_JCSGL_JCX_02']);
    expect(new Set(out.featureIds).size).toBe(2);
  });

  it('featureIds 去重：不同行不产生重复条目', async () => {
    const out = await run(collisionInput());
    expect(out.featureIds).toEqual(Array.from(new Set(out.featureIds)));
  });
});

describe('stage-feature 动作档案', () => {
  it('透传探索阶段已识别的动作语义，不根据测试点名称重新分类', async () => {
    const action = node({
      id: 'action_create',
      label: '维护资料',
      actionKind: 'create',
      actionText: '新增患者',
      actionSelector: '#patient-create',
      url: 'https://his.example/patients',
      subsystemId: 'sys_his',
      type: 'action',
      parentId: 'sub_patient',
      status: 'covered',
      depth: 3,
    });
    const legacy = node({
      id: 'action_legacy',
      label: '历史节点',
      subsystemId: 'sys_his',
      type: 'action',
      parentId: 'sub_patient',
      status: 'needs_review',
      depth: 3,
    });
    const sub = node({ id: 'sub_patient', label: '患者', subsystemId: 'sys_his', type: 'module', parentId: 'mod_registry', status: 'covered', depth: 2, children: [action, legacy] });
    const mod = node({ id: 'mod_registry', label: '挂号', subsystemId: 'sys_his', type: 'module', parentId: 'root', status: 'covered', depth: 1, children: [sub] });
    const root = node({ id: 'root', label: 'HIS', subsystemId: 'sys_his', type: 'system', parentId: null, status: 'covered', depth: 0, children: [mod] });

    const output = await run({ moduleTree: [root], systemName: 'HIS', confirmedOnly: false });

    expect(output.featureProfiles).toEqual([
      expect.objectContaining({
        featureId: output.featureIds[0],
        testPoint: '维护资料',
        actionKind: 'create',
        pageUrl: 'https://his.example/patients',
        clickSelector: '#patient-create',
        sourceLabel: '新增患者',
        sourceSelector: '#patient-create',
        parentModule: '挂号',
        subsystemId: 'sys_his',
      }),
      expect.objectContaining({
        featureId: output.featureIds[1],
        actionKind: 'other',
      }),
    ]);
  });
});

describe('stage-feature 结构化设计源适配', () => {
  it('解析 OpenAPI JSON/YAML 与 workflow，GET 不误判新增且无效 workflow 显式待复核', async () => {
    const openapi = JSON.stringify({
      openapi: '3.0.3',
      paths: {
        '/patients': {
          get: { parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }], responses: { '200': { description: 'ok' } } },
          post: { security: [{ bearerAuth: [] }], parameters: [{ name: 'tenantId', in: 'header', required: true, description: '租户标识', schema: { type: 'string', minLength: 1 } }], requestBody: { required: true, description: '患者资料', content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, phone: { type: 'string', pattern: '^1\\d{10}$' } } } } } }, responses: { '201': { description: 'created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } } } } } },
        },
      },
    });
    const workflow = JSON.stringify({ id: 'admission', name: '入院', entities: ['患者'], roles: ['医生'], states: ['待入院', '已入院'], transitions: [{ id: 'admit', action: '办理入院', from: '待入院', to: '已入院', actorRoles: ['医生'], preconditions: ['患者已登记'], postconditions: ['生成住院记录'] }] });
    const out = await run({
      moduleTree: [], systemName: 'HIS', confirmedOnly: false,
      designSources: [
        { kind: 'openapi', content: openapi, name: 'patients.json' },
        { kind: 'workflow', content: workflow, name: 'admission.json' },
        { kind: 'workflow', content: '{"id":"broken"}', name: 'broken.json' },
      ],
    });

    const getProfile = out.featureProfiles?.find((profile) => profile.testPoint === 'GET /patients');
    const postProfile = out.featureProfiles?.find((profile) => profile.testPoint === 'POST /patients');
    const workflowProfile = out.featureProfiles?.find((profile) => profile.testPoint === '办理入院');
    expect(getProfile?.actionKind).toBe('list');
    expect(postProfile?.actionKind).toBe('create');
    expect(workflowProfile?.actionKind).toBe('workflow');
    expect(out.featureEvidence?.[postProfile!.featureId].fields.map((field) => field.name)).toEqual(expect.arrayContaining(['name', 'phone']));
    expect(postProfile?.source).toBe('openapi');
    expect(out.featureEvidence?.[postProfile!.featureId].structuredDesign?.api).toEqual(expect.objectContaining({
      method: 'POST', path: '/patients', security: ['bearerAuth'],
      parameters: expect.arrayContaining([expect.objectContaining({ name: 'tenantId', in: 'header', required: true, description: '租户标识' })]),
      requestBody: expect.objectContaining({ description: '患者资料' }),
      responses: expect.arrayContaining([expect.objectContaining({ status: '201', description: 'created', schema: expect.objectContaining({ properties: expect.arrayContaining(['id', 'name']) }) })]),
    }));
    expect(out.featureEvidence?.[workflowProfile!.featureId].coverageKeys).toContain('workflow.transition.admit');
    expect(workflowProfile?.source).toBe('workflow');
    expect(out.featureEvidence?.[workflowProfile!.featureId].structuredDesign?.workflow?.transitions[0]).toEqual(expect.objectContaining({
      id: 'admit', action: '办理入院', from: '待入院', to: '已入院', actorRoles: ['医生'],
      preconditions: ['患者已登记'], postconditions: ['生成住院记录'],
    }));
    expect(Object.values(out.featureEvidence ?? {}).some((evidence) => evidence.needsReview && /workflow/i.test(evidence.reviewReason ?? ''))).toBe(true);
  });

  it('Swagger 2 body/$ref/allOf/oneOf 与响应、安全声明均转为可追溯证据', async () => {
    const swagger = JSON.stringify({
      swagger: '2.0',
      securityDefinitions: { bearerAuth: { type: 'apiKey', name: 'Authorization', in: 'header' } },
      paths: {
        '/patients/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }],
          put: {
            security: [{ bearerAuth: [] }],
            parameters: [{
              name: 'body', in: 'body', required: true,
              schema: { allOf: [
                { $ref: '#/definitions/PatientBase' },
                { type: 'object', required: ['level'], properties: { level: { type: 'string', enum: ['normal', 'urgent'] } } },
                { oneOf: [
                  { type: 'object', properties: { sms: { type: 'string' } } },
                  { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
                ] },
              ] },
            }],
            responses: { '200': { description: 'ok', schema: { $ref: '#/definitions/PatientBase' } }, '400': { description: 'bad request' } },
          },
        },
      },
      definitions: {
        PatientBase: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 2 } } },
      },
    });

    const out = await run({
      moduleTree: [], systemName: 'HIS', confirmedOnly: false,
      designSources: [{ kind: 'openapi', content: swagger, name: 'patients.swagger.json' }],
    });
    const profile = out.featureProfiles?.find((item) => item.testPoint === 'PUT /patients/{id}');
    const evidence = profile && out.featureEvidence?.[profile.featureId];

    expect(profile?.actionKind).toBe('update');
    expect(evidence?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'id', required: true }),
      expect.objectContaining({ name: 'name', required: true, minLength: 2 }),
      expect.objectContaining({ name: 'level', required: true, options: ['normal', 'urgent'] }),
      expect.objectContaining({ name: 'sms' }),
      expect.objectContaining({ name: 'email', inputType: 'string' }),
    ]));
    expect(evidence?.coverageKeys).toEqual(expect.arrayContaining([
      'api.response.200',
      'api.response.400',
      'api.security.bearerAuth',
    ]));
    expect(evidence?.structuredDesign?.api?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]));
    expect(evidence?.structuredDesign?.api?.responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: '200', description: 'ok', schema: expect.objectContaining({ properties: expect.arrayContaining(['name']) }) }),
    ]));
  });

  it('外部 $ref 被禁用并降级为 needs_review，不读取网络或本地文件', async () => {
    const out = await run({
      moduleTree: [], systemName: 'HIS', confirmedOnly: false,
      designSources: [{
        kind: 'openapi',
        name: 'external-ref.json',
        content: JSON.stringify({
          swagger: '2.0',
          paths: { '/patients': { get: { responses: { '200': { description: 'ok', schema: { $ref: 'https://example.test/patient.json#/Patient' } } } } } },
        }),
      }],
    });

    expect(Object.values(out.featureEvidence ?? {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ needsReview: true, reviewReason: expect.stringContaining('openapi') }),
    ]));
  });

  it('operation 级参数覆盖 path 参数，显式 security 空数组覆盖全局鉴权（OpenAPI / Swagger）', async () => {
    const openapi = JSON.stringify({
      openapi: '3.0.3', security: [{ bearerAuth: [] }], paths: {
        '/patients': { parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }], get: { security: [], parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 2 } }], responses: { '200': { description: 'ok' } } } },
      },
    });
    const swagger = JSON.stringify({
      swagger: '2.0', security: [{ bearerAuth: [] }], paths: {
        '/visits': { parameters: [{ name: 'page', in: 'query', type: 'integer', minimum: 1 }], get: { security: [], parameters: [{ name: 'page', in: 'query', type: 'integer', minimum: 3 }], responses: { '200': { description: 'ok' } } } },
      },
    });
    const out = await run({ moduleTree: [], systemName: 'HIS', confirmedOnly: false, designSources: [{ kind: 'openapi', name: 'openapi.json', content: openapi }, { kind: 'openapi', name: 'swagger.json', content: swagger }] });
    for (const testPoint of ['GET /patients', 'GET /visits']) {
      const profile = out.featureProfiles?.find((item) => item.testPoint === testPoint)!;
      const evidence = out.featureEvidence?.[profile.featureId]!;
      expect(evidence.structuredDesign?.api?.security).toEqual([]);
      expect(evidence.structuredDesign?.api?.parameters.filter((item) => item.name === 'page')).toHaveLength(1);
      expect(evidence.coverageKeys.filter((key) => key === 'api.parameter.query.page')).toHaveLength(1);
    }
    expect(out.featureEvidence?.[out.featureProfiles?.find((item) => item.testPoint === 'GET /patients')!.featureId].structuredDesign?.api?.parameters[0]?.schema?.minimum).toBe(2);
    expect(out.featureEvidence?.[out.featureProfiles?.find((item) => item.testPoint === 'GET /visits')!.featureId].structuredDesign?.api?.parameters[0]?.schema?.minimum).toBe(3);
  });
});
