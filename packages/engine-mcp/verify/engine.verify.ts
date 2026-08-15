/**
 * @file engine.verify.ts
 * @description engine-mcp 会话接口契约校验（门户会话复用可达）
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import { PlaywrightEngine } from '../src/playwright-engine';
import type { EngineConfig } from '../src/types';

describe('engine-mcp 会话接口契约', () => {
  const cfg: EngineConfig = { headless: true };

  it('McpEngine 暴露会话提取/注入方法（门户会话复用闭环可达）', () => {
    const engine = new PlaywrightEngine(cfg);
    expect(typeof engine.getSessionCookies).toBe('function');
    expect(typeof engine.getSessionHeaders).toBe('function');
    expect(typeof engine.getSessionTokens).toBe('function');
    expect(typeof engine.applySession).toBe('function');
  });
});
