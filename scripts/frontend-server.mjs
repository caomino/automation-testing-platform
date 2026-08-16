/**
 * @file frontend-server.mjs
 * @description 部署态前端静态文件服务器（端口 5173）。
 *   从 restart.mjs 中抽出，便于独立测试。
 *
 *   职责：
 *     1. /api/* 反向代理到后端（默认 127.0.0.1:3001）
 *     2. 静态文件服务：dist 目录下的真实文件按 MIME 返回
 *     3. SPA fallback：未命中的前端路由回落 index.html
 *
 *   为什么必须代理：前端 dataApi 走相对路径 /api/...，开发态由 Vite proxy 承接；
 *   部署态若没有代理，/api/* 会被 SPA fallback 兜成 index.html（200 + text/html），
 *   前端 res.json() 直接抛 "Unexpected token '<'"，表现为「新增项目报错」。
 *
 *   注意：createFrontendServer 只创建 server，不 listen。
 *   由调用方决定端口（测试可用 0 取随机端口）。
 */

import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain',
};

/**
 * 静态文件 + SPA fallback。
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} distDir 前端构建产物目录
 */
function serveStatic(req, res, distDir) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = join(distDir, urlPath.split('?')[0]);

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (existsSync(filePath)) {
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    createReadStream(filePath).pipe(res);
  } else {
    const indexPath = join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    createReadStream(indexPath).pipe(res);
  }
}

/** API 请求前缀：命中即走代理，绝不进入 SPA fallback */
const API_PREFIX = '/api';

/**
 * 判断请求是否属于后端 API。
 * @param {string} url
 * @returns {boolean}
 */
export function isApiRequest(url) {
  if (!url) return false;
  const path = url.split('?')[0];
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

/**
 * 把请求原样转发给后端，并把后端响应原样回传。
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ backendHost: string, backendPort: number }} target
 */
function proxyToBackend(req, res, { backendHost, backendPort }) {
  const headers = { ...req.headers, host: `${backendHost}:${backendPort}` };

  const upstream = http.request(
    { host: backendHost, port: backendPort, method: req.method, path: req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // 后端不可达时必须返回 JSON，让前端能给出可读错误，而不是拿到 HTML
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        error: `API 后端不可达 (${backendHost}:${backendPort})：${err.message}。请确认后端服务已启动。`,
      }),
    );
  });

  req.pipe(upstream);
}

/**
 * 创建部署态前端服务器（不 listen）。
 * @param {{ distDir: string, backendHost?: string, backendPort?: number }} options
 * @returns {http.Server}
 */
export function createFrontendServer({ distDir, backendHost = '127.0.0.1', backendPort = 3001 }) {
  return http.createServer((req, res) => {
    if (isApiRequest(req.url)) {
      proxyToBackend(req, res, { backendHost, backendPort });
      return;
    }
    serveStatic(req, res, distDir);
  });
}
