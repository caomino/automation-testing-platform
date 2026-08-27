/**
 * @file coveragePlanner.ts
 * @description 五类覆盖模型（spec §8）：五类是覆盖维度，不是五条用例。
 *              将细粒度 coverageKey 归类到 normal/boundary/exception/process/permission，
 *              对每类给出 covered / not_applicable / needs_review 结论。
 */
import type { ActionKind, CoverageManifest, FeatureEvidence } from '@test-platform/contracts';
import type { CoverageCategory, CoverageDecision } from '@test-platform/contracts';

/** 权限类（明确覆盖角色/权限拒绝） */
const PERMISSION_KEYS = new Set([
  'auth.allow', 'auth.deny', 'permission.allow', 'permission.deny',
  'list.permission', 'query.permission', 'create.permission', 'update.permission',
  'delete.permission', 'batch_delete.permission', 'import.permission', 'export.permission',
  'detail.permission', 'workflow.permission',
]);

/** 异常类（非法/缺失输入、取消、确认、关联限制、错误行） */
const EXCEPTION_KEYS = new Set([
  'create.cancel', 'update.cancel', 'delete.cancel', 'batch_delete.cancel',
  'delete.confirm', 'batch_delete.confirm', 'delete.relation', 'delete.soft_delete',
  'import.error_rows', 'import.duplicate', 'import.file_type',
  'export.format', 'export.range', 'query.performance',
]);

/** 边界类（长度/范围/枚举/格式、唯一性、日期/模糊/组合/空查询、API 参数与响应） */
const BOUNDARY_KEYS = new Set([
  'create.uniqueness', 'query.date_range', 'query.fuzzy', 'query.combination', 'query.empty', 'query.clear',
]);

/** 流程类（工作流状态转换/角色/前后置） */
const PROCESS_KEYS = new Set([
  'workflow.entry', 'workflow.transition', 'workflow.permission',
]);

/** 将细粒度 coverageKey 归类到五类之一；优先级 permission > exception > boundary > process > normal。 */
export function classifyCoverageKey(key: string, _actionKind: ActionKind): CoverageCategory {
  if (PERMISSION_KEYS.has(key) || key.endsWith('.permission')) return 'permission';
  if (EXCEPTION_KEYS.has(key) || /\.(required|pattern)$/.test(key)) return 'exception';
  if (
    BOUNDARY_KEYS.has(key)
    || /\.(length|range|enum|format)(?:\.|$)/.test(key)
    || /\.(required|pattern|readonly)(?:\.|$)/.test(key)
    || key.startsWith('api.parameter.')
    || key.startsWith('api.body')
    || key.startsWith('api.response.')
  ) return 'boundary';
  if (PROCESS_KEYS.has(key) || key.startsWith('workflow.transition.') || key.startsWith('workflow.role.') || key.startsWith('workflow.precondition.') || key.startsWith('workflow.postcondition.')) return 'process';
  return 'normal';
}

export interface CoveragePlan {
  decisions: Record<CoverageCategory, CoverageDecision>;
  reasons: string[];
}

/** 基于证据 manifest 计算五类覆盖结论（spec §8） */
export function planCoverage(
  actionKind: ActionKind,
  evidence: FeatureEvidence | undefined,
): CoveragePlan {
  const manifest: CoverageManifest | undefined = evidence?.coverageManifest;
  const dynamicKeys = evidence ? [
    ...evidence.coverageKeys,
    ...evidence.actionEntries
      .filter((entry) => entry.observed && !evidence.coverageKeys.some((key) => key.startsWith(`${entry.actionKind}.`)))
      .map((entry) => `${entry.actionKind}.entry`),
    ...(actionKind === 'create' && evidence.states.includes('create') ? ['create.ready'] : []),
    ...(actionKind === 'update' && evidence.states.includes('update') ? ['update.ready'] : []),
    ...(actionKind === 'detail' && evidence.states.includes('detail') ? ['detail.view'] : []),
    ...(actionKind === 'query' || actionKind === 'reset'
      ? evidence.fields.map((field) => `query.field.${field.name}`)
      : []),
    ...(actionKind === 'list' && evidence.tables[0]
      ? [
        'list.display',
        ...(evidence.tables[0].columns.length > 0 ? ['list.headers'] : []),
        ...(evidence.tables[0].hasEmptyState ? ['list.empty'] : []),
        ...(evidence.tables[0].hasPagination ? ['list.pagination'] : []),
        ...(evidence.tables[0].hasSorting || (evidence.tables[0].sortableColumns?.length ?? 0) > 0 ? ['list.sort'] : []),
        ...evidence.tables[0].columns.map((column) => `list.column.${column}`),
        ...(evidence.tables[0].sortableColumns ?? []).map((column) => `list.sort.${column}`),
        ...(evidence.tables[0].filterFields ?? []).map((field) => `list.search.${field}`),
      ]
      : []),
    ...evidence.fields.flatMap((field) => [
      ...(field.required ? [`${actionKind}.required.${field.name}`] : []),
      ...(field.pattern ? [`${actionKind}.pattern.${field.name}`] : []),
      ...(field.minLength !== undefined || field.maxLength !== undefined ? [`${actionKind}.length.${field.name}`] : []),
      ...(field.minimum !== undefined || field.maximum !== undefined ? [`${actionKind}.range.${field.name}`] : []),
      ...(field.options?.length ? [`${actionKind}.enum.${field.name}`] : []),
      ...(actionKind === 'update' && field.readonly ? [`update.readonly.${field.name}`] : []),
    ]),
  ] : [];
  const requiredKeys = manifest?.requiredKeys ?? [...new Set(dynamicKeys)];
  const observedKeys = new Set(manifest?.observedKeys ?? dynamicKeys);

  const decisions = {} as Record<CoverageCategory, CoverageDecision>;
  const reasons: string[] = [];

  (['normal', 'boundary', 'exception', 'process', 'permission'] as CoverageCategory[]).forEach((category) => {
    const inCat = requiredKeys.filter((k) => classifyCoverageKey(k, actionKind) === category);
    if (inCat.length === 0) {
      decisions[category] = 'not_applicable';
      return;
    }
    const observed = inCat.filter((k) => observedKeys.has(k));
    if (observed.length > 0) {
      decisions[category] = 'covered';
      reasons.push(`[${category}] 已覆盖：${observed.join('、')}`);
    } else {
      decisions[category] = 'needs_review';
      reasons.push(`[${category}] 业务适用但证据不足：${inCat.join('、')}`);
    }
  });

  return { decisions, reasons };
}
