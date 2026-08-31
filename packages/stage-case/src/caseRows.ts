/**
 * @file caseRows.ts
 * @description 质量门兜底对齐（P1 三级对齐）：用例行 vs 功能点表 的一致性校验。
 *  - L1 数量：每个功能点应生成 SCENARIO_ORDER.length 条场景用例；
 *  - L2 编号：用例编号必须绑定功能点标识（前缀 = 测试点标识）；
 *  - L3 内容：测试内容必须等于功能点测试点。
 * 返回 QualityGateIssue[]（非阻塞，供前端/验收展示）。
 */
import { DEFAULT_FEATURE_COLUMNS, type CaseRow, type FeatureEvidence, type FeatureProfile, type FeatureRow, type QualityGateIssue } from '@test-platform/contracts';
import { buildCoverageManifest } from './actionScenarioEngine';

const FC = DEFAULT_FEATURE_COLUMNS;

export function sanitizeCaseRowsAgainstFeatureRows(
  caseRows: CaseRow[][],
  featureTable: FeatureRow[][],
  featureProfiles?: FeatureProfile[],
  featureEvidence?: Record<string, FeatureEvidence>,
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
  const scenarioIds = new Set<string>();
  const coverageIds = new Set<string>();

  for (const sheet of caseRows) {
    for (const row of sheet) {
      if (!row.id?.trim()) issues.push({ caseRowId: row.caseNo || 'unknown', type: '缺证据', message: '用例缺少行标识 id', blocking: true });
      if (!row.featureId?.trim()) {
        issues.push({ caseRowId: row.id || row.caseNo || 'unknown', type: '缺证据', message: '用例缺少 featureId', blocking: true });
      } else if (!featureMap.has(row.featureId)) {
        issues.push({ caseRowId: row.id, type: '越权', message: `用例关联了未知功能点：${row.featureId}`, blocking: true });
      }
      if (!row.scenarioId?.trim()) issues.push({ caseRowId: row.id, type: '缺证据', message: `功能点 ${row.featureId} 的用例缺少 scenarioId`, blocking: true });
      if (!row.coverageKeys?.length) issues.push({ caseRowId: row.id, type: '缺证据', message: `功能点 ${row.featureId} 的用例缺少 coverageKeys`, blocking: true });
      if (row.featureId) counts.set(row.featureId, (counts.get(row.featureId) ?? 0) + 1);
      if (row.caseNo && row.featureId && !row.caseNo.startsWith(row.featureId)) badBinding.push(row.caseNo);
      const fr = row.featureId ? featureMap.get(row.featureId) : undefined;
      if (fr && row.content !== fr[FC.testPoint]) badContent.push(row.caseNo);
      if (row.content !== row.targetTestPoint) badContent.push(row.caseNo);
      const visible = [row.caseNo, row.content, row.step, row.operation, row.expected, row.firstResult, row.regressionResult, row.conclusion];
      if (visible.some((value) => !value?.trim())) {
        issues.push({ caseRowId: row.id, type: '缺证据', message: `用例 ${row.id} 八列可见字段不完整`, blocking: true });
      }
      if (row.scenarioId) {
        const key = `${row.featureId}:${row.scenarioId}`;
        if (scenarioIds.has(key)) issues.push({ caseRowId: row.id, type: '泛化', message: `功能点 ${row.featureId} 的 scenarioId 重复：${row.scenarioId}`, blocking: true });
        scenarioIds.add(key);
      }
      for (const coverageKey of row.coverageKeys ?? []) {
        const key = `${row.featureId}:${coverageKey}`;
        if (coverageIds.has(key)) issues.push({ caseRowId: row.id, type: '泛化', message: `功能点 ${row.featureId} 的 coverageKey 重复：${coverageKey}`, blocking: true });
        coverageIds.add(key);
      }
      if (row.needsReview && !row.reviewReason) {
        issues.push({ caseRowId: row.id, type: '缺证据', message: `功能点 ${row.featureId} 的待复核用例缺少原因`, blocking: true });
      }
    }
  }

  const profiles = new Map((featureProfiles ?? []).map((profile) => [profile.featureId, profile]));
  // feature-driven：场景数量动态（由证据决定），不再强制固定条数；仅对无档案且无 coverageKeys 的功能点提示。
  for (const [fid, count] of counts) {
    if (count === 0) {
      issues.push({
        caseRowId: fid,
        type: '泛化',
        message: `功能点 ${fid} 未生成任何用例步骤`,
        blocking: false,
      });
    }
  }
  for (const [featureId, profile] of profiles) {
    const feature = featureMap.get(featureId);
    if (!feature) continue;
    const context = {
      subModule: feature[FC.subModule] ?? '',
      featureName: feature[FC.featureName] ?? '',
      testPoint: feature[FC.testPoint] ?? '',
    };
    const manifest = buildCoverageManifest(profile, featureEvidence?.[featureId], context);
    const actualKeys = new Set<string>();
    const observedActualKeys = new Set<string>();
    for (const row of caseRows.flat().filter((item) => item.featureId === featureId)) {
      for (const key of row.coverageKeys ?? []) {
        actualKeys.add(key);
        if (!row.needsReview && row.evidenceLevel !== 'needs_review') observedActualKeys.add(key);
      }
    }
    for (const coverageKey of manifest.requiredKeys) {
      if (!actualKeys.has(coverageKey)) {
        issues.push({
          caseRowId: featureId,
          type: '缺证据',
          message: `功能点 ${featureId} 缺少 coverageKey：${coverageKey}`,
          blocking: manifest.observedKeys.includes(coverageKey),
        });
      } else if (manifest.observedKeys.includes(coverageKey) && !observedActualKeys.has(coverageKey)) {
        issues.push({
          caseRowId: featureId,
          type: '缺证据',
          message: `功能点 ${featureId} 的 observed coverageKey 仅由待复核用例承载：${coverageKey}`,
          blocking: true,
        });
      }
    }
  }
  // L2 编号绑定
  for (const b of badBinding) {
    issues.push({ caseRowId: b, type: '越权', message: `用例编号 ${b} 未绑定功能点标识`, blocking: true });
  }
  // L3 内容对齐
  for (const b of new Set(badContent)) {
    issues.push({ caseRowId: b, type: '缺证据', message: `用例 ${b} 测试内容未对齐功能点测试点`, blocking: true });
  }

  return issues;
}
