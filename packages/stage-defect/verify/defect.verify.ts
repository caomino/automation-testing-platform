/**
 * @file defect.verify.ts
 * @description stage-defect 冻结接口校验（失败→缺陷 / 六列结构 / 级别枚举 / 模块筛选 / 截图关联）
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import type { DefectInput, ExecutionResult } from '@test-platform/contracts';
import { DefectOutputSchema, DefectRowSchema } from '@test-platform/contracts';
import { run } from '../src';
import { deriveModule, deriveLevel } from '../src';

/** 构造一条 ExecutionResult（缺省值对齐常见场景） */
function make(
  over: Partial<ExecutionResult> & { caseNo: string; status: ExecutionResult['status'] },
): ExecutionResult {
  return {
    caseNo: over.caseNo,
    caseRowId: over.caseRowId ?? `row_${over.caseNo}`,
    env: over.env ?? { browser: 'Chrome', os: 'Win11' },
    status: over.status,
    steps: over.steps ?? [],
    defectRef: over.defectRef,
  };
}

describe('stage-defect 冻结接口', () => {
  it('失败用例 → 缺陷（passed/skipped 不计）', async () => {
    const input: DefectInput = {
      executionReport: [
        make({
          caseNo: 'QYYX_PZ_JCX_01',
          status: 'failed',
          steps: [{ step: 'S1', operation: '查询', expected: '列表展示', actual: '脚本报错', result: 'failed' }],
        }),
        make({ caseNo: 'QYYX_PZ_JCX_02', status: 'passed' }),
        make({ caseNo: 'QYYX_PZ_JCX_03', status: 'skipped' }),
      ],
    };
    const out = await run(input);
    const flat = out.defectTable.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0].description).toContain('脚本报错');
    expect(flat[0].environment).toContain('QYYX_PZ_JCX_01');
  });

  it('六列结构正确（序号/问题描述/截图引用/级别/质量特性/环境，对齐冻结 schema）', async () => {
    const input: DefectInput = {
      executionReport: [
        make({
          caseNo: 'QYYX_PZ_JCX_01',
          status: 'failed',
          steps: [{ step: 'S1', operation: '新增', expected: '成功', actual: '失败', result: 'failed' }],
        }),
      ],
    };
    const out = await run(input);
    expect(() => DefectOutputSchema.parse(out)).not.toThrow();
    expect(out.defectTable).toHaveLength(1);
    const row = out.defectTable[0][0];
    expect(() => DefectRowSchema.parse(row)).not.toThrow();
    expect(typeof row.sequence).toBe('number');
    expect(typeof row.description).toBe('string');
    expect(typeof row.qualityAttribute).toBe('string');
    expect(typeof row.environment).toBe('string');
  });

  it('级别枚举（高·中·低）', async () => {
    const inputs: DefectInput[] = [
      // 安全类 → 高
      { executionReport: [make({ caseNo: 'A_01', status: 'failed', steps: [{ step: 'S1', operation: '权限校验', expected: '拦截', actual: '越权访问', result: 'failed' }] })] },
      // 外观类 → 低
      { executionReport: [make({ caseNo: 'B_01', status: 'failed', steps: [{ step: 'S1', operation: '刷新', expected: '列表', actual: '未刷新', result: 'failed' }] })] },
      // 普通 → 中
      { executionReport: [make({ caseNo: 'C_01', status: 'failed', steps: [{ step: 'S1', operation: '新增', expected: '成功', actual: '失败', result: 'failed' }] })] },
    ];
    const levels = (await Promise.all(inputs.map((i) => run(i)))).map((o) => o.defectTable.flat()[0].level);
    expect(levels).toEqual(['高', '低', '中']);
    for (const lv of levels) expect(['高', '中', '低']).toContain(lv);
    // 纯函数枚举约束
    expect(['高', '中', '低']).toContain(deriveLevel('权限越权'));
    expect(['高', '中', '低']).toContain(deriveLevel('未刷新样式'));
  });

  it('模块筛选（按模块键分组 + moduleFilter 精确匹配）', async () => {
    const input: DefectInput = {
      executionReport: [
        make({ caseNo: 'QYYX_PZ_JCX_01', status: 'failed', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
        make({ caseNo: 'QYYX_PZ_JCX_02', status: 'failed', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
        make({ caseNo: 'OTHER_XX_01', status: 'failed', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
      ],
    };
    // 无筛选：两组（QYYX_PZ_JCX / OTHER_XX），共 3 条
    const all = await run(input);
    expect(all.defectTable).toHaveLength(2);
    expect(all.defectTable.flat()).toHaveLength(3);

    // 筛选 QYYX_PZ_JCX：仅一组 2 条
    const filtered = await run({ ...input, moduleFilter: 'QYYX_PZ_JCX' });
    expect(filtered.defectTable).toHaveLength(1);
    expect(filtered.defectTable.flat()).toHaveLength(2);
    expect(filtered.defectTable.flat().every((r) => r.environment.includes('QYYX_PZ_JCX'))).toBe(true);

    expect(deriveModule('QYYX_PZ_JCX_01')).toBe('QYYX_PZ_JCX');
    expect(deriveModule('OTHER_XX_01')).toBe('OTHER_XX');
  });

  it('边界：moduleFilter 空串视为不过滤（与未提供等价，返回全部分组）', async () => {
    const input: DefectInput = {
      executionReport: [
        make({ caseNo: 'QYYX_PZ_JCX_01', status: 'failed', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
        make({ caseNo: 'OTHER_XX_01', status: 'failed', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
      ],
    };
    const empty = await run({ ...input, moduleFilter: '' });
    const omitted = await run(input);
    // 空串与未提供 moduleFilter 结果一致：两组共 2 条
    expect(empty.defectTable).toHaveLength(2);
    expect(empty.defectTable.flat()).toHaveLength(2);
    expect(empty.defectTable).toEqual(omitted.defectTable);
  });

  it('去重：多个失败用例共享同一 defectRef → screenshots 按 defectRef 去重', async () => {
    const input: DefectInput = {
      executionReport: [
        make({ caseNo: 'QYYX_PZ_JCX_01', status: 'failed', defectRef: 'shot_shared', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
        make({ caseNo: 'QYYX_PZ_JCX_02', status: 'failed', defectRef: 'shot_shared', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
      ],
    };
    const out = await run(input);
    // 共享同一 defectRef → 仅一条 ScreenshotRef
    expect(out.screenshots).toHaveLength(1);
    expect(out.screenshots[0].id).toBe('shot_shared');
    // 但两行缺陷各自保留 screenshotRef 关联
    expect(out.defectTable.flat().every((r) => r.screenshotRef === 'shot_shared')).toBe(true);
  });

  it('截图引用关联（defectRef ↔ screenshots ↔ 行 screenshotRef）', async () => {
    const input: DefectInput = {
      executionReport: [
        make({ caseNo: 'QYYX_PZ_JCX_01', status: 'failed', defectRef: 'shot_001', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] }),
      ],
    };
    const out = await run(input);
    expect(out.screenshots).toHaveLength(1);
    expect(out.screenshots[0].id).toBe('shot_001');
    expect(out.screenshots[0].caseNo).toBe('QYYX_PZ_JCX_01');
    expect(out.screenshots[0].path).toBe('screenshots/shot_001.png');
    expect(out.defectTable.flat()[0].screenshotRef).toBe('shot_001');
  });

  it('边界：无失败用例 → 空表空截图', async () => {
    const out = await run({ executionReport: [make({ caseNo: 'A_01', status: 'passed' })] });
    expect(out.defectTable).toEqual([]);
    expect(out.screenshots).toEqual([]);
  });

  it('边界：失败用例无截图 → screenshotRef 缺省、screenshots 不含', async () => {
    const out = await run({
      executionReport: [make({ caseNo: 'A_01', status: 'failed', steps: [{ step: 'S1', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }] })],
    });
    expect(out.screenshots).toEqual([]);
    expect(out.defectTable.flat()[0].screenshotRef).toBeUndefined();
  });
});
