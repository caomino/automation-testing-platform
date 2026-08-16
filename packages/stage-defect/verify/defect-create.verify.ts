/**
 * @file defect-create.verify.ts
 * @description createDefect / normalize / 导入导出 校验（六列 + 环境归一 + round-trip）
 * @frozen v1.0（增补）
 */
import { describe, it, expect } from 'vitest';
import { DefectRowSchema } from '@test-platform/contracts';
import type { ExecutionResult } from '@test-platform/contracts';
import {
  createDefect,
  deriveEnvironment,
  deriveQualityAttribute,
  normalize,
  normalizeEnv,
  exportDefectsJSON,
  importDefectsJSON,
  exportDefectsTSV,
  importDefectsTSV,
  DEFECT_TSV_HEADER,
} from '../src';

describe('stage-defect 创建与导入导出', () => {
  it('createDefect：六列创建 + 环境归一（win11/chromium → Win11/Chrome）', () => {
    const row = createDefect({
      sequence: 1,
      description: '查询时脚本报错导致崩溃',
      environment: { os: 'win11', browser: 'chromium', version: '120', caseNo: 'QYYX_PZ_JCX_01', step: 'S2' },
      screenshotRef: 'shot_001',
    });
    expect(() => DefectRowSchema.parse(row)).not.toThrow();
    expect(row.sequence).toBe(1);
    // version 以 '·' 续接（无空格），对齐 SPEC 三段式分隔
    expect(row.environment).toBe('Win11·Chrome·120·QYYX_PZ_JCX_01/S2');
    expect(row.screenshotRef).toBe('shot_001');
    // 安全/崩溃类 → 高；质量特性 → 健壮性
    expect(row.level).toBe('高');
    expect(row.qualityAttribute).toBe('健壮性');
  });

  it('createDefect：无 version 时不产生多余分隔（三段式 os·browser·caseNo）', () => {
    const row = createDefect({
      sequence: 1,
      description: 'd',
      environment: { os: 'win11', browser: 'chrome', caseNo: 'QYYX_PZ_JCX_01' },
    });
    expect(row.environment).toBe('Win11·Chrome·QYYX_PZ_JCX_01');
  });

  it('deriveEnvironment：带 version 以 "·" 续接（无空格），并含失败步骤尾缀', () => {
    const result: ExecutionResult = {
      caseNo: 'QYYX_PZ_JCX_01',
      caseRowId: 'row_1',
      env: { os: 'win11', browser: 'chromium', version: '120' },
      status: 'failed',
      steps: [{ step: 'S2', operation: 'o', expected: 'e', actual: 'a', result: 'failed' }],
    };
    expect(deriveEnvironment(result)).toBe('Win11·Chrome·120·QYYX_PZ_JCX_01/S2');
    // 无 version 时无多余分隔
    const noVer: ExecutionResult = { ...result, env: { os: 'win11', browser: 'chromium' } };
    expect(deriveEnvironment(noVer)).toBe('Win11·Chrome·QYYX_PZ_JCX_01/S2');
  });

  it('deriveQualityAttribute：安全/权限/越权 → 安全性；其余分支覆盖', () => {
    expect(deriveQualityAttribute('存在越权访问风险')).toBe('安全性');
    expect(deriveQualityAttribute('权限校验失败')).toBe('安全性');
    expect(deriveQualityAttribute('安全漏洞')).toBe('安全性');
    expect(deriveQualityAttribute('用户密码以明文存储')).toBe('安全性'); // 数据类 → 安全
    expect(deriveQualityAttribute('脚本报错崩溃')).toBe('健壮性');
    expect(deriveQualityAttribute('列表样式乱码')).toBe('易用性');
    expect(deriveQualityAttribute('新增数据未保存')).toBe('功能正确性');
    // 未知类别 → 默认功能正确性
    expect(deriveQualityAttribute('无明显特征的一般缺陷')).toBe('功能正确性');
  });

  it('deriveLevel：安全/数据类关键词 → 高；其余按低/中分支分配', () => {
    const level = (desc: string) => {
      // deriveLevel 为纯函数，不对外导出（在 logic.ts 内部）；
      // 这里通过 createDefect 间接验证 level 分支正确性
      return createDefect({
        sequence: 1,
        description: desc,
        environment: { os: 'win11', browser: 'chrome', caseNo: 'X_01' },
      }).level;
    };
    expect(level('越权访问敏感数据')).toBe('高'); // 安全
    expect(level('用户数据被意外删除')).toBe('高'); // 数据丢失
    expect(level('提交时页面崩溃')).toBe('高'); // 崩溃
    expect(level('刷新后样式错乱')).toBe('低'); // 易用性
    expect(level('新增一条记录失败')).toBe('中'); // 默认分支
  });

  it('DEFECT_TSV_HEADER：六列完整列名与顺序（对齐冻结 docs 主规格）', () => {
    expect([...DEFECT_TSV_HEADER]).toEqual([
      '序号', '问题描述', '问题截图', '问题级别', '质量特性', '问题产生环境',
    ]);
    // 完整列名 + 顺序不变（冻结契约）
    expect(DEFECT_TSV_HEADER).toHaveLength(6);
    expect(DEFECT_TSV_HEADER[0]).toBe('序号');
    expect(DEFECT_TSV_HEADER[3]).toBe('问题级别');
    expect(DEFECT_TSV_HEADER[4]).toBe('质量特性');
    expect(DEFECT_TSV_HEADER[5]).toBe('问题产生环境');
  });

  it('createDefect：未给级别/质量特性时按描述推导（外观 → 低/易用性）', () => {
    const row = createDefect({
      sequence: 2,
      description: '刷新后列表样式乱码',
      environment: { os: 'mac', browser: 'safari', caseNo: 'OTHER_XX_01' },
    });
    expect(row.level).toBe('低');
    expect(row.qualityAttribute).toBe('易用性');
  });

  it('createDefect：显式级别/质量特性优先于推导', () => {
    const row = createDefect({
      sequence: 3,
      description: '脚本报错',
      environment: { os: 'linux', browser: 'firefox', caseNo: 'A_01' },
      level: '中',
      qualityAttribute: '功能正确性',
    });
    expect(row.level).toBe('中');
    expect(row.qualityAttribute).toBe('功能正确性');
    expect(row.environment).toBe('Linux·Firefox·A_01');
  });

  it('normalizeEnv：别名归一覆盖 win/windows/win11、chrome/chromium、mac', () => {
    expect(normalizeEnv('win', 'chrome')).toEqual({ os: 'Win11', browser: 'Chrome' });
    expect(normalizeEnv('windows', 'chromium')).toEqual({ os: 'Win11', browser: 'Chrome' });
    expect(normalizeEnv('macos', 'safari')).toEqual({ os: 'macOS', browser: 'Safari' });
    expect(normalizeEnv('ubuntu', 'firefox')).toEqual({ os: 'Linux', browser: 'Firefox' });
  });

  it('normalize：整段环境字符串归一（保留用例号/步骤尾缀）', () => {
    expect(normalize('win11·chromium·QYYX_PZ_JCX_01/S2')).toBe('Win11·Chrome·QYYX_PZ_JCX_01/S2');
    expect(normalize('mac·edge·A_01')).toBe('macOS·Edge·A_01');
    // 段不足两段原样返回
    expect(normalize('Win11')).toBe('Win11');
  });

  it('JSON 导入导出 round-trip 保真（顺序/内容一致）', () => {
    const table = [
      [
        createDefect({ sequence: 1, description: 'd1', environment: { os: 'win11', browser: 'chrome', caseNo: 'M_01' } }),
        createDefect({ sequence: 2, description: 'd2', environment: { os: 'mac', browser: 'safari', caseNo: 'M_02' } }),
      ],
    ];
    const json = exportDefectsJSON(table);
    const back = importDefectsJSON(json);
    expect(back).toHaveLength(2);
    expect(back[0].environment).toBe('Win11·Chrome·M_01');
    expect(back[1].environment).toBe('macOS·Safari·M_02');
    expect(back).toEqual(table.flat());
  });

  it('TSV 导入导出 round-trip 保真（Excel 友好）', () => {
    const table = [
      [createDefect({ sequence: 1, description: 'd1', environment: { os: 'win11', browser: 'chrome', caseNo: 'M_01' }, screenshotRef: 's1' })],
    ];
    const tsv = exportDefectsTSV(table);
    expect(tsv.startsWith('序号\t问题描述\t问题截图')).toBe(true);
    const back = importDefectsTSV(tsv);
    expect(back).toHaveLength(1);
    expect(back[0].screenshotRef).toBe('s1');
    expect(back[0].environment).toBe('Win11·Chrome·M_01');
    expect(back).toEqual(table.flat());
  });
});
