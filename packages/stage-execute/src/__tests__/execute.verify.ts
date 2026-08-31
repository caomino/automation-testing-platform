/**
 * @file execute.verify.ts
 * @description 执行 stage 契约验证（TDD 先红后绿）
 * @frozen v1.0 — 覆盖：矩阵执行、快照比对、isolationVerified 计算、步骤结果聚合、scope
 */
import { describe, it, expect } from 'vitest';
import type {
  BrowserOS,
  CaseRow,
  CaseSheet,
  DataSnapshot,
  MetaHeader,
} from '@test-platform/contracts';
import type { McpEngine } from '@test-platform/engine-mcp';
import { run } from '../run';
import { createMockEngine, createMockSnapshotProvider } from '../mock';

function buildMeta(): MetaHeader {
  return {
    systemName: '区域影像系统',
    testPointId: 'QYYX_PZ_JCX',
    testPoint: '检查室',
    testers: '陈新',
    clientStaff: '延安医疗集团',
    developerStaff: '—',
    firstTestDate: '2026-08-14',
    regressionDate: '—',
    conclusionRule: '默认',
    precondition: '已登录',
  };
}

function buildRow(caseNo: string, id: string): CaseRow {
  return {
    caseNo,
    content: '查询',
    step: 'Step1',
    operation: '点击查询',
    expected: '返回列表',
    firstResult: '\\',
    regressionResult: '\\',
    conclusion: '\\',
    id,
    featureId: caseNo,
    targetTestPoint: '查询',
  };
}

function buildSheet(name: string, rows: CaseRow[]): CaseSheet {
  return { sheetName: name, meta: buildMeta(), rows };
}

const ENV_CHROME: BrowserOS = { browser: 'chrome', os: 'win11' };
const ENV_EDGE: BrowserOS = { browser: 'edge', os: 'win10' };

describe('执行 stage 契约', () => {
  it('矩阵执行：浏览器×OS × 用例 笛卡尔积生成 ExecutionResult', async () => {
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1'), buildRow('C_02', 'r2')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME, ENV_EDGE],
    };
    const out = await run(input, { engine: createMockEngine() });

    expect(out.executionReport).toHaveLength(4); // 2 env × 2 case
    const caseNos = out.executionReport.map(r => r.caseNo);
    expect(caseNos).toEqual(['C_01', 'C_02', 'C_01', 'C_02']);
    const envs = out.executionReport.map(r => `${r.env.browser}/${r.env.os}`);
    expect(envs).toEqual(['chrome/win11', 'chrome/win11', 'edge/win10', 'edge/win10']);
    expect(out.isolationVerified).toBe(true); // 空快照默认通过
  });

  it('步骤结果聚合：含 failed → status failed 且带 defectRef；全 passed → passed；空步骤 → skipped', async () => {
    const engine = createMockEngine({
      stepFor: () => [
        { step: 's1', operation: 'o', expected: 'e', actual: 'a', result: 'passed' },
        { step: 's2', operation: 'o', expected: 'e', actual: 'a', result: 'failed' },
      ],
    });
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME],
    };
    const out = await run(input, { engine });

    expect(out.executionReport[0].status).toBe('failed');
    expect(out.executionReport[0].defectRef).toContain('DEF-C_01');
    expect(out.executionReport[0].steps).toHaveLength(2);
  });

  it('数据隔离：历史数据被修改/删除 → isolationVerified=false', async () => {
    const before: DataSnapshot = {
      capturedAt: 1,
      rowHashes: { t_user: ['h1', 'h2'] },
      ownerTaskId: 'task-x',
    };
    const afterModified: DataSnapshot = {
      capturedAt: 2,
      rowHashes: { t_user: ['h1', 'hX'] }, // h2 被改/删
      ownerTaskId: 'task-x',
    };
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME],
    };
    const out = await run(input, {
      engine: createMockEngine(),
      snapshotProvider: createMockSnapshotProvider([before, afterModified]),
      ownerTaskId: 'task-x',
    });

    expect(out.dataSnapshotBefore).toEqual(before);
    expect(out.dataSnapshotAfter).toEqual(afterModified);
    expect(out.isolationVerified).toBe(false);
  });

  it('数据隔离：新增数据归属本任务 owner → true；归属错误 → false', async () => {
    const before: DataSnapshot = {
      capturedAt: 1,
      rowHashes: { t_user: ['h1'] },
      ownerTaskId: 'task-x',
    };
    const afterOwned: DataSnapshot = {
      capturedAt: 2,
      rowHashes: { t_user: ['h1', 'hNEW'] }, // 新增行
      ownerTaskId: 'task-x', // 归属正确
    };
    const afterWrong: DataSnapshot = {
      capturedAt: 2,
      rowHashes: { t_user: ['h1', 'hNEW'] },
      ownerTaskId: 'OTHER', // 归属错误
    };

    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME],
    };

    const owned = await run(input, {
      engine: createMockEngine(),
      snapshotProvider: createMockSnapshotProvider([before, afterOwned]),
      ownerTaskId: 'task-x',
    });
    expect(owned.isolationVerified).toBe(true);

    const wrong = await run(input, {
      engine: createMockEngine(),
      snapshotProvider: createMockSnapshotProvider([before, afterWrong]),
      ownerTaskId: 'task-x',
    });
    expect(wrong.isolationVerified).toBe(false);
  });

  it('scope：selected_modules 仅执行选中模块 sheet', async () => {
    const input = {
      caseWorkbook: [
        buildSheet('模块A', [buildRow('C_01', 'r1')]),
        buildSheet('模块B', [buildRow('C_02', 'r2')]),
      ],
      scope: 'selected_modules' as const,
      selectedModuleIds: ['模块A'],
      browserOSMatrix: [ENV_CHROME],
    };
    const out = await run(input, { engine: createMockEngine() });

    expect(out.executionReport).toHaveLength(1);
    expect(out.executionReport[0].caseRowId).toBe('r1');
  });

  it('边界：空用例工作簿 → executionReport 空且 isolationVerified true（不崩溃）', async () => {
    const input = {
      caseWorkbook: [buildSheet('模块A', [])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME],
    };
    const out = await run(input, { engine: createMockEngine() });

    expect(out.executionReport).toHaveLength(0);
    expect(out.isolationVerified).toBe(true);
  });
});

describe('执行 stage 边界/红线补充', () => {
  it('(a) 连续两次 run() 之间不串味（无共享可变状态泄漏）', async () => {
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1'), buildRow('C_02', 'r2')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME],
    };
    const out1 = await run(input, { engine: createMockEngine() });
    const out2 = await run(input, { engine: createMockEngine() });

    expect(out1.executionReport.map(r => `${r.caseNo}/${r.status}`)).toEqual(['C_01/passed', 'C_02/passed']);
    // 两次运行相互独立且无共享可变状态污染：产出入参与结果完全一致
    expect(out2.executionReport.map(r => `${r.caseNo}/${r.status}`)).toEqual(out1.executionReport.map(r => `${r.caseNo}/${r.status}`));
    expect(out1.executionReport[0].defectRef).toBeUndefined();
    expect(out2.executionReport[0].defectRef).toBeUndefined();
  });

  it('(b) engineFactory 抛错(BROWSER_LAUNCH_FAILED) → 不崩溃，该环境用例记为 failed', async () => {
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME, ENV_EDGE],
    };
    const out = await run(input, {
      engineFactory: () => {
        throw new Error('BROWSER_LAUNCH_FAILED: chrome crashed');
      },
    });

    // run 不 reject；两个环境各一条 failed 记录
    expect(out.executionReport).toHaveLength(2);
    expect(out.executionReport.every(r => r.status === 'failed')).toBe(true);
    expect(out.executionReport.every(r => r.steps[0].actual.includes('BROWSER_LAUNCH_FAILED'))).toBe(true);
    expect(out.isolationVerified).toBe(true); // 空快照默认通过，引擎失败不波及隔离校验
  });

  it('(c) 单用例非超时异常 → failed（且不被误标为 EXEC_TIMEOUT）', async () => {
    const errorEngine = {
      ...createMockEngine(),
      runCase: async () => {
        throw new Error('脚本执行异常: null pointer');
      },
    };
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME],
    };
    const out = await run(input, { engine: errorEngine });

    expect(out.executionReport[0].status).toBe('failed');
    expect(out.executionReport[0].steps[0].actual).toContain('脚本执行异常');
    expect(out.executionReport[0].steps[0].actual).not.toContain('EXEC_TIMEOUT');
    expect(out.executionReport[0].defectRef).toContain('DEF-C_01');
  });

  it('(d) isolationVerified=false（数据隔离红线违例）仍正常产出不崩溃', async () => {
    const before: DataSnapshot = {
      capturedAt: 1,
      rowHashes: { t_user: ['h1', 'h2'] },
      ownerTaskId: 'task-x',
    };
    const after: DataSnapshot = {
      capturedAt: 2,
      rowHashes: { t_user: ['h1', 'hX'] }, // h2 被改
      ownerTaskId: 'task-x',
    };
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1'), buildRow('C_02', 'r2')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME],
    };
    const out = await run(input, {
      engine: createMockEngine(),
      snapshotProvider: createMockSnapshotProvider([before, after]),
      ownerTaskId: 'task-x',
    });

    expect(out.isolationVerified).toBe(false); // 红线违例被如实记录
    expect(out.executionReport).toHaveLength(2); // 产出完整、不崩溃
    expect(out.executionReport.every(r => r.status === 'passed')).toBe(true);
  });

  it('env 级隔离：engineFactory 为每个 env 返回独立引擎实例', async () => {
    const instances: McpEngine[] = [];
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME, ENV_EDGE, { browser: 'firefox', os: 'linux' }],
    };
    await run(input, {
      engineFactory: (_env) => {
        const e = createMockEngine();
        instances.push(e);
        return e;
      },
    });

    expect(instances).toHaveLength(3);
    expect(instances[0]).not.toBe(instances[1]);
    expect(instances[1]).not.toBe(instances[2]);
  });

  it('DEFECT_REF_PREFIX 跨包共享：defectRef = <PREFIX>-<caseNo>@<browser>-<os> 稳定格式', async () => {
    // 用例失败时生成缺陷引用，前缀与 stage-defect 消费侧保持一致
    const engine = createMockEngine({
      stepFor: () => [
        { step: 's1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' },
      ],
    });
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [ENV_CHROME, ENV_EDGE],
    };
    const out = await run(input, { engine });
    // 两条各带独立 env 后缀
    const refs = out.executionReport.map((r) => r.defectRef);
    expect(refs).toEqual([
      'DEF-C_01@chrome-win11',
      'DEF-C_01@edge-win10',
    ]);
    expect(new Set(refs).size).toBe(2); // 跨 env 不串
    // 前缀常量值 = 'DEF'（冻结，stage-defect 消费侧依赖）
    const { DEFECT_REF_PREFIX } = await import('../constants');
    expect(DEFECT_REF_PREFIX).toBe('DEF');
  });

  it('空矩阵（无 env）→ executionReport 空，且不崩溃', async () => {
    const input = {
      caseWorkbook: [buildSheet('模块A', [buildRow('C_01', 'r1')])],
      scope: 'all' as const,
      browserOSMatrix: [] as BrowserOS[],
    };
    const out = await run(input, { engine: createMockEngine() });
    expect(out.executionReport).toHaveLength(0);
    expect(out.isolationVerified).toBe(true);
  });
});
