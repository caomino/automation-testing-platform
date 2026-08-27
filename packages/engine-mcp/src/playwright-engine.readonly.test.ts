import { describe, expect, it } from 'vitest';
import { PlaywrightEngine } from './playwright-engine.js';
import { createServer } from 'node:http';

describe('PlaywrightEngine.runReadOnlyClick', () => {
  it('在真正发送前 abort POST，并返回 blocked', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void> } }).page;
      await page.setContent(`<button id="open" data-safe-opener aria-haspopup="dialog">打开详情</button><script>document.querySelector('#open').onclick=()=>fetch('https://readonly.example.test/write',{method:'POST'}).catch(()=>{});</script>`);
      const result = await engine.runReadOnlyClick('#open', 'action');

      expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: expect.stringContaining('fetch') }));
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('阻断点击处理器中的 GET 副作用，仅放行与 href 完全一致的同源文档导航', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      let sideEffectRequests = 0;
      const page = (engine as unknown as { page: {
        goto: (url: string) => Promise<unknown>;
        route: (url: string, handler: (route: { fulfill: (response: { body: string }) => Promise<void> }) => Promise<void>) => Promise<void>;
      } }).page;
      await page.route('**/source', async (route) => route.fulfill({ body: '<a id="detail" href="/detail" onclick="fetch(\'/toggleStatus?id=7\').catch(()=>{})">查看详情</a>' }));
      await page.route('**/detail', async (route) => route.fulfill({ body: '<h1>详情</h1>' }));
      await page.route('**/toggleStatus*', async (route) => {
        sideEffectRequests += 1;
        await route.fulfill({ body: 'changed' });
      });
      await page.goto('https://readonly.example.test/source');

      await expect(engine.runReadOnlyClick('#detail', 'action')).resolves.toMatchObject({
        status: 'blocked',
        reason: expect.stringContaining('fetch'),
      });
      expect(sideEffectRequests).toBe(0);
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('阻断 WebSocket、sendBeacon、XHR 与原生 form 提交通道', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void> } }).page;
      await page.setContent(`<form id="write" action="https://readonly.example.test/write"><button type="button" id="open" data-safe-opener aria-haspopup="dialog">打开详情</button></form><script>
        document.querySelector('#open').onclick=()=>{
          for (const operation of [
            ()=>new WebSocket('wss://readonly.example.test/write'),
            ()=>navigator.sendBeacon('https://readonly.example.test/write','x'),
            ()=>{const xhr=new XMLHttpRequest();xhr.open('GET','https://readonly.example.test/toggleStatus');xhr.send()},
            ()=>document.querySelector('#write').submit()
          ]) { try { operation() } catch {} }
        };
      </script>`);

      await expect(engine.runReadOnlyClick('#open', 'action')).resolves.toMatchObject({
        status: 'blocked',
        reason: expect.stringMatching(/WebSocket.*sendBeacon.*XMLHttpRequest.*HTMLFormElement/s),
      });
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('页面预先缓存原生 WebSocket 构造器时仍阻止连接', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void> } }).page;
      await page.setContent(`<button id="open" data-safe-opener aria-haspopup="dialog">打开详情</button><script>
        const CachedWebSocket = WebSocket;
        document.querySelector('#open').onclick=()=>{ try { new CachedWebSocket('ws://127.0.0.1:9/write') } catch {} };
      </script>`);

      await expect(engine.runReadOnlyClick('#open', 'action')).resolves.toMatchObject({
        status: 'blocked',
        reason: expect.stringContaining('WebSocket'),
      });
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('页面预先缓存 Storage 写函数时仅影响可丢弃隔离上下文', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: {
        goto: (url: string) => Promise<unknown>;
        route: (url: string, handler: (route: { fulfill: (response: { body: string }) => Promise<void> }) => Promise<void>) => Promise<void>;
        setContent: (html: string) => Promise<void>;
        evaluate: <T>(fn: () => T) => Promise<T>;
      } }).page;
      await page.route('**/cached-storage', async (route) => route.fulfill({ body: `<button id="open" data-safe-opener aria-haspopup="dialog">打开详情</button><script>
        const nativeSet = Storage.prototype.setItem;
        document.querySelector('#open').onclick=()=>nativeSet.call(localStorage,'escaped','yes');
      </script>` }));
      await page.goto('https://readonly.example.test/cached-storage');

      await expect(engine.runReadOnlyClick('#open', 'action')).resolves.toMatchObject({
        status: 'blocked',
        reason: expect.stringContaining('localStorage snapshot changed'),
      });
      await expect(page.evaluate(() => localStorage.getItem('escaped'))).resolves.toBeNull();
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('拒绝伪装为安全 opener 的 icon-only、未知节点、checkbox 与 switch，且不触发处理器', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void>; evaluate: <T>(fn: () => T) => Promise<T> } }).page;
      await page.setContent(`<script>window.clicks=0</script><button id="icon" data-safe-opener aria-haspopup="dialog" onclick="window.clicks++"></button><div id="unknown" data-safe-opener onclick="window.clicks++">未知</div><input id="choice" type="checkbox" data-safe-opener aria-label="启用" onclick="window.clicks++"><button id="switch" role="switch" data-safe-opener onclick="window.clicks++">启用</button>`);

      for (const selector of ['#icon', '#unknown', '#choice', '#switch']) {
        await expect(engine.runReadOnlyClick(selector, 'action')).resolves.toMatchObject({ status: 'blocked' });
      }
      await expect(page.evaluate(() => (window as unknown as { clicks: number }).clicks)).resolves.toBe(0);
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('拒绝无 href 的 role=link，onclick handler 不会运行', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void>; evaluate: <T>(fn: () => T) => Promise<T> } }).page;
      await page.setContent('<script>window.clicks=0</script><div id="link" role="link" onclick="window.clicks++">查看详情</div>');

      await expect(engine.runReadOnlyClick('#link', 'action')).resolves.toMatchObject({ status: 'blocked' });
      await expect(page.evaluate(() => (window as unknown as { clicks: number }).clicks)).resolves.toBe(0);
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('阻断 localStorage 与 IndexedDB 写入，并在结束后恢复原型', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { goto: (url: string) => Promise<unknown>; route: (url: string, handler: (route: { fulfill: (response: { body: string }) => Promise<void> }) => Promise<void>) => Promise<void>; evaluate: <T>(fn: () => T) => Promise<T> } }).page;
      await page.route('**/storage', async (route) => route.fulfill({ body: '<button id="storage" data-safe-opener aria-haspopup="dialog">打开详情</button><button id="idb" data-safe-opener aria-haspopup="dialog">打开记录</button><script>document.querySelector("#storage").onclick=()=>localStorage.setItem("blocked","yes");const request=indexedDB.open("readonly-test",1);request.onupgradeneeded=()=>request.result.createObjectStore("items");request.onsuccess=()=>{window.db=request.result;document.querySelector("#idb").onclick=()=>window.db.transaction("items","readwrite").objectStore("items").put("blocked","new")};</script>' }));
      await page.goto('https://readonly.example.test/storage');
      await page.evaluate(() => new Promise<void>((resolve) => {
        const timer = window.setInterval(() => { if ((window as unknown as { db?: IDBDatabase }).db) { window.clearInterval(timer); resolve(); } }, 10);
      }));

      await expect(engine.runReadOnlyClick('#storage', 'action')).resolves.toMatchObject({ status: 'blocked', reason: expect.stringContaining('Storage.setItem') });
      await expect(page.evaluate(() => localStorage.getItem('blocked'))).resolves.toBeNull();
      await expect(engine.runReadOnlyClick('#idb', 'action')).resolves.toMatchObject({ status: 'blocked', reason: expect.stringContaining('IndexedDB.put') });
      await expect(page.evaluate(() => new Promise<unknown>((resolve) => {
        const request = (window as unknown as { db: IDBDatabase }).db.transaction('items', 'readonly').objectStore('items').get('new');
        request.onsuccess = () => resolve(request.result);
      }))).resolves.toBeUndefined();
      await expect(page.evaluate(() => { localStorage.setItem('restored', 'yes'); return localStorage.getItem('restored'); })).resolves.toBe('yes');
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('检测下载并删除本地下载文件，停止只读状态采集', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/download') {
        response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="report.txt"' });
        response.end('report');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<a id="open" href="/download">下载详情</a>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试 HTTP 服务启动失败');
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { goto: (url: string) => Promise<unknown> } }).page;
      await page.goto(`http://127.0.0.1:${address.port}/page`);

      await expect(engine.runReadOnlyClick('#open', 'action')).resolves.toMatchObject({ status: 'blocked', download: true });
    } finally {
      await engine.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 15_000);

  it('检测并关闭 window.open 弹窗，当前页安全 dialog 仍可执行', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void> } }).page;
      await page.setContent('<button id="dialog" data-safe-opener aria-haspopup="dialog">打开详情</button><button id="popup" data-safe-opener aria-haspopup="dialog" onclick="window.open(\'/detail\')">打开弹窗</button>');
      await expect(engine.runReadOnlyClick('#dialog', 'action')).resolves.toMatchObject({ status: 'performed' });
      await expect(engine.runReadOnlyClick('#popup', 'action')).resolves.toMatchObject({ status: 'blocked', reason: expect.stringContaining('弹窗') });
    } finally {
      await engine.close();
    }
  }, 15_000);

  it('阻止点击期间注册的延迟 POST，路由守卫撤销后也不会逃逸', async () => {
    const engine = new PlaywrightEngine({ headless: true, subsystemId: 'readonly' });
    await engine.launch();
    try {
      const page = (engine as unknown as { page: { setContent: (html: string) => Promise<void>; waitForTimeout: (ms: number) => Promise<void> } }).page;
      await page.setContent('<button id="delayed" data-safe-opener aria-haspopup="dialog" onclick="setTimeout(()=>fetch(\'https://readonly.example.test/write\',{method:\'POST\'}),1000)">打开详情</button>');
      await expect(engine.runReadOnlyClick('#delayed', 'action')).resolves.toMatchObject({ status: 'blocked', reason: expect.stringContaining('setTimeout') });
      await page.waitForTimeout(1100);
    } finally {
      await engine.close();
    }
  }, 15_000);
});
