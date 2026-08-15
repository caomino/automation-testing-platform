/**
 * @file ExploreContract.ts
 * @description 系统探索 stage 的 I/O 契约（MCP 遍历 + 模块树 CRUD + 人工补充）
 * @input ExploreInput @output ExploreOutput
 * @frozen v1.0
 */
import type { ModuleNode } from '../types/ModuleNode';
import type { ManualSupplement } from '../types/ManualSupplement';
import type { McpExplorationCheckpoint } from '../types/shared';
import type { SessionHandle } from '../types/SystemConfig';

/** 输入（冻结） */
export interface ExploreInput {
  /** 会话句柄 */
  sessionHandle: SessionHandle;
  /** 子系统 ID */
  subsystemId: string;
  /** 断点续跑 checkpoint ID */
  resumeFrom?: string;
  /** 人工补充数据 */
  manualSupplement?: ManualSupplement;
}

/** 输出（冻结） */
export interface ExploreOutput {
  /** 模块树 */
  moduleTree: ModuleNode[];
  /** 覆盖率 */
  coverage: { visited: number; total: number; frontier: string[] };
  /** needs_review 模块 ID 列表 */
  needsReview: string[];
  /** 断点 */
  checkpoint: McpExplorationCheckpoint;
}

/** run 函数签名（冻结） */
export type ExploreRun = (input: ExploreInput) => Promise<ExploreOutput>;
