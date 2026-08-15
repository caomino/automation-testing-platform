/**
 * @file case.verify.ts
 * @description stage-case 契约校验 + 真实生成逻辑验证（P1 绑定内核）
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import { run } from '../src/index';
import type { CaseInput, FeatureRow } from '@test-platform/contracts';
import { CASE_COLUMN_WIDTHS } from '@test-platform/contracts';

const baseMeta = {
  systemName: '区域影像系统',
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

describe('stage-case 骨架契约', () => {
  it('run 返回 CaseOutput 形状（空表占位，P1 待实现）', async () => {
    const input: CaseInput = {
      featureTable: [
        [['1', '功能性测试', '3.1', '区域影像系统', '检查室管理', '检查室', '查询', '查询', 'QYYX_PZ_JCX_01']],
      ],
      scope: 'all',
      metaConfig: baseMeta,
    };
    const out = await run(input);
    expect(Array.isArray(out.caseWorkbook)).toBe(true);
    expect(Array.isArray(out.caseRows)).toBe(true);
    expect(out.metaHeader).toEqual(baseMeta); // 可编辑 meta 头（值等价）
    expect(out.metaHeader).not.toBe(baseMeta); // 不再共享输入引用，round-trip 不污染
    expect(out.qualityGateIssues).toEqual([]);
    expect(out.complexLogicDetected).toBe(false);
  });
});

/** 构造一条功能点行（九列顺序） */
function fp(
  sequence: string,
  testType: string,
  systemName: string,
  mainModule: string,
  subModule: string,
  featureName: string,
  testPoint: string,
  testPointId: string,
): FeatureRow {
  return [
    sequence,
    testType,
    '3.1',
    systemName,
    mainModule,
    subModule,
    featureName,
    testPoint,
    testPointId,
  ];
}

describe('stage-case 真实生成逻辑', () => {
  const meta = { ...baseMeta };

  it('每个功能点生成 正常/边界/异常 三场景，用例编号绑定功能点标识', async () => {
    const input: CaseInput = {
      featureTable: [
        [fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    const rows = out.caseRows[0];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.scenarioId)).toEqual(['normal', 'boundary', 'exception']);
    // 用例编号 = 功能点测试点标识（4段）+ 场景后缀，sheet 内唯一
    const nos = rows.map((r) => r.caseNo);
    expect(nos).toEqual(['QYYX_PZ_JCX_01_N1', 'QYYX_PZ_JCX_01_N2', 'QYYX_PZ_JCX_01_N3']);
    expect(new Set(nos).size).toBe(3); // 每行唯一
    // 绑定断言：编号仍以功能点 4 段值为前缀，featureId 保持完整 4 段值
    for (const r of rows) {
      expect(r.caseNo.startsWith('QYYX_PZ_JCX_01_')).toBe(true);
      expect(r.featureId).toBe('QYYX_PZ_JCX_01');
      expect(r.content).toBe('查询'); // 测试点 → 测试内容
      expect(r.firstResult).toBe('\\');
      expect(r.regressionResult).toBe('\\');
      expect(r.conclusion).toBe('\\');
    }
  });

  it('八列逐字段断言（step/operation/expected 等完整填充）', async () => {
    const input: CaseInput = {
      featureTable: [
        [fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    const [normal, boundary, exception] = out.caseRows[0];
    // step 顺序
    expect([normal.step, boundary.step, exception.step]).toEqual(['Step1', 'Step2', 'Step3']);
    // operation / expected 场景化且非空
    expect(normal.operation).toContain('正常操作');
    expect(normal.expected).toContain('正常响应');
    expect(boundary.operation).toContain('边界值');
    expect(boundary.expected).toContain('边界条件');
    expect(exception.operation).toContain('异常数据');
    expect(exception.expected).toContain('错误提示');
    // 八列全字段存在性 + 初始占位
    for (const r of out.caseRows[0]) {
      expect(typeof r.caseNo).toBe('string');
      expect(typeof r.content).toBe('string');
      expect(typeof r.step).toBe('string');
      expect(r.operation.length).toBeGreaterThan(0);
      expect(r.expected.length).toBeGreaterThan(0);
      expect(r.firstResult).toBe('\\');
      expect(r.regressionResult).toBe('\\');
      expect(r.conclusion).toBe('\\');
    }
  });

  it('多子系统 => 一子系统一 sheet，caseRows 与 caseWorkbook 一致', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
          fp('2', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '新增', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    expect(out.caseWorkbook).toHaveLength(2);
    expect(out.caseRows).toHaveLength(2);
    // sheet 名取子系统，且行与 caseRows 同源（按输入顺序）
    const names = out.caseWorkbook.map((s) => s.sheetName);
    expect(names).toEqual(['检查室', '排班']);
    out.caseWorkbook.forEach((sheet, i) => {
      expect(sheet.rows).toBe(out.caseRows[i]);
      expect(sheet.colWidths).toEqual(CASE_COLUMN_WIDTHS);
    });
  });

  it('scope=selected_modules 仅生成选中子系统', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
          fp('2', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '新增', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'selected_modules',
      selectedModuleIds: ['排班'],
      metaConfig: meta,
    };
    const out = await run(input);
    expect(out.caseWorkbook).toHaveLength(1);
    expect(out.caseWorkbook[0].sheetName).toBe('排班');
    expect(out.caseRows[0][0].caseNo).toBe('QYYX_PZ_PB_01_N1');
  });

  it('meta 头可编辑（克隆而非共享引用，round-trip 不污染输入）', async () => {
    const input: CaseInput = {
      featureTable: [
        [fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')],
      ],
      scope: 'all',
      metaConfig: meta,
      aiConfig: { configId: 'cfg-1', enabled: false },
    };
    const out = await run(input);
    expect(out.metaHeader).toEqual(meta); // 值等价，仍可编辑
    expect(out.metaHeader).not.toBe(meta); // 非同一引用
    // 编辑输出不应污染原始输入
    out.metaHeader.testers = '改后';
    expect(meta.testers).toBe('张三');
    expect(out.qualityGateIssues).toEqual([]);
    expect(out.complexLogicDetected).toBe(false);
  });

  it('数据边界：缺失/空 testPointId 列 => 用例编号兜底空串', async () => {
    const emptyIdRow = fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', '');
    const input: CaseInput = {
      featureTable: [[emptyIdRow]],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    const rows = out.caseRows[0];
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.caseNo).toBe(''); // 兜底空串
      expect(r.featureId).toBe(''); // 绑定键同样兜底
    }
  });

  it('数据边界：selectedModuleIds 空数组 => 回退 all 生成全部', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
          fp('2', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '新增', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'selected_modules',
      selectedModuleIds: [], // 空 => 回退全量
      metaConfig: meta,
    };
    const out = await run(input);
    expect(out.caseWorkbook).toHaveLength(2); // 两个子系统均生成
  });
});
