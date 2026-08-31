/**
 * @file engine-behavior.verify.ts
 * @description engine-mcp BrowserCommand 执行 + 只读模式 + DOM 语义抽象
 */
import { describe, it, expect } from 'vitest';
import { PlaywrightEngine } from '../src/playwright-engine';
import type { EngineConfig, BrowserCommand } from '../src/types';
import type { CaseRow } from '@test-platform/contracts';
import { createMockPage, injectPage, INTERACTIVE_TAGS, CONTAINER_TAGS, stableSelector } from './_helpers';

// ─── BrowserCommand 执行 ────────────────────────────────────

describe('engine-mcp BrowserCommand 执行', () => {
  const cfg: EngineConfig = { headless: true };

  it('navigate 正确调用 page.goto', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const result = await engine.runStep({ kind: 'navigate', url: 'https://example.com' });

    expect(result.result).toBe('passed');
    expect(calls.filter((c) => c.method === 'goto').length).toBe(1);
    expect(calls.find((c) => c.method === 'goto')?.args[0]).toBe('https://example.com');
  });

  it('click 正确调用 page.click', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const cmd: BrowserCommand = { kind: 'click', selector: '#btn' };
    const result = await engine.runStep(cmd);

    expect(result.result).toBe('passed');
    expect(calls.find((c) => c.method === 'click')?.args[0]).toBe('#btn');
  });

  it('fill 正确调用 page.fill', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const cmd: BrowserCommand = { kind: 'fill', selector: '#input', value: 'hello' };
    const result = await engine.runStep(cmd);

    expect(result.result).toBe('passed');
    expect(calls.find((c) => c.method === 'fill')?.args).toEqual(['#input', 'hello']);
  });

  it('select 正确调用 page.selectOption', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const cmd: BrowserCommand = { kind: 'select', selector: '#sel', value: 'opt1' };
    const result = await engine.runStep(cmd);

    expect(result.result).toBe('passed');
    expect(calls.find((c) => c.method === 'selectOption')?.args).toEqual(['#sel', 'opt1']);
  });

  it('press 正确调用 page.press', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const cmd: BrowserCommand = { kind: 'press', selector: '#btn', key: 'Enter' };
    const result = await engine.runStep(cmd);

    expect(result.result).toBe('passed');
    expect(calls.find((c) => c.method === 'press')?.args).toEqual(['#btn', 'Enter']);
  });

  it('wait 正确调用 page.waitForSelector', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const cmd: BrowserCommand = { kind: 'wait', selector: '.ready' };
    const result = await engine.runStep(cmd);

    expect(result.result).toBe('passed');
    expect(calls.find((c) => c.method === 'waitForSelector')?.args[0]).toBe('.ready');
  });

  it('screenshot 正确调用 page.screenshot', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const cmd: BrowserCommand = { kind: 'screenshot', path: '/tmp/shot.png' };
    const result = await engine.runStep(cmd);

    expect(result.result).toBe('passed');
    expect(calls.find((c) => c.method === 'screenshot')).toBeDefined();
  });

  it('dom 命令调用 extractSemanticDom', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const cmd: BrowserCommand = { kind: 'dom', selector: '#app' };
    const result = await engine.runStep(cmd);

    expect(result.result).toBe('passed');
    expect(calls.some((c) => c.method === 'evaluate')).toBe(true);
  });

  it('runStep 返回正确的 ExecutionStepResult 结构', async () => {
    const engine = new PlaywrightEngine(cfg);
    const { mockPage } = createMockPage();
    injectPage(engine, mockPage);

    const result = await engine.runStep({ kind: 'navigate', url: 'https://a.com' });

    expect(result.step).toBe('navigate');
    expect(result.operation).toContain('https://a.com');
    expect(result.actual).toBe('ok');
    expect(result.result).toBe('passed');
  });

  it('page 操作抛错时 result=failed', async () => {
    const engine = new PlaywrightEngine(cfg);
    const mockPage = {
      goto: async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); },
      click: async () => {},
      fill: async () => {},
      selectOption: async () => {},
      press: async () => {},
      waitForSelector: async () => {},
      screenshot: async () => {},
      evaluate: async () => null,
      $: async () => null,
      context: () => ({ cookies: async () => [], addCookies: async () => {} }),
      url: () => 'about:blank',
      setDefaultTimeout: () => {},
    };
    injectPage(engine, mockPage);

    const result = await engine.runStep({ kind: 'navigate', url: 'https://bad.com' });

    expect(result.result).toBe('failed');
    expect(result.actual).toContain('ERR_CONNECTION_REFUSED');
  });
});

// ─── 只读探索模式 ──────────────────────────────────────────

describe('engine-mcp 只读探索模式', () => {
  it('readOnly=true 时 fill 返回 skipped', async () => {
    const engine = new PlaywrightEngine({ headless: true, readOnly: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const result = await engine.runStep({ kind: 'fill', selector: '#inp', value: 'x' });

    expect(result.result).toBe('skipped');
    expect(result.actual).toBe('只读模式禁止写操作');
    expect(calls.find((c) => c.method === 'fill')).toBeUndefined();
  });

  it('readOnly=true 时 select 返回 skipped', async () => {
    const engine = new PlaywrightEngine({ headless: true, readOnly: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const result = await engine.runStep({ kind: 'select', selector: '#s', value: 'v' });

    expect(result.result).toBe('skipped');
    expect(calls.find((c) => c.method === 'selectOption')).toBeUndefined();
  });

  it('readOnly=true 时 press 返回 skipped', async () => {
    const engine = new PlaywrightEngine({ headless: true, readOnly: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const result = await engine.runStep({ kind: 'press', selector: '#b', key: 'Enter' });

    expect(result.result).toBe('skipped');
    expect(calls.find((c) => c.method === 'press')).toBeUndefined();
  });

  it('readOnly=true 时 navigate 和 click 仍可执行', async () => {
    const engine = new PlaywrightEngine({ headless: true, readOnly: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const navResult = await engine.runStep({ kind: 'navigate', url: 'https://x.com' });
    const clickResult = await engine.runStep({ kind: 'click', selector: '#ok' });

    expect(navResult.result).toBe('passed');
    expect(clickResult.result).toBe('passed');
    expect(calls.filter((c) => c.method === 'goto').length).toBe(1);
    expect(calls.filter((c) => c.method === 'click').length).toBe(1);
  });

  it('readOnly=true 时 dom 和 screenshot 仍可执行', async () => {
    const engine = new PlaywrightEngine({ headless: true, readOnly: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const domResult = await engine.runStep({ kind: 'dom' });
    const shotResult = await engine.runStep({ kind: 'screenshot', path: '/tmp/s.png' });

    expect(domResult.result).toBe('passed');
    expect(shotResult.result).toBe('passed');
    expect(calls.some((c) => c.method === 'screenshot')).toBe(true);
  });
});

// ─── DOM 语义抽象逻辑 ──────────────────────────────────────

describe('engine-mcp DOM 语义抽象', () => {
  it('interactive tags 包含全部 6 种交互标签', () => {
    expect(INTERACTIVE_TAGS.size).toBe(6);
    expect(INTERACTIVE_TAGS.has('A')).toBe(true);
    expect(INTERACTIVE_TAGS.has('BUTTON')).toBe(true);
    expect(INTERACTIVE_TAGS.has('INPUT')).toBe(true);
    expect(INTERACTIVE_TAGS.has('SELECT')).toBe(true);
    expect(INTERACTIVE_TAGS.has('TEXTAREA')).toBe(true);
    expect(INTERACTIVE_TAGS.has('SUMMIT')).toBe(true);
  });

  it('container tags 包含全部 13 种容器标签', () => {
    expect(CONTAINER_TAGS.size).toBe(13);
    const expected = ['DIV', 'SECTION', 'ASIDE', 'NAV', 'UL', 'OL', 'LI', 'FORM', 'TABLE', 'HEADER', 'FOOTER', 'MAIN', 'ARTICLE'];
    for (const tag of expected) {
      expect(CONTAINER_TAGS.has(tag)).toBe(true);
    }
  });

  it('stableSelector: id 优先', () => {
    const el = {
      id: 'myBtn',
      tagName: 'BUTTON',
      getAttribute: () => null,
      parentElement: { tagName: 'DIV', parentElement: null },
      nodeType: 1,
    };
    expect(stableSelector(el)).toBe('#myBtn');
  });

  it('stableSelector: data-testid 降级', () => {
    const el = {
      tagName: 'INPUT',
      getAttribute: (name: string) => (name === 'data-testid' ? 'username' : null),
      parentElement: { tagName: 'FORM', parentElement: null },
      nodeType: 1,
    };
    expect(stableSelector(el)).toBe('input[data-testid="username"]');
  });

  it('stableSelector: data-id 降级', () => {
    const el = {
      tagName: 'DIV',
      getAttribute: (name: string) => (name === 'data-id' ? 'card-1' : null),
      parentElement: { tagName: 'SECTION', parentElement: null },
      nodeType: 1,
    };
    expect(stableSelector(el)).toBe('div[data-id="card-1"]');
  });

  it('stableSelector: name 属性降级', () => {
    const el = {
      tagName: 'INPUT',
      getAttribute: (name: string) => (name === 'name' ? 'email' : null),
      parentElement: { tagName: 'FORM', parentElement: null },
      nodeType: 1,
    };
    expect(stableSelector(el)).toBe('input[name="email"]');
  });

  it('stableSelector: 位置路径兜底', () => {
    const el = {
      tagName: 'SPAN',
      getAttribute: () => null,
      parentElement: {
        tagName: 'DIV',
        nodeType: 1,
        parentElement: {
          tagName: 'SECTION',
          nodeType: 1,
          parentElement: { tagName: 'BODY', nodeType: 1, parentElement: null },
        },
      },
      nodeType: 1,
    };
    expect(stableSelector(el)).toBe('body > section > div > span');
  });

  it('stableSelector: 层级深度限制为 4', () => {
    const deep = {
      tagName: 'A',
      nodeType: 1,
      getAttribute: () => null,
      parentElement: {
        tagName: 'LI',
        nodeType: 1,
        parentElement: {
          tagName: 'UL',
          nodeType: 1,
          parentElement: {
            tagName: 'NAV',
            nodeType: 1,
            parentElement: {
              tagName: 'DIV',
              nodeType: 1,
              parentElement: { tagName: 'BODY', nodeType: 1, parentElement: null },
            },
          },
        },
      },
    };
    const result = stableSelector(deep);
    expect(result.split(' > ').length).toBeLessThanOrEqual(4);
  });
});

// ─── 多步操作解析与执行 ─────────────────────────────────────

describe('engine-mcp 多步操作解析 (parseOperation)', () => {
  const makeRow = (operation: string): CaseRow => ({
    caseNo: 'T_01', content: '测试', step: 'Step1',
    operation, expected: 'ok', firstResult: '', regressionResult: '',
  });

  it('解析点击操作', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('点击【查询】'));
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toMatchObject({ kind: 'click', selector: 'text=查询' });
  });

  it('解析录入操作', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('在用户名输入框录入"admin"'));
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toMatchObject({ kind: 'fill', value: 'admin' });
  });

  it('解析访问/导航操作', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('访问 https://example.com'));
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toMatchObject({ kind: 'navigate', url: 'https://example.com' });
  });

  it('解析按键操作', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('按下Enter'));
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toMatchObject({ kind: 'press', key: 'Enter' });
  });

  it('解析等待操作', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('等待页面加载'));
    expect(cmds.length).toBe(1);
    expect(cmds[0].kind).toBe('wait');
  });

  it('解析关键词隐式点击', () => {
    const keywords = ['新增', '保存', '删除', '提交', '查询', '搜索', '确定', '取消'];
    for (const kw of keywords) {
      const cmds = PlaywrightEngine.parseOperation(makeRow(kw));
      expect(cmds.length).toBe(1);
      expect(cmds[0]).toMatchObject({ kind: 'click', selector: `text=${kw}` });
    }
  });

  it('解析多步操作（→分隔）', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('点击【登录】→在用户名输入框录入"admin"→按下Enter'));
    expect(cmds.length).toBe(3);
    expect(cmds[0]).toMatchObject({ kind: 'click' });
    expect(cmds[1]).toMatchObject({ kind: 'fill', value: 'admin' });
    expect(cmds[2]).toMatchObject({ kind: 'press', key: 'Enter' });
  });

  it('解析多步操作（；分隔）', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('选择"管理员"；点击【确认】'));
    expect(cmds.length).toBe(2);
  });

  it('空操作返回空数组', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow(''));
    expect(cmds.length).toBe(0);
  });

  it('无匹配操作默认返回 click 命令', () => {
    const cmds = PlaywrightEngine.parseOperation(makeRow('some random text'));
    expect(cmds.length).toBe(1);
    expect(cmds[0].kind).toBe('click');
  });
});

describe('engine-mcp runCase 多步执行', () => {
  it('单步操作执行：click', async () => {
    const engine = new PlaywrightEngine({ headless: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const row: CaseRow = {
      caseNo: 'T_01', content: '登录', step: 'Step1',
      operation: '点击【登录】', expected: '跳转主页',
      firstResult: '', regressionResult: '',
    };

    const results = await engine.runCase(row);
    expect(results.length).toBe(1);
    expect(results[0].result).toBe('passed');
    expect(calls.some((c) => c.method === 'click')).toBe(true);
  });

  it('单步操作执行：fill', async () => {
    const engine = new PlaywrightEngine({ headless: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const row: CaseRow = {
      caseNo: 'T_02', content: '录入', step: 'Step1',
      operation: '在用户名输入框录入"admin"', expected: '显示',
      firstResult: '', regressionResult: '',
    };

    const results = await engine.runCase(row);
    expect(results.length).toBe(1);
    expect(results[0].result).toBe('passed');
    expect(calls.some((c) => c.method === 'fill')).toBe(true);
  });

  it('多步操作顺序执行', async () => {
    const engine = new PlaywrightEngine({ headless: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const row: CaseRow = {
      caseNo: 'T_03', content: '登录流程', step: 'Step1',
      operation: '点击【登录】→在用户名输入框录入"admin"→按下Enter',
      expected: '登录成功', firstResult: '', regressionResult: '',
    };

    const results = await engine.runCase(row);
    expect(results.length).toBe(3);
    expect(results.every((r) => r.result === 'passed')).toBe(true);

    const clickCalls = calls.filter((c) => c.method === 'click');
    const fillCalls = calls.filter((c) => c.method === 'fill');
    const pressCalls = calls.filter((c) => c.method === 'press');
    expect(clickCalls.length).toBeGreaterThanOrEqual(1);
    expect(fillCalls.length).toBeGreaterThanOrEqual(1);
    expect(pressCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('空操作返回 skipped', async () => {
    const engine = new PlaywrightEngine({ headless: true });
    const { mockPage } = createMockPage();
    injectPage(engine, mockPage);

    const row: CaseRow = {
      caseNo: 'T_04', content: '空', step: 'Step1',
      operation: '', expected: 'N/A', firstResult: '', regressionResult: '',
    };

    const results = await engine.runCase(row);
    expect(results.length).toBe(1);
    expect(results[0].result).toBe('skipped');
  });

  it('只读模式下写操作被跳过', async () => {
    const engine = new PlaywrightEngine({ headless: true, readOnly: true });
    const { mockPage, calls } = createMockPage();
    injectPage(engine, mockPage);

    const row: CaseRow = {
      caseNo: 'T_05', content: '登录', step: 'Step1',
      operation: '在用户名输入框录入"admin"→按下Enter',
      expected: '登录成功', firstResult: '', regressionResult: '',
    };

    const results = await engine.runCase(row);
    expect(results.length).toBe(2);
    expect(results[0].result).toBe('skipped');
    expect(results[1].result).toBe('skipped');
    expect(calls.filter((c) => c.method === 'fill').length).toBe(0);
  });

  it('runCase 结果包含 step/operation/expected/actual 字段', async () => {
    const engine = new PlaywrightEngine({ headless: true });
    const { mockPage } = createMockPage();
    injectPage(engine, mockPage);

    const row: CaseRow = {
      caseNo: 'T_06', content: '测试', step: 'Step1',
      operation: '点击【查询】', expected: '显示结果',
      firstResult: '', regressionResult: '',
    };

    const results = await engine.runCase(row);
    for (const r of results) {
      expect(r.step).toBeDefined();
      expect(r.operation).toBeDefined();
      expect(r.expected).toBeDefined();
      expect(r.actual).toBeDefined();
      expect(['passed', 'failed', 'skipped']).toContain(r.result);
    }
  });
});