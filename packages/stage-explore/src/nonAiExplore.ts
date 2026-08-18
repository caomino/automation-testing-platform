/**
 * @file nonAiExplore.ts
 * @description 非 AI 探索实现（P-A / 双模式之「关闭 AI」侧）。
 *
 * 隔离硬约束（design §3）：本文件**不得** import `aiExplore.ts` / `infra-ai` / `AIClient` /
 * `menu-explorer` / `aiFallback`。唯一外部依赖是 contracts 公共契约与 engine-mcp 的执行面。
 * 与 AI 侧的唯一交汇点是入参 `engine: McpEngine` 与出参 `ModuleNode[]`。
 *
 * 职责：调用引擎既有「结构化菜单遍历 + 逐叶子进页采功能点」能力（engine.exploreModules），
 * 产出操作级（type='action'）功能点；再用 in-pipeline 粒度闸门兜底质量。
 */
import type { McpEngine } from '@test-platform/engine-mcp';
import type { ModuleNode } from '@test-platform/contracts';

/**
 * 非 AI 探索主流程。
 * @param engine 已启动的引擎（复用登录浏览器或自建 headless，由调用方决定）
 * @returns 模块树（含 operation 级 action 叶子）
 *
 * 纯净职责：仅驱动引擎既有「结构化菜单遍历 + 逐叶子进页采功能点」能力。
 * 粒度闸门（assertActionGranularity）统一在 stage-explore `run` 中施加，两种模式共用。
 */
export async function exploreNonAi(engine: McpEngine): Promise<ModuleNode[]> {
  return engine.exploreModules();
}
