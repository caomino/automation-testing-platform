/**
 * @file engine.verify.ts
 * @description engine-mcp 会话复用四方法 + 工厂函数 + 接口契约
 */
import { describe, it, expect } from 'vitest';
import { PlaywrightEngine } from '../src/playwright-engine';
import { McpPlaywrightAdapter } from '../src/mcp-adapter';
import { createEngine } from '../src/index';
import type { EngineConfig } from '../src/types';
import { createMockPage, injectPage } from './_helpers';

// ─── 会话复用四方法 ──────────────────────────────────────────

describe('engine-mcp 会话复用', () => {
  const cfg: EngineConfig = { headless: true };

  it('getSessionCookies: 正确格式化为 name=value 数组', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage({
      cookies: [
        { name: 'JSESSIONID', value: 'abc123' },
        { name: 'USER_ID', value: '42' },
      ],
    });
    injectPage(engine, mockPage);

    const result = await engine.getSessionCookies();

    expect(result).toEqual(['JSESSIONID=abc123', 'USER_ID=42']);
    expect(calls.some((c) => c.method === 'context.addCookies')).toBe(false);
  });

  it('getSessionCookies: 空 Cookie 返回空数组', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage } = createMockPage({ cookies: [] });
    injectPage(engine, mockPage);

    const result = await engine.getSessionCookies();

    expect(result).toEqual([]);
  });

  it('getSessionHeaders: 正确提取 Authorization 和 X-Token', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage({
      evaluateReturn: { Authorization: 'Bearer tk_123', 'X-Token': 'csrf_abc' },
    });
    injectPage(engine, mockPage);

    const result = await engine.getSessionHeaders();

    expect(result).toEqual({ Authorization: 'Bearer tk_123', 'X-Token': 'csrf_abc' });
    expect(calls.filter((c) => c.method === 'evaluate').length).toBe(1);
  });

  it('getSessionHeaders: 无匹配 meta 头返回空对象', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage } = createMockPage({ evaluateReturn: {} });
    injectPage(engine, mockPage);

    const result = await engine.getSessionHeaders();

    expect(result).toEqual({});
  });

  it('getSessionTokens: 正确提取 localStorage/sessionStorage token', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage({
      evaluateReturn: ['token=abc', 'accessToken=xyz'],
    });
    injectPage(engine, mockPage);

    const result = await engine.getSessionTokens();

    expect(result).toEqual(['token=abc', 'accessToken=xyz']);
    expect(calls.filter((c) => c.method === 'evaluate').length).toBe(1);
  });

  it('getSessionTokens: 无 token 返回空数组', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage } = createMockPage({ evaluateReturn: [] });
    injectPage(engine, mockPage);

    const result = await engine.getSessionTokens();

    expect(result).toEqual([]);
  });

  it('applySession: 正确注入 cookies 到浏览器上下文', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    await engine.applySession({
      cookies: ['JSESSIONID=abc123', 'USER_ID=42'],
    });

    const addCookiesCall = calls.find((c) => c.method === 'context.addCookies');
    expect(addCookiesCall).toBeDefined();
    const injected = addCookiesCall?.args[0] as Array<{ name: string; value: string; url: string }>;
    expect(injected).toHaveLength(2);
    expect(injected[0]).toEqual({ name: 'JSESSIONID', value: 'abc123', url: 'https://example.com' });
    expect(injected[1]).toEqual({ name: 'USER_ID', value: '42', url: 'https://example.com' });
  });

  it('applySession: 正确注入 tokens 到 localStorage', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    await engine.applySession({
      cookies: [],
      tokens: ['token=mytoken', 'authToken=xyz'],
    });

    const evalCalls = calls.filter((c) => c.method === 'evaluate');
    expect(evalCalls.length).toBe(1);
    const evalArgs = evalCalls[0].args;
    expect(Array.isArray(evalArgs[1])).toBe(true);
    expect(evalArgs[1]).toEqual(['token=mytoken', 'authToken=xyz']);
  });

  it('applySession: cookies 为空时不调用 addCookies', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    await engine.applySession({ cookies: [] });

    expect(calls.find((c) => c.method === 'context.addCookies')).toBeUndefined();
  });

  it('applySession: 无 tokens 时不调用 evaluate', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    await engine.applySession({ cookies: ['a=b'] });

    const evalCalls = calls.filter((c) => c.method === 'evaluate');
    expect(evalCalls.length).toBe(0);
  });

  it('四方法在 engine 未启动时抛错', async () => {
    const engine = new PlaywrightEngine(cfg);
    await expect(engine.getSessionCookies()).rejects.toThrow('engine not launched');
    await expect(engine.getSessionHeaders()).rejects.toThrow('engine not launched');
    await expect(engine.getSessionTokens()).rejects.toThrow('engine not launched');
    await expect(engine.applySession({ cookies: [] })).rejects.toThrow('engine not launched');
  });
});

// ─── 工厂函数 ──────────────────────────────────────────────

describe('engine-mcp 工厂函数', () => {
  it('createEngine 默认返回 PlaywrightEngine 实例（v1.5 默认 direct）', () => {
    const engine = createEngine({ headless: true });
    expect(engine).toBeInstanceOf(PlaywrightEngine);
  });

  it('createEngine engineType=direct 返回 PlaywrightEngine 实例', () => {
    const engine = createEngine({ engineType: 'direct', headless: true });
    expect(engine).toBeInstanceOf(PlaywrightEngine);
  });

  it('createEngine 接受完整配置', () => {
    const engine = createEngine({
      engineType: 'mcp',
      headless: false,
      viewport: { width: 1920, height: 1080 },
      timeoutMs: 60000,
      readOnly: true,
      manualTakeover: false,
    });
    expect(engine).toBeInstanceOf(McpPlaywrightAdapter);
  });

  it('createEngine 返回的实例暴露 McpEngine 全部方法', () => {
    const engine = createEngine({ headless: true });
    const methods = [
      'launch', 'navigate', 'extractSemanticDom', 'exploreModules',
      'runStep', 'runCase', 'screenshot',
      'getSessionCookies', 'getSessionHeaders', 'getSessionTokens', 'applySession',
      'waitForTimeout', 'close',
    ];
    for (const m of methods) {
      expect(typeof (engine as unknown as Record<string, unknown>)[m]).toBe('function');
    }
  });
});

// ─── 接口契约 ──────────────────────────────────────────────

describe('engine-mcp 接口契约', () => {
  it('McpEngine 暴露会话提取/注入方法（门户会话复用闭环可达）', () => {
    const engine = new PlaywrightEngine({ headless: true });
    expect(typeof engine.getSessionCookies).toBe('function');
    expect(typeof engine.getSessionHeaders).toBe('function');
    expect(typeof engine.getSessionTokens).toBe('function');
    expect(typeof engine.applySession).toBe('function');
  });

  it('McpEngine 暴露生命周期方法', () => {
    const engine = new PlaywrightEngine({ headless: true });
    expect(typeof engine.launch).toBe('function');
    expect(typeof engine.close).toBe('function');
    expect(typeof engine.navigate).toBe('function');
  });

  it('McpEngine 暴露 DOM 探索方法', () => {
    const engine = new PlaywrightEngine({ headless: true });
    expect(typeof engine.extractSemanticDom).toBe('function');
    expect(typeof engine.exploreModules).toBe('function');
  });

  it('McpEngine 暴露执行方法', () => {
    const engine = new PlaywrightEngine({ headless: true });
    expect(typeof engine.runStep).toBe('function');
    expect(typeof engine.runCase).toBe('function');
    expect(typeof engine.screenshot).toBe('function');
  });
});