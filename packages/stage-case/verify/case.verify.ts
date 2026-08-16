/**
 * @file case.verify.ts
 * @description stage-case 契约校验 + 真实生成逻辑验证（P1 绑定内核）
 * @frozen v1.0
 */
import { describe, it, expect, afterEach } from 'vitest';
import { run, setAIClient } from '../src/index';
import type { CaseInput, FeatureRow } from '@test-platform/contracts';
import { CASE_COLUMN_WIDTHS } from '@test-platform/contracts';
import type { CaseAIClient } from '../src/aiCaseRows';

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

/** 测试收尾：复位 AI 客户端，避免跨用例泄漏 */
afterEach(() => {
  setAIClient(null);
});

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

const SCENARIO_KEYS = ['normal', 'boundary', 'exception', 'process', 'permission'] as const;
const SCENARIO_SUFFIX = ['_N1', '_N2', '_N3', '_N4', '_N5'] as const;

describe('stage-case 真实生成逻辑', () => {
  const meta = { ...baseMeta };

  it('每个功能点生成 正常/边界/异常/流程/权限 五类场景，用例编号绑定功能点标识', async () => {
    const input: CaseInput = {
      featureTable: [
        [fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    const rows = out.caseRows[0];
    expect(rows).toHaveLength(5); // 五类场景
    // 场景顺序固定：正常/边界/异常/流程/权限
    expect(rows.map((r) => r.scenarioId)).toEqual([...SCENARIO_KEYS]);
    // 用例编号 = 功能点测试点标识（4段）+ 场景后缀（_N1.._N5），sheet 内唯一
    const nos = rows.map((r) => r.caseNo);
    expect(nos).toEqual(['QYYX_PZ_JCX_01_N1', 'QYYX_PZ_JCX_01_N2', 'QYYX_PZ_JCX_01_N3', 'QYYX_PZ_JCX_01_N4', 'QYYX_PZ_JCX_01_N5']);
    expect(new Set(nos).size).toBe(5); // 每行唯一
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

  it('八列逐字段断言（step/operation/expected 等完整填充，五场景均覆盖）', async () => {
    const input: CaseInput = {
      featureTable: [
        [fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    const rows = out.caseRows[0];
    expect(rows).toHaveLength(5);

    for (const r of rows) {
      // step 为场景标签（Step_<场景键>）
      expect(r.step).toMatch(/^Step_(normal|boundary|exception|process|permission)$/);
      // 八列全字段存在性 + 初始占位
      expect(typeof r.caseNo).toBe('string');
      expect(typeof r.content).toBe('string');
      expect(r.operation.length).toBeGreaterThan(0);
      expect(r.expected.length).toBeGreaterThan(0);
      expect(r.firstResult).toBe('\\');
      expect(r.regressionResult).toBe('\\');
      expect(r.conclusion).toBe('\\');
    }

    const [normal, boundary, exception, process, permission] = rows;
    // 正常：访问/点击/录入 + 正常响应
    expect(normal.operation).toContain('访问');
    expect(normal.operation).toContain('点击');
    expect(normal.operation).toContain('录入');
    expect(normal.expected).toContain('正常响应');
    // 边界：边界值 + 边界条件处理
    expect(boundary.operation).toContain('录入');
    expect(boundary.operation).toContain('点击');
    expect(boundary.operation).toContain('边界值');
    expect(boundary.expected).toContain('边界条件');
    // 异常：非法数据 + 错误提示
    expect(exception.operation).toContain('录入');
    expect(exception.operation).toContain('点击');
    expect(exception.operation).toContain('选择');
    expect(exception.expected).toContain('错误提示');
    // 流程：前置关联 + 流程闭环
    expect(process.operation).toContain('前置');
    expect(process.expected).toContain('流程');
    // 权限：无权限账号 + 权限校验
    expect(permission.operation).toContain('无权限');
    expect(permission.expected).toContain('权限');
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
    // 每子系统 5 场景
    for (const sheet of out.caseWorkbook) expect(sheet.rows).toHaveLength(5);
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
    expect(out.caseWorkbook[0].rows).toHaveLength(5);
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
    expect(rows).toHaveLength(5);
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

  it('五场景共号：跨 sheet 的用例编号全局唯一（绑定完整 4 段标识 + _N1.._N5）', async () => {
    const input: CaseInput = {
      featureTable: [
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'),
        ],
        [
          fp('1', '功能性测试', '区域影像系统', '配置', '排班', '排班管理', '查询', 'QYYX_PZ_PB_01'),
        ],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    const allNos = out.caseRows.flat().map((r) => r.caseNo);
    expect(allNos).toHaveLength(10); // 2 子系统 × 5 场景
    expect(new Set(allNos).size).toBe(allNos.length); // 全表唯一
    out.caseRows.forEach((rows) => {
      expect(new Set(rows.map((r) => r.caseNo)).size).toBe(rows.length);
    });
    // 编号可绑定回功能点标识 + 场景后缀（_N1.._N5）
    expect(allNos.every((n) => /^(QYYX_PZ_(JCX|PB)_01)_(N1|N2|N3|N4|N5)$/.test(n))).toBe(true);
  });

  it('complexLogicDetected：当前占位为 false（字段语义完整、类型已对齐）', async () => {
    const input: CaseInput = {
      featureTable: [
        [fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')],
      ],
      scope: 'all',
      metaConfig: meta,
    };
    const out = await run(input);
    expect(typeof out.complexLogicDetected).toBe('boolean');
    expect(out.complexLogicDetected).toBe(false);
    expect(out.qualityGateIssues).toEqual([]);
  });

  it('AI 开启：注入 AI 客户端后生成带 needs_review 证据的用例；关闭：模板兜底', async () => {
    // 模板分支（默认，无 AI 客户端）
    const templateOut = await run({
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all',
      metaConfig: meta,
    });
    for (const r of templateOut.caseRows[0]) {
      expect(r.evidenceLevel).toBe('derived');
      expect(r.needsReview).toBeFalsy();
    }

    // AI 分支：注入一个兼容 infra-ai 的 mock 客户端
    const mockAI: CaseAIClient = {
      async complete() {
        return {
          text: '【操作步骤】\n1. 访问 [检查室] 页面\n2. 执行 [查询] 操作\n【预期结果】\n系统返回查询结果',
        };
      },
    };
    setAIClient(mockAI);
    const aiOut = await run({
      featureTable: [[fp('1', '功能性测试', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01')]],
      scope: 'all',
      metaConfig: meta,
    });
    expect(aiOut.caseRows[0]).toHaveLength(5);
    for (const r of aiOut.caseRows[0]) {
      expect(r.evidenceLevel).toBe('needs_review'); // 证据门：AI 生成需人工复核
      expect(r.needsReview).toBe(true);
      expect(r.caseNo.startsWith('QYYX_PZ_JCX_01_')).toBe(true); // 编号仍绑定功能点
      expect(r.content).toBe('查询');
    }
    expect(aiOut.qualityGateIssues).toEqual([]); // 绑定/数量/内容三级对齐通过
    setAIClient(null);
  });
});
