/**
 * @file caseRows.ts
 * @description 质量门兜底对齐（P1 三级对齐）：用例行 vs 功能点表 的一致性校验。
 *  - L1 数量：每个功能点应生成 SCENARIO_ORDER.length 条场景用例；
 *  - L2 编号：用例编号必须绑定功能点标识（前缀 = 测试点标识）；
 *  - L3 内容：测试内容必须等于功能点测试点。
 * 返回 QualityGateIssue[]（非阻塞，供前端/验收展示）。
 */
import { DEFAULT_FEATURE_COLUMNS, type CaseRow, type FeatureRow, type QualityGateIssue } from '@test-platform/contracts';
import { SCENARIO_ORDER } from './templateScenarioEngine';

const FC = DEFAULT_FEATURE_COLUMNS;

export function sanitizeCaseRowsAgainstFeatureRows(
  caseRows: CaseRow[][],
  featureTable: FeatureRow[][],
): QualityGateIssue[] {
  const issues: QualityGateIssue[] = [];

  const flat = featureTable.flat();
  const featureMap = new Map<string, FeatureRow>();
  for (const r of flat) {
    const id = r[FC.testPointId];
    if (id && !featureMap.has(id)) featureMap.set(id, r);
  }

  const counts = new Map<string, number>();
  const badBinding: string[] = [];
  const badContent: string[] = [];

  for (const sheet of caseRows) {
    for (const row of sheet) {
      if (row.featureId) counts.set(row.featureId, (counts.get(row.featureId) ?? 0) + 1);
      if (row.caseNo && row.featureId && !row.caseNo.startsWith(row.featureId)) badBinding.push(row.caseNo);
      const fr = row.featureId ? featureMap.get(row.featureId) : undefined;
      if (fr && row.content !== fr[FC.testPoint]) badContent.push(row.caseNo);
    }
  }

  // L1 数量
  for (const [fid, count] of counts) {
    if (count !== SCENARIO_ORDER.length) {
      issues.push({
        caseRowId: fid,
        type: '泛化',
        message: `功能点 ${fid} 应生成 ${SCENARIO_ORDER.length} 条场景用例，实际 ${count} 条`,
        blocking: false,
      });
    }
  }
  // L2 编号绑定
  for (const b of badBinding) {
    issues.push({ caseRowId: b, type: '越权', message: `用例编号 ${b} 未绑定功能点标识`, blocking: false });
  }
  // L3 内容对齐
  for (const b of badContent) {
    issues.push({ caseRowId: b, type: '缺证据', message: `用例 ${b} 测试内容未对齐功能点测试点`, blocking: false });
  }

  return issues;
}
