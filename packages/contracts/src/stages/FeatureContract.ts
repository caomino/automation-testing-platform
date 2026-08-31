/**
 * @file FeatureContract.ts
 * @description 功能点审核 stage 的 I/O 契约（九列 + 合并 + 增删 + 整体确认）
 * @input FeatureInput @output FeatureOutput
 * @frozen v1.0
 */
import type { FeatureProvenance, FeatureRow } from '../types/FeatureRow';
import type { ModuleNode } from '../types/ModuleNode';
import type { DesignSource, FeatureEvidence, FeatureProfile } from '../types/TestDesign';

/** 输入（冻结） */
export interface FeatureInput {
  /** 模块树 */
  moduleTree: ModuleNode[];
  /** 系统名称 */
  systemName: string;
  /** 仅返回已确认功能点 */
  confirmedOnly: boolean;
  /** OpenAPI/workflow 等结构化设计源；自由文本不接受为 observed 证据。 */
  designSources?: DesignSource[];
}

/** 输出（冻结） */
export interface FeatureOutput {
  /** 九列功能点表（按模块分组） */
  featureTable: FeatureRow[][];
  /** 测试点标识列表（base_NN） */
  featureIds: string[];
  /** 溯源元数据 */
  provenance: FeatureProvenance[];
  /** 测试点标识 → 来源页面 URL（生成功能点时由模块树节点 url 带出，供用例阶段按所选模块探索） */
  featurePaths?: Record<string, string>;
  /** @新增 每个功能点的动作档案（消费 ModuleNode 明确语义，不重新分类） */
  featureProfiles?: FeatureProfile[];
  /** 结构化设计源及 Web 探索统一输出的按功能点隔离证据。 */
  featureEvidence?: Record<string, FeatureEvidence>;
}

/** run 函数签名（冻结） */
export type FeatureRun = (input: FeatureInput) => Promise<FeatureOutput>;
