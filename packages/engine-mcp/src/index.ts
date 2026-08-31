/**
 * @file index.ts
 * @description engine-mcp 导出 + 工厂
 * @frozen v1.3 — 默认使用 MCP 适配器（契约要求），direct 模式保留作降级方案
 */
import type { EngineConfig, McpEngine, EngineType } from './types.js';
import { PlaywrightEngine } from './playwright-engine.js';
import { McpPlaywrightAdapter } from './mcp-adapter.js';

export * from './types.js';
export { PlaywrightEngine } from './playwright-engine.js';
export { McpPlaywrightAdapter } from './mcp-adapter.js';
export { snapshotToSemanticNodes, parseSnapshotEntries, findInteractiveNodes, findNodesByTag } from './snapshot-converter.js';

/**
 * 工厂函数：根据 config.engineType 创建对应引擎
 * - 'direct'（默认）：Playwright 直连，稳定可靠，适合登录/探索/执行全链路
 * - 'mcp'：通过 McpPlaywrightAdapter 封装 @playwright/mcp，适合 AI 代理辅助场景
 * 
 * v1.5 变更：默认值从 'mcp' 改为 'direct'，避免 MCP 协议超时问题
 */
export function createEngine(config: EngineConfig): McpEngine {
  const engineType: EngineType = config.engineType || 'direct';
  switch (engineType) {
    case 'mcp':
      return new McpPlaywrightAdapter(config);
    case 'direct':
    default:
      return new PlaywrightEngine(config);
  }
}
