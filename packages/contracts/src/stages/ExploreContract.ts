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
  /** 目标系统 URL（探索时先导航到此地址） */
  systemUrl?: string;
  /** 断点续跑 checkpoint ID */
  resumeFrom?: string;
  /** 人工补充数据 */
  manualSupplement?: ManualSupplement;
  /** @新增 只读点击安全策略：strict=仅放行 a[href]/dialog/safe-opener（默认）；allow_all=放行所有非写操作按钮（新增/详情/查询等），仍拦截提交/保存/删除/导出/导入/审核等写操作与危险导航 */
  readOnlyClickPolicy?: 'strict' | 'allow_all';
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
