import { describe, it, expect, vi } from 'vitest';
import { PipelineOrchestrator } from '../index';
import type { McpEngine } from '@test-platform/engine-mcp';
import { createStore } from '@test-platform/infra-store';
import type { SessionCapableEngine } from '@test-platform/engine-mcp';

// 假引擎：完全离线，不启动真实浏览器，仅记录被调用次数。
// 用于固化「反复登录修复」——同一 systemId 连续 login 只能 launch 一次浏览器，
// 后续请求应复用既有的接管引擎（orchestrator 层 skip relaunch 短路）。
function makeFakeEngine(): SessionCapableEngine {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    extractSemanticDom: vi.fn().mockResolvedValue([]),
    exploreModules: vi.fn().mockResolvedValue([]),
    runStep: vi.fn().mockResolvedValue(undefined),
    runCase: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue({ id: 's1', fileName: 't.png', path: '/tmp/t.png' }),
    getSessionCookies: vi.fn().mockResolvedValue(['mock-cookie=1']),
    getSessionHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer t' }),
    getSessionTokens: vi.fn().mockResolvedValue(['mock-token']),
    applySession: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    getCurrentUrl: vi.fn().mockResolvedValue('http://localhost:9999/home'),
    getStorageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
  } as unknown as SessionCapableEngine;
}

describe('login reuse (反复登录修复)', () => {
  it('同一 systemId 连续 no-login 只 launch 一次浏览器，后续复用', async () => {
    const launchSpy = vi.fn();
    const fakeEngine = makeFakeEngine();
    // engineFactory 计数：每次被调用都应创建新引擎；修复后只应在首次调用一次。
    const engineFactory = vi.fn((_cfg: unknown): McpEngine => {
      launchSpy();
      return fakeEngine as unknown as McpEngine;
    });

    const orchestrator = new PipelineOrchestrator({
      engineFactory,
      store: createStore(),
    });

    const baseInput = {
      projectId: 'proj-reuse-test',
      systemId: 'sys-reuse-test',
      mode: 'no-login' as const,
      systemUrl: 'http://localhost:9999',
    };

    // 第一次：Map 为空 → 真实 launch 一次，并写入接管引擎 Map
    const first = await orchestrator.runStage('login', baseInput as Record<string, unknown>);
    expect(first.loginStatus).toBe('ok');

    // 第二次：Map 命中 → 走复用短路，不应再 launch
    const second = await orchestrator.runStage('login', baseInput as Record<string, unknown>);
    expect(second.loginStatus).toBe('ok');

    // 第三次：同上
    const third = await orchestrator.runStage('login', baseInput as Record<string, unknown>);
    expect(third.loginStatus).toBe('ok');

    // 关键断言：引擎工厂只被调用一次（只 launch 一次浏览器），后续全部复用
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it('不同 systemId 各自 launch 一次，互不干扰', async () => {
    const engineFactory = vi.fn((_cfg: unknown): McpEngine => makeFakeEngine() as unknown as McpEngine);
    const orchestrator = new PipelineOrchestrator({
      engineFactory,
      store: createStore(),
    });

    const a = await orchestrator.runStage('login', {
      projectId: 'proj-A',
      systemId: 'sys-A',
      mode: 'no-login',
      systemUrl: 'http://localhost:9999',
    } as Record<string, unknown>);
    const b = await orchestrator.runStage('login', {
      projectId: 'proj-B',
      systemId: 'sys-B',
      mode: 'no-login',
      systemUrl: 'http://localhost:9999',
    } as Record<string, unknown>);

    expect(a.loginStatus).toBe('ok');
    expect(b.loginStatus).toBe('ok');
    // 两个不同系统各 launch 一次
    expect(engineFactory).toHaveBeenCalledTimes(2);
  });
});
