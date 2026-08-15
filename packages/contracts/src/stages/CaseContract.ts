/**
 * @file CaseContract.ts
 * @description 测试用例生成 stage 的 I/O 契约（八列 + meta + 选中模块/全部 + 复杂逻辑分层）
 * @input CaseInput @output CaseOutput
 * @frozen v1.0
 */
import type { CaseRow } from '../types/CaseRow';
import type { CaseSheet, MetaHeader } from '../types/CaseSheet';
import type { FeatureRow } from '../types/FeatureRow';
import type { AIConfigRef, QualityGateIssue } from '../types/shared';

/** 输入（冻结） */
export interface CaseInput {
  /** 已确认功能点表 */
  featureTable: FeatureRow[][];
  /** 生成范围 */
  scope: 'selected_modules' | 'all';
  /** 选中模块 ID（scope=selected_modules 时必填） */
  selectedModuleIds?: string[];
  /** meta 头配置 */
  metaConfig: MetaHeader;
  /** AI 配置引用（可选） */
  aiConfig?: AIConfigRef;
}

/** 输出（冻结） */
export interface CaseOutput {
  /** 用例工作簿（一子系统一 sheet） */
  caseWorkbook: CaseSheet[];
  /** 八列用例数据 */
  caseRows: CaseRow[][];
  /** 可编辑 meta 头 */
  metaHeader: MetaHeader;
  /** 质量门问题 */
  qualityGateIssues: QualityGateIssue[];
  /** 是否检测到复杂逻辑 */
  complexLogicDetected: boolean;
}

/** run 函数签名（冻结） */
export type CaseRun = (input: CaseInput) => Promise<CaseOutput>;
