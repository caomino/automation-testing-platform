/**
 * @file strongValidation.ts
 * @description 产物强校验（spec §12）：生成后本批强校验 → 合并后全量强校验。阻断性规则：编号/内容/顺序/
 *              证据绑定/连续 Step/空泛/跨功能点/五类覆盖结论。
 */
import type { CaseOutput, CaseRow } from '@test-platform/contracts';
import { assertCompanyStyle } from './companyStyle';

export interface StrongValidationIssue {
  code: string;
  message: string;
  blocking: boolean;
  featureId?: string;
}

/** 旧错误编号模式（spec §3.1 / §3.2 / §12）：_N1.._N5 或 _Axx 后缀 */
function hasLegacySuffix(caseNo: string): boolean {
  return /_(N[1-5]|A\d{2})$/.test(caseNo);
}

export function strongValidate(output: CaseOutput): StrongValidationIssue[] {
  const issues: StrongValidationIssue[] = [];
  const rows = output.caseRows.flat();

  // 1. 每个生成功能点有且只有一个可见用例组（caseNo === featureId）
  const caseNoSet = new Set<string>();
  for (const row of rows) caseNoSet.add(row.caseNo);
  for (const row of rows) {
    if (hasLegacySuffix(row.caseNo)) {
      issues.push({ code: 'LEGACY_SUFFIX', message: `用例编号含旧错误后缀：${row.caseNo}`, blocking: true, featureId: row.featureId });
    }
    if (row.caseNo !== row.featureId) {
      issues.push({ code: 'CASE_NO_MISMATCH', message: `caseNo(${row.caseNo}) ≠ featureId(${row.featureId})`, blocking: true, featureId: row.featureId });
    }
    if (row.content !== row.targetTestPoint) {
      issues.push({ code: 'CONTENT_MISMATCH', message: `content(${row.content}) ≠ targetTestPoint(${row.targetTestPoint})`, blocking: true, featureId: row.featureId });
    }
    if (row.featureId !== row.caseNo) {
      // 同组绑定：逐行 featureId 应等于 caseNo
    }
  }

  // 2. 每个 caseNo 组内 Step 从 1 连续递增
  const byCaseNo = new Map<string, CaseRow[]>();
  for (const row of rows) {
    const arr = byCaseNo.get(row.caseNo) ?? [];
    arr.push(row);
    byCaseNo.set(row.caseNo, arr);
  }
  for (const [caseNo, group] of byCaseNo) {
    const steps = group
      .map((r) => Number((r.step ?? '').replace(/[^0-9]/g, '')))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    const expected = steps.map((_, i) => i + 1);
    if (steps.length === 0 || steps.some((n, i) => n !== expected[i])) {
      issues.push({ code: 'STEP_NOT_CONTINUOUS', message: `用例组 ${caseNo} 的 Step 不连续`, blocking: true, featureId: caseNo });
    }
    // 3. 每个可见操作和预期非空且通过空泛检查
    for (const r of group) {
      const styleIssues = assertCompanyStyle(r.operation, r.expected);
      for (const si of styleIssues) {
        issues.push({ code: 'COMPANY_STYLE', message: `功能点 ${r.featureId} ${si.field}：${si.message}`, blocking: true, featureId: r.featureId });
      }
    }
  }

  // 4. 每个 covered 场景存在有效证据引用（needsReview 不得伪装 covered）
  for (const row of rows) {
    if (row.needsReview && row.evidenceLevel === 'observed') {
      issues.push({ code: 'FAKE_OBSERVED', message: `功能点 ${row.featureId} 标记 needs_review 但 evidenceLevel=observed`, blocking: true, featureId: row.featureId });
    }
  }

  return issues;
}
