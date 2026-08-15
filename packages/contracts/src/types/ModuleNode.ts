/**
 * @file ModuleNode.ts
 * @description 模块树节点类型 — 探索阶段的输出
 * @contract ExploreOutput.moduleTree
 * @frozen v1.0 — 字段只允许加可选字段，不允许删/改类型
 */

/** 模块树节点 */
export interface ModuleNode {
  /** 节点唯一 ID（UUID 或路径哈希） */
  id: string;
  /** 显示名称（如"检查室列表"、"关键字查询"） */
  label: string;
  /** 父节点 ID，根节点为 null */
  parentId: string | null;
  /** 所属子系统 ID */
  subsystemId: string;
  /** 节点类型 */
  type: 'system' | 'module' | 'page' | 'action';
  /** 探索状态 */
  status: 'covered' | 'needs_review' | 'unexplored';
  /** 子节点 */
  children: ModuleNode[];
  /** 页面 URL（type=page 时有值） */
  url?: string;
  /** 页面标题（type=page 时有值） */
  pageTitle?: string;
  /** 探索证据 ID（关联到探索快照） */
  evidenceId?: string;
  /** 树深度（根=0） */
  depth: number;
  /** 人工补充标记 */
  manuallyAdded?: boolean;
  /** needs_review 原因 */
  reviewReason?: string;
}
