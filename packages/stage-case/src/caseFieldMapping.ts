/**
 * @file caseFieldMapping.ts
 * @description 功能点行（九列）↔ 用例字段 的映射层（P1 绑定内核）
 *  集中维护"测试点标识 / 测试内容 / 子系统头"的取列逻辑，避免散落各处导致维度错位。
 */
import { DEFAULT_FEATURE_COLUMNS, type FeatureRow } from '@test-platform/contracts';

const FC = DEFAULT_FEATURE_COLUMNS;

/** 从功能点行取"测试点标识"（用例编号绑定键，4 段 base_NN） */
export const featureIdFromFeatureRow = (r: FeatureRow): string => r[FC.testPointId] ?? '';

/** 从功能点行取"测试内容"（= 测试点；缺失时回退功能点名） */
export const caseContentFromFeatureRow = (r: FeatureRow): string => r[FC.testPoint] || r[FC.featureName] || '';

/** 从功能点行抽取用例表头（子系统 sheet 的可编辑 meta 来源） */
export const mapFeatureRowToCaseHeader = (r: FeatureRow) => ({
  systemName: r[FC.systemName],
  mainModule: r[FC.mainModule],
  subModule: r[FC.subModule],
  featureName: r[FC.featureName],
  testPoint: r[FC.testPoint],
  testPointId: r[FC.testPointId],
});
