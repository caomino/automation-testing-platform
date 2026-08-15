/**
 * @file FeatureContract.ts
 * @description 功能点审核 stage 的 I/O 契约（九列 + 合并 + 增删 + 整体确认）
 * @input FeatureInput @output FeatureOutput
 * @frozen v1.0
 */
import type { FeatureProvenance, FeatureRow } from '../types/FeatureRow';
import type { ModuleNode } from '../types/ModuleNode';

/** 输入（冻结） */
export interface FeatureInput {
  /** 模块树 */
  moduleTree: ModuleNode[];
  /** 系统名称 */
  systemName: string;
  /** 仅返回已确认功能点 */
  confirmedOnly: boolean;
}

/** 输出（冻结） */
export interface FeatureOutput {
  /** 九列功能点表（按模块分组） */
  featureTable: FeatureRow[][];
  /** 测试点标识列表（base_NN） */
  featureIds: string[];
  /** 溯源元数据 */
  provenance: FeatureProvenance[];
}

/** run 函数签名（冻结） */
export type FeatureRun = (input: FeatureInput) => Promise<FeatureOutput>;
