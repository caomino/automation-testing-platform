/**
 * @file playwright-engine.semantic.test.ts
 * @description T3 回归：extractPageElements 对字段约束 / 表格语义 / 提交按钮的只读抽取与透传
 * 用 jsdom 真实 DOM 驱动 DOM_WALK 字符串（与浏览器内执行路径一致），不依赖真实浏览器。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import type { ExploredElement } from '@test-platform/contracts';
import { PlaywrightEngine } from './playwright-engine.js';

/** 构造真实 DOM 并把 jsdom 全局暴露给 DOM_WALK（getBoundingClientRect 在 jsdom 默认返回 0 → 视觉不可见，需 override） */
function setupDom(html: string): void {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { pretendToBeVisual: true, url: 'http://x.test/page' });
  const w = dom.window as unknown as Record<string, any>;
  w.Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON() { return {}; } };
  } as unknown as DOMRect;
  (globalThis as any).window = w;
  (globalThis as any).document = w.document;
  (globalThis as any).Element = w.Element;
  (globalThis as any).Node = w.Node;
  (globalThis as any).NodeFilter = w.NodeFilter;
  (globalThis as any).HTMLElement = w.HTMLElement;
}

/** 用可控 page 假对象驱动 extractPageElements（page.evaluate 直接执行 DOM_WALK） */
function makeEngine(html: string): PlaywrightEngine {
  setupDom(html);
  const engine = new PlaywrightEngine({ headless: true, subsystemId: 's1' });
  (engine as unknown as { page: any }).page = {
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
    url: () => 'http://x.test/page',
  };
  return engine;
}

const HTML = `
<main>
  <form>
    <label>* 姓名<input name="realname" placeholder="姓名"></label>
    <input name="username" required minlength="3" maxlength="20" placeholder="用户名">
    <input name="email" pattern="^[^@]+@[^@]+$" placeholder="邮箱">
    <select name="role">
      <option>管理员</option>
      <option>普通用户</option>
    </select>
    <input type="radio" name="gender" value="男">
    <input type="radio" name="gender" value="女">
    <input type="checkbox" name="agree" checked>
    <button type="submit">提交</button>
  </form>
  <table class="data-table">
    <thead>
      <tr><th aria-sort="ascending">名称</th><th>状态</th><th>操作</th></tr>
    </thead>
    <tbody>
      <tr><td>张三</td><td>启用</td><td>编辑</td></tr>
      <tr><td>李四</td><td>禁用</td><td>编辑</td></tr>
    </tbody>
  </table>
  <div class="pagination">第 1/5 页 共 50 条</div>
</main>
`;

const byName = (els: ExploredElement[], name: string): ExploredElement | undefined =>
  els.find((e) => e.selector.includes(`name="${name}"`));

describe('T3 extractPageElements 字段约束抽取', () => {
  let els: ExploredElement[] = [];

  beforeAll(async () => {
    const engine = makeEngine(HTML);
    els = await engine.extractPageElements();
  });

  it('required 属性 → ExploredElement.required', () => {
    expect(byName(els, 'username')?.required).toBe(true);
  });

  it('带 * 的 label 内输入框 → 推断 required（label/aria 推导路径）', () => {
    expect(byName(els, 'realname')?.required).toBe(true);
  });

  it('minlength / maxlength → minLength / maxLength', () => {
    const u = byName(els, 'username');
    expect(u?.minLength).toBe(3);
    expect(u?.maxLength).toBe(20);
  });

  it('pattern 属性 → ExploredElement.pattern', () => {
    expect(byName(els, 'email')?.pattern).toBe('^[^@]+@[^@]+$');
  });

  it('select 选项 → ExploredElement.options', () => {
    const role = byName(els, 'role');
    expect(role?.options).toEqual(['管理员', '普通用户']);
  });

  it('radio 同组 → options 含全部枚举', () => {
    const gender = byName(els, 'gender');
    expect(gender?.options).toEqual(expect.arrayContaining(['男', '女']));
  });

  it('checkbox checked → ExploredElement.checked', () => {
    expect(byName(els, 'agree')?.checked).toBe(true);
  });

  it('提交按钮被识别为可交互数据控件（@T3 SUBMIT 拼写修复后语义稳定）', () => {
    const submit = els.find((e) => e.tag === 'button' && e.text === '提交');
    expect(submit).toBeDefined();
    expect(submit?.interactive).toBe(true);
    expect(submit?.suggestedAction).toBe('click');
  });
});

describe('T3 extractPageElements 表格语义抽取', () => {
  let els: ExploredElement[] = [];

  beforeAll(async () => {
    const engine = makeEngine(HTML);
    els = await engine.extractPageElements();
  });

  it('table 节点携带 tableInfo：列头 / 行数 / 分页 / 排序', () => {
    const table = els.find((e) => e.tag === 'table');
    expect(table).toBeDefined();
    expect(table?.tableInfo).toBeDefined();
    expect(table?.tableInfo?.columns).toEqual(['名称', '状态', '操作']);
    expect(table?.tableInfo?.rowCount).toBe(2);
  });

  it('分页控件（class 含 page）被识别 → hasPagination + 分页信息文本', () => {
    const table = els.find((e) => e.tag === 'table');
    expect(table?.tableInfo?.hasPagination).toBe(true);
    expect(table?.tableInfo?.paginationInfo).toContain('第 1/5 页 共 50 条');
  });

  it('aria-sort 表头 → hasSorting + sortableColumns', () => {
    const table = els.find((e) => e.tag === 'table');
    expect(table?.tableInfo?.hasSorting).toBe(true);
    expect(table?.tableInfo?.sortableColumns).toEqual(expect.arrayContaining(['名称']));
  });
});

describe('T10 extractPageElements 容器与只读边界', () => {
  it('采集可达 Tab/抽屉/折叠、同源 iframe、open shadow 与虚拟列表，并标注不可读边界', async () => {
    const engine = makeEngine(`
      <div id="basic-tab" role="tab" aria-expanded="true">基本信息</div>
      <aside id="detail-drawer" class="drawer" aria-expanded="true">详情</aside>
      <details id="more-collapse" class="accordion" open><summary>更多</summary></details>
      <iframe id="same-frame" src="/embedded"></iframe>
      <iframe id="cross-frame" src="https://cross.example.test/embedded"></iframe>
      <x-open id="open-shadow"></x-open>
      <x-closed id="closed-shadow" data-shadow-dom="closed"></x-closed>
      <div id="virtual-users" class="virtual-list" role="grid">
        <div role="columnheader">姓名</div><div role="row" data-index="0">张三</div>
      </div>
      <canvas id="chart"></canvas>
    `);
    const openHost = document.querySelector('#open-shadow')!;
    const root = openHost.attachShadow({ mode: 'open' });
    root.innerHTML = '<input name="shadowName" required>';
    const frame = document.querySelector('#same-frame') as HTMLIFrameElement;
    const embedded = new JSDOM('<!DOCTYPE html><html><body><input name="frameName" required></body></html>', { pretendToBeVisual: true, url: 'http://x.test/embedded' });
    Object.defineProperty(frame, 'contentDocument', { configurable: true, value: embedded.window.document });
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: embedded.window });
    const frameWindow = embedded.window as unknown as Record<string, any>;
    frameWindow.Element.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON() { return {}; } };
    } as unknown as DOMRect;

    const elements = await engine.extractPageElements();
    const containers = elements.flatMap((element) => element.containers ?? []);
    const uncovered = elements.flatMap((element) => element.uncovered ?? []);

    expect(byName(elements, 'frameName')?.required).toBe(true);
    expect(byName(elements, 'shadowName')?.required).toBe(true);
    expect(containers.map((container) => container.kind)).toEqual(expect.arrayContaining(['tab', 'drawer', 'collapse', 'iframe', 'shadow', 'virtual_list']));
    expect(containers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'iframe', selector: '#same-frame', crossOrigin: false }),
      expect.objectContaining({ kind: 'shadow', selector: '#open-shadow', shadowDom: 'open' }),
    ]));
    expect(elements).toEqual(expect.arrayContaining([expect.objectContaining({ tableInfo: expect.objectContaining({ isVirtualList: true }) })]));
    expect(uncovered.map((item) => item.kind)).toEqual(expect.arrayContaining(['cross_origin_iframe', 'closed_shadow_dom', 'canvas']));
  });

  it('在真实 Chromium 页面中提取可达容器、open shadow、虚拟列表和 Canvas 边界', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 't10' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void>; evaluate: (fn: () => void) => Promise<void> } }).page;
      await page.setContent(`
        <style>div, aside, details, x-host, canvas { display: block; width: 120px; height: 24px; }</style>
        <div id="tab" role="tab">基础信息</div>
        <aside id="drawer" class="drawer">详情</aside>
        <details id="collapse" class="accordion" open><summary>更多</summary></details>
        <x-host id="shadow"></x-host>
        <div id="virtual" class="virtual-list" role="grid"><div role="columnheader">姓名</div><div role="row">张三</div></div>
        <canvas id="chart"></canvas>
      `);
      await page.evaluate(() => {
        document.querySelector('#shadow')!.attachShadow({ mode: 'open' }).innerHTML = '<input name="realShadowName" required>';
      });

      const elements = await engine.extractPageElements();
      const containers = elements.flatMap((element) => element.containers ?? []);
      const uncovered = elements.flatMap((element) => element.uncovered ?? []);

      expect(byName(elements, 'realShadowName')?.required).toBe(true);
      expect(containers.map((container) => container.kind)).toEqual(expect.arrayContaining(['tab', 'drawer', 'collapse', 'shadow', 'virtual_list']));
      expect(elements).toEqual(expect.arrayContaining([expect.objectContaining({ tableInfo: expect.objectContaining({ isVirtualList: true }) })]));
      expect(uncovered).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'canvas' })]));
    } finally {
      await engine.close();
    }
  }, 15_000);
});
