/**
 * @file index.ts
 * @description engine-mcp 导出 + 工厂
 * @frozen v1.0
 */
import type { EngineConfig, McpEngine } from './types';
import { PlaywrightEngine } from './playwright-engine';

export * from './types';
export { PlaywrightEngine } from './playwright-engine';

/** 工厂：当前返回 Playwright 实现；后续可切换其他引擎，调用方无感 */
export function createEngine(config: EngineConfig): McpEngine {
  return new PlaywrightEngine(config);
}
