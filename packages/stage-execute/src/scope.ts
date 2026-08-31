/**
 * @file scope.ts
 * @description 执行范围（selected_modules | all）过滤
 * @contract ExecuteInput.scope / selectedModuleIds
 * @frozen v1.0
 */
import type { CaseSheet, ExecuteInput } from '@test-platform/contracts';

/**
 * 按 scope 过滤用例表。
 * - all：返回全部 sheet
 * - selected_modules：仅保留 sheetName ∈ selectedModuleIds 的 sheet
 *
 * @param input - 执行输入
 * @returns 命中范围的用例 sheet 列表
 */
export function filterByScope(input: ExecuteInput): CaseSheet[] {
  if (input.scope !== 'selected_modules') return input.caseWorkbook;

  const ids = new Set(input.selectedModuleIds ?? []);
  return input.caseWorkbook.filter(sheet => ids.has(sheet.sheetName));
}
