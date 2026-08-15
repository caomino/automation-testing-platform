/**
 * @file CaseRow.ts
 * @description 测试用例行类型 — 八列可见数据 + 绑定元数据（隐藏，不写入 Excel）
 * @contract CaseOutput.caseRows
 * @frozen v1.0
 */

/** 用例列索引（八列固定顺序） */
export interface CaseColumnIndexes {
  /** 列 0: 用例编号（= 测试点标识_NN） */
  caseNo: number;
  /** 列 1: 测试内容（= 功能点.测试点） */
  content: number;
  /** 列 2: 步骤（Step1, Step2...） */
  step: number;
  /** 列 3: 输入及操作说明 */
  operation: number;
  /** 列 4: 预期结果 */
  expected: number;
  /** 列 5: 初次测试结果 */
  firstResult: number;
  /** 列 6: 回归测试结果 */
  regressionResult: number;
  /** 列 7: 测试结论 */
  conclusion: number;
}

/** 默认列索引 */
export const DEFAULT_CASE_COLUMNS: CaseColumnIndexes = {
  caseNo: 0,
  content: 1,
  step: 2,
  operation: 3,
  expected: 4,
  firstResult: 5,
  regressionResult: 6,
  conclusion: 7,
};

/**
 * 默认列宽（对齐主规格 §5.4 八列列宽 `[18,16,8,34,34,14,14,12]`）
 * 该值与金标准《区域影像测试用例.xls》`testProcessWorkbook.ts` 契约一致（审核报告 §D 已核实）。
 * ⚠ round-trip 导出必须以导入的原始列宽为准（CaseSheet.colWidths），本常量仅作新建空表默认值。
 */
export const CASE_COLUMN_WIDTHS: number[] = [18, 16, 8, 34, 34, 14, 14, 12];

/** 测试用例行 */
export interface CaseRow {
  // === 八列可见数据 ===
  /** 用例编号（= 测试点标识_NN，如 QYYX_PZ_JCX_01） */
  caseNo: string;
  /** 测试内容（= 功能点.测试点，如"查询"） */
  content: string;
  /** 步骤（Step1, Step2...） */
  step: string;
  /** 输入及操作说明 */
  operation: string;
  /** 预期结果 */
  expected: string;
  /** 初次测试结果（初始为 \） */
  firstResult: string;
  /** 回归测试结果（初始为 \） */
  regressionResult: string;
  /** 测试结论（初始为 \） */
  conclusion: string;

  // === 绑定元数据（隐藏，不写入 Excel） ===
  /** 行唯一 ID */
  id: string;
  /** 绑定的功能点 ID（= 功能点表"测试点标识"列完整值 base_NN，如 QYYX_PZ_JCX_01） */
  featureId: string;
  /** 绑定的测试点（功能点.测试点，如"查询"） */
  targetTestPoint: string;
  /** 场景 ID（模板场景标识） */
  scenarioId?: string;
  /** 探索证据 ID */
  evidenceId?: string;
  /** 证据级别 */
  evidenceLevel?: 'observed' | 'derived' | 'needs_review';
  /** 来源 */
  origin?: 'system_generated' | 'user_edited' | 'user_added' | 'confirmed' | 'imported';
  /** 质量级别 */
  quality?: 'high' | 'low' | 'conflict';
  /** needs_review 标记 */
  needsReview?: boolean;
  /** review 原因 */
  reviewReason?: string;
  /** 置信度（0-1） */
  confidence?: number;
  /** 人工编辑标记 */
  manualEdited?: boolean;
  /** 质量门状态 */
  qualityGateStatus?: string;
}
