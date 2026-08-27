/**
 * @file merge.ts
 * @description 产物合并策略（spec §12）：all 整体替换 / selected_modules 追加缺失 / regenerate_selected 定点替换。
 *              合并后再由强校验把关。普通选中生成遇到已存在 testPointId 必须跳过（由快照器处理）。
 */
import { CASE_COLUMN_WIDTHS, type CaseRow, type CaseSheet, type MetaHeader } from '@test-platform/contracts';

export function extractCaseRows(workbook: CaseSheet[] | undefined): CaseRow[] {
  return (workbook ?? []).flatMap((s) => s.rows);
}

export interface MergeOptions {
  current: CaseSheet[];
  batchGenerated: CaseRow[];
  scope: 'all' | 'selected_modules';
  regenerateSelected: boolean;
  /** featureId -> 子系统（sheet 键），用于分组 */
  featureIdModuleMap: Record<string, string>;
  meta: MetaHeader;
  colWidths?: number[];
  /** 当前已确认功能点 ID；历史 workbook 中不属于此快照的行不得继续流入产物。 */
  allowedFeatureIds?: Set<string>;
}

/** 将 CaseRow 列表按 featureIdModuleMap 分组为 CaseSheet（保持出现顺序，sheet 按首次出现排序） */
export function groupIntoWorkbook(
  rows: CaseRow[],
  featureIdModuleMap: Record<string, string>,
  meta: MetaHeader,
  colWidths?: number[],
): CaseSheet[] {
  const order: string[] = [];
  const buckets = new Map<string, CaseRow[]>();
  for (const row of rows) {
    const key = featureIdModuleMap[row.featureId] ?? 'DEFAULT';
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(row);
  }
  return order.map((sheetName) => ({
    sheetName,
    meta: { ...meta },
    rows: buckets.get(sheetName)!,
    colWidths: colWidths ?? CASE_COLUMN_WIDTHS,
  }));
}

export function mergeCaseProducts(opts: MergeOptions): CaseSheet[] {
  const { current, batchGenerated, scope, regenerateSelected, featureIdModuleMap, meta, colWidths, allowedFeatureIds } = opts;
  const batchFeatureIds = new Set(batchGenerated.map((r) => r.featureId));

  if (scope === 'all') {
    // 全量：整体替换当前完整产物
    return groupIntoWorkbook(batchGenerated, featureIdModuleMap, meta, colWidths);
  }

  const selectedSheetNames = new Set(Object.values(featureIdModuleMap));
  const isCanonicalRow = (row: CaseRow, sheetName: string): boolean => {
    if (allowedFeatureIds && !allowedFeatureIds.has(row.featureId) && selectedSheetNames.has(sheetName)
      && row.manualEdited !== true && row.origin !== 'user_edited') return false;
    if (row.caseNo !== row.featureId) return false;
    if (/_(?:N[1-5]|A\d{2})$/.test(row.caseNo)) return false;
    return true;
  };
  const merged = structuredClone(current).map((sheet) => ({
    ...sheet,
    rows: sheet.rows.filter((row) => isCanonicalRow(row, sheet.sheetName)),
  })).filter((sheet) => sheet.rows.length > 0);
  if (regenerateSelected) {
    for (const sheet of merged) {
      sheet.rows = sheet.rows.filter((row) => !batchFeatureIds.has(row.featureId));
    }
  }

  for (const generatedSheet of groupIntoWorkbook(batchGenerated, featureIdModuleMap, meta, colWidths)) {
    const existingIndex = merged.findIndex((sheet) => sheet.sheetName === generatedSheet.sheetName);
    if (existingIndex === -1) {
      merged.push(generatedSheet);
      continue;
    }
    const existing = merged[existingIndex];
    if (existing) {
      merged[existingIndex] = { ...existing, rows: [...existing.rows, ...generatedSheet.rows] };
    }
  }
  return merged;
}
