/**
 * 单独启动前端静态服务（含 `/api` → 后端代理）。
 *
 * 用途：改了 `packages/app/src/**` 或 `scripts/frontend-server.mjs` 后，
 * 只需「重建 dist + 重启前端」，**不必**跑 `restart.mjs restart`（那会连带重启后端 +
 * 重跑根构建，既慢又会打断用户正在进行的操作与会话）。
 *
 * 用法：
 *   node scripts/start-frontend.mjs            # 前台运行（Ctrl+C 退出）
 *   FRONTEND_PORT=5173 node scripts/...        # 指定端口
 *   后台常驻（Windows / 跨平台）：见文件尾部说明
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createFrontendServer } from './frontend-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'packages', 'app', 'dist');
const port = Number(process.env.FRONTEND_PORT || 5173);
const backendPort = Number(process.env.BACKEND_PORT || 3001);

const server = createFrontendServer({ distDir, backendHost: '127.0.0.1', backendPort });
server.on('error', (err) => {
  console.error(`[frontend] 启动失败：${err.message}（端口 ${port} 可能已被占用）`);
  process.exit(1);
});
server.listen(port, () => {
  console.log(`[frontend] serving ${distDir}`);
  console.log(`[frontend] http://localhost:${port}  (proxy /api -> 127.0.0.1:${backendPort})`);
});
