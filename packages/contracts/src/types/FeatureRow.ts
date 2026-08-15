/**
 * @file FeatureRow.ts
 * @description 功能点行类型 — 九列固定顺序，严格遵循金标准《区域影像测试用例.xls》
 * @contract FeatureOutput.featureTable
 * @frozen v1.0
 */

/** 功能点列索引（九列固定顺序，列 0-8） */
export interface FeatureColumnIndexes {
  /** 列 0: 序号 */
  sequence: number;
  /** 列 1: 测试类型（功能性测试/性能测试/安全测试等） */
  testType: number;
  /** 列 2: 需求章节 */
  requirementSection: number;
  /** 列 3: 系统名称 */
  systemName: number;
  /** 列 4: 主模块（=父目录） */
  mainModule: number;
  /** 列 5: 子模块（=子系统） */
  subModule: number;
  /** 列 6: 功能点 */
  featureName: number;
  /** 列 7: 测试点 */
  testPoint: number;
  /** 列 8: 测试点标识（base_NN，4 段，行级唯一主键） */
  testPointId: number;
}

/** 默认列索引 */
export const DEFAULT_FEATURE_COLUMNS: FeatureColumnIndexes = {
  sequence: 0,
  testType: 1,
  requirementSection: 2,
  systemName: 3,
  mainModule: 4,
  subModule: 5,
  featureName: 6,
  testPoint: 7,
  testPointId: 8,
};

/** 功能点行 = 9 元素字符串数组 */
export type FeatureRow = string[];

/** 功能点行元数据（隐藏溯源，不参与编号） */
export interface FeatureProvenance {
  /** 溯源 ID（FP-<sha256>） */
  provenanceId: string;
  /** 关联的功能点行索引 */
  featureRowIndex: number;
  /** 来源（探索/AI/人工） */
  source: 'exploration' | 'ai_generated' | 'manual';
  /** 探索证据 ID */
  evidenceId?: string;
  /** 确认状态 */
  confirmed: boolean;
}
