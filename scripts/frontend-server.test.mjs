/**
 * @file frontend-server.test.mjs
 * @description 部署态前端服务器（5173）行为测试。
 *
 *   回归背景：「新增项目报错」根因 —— 该服务器缺少 /api 反向代理，
 *   SPA fallback 把 /api/* 兜成 index.html（HTTP 200 + text/html），
 *   导致前端 dataApi 的 res.json() 抛 "Unexpected token '<'"。
 *   本文件把该行为钉死，防止回归。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFrontendServer } from './frontend-server.mjs';

/** 起一个桩后端，模拟 orchestrator 的 /api/store 响应 */
function startStubBackend() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/store/projects') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const input = JSON.parse(body || '{}');
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: { id: 'p-stub', name: input.name } }));
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/store/projects') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: [{ id: 'p-stub', name: '桩项目' }] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'stub not found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

let distDir;
let backend;
let frontend;
let frontendPort;

beforeAll(async () => {
  distDir = mkdtempSync(join(tmpdir(), 'tp-dist-'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>');

  backend = await startStubBackend();
  frontend = createFrontendServer({ distDir, backendHost: '127.0.0.1', backendPort: backend.port });
  frontendPort = await listen(frontend);
});

afterAll(async () => {
  if (frontend) await closeServer(frontend);
  if (backend?.server) await closeServer(backend.server);
  if (distDir) rmSync(distDir, { recursive: true, force: true });
});

const url = (p) => `http://127.0.0.1:${frontendPort}${p}`;

describe('部署态前端服务器 · /api 反向代理', () => {
  it('新增项目请求应转发到后端并返回后端的 JSON（不得回落 index.html）', async () => {
    const res = await fetch(url('/api/store/projects'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新增项目回归', type: 'standalone' }),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');

    const json = await res.json();
    expect(json).toEqual({ ok: true, data: { id: 'p-stub', name: '新增项目回归' } });
  });

  it('项目列表 GET 请求同样应透传后端状态码与数据', async () => {
    const res = await fetch(url('/api/store/projects'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].name).toBe('桩项目');
  });

  it('后端返回的错误状态码应原样透传（不得被改写成 200）', async () => {
    const res = await fetch(url('/api/store/unknown-route'));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

describe('部署态前端服务器 · SPA fallback 不被破坏', () => {
  it('前端路由应回落 index.html', async () => {
    const res = await fetch(url('/some/spa/route'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('SPA');
  });

  it('根路径应返回 index.html', async () => {
    const res = await fetch(url('/'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('SPA');
  });

  it('路径中含 api 但不是 /api 前缀的前端路由不应被代理', async () => {
    const res = await fetch(url('/apidocs'));
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});

describe('部署态前端服务器 · 后端不可达', () => {
  it('后端挂掉时 /api 应返回 JSON 502，而不是 HTML（否则前端只能报晦涩的 JSON 解析错）', async () => {
    // 指向一个没有服务监听的端口
    const orphan = createFrontendServer({ distDir, backendHost: '127.0.0.1', backendPort: 1 });
    const port = await listen(orphan);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/store/projects`);
      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('application/json');
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/后端不可达/);
    } finally {
      await closeServer(orphan);
    }
  });
});
