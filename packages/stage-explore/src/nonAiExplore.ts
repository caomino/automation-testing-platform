/**
 * @file nonAiExplore.ts
 * @description 非 AI 探索实现（P-A / 双模式之「关闭 AI」侧）。
 *
 * 隔离硬约束（design §3）：本文件**不得** import `aiExplore.ts` / `infra-ai` / `AIClient` 值级实现。
 * 与 AI 侧唯一交汇点是入参 `engine: McpEngine` 与出参 `ModuleNode[]`。
 *
 * 职责：驱动「无权限多级降级融合管线」（menuFusion.buildModuleTreeViaDegradation）。
 * 该管线以**前端产物（SPA 路由 / JS 分包 / DOM 菜单）**为主源逐级降级，不依赖 RBAC 权限，
 * 因而低权限账号也能发现全部子目录与功能点；粒度闸门（assertActionGranularity）
 * 统一在 stage-explore `run` 中施加，两种模式共用。
 */
import type { McpEngine } from '@test-platform/engine-mcp';
import type { ModuleNode } from '@test-platform/contracts';
import {
  buildModuleTreeViaDegradation,
  emptyPlaceholderNode,
  formatDegradationSummary,
} from './menuFusion.js';

/** 非 AI 探索上下文（融合管线所需的 subsystemId / startUrl） */
export interface NonAiExploreContext {
  subsystemId: string;
  startUrl?: string;
}

/**
 * 非 AI 探索主流程。
 * @param engine 已启动的引擎（复用登录浏览器或自建 headless，由调用方决定）
 * @param ctx 融合管线上下文；缺省 subsystemId 用 'unknown'
 * @returns 模块树（含子目录 page 节点 + 操作级 action 功能点，来源于无权限前端探测）
 */
export async function exploreNonAi(
  engine: McpEngine,
  ctx: NonAiExploreContext = { subsystemId: 'unknown' },
): Promise<ModuleNode[]> {
  const { tree, degradations } = await buildModuleTreeViaDegradation(engine, {
    subsystemId: ctx.subsystemId,
    startUrl: ctx.startUrl,
  });
  // 说明「为什么降级」：把降级链打印到日志，便于运行时直接看到每级降级根因
  if (degradations.length) {
    console.warn(`[explore][降级链] ${formatDegradationSummary(degradations)}`);
  }
  // P0-1：所有来源都无产出时返回占位根（标 needs_review + 降级原因），保证管线永远产出、不崩
  if (tree.length > 0) return tree;
  return [emptyPlaceholderNode(ctx.subsystemId, degradations)];
}
