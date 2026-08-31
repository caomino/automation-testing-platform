/**
 * @file featureSnapshot.ts
 * @description 功能点快照器（spec §6.1）：冻结有序功能点列表、拒绝缺失/重复 testPointId、
 *              按 scope 过滤、普通选中模块排除已存在功能点、计算稳定指纹。
 */
import { DEFAULT_FEATURE_COLUMNS, type FeatureProfile, type FeatureRow, type ActionKind } from '@test-platform/contracts';

const FC = DEFAULT_FEATURE_COLUMNS;

export interface FeatureSnapshotItem {
  featureId: string;
  testPoint: string;
  mainModule: string;
  subModule: string;
  featureName: string;
  row: FeatureRow;
  profile?: FeatureProfile;
  fingerprint: string;
}

export interface SnapshotOptions {
  scope: 'all' | 'selected_modules';
  /** 当前任务冻结的系统身份，参与功能点指纹计算 */
  systemId?: string;
  selectedModuleIds?: string[];
  /** 当前已保存产物中的 featureId 集合；选中模块且非重生成时用于跳过已存在项 */
  existingFeatureIds?: Set<string>;
  /** 明确重新生成选中模块（定点替换，不跳过） */
  regenerateSelected?: boolean;
  featureProfiles?: FeatureProfile[];
  featurePaths?: Record<string, string>;
}

export interface SnapshotResult {
  /** 本批需要生成的功能点（保持输入顺序） */
  toGenerate: FeatureSnapshotItem[];
  /** 选中模块普通生成时被跳过的已存在功能点 */
  skippedExisting: FeatureSnapshotItem[];
}

export class FeatureSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureSnapshotValidationError';
  }
}

/** 稳定指纹：由 systemId + 九列内容 + 来源路径 + 动作档案稳定字段计算（spec §5.4） */
export function computeFeatureFingerprint(
  featureId: string,
  row: FeatureRow,
  profile?: FeatureProfile,
  path?: string,
  systemId = '',
): string {
  const canonical = JSON.stringify({
    systemId,
    featureId,
    featureRow: Array.from({ length: 9 }, (_, index) => row[index] ?? ''),
    profile: {
      featureId: profile?.featureId ?? featureId,
      testPoint: profile?.testPoint ?? '',
      actionKind: profile?.actionKind ?? '',
      pageUrl: profile?.pageUrl ?? '',
      clickSelector: profile?.clickSelector ?? '',
      parentModule: profile?.parentModule ?? '',
      subsystemId: profile?.subsystemId ?? '',
      sourceLabel: profile?.sourceLabel ?? '',
      sourceSelector: profile?.sourceSelector ?? '',
      source: profile?.source ?? '',
    },
    path: path ?? '',
  });
  return `fp_${djb2(canonical)}`;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 无档案时的关键词兜底识别（spec §7：关键词仅作辅助，仅在缺少明确动作语义时启用） */
export function inferActionKind(testPoint: string, featureName: string): ActionKind {
  const text = `${featureName} ${testPoint}`;
  if (/批量删除|批量移除/.test(text)) return 'batch_delete';
  if (/删除|移除|作废/.test(testPoint)) return 'delete';
  if (/导入/.test(text)) return 'import';
  if (/导出/.test(text)) return 'export';
  if (/新增|添加|创建|录入/.test(testPoint)) return 'create';
  if (/修改|编辑|更新/.test(testPoint)) return 'update';
  if (/详情|查看|浏览/.test(testPoint)) return 'detail';
  if (/查询|搜索|筛选|检索/.test(text)) return 'query';
  if (/重置|清空条件/.test(text)) return 'reset';
  if (/列表|展示|显示|记录/.test(testPoint)) return 'list';
  if (/审核|审批|复核|签核/.test(text)) return 'workflow';
  if (/权限|授权|角色/.test(text)) return 'permission';
  return 'other';
}

export function buildFeatureSnapshot(featureTable: FeatureRow[][], opts: SnapshotOptions): SnapshotResult {
  const profilesById = new Map((opts.featureProfiles ?? []).map((p) => [p.featureId, p]));
  const frozenRows = featureTable.flat();
  const seen = new Set<string>();
  const toGenerate: FeatureSnapshotItem[] = [];
  const skippedExisting: FeatureSnapshotItem[] = [];

  for (const row of frozenRows) {
    const featureId = row[FC.testPointId] ?? '';
    if (!featureId.trim()) {
      throw new FeatureSnapshotValidationError('featureTable.testPointId 不能为空');
    }
    if (seen.has(featureId)) {
      throw new FeatureSnapshotValidationError(`featureTable.testPointId 重复：${featureId}`);
    }
    seen.add(featureId);
  }

  if (opts.scope === 'selected_modules' && !opts.selectedModuleIds?.length) {
    return { toGenerate, skippedExisting };
  }

  for (const row of frozenRows) {
    const featureId = row[FC.testPointId] ?? '';

    const mainModule = row[FC.mainModule] ?? '';
    const subModule = row[FC.subModule] ?? '';
    const testPoint = row[FC.testPoint] ?? '';

    // scope 过滤
    if (opts.scope === 'selected_modules') {
      const selectedModuleIds = opts.selectedModuleIds;
      if (!selectedModuleIds) continue;
      const hit = selectedModuleIds.includes(mainModule) || selectedModuleIds.includes(subModule);
      if (!hit) continue;
    }

    const profile = profilesById.get(featureId);
    const path = opts.featurePaths?.[featureId];
    const item: FeatureSnapshotItem = {
      featureId,
      testPoint,
      mainModule,
      subModule,
      featureName: row[FC.featureName] ?? '',
      row,
      profile,
      fingerprint: computeFeatureFingerprint(featureId, row, profile, path, opts.systemId),
    };

    // 选中模块且非重生成：已存在则跳过（不覆盖人工编辑，不产生重复组）
    if (
      opts.scope === 'selected_modules'
      && !opts.regenerateSelected
      && opts.existingFeatureIds?.has(featureId)
    ) {
      skippedExisting.push(item);
      continue;
    }
    toGenerate.push(item); // 保持输入顺序
  }

  return { toGenerate, skippedExisting };
}
