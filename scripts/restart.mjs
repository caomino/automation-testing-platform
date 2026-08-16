/**
 * @file restart.mjs
 * @description 前端编译 + 服务重启协调器
 *   生产构建模式：编译前端静态文件 → 停止旧服务 → 启动新服务
 *
 *   使用方式:
 *     node scripts/restart.mjs build        # 仅编译前端
 *     node scripts/restart.mjs restart      # 编译+重启（完整流程）
 *     node scripts/restart.mjs stop         # 停止所有服务
 *     node scripts/restart.mjs status       # 查看服务状态
 *
 *   端口: 前端 5173 (静态文件) | 后端 3001 (API)
 */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, createReadStream, appendFileSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFrontendServer } from './frontend-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CONFIG = {
  frontendDist: join(ROOT, 'packages', 'app', 'dist'),
  backendPort: 3001,
  frontendPort: 5173,
  pidFile: join(ROOT, '.service-pids.json'),
  logFile: join(ROOT, '.service.log'),
};

function log(msg, level = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(dirname(CONFIG.logFile), { recursive: true });
    appendFileSync(CONFIG.logFile, line + '\n');
  } catch {}
}

function getPidByPort(port) {
  try {
    const output = execSync(
      `netstat -ano | findstr "LISTENING" | findstr ":${port} "`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    const match = output.trim().split(/\s+/).pop();
    const pid = parseInt(match, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function killPid(pid) {
  try {
    execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8', timeout: 5000 });
    log(`Killed PID ${pid}`, 'warn');
    return true;
  } catch {
    log(`Failed to kill PID ${pid}`, 'error');
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForPortFree(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = getPidByPort(port);
    if (!pid) return true;
    await sleep(200);
  }
  log(`Timeout waiting for port ${port} to be free`, 'error');
  return false;
}

async function waitForPortListen(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = getPidByPort(port);
    if (pid) return true;
    await sleep(200);
  }
  log(`Timeout waiting for port ${port} to listen`, 'error');
  return false;
}

function loadPids() {
  if (!existsSync(CONFIG.pidFile)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG.pidFile, 'utf-8'));
  } catch {
    return {};
  }
}

function savePids(pids) {
  writeFileSync(CONFIG.pidFile, JSON.stringify(pids, null, 2));
}

function stopAllServices() {
  const pids = loadPids();

  for (const [name, pid] of Object.entries(pids)) {
    if (pid) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8', timeout: 5000 });
        log(`Stopped ${name} (PID ${pid})`, 'warn');
      } catch {}
    }
  }

  const backendPid = getPidByPort(CONFIG.backendPort);
  if (backendPid) {
    try {
      execSync(`taskkill /F /PID ${backendPid}`, { encoding: 'utf-8', timeout: 5000 });
      log(`Stopped backend (PID ${backendPid})`, 'warn');
    } catch {}
  }

  const frontendPid = getPidByPort(CONFIG.frontendPort);
  if (frontendPid) {
    try {
      execSync(`taskkill /F /PID ${frontendPid}`, { encoding: 'utf-8', timeout: 5000 });
      log(`Stopped frontend (PID ${frontendPid})`, 'warn');
    } catch {}
  }

  savePids({});
  log('All services stopped', 'info');
}

let servicesRunning = false;
let cleanupHandler = null;

function setupCleanup(frontendServer) {
  if (cleanupHandler) {
    process.removeListener('SIGINT', cleanupHandler);
    process.removeListener('SIGTERM', cleanupHandler);
  }

  cleanupHandler = () => {
    if (servicesRunning) {
      servicesRunning = false;
      log('Shutting down...', 'info');
      stopAllServices();
      if (frontendServer) frontendServer.close();
      process.exit(0);
    }
  };

  process.on('SIGINT', cleanupHandler);
  process.on('SIGTERM', cleanupHandler);
  process.on('exit', () => {
    stopAllServices();
    if (frontendServer) frontendServer.close();
  });
}

function checkFrontendBuild() {
  if (!existsSync(CONFIG.frontendDist)) return false;
  try {
    const files = readdirSync(CONFIG.frontendDist);
    return files.length > 0;
  } catch {
    return false;
  }
}

function buildFrontend() {
  log('Building frontend...', 'info');
  try {
    execSync('pnpm --filter @test-platform/app build', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'inherit',
      timeout: 120000,
    });
    if (checkFrontendBuild()) {
      log('Frontend build completed successfully', 'info');
      return true;
    }
    log('Frontend build output not found', 'error');
    return false;
  } catch (err) {
    log(`Frontend build failed: ${err.message}`, 'error');
    return false;
  }
}

function startBackendServer() {
  log('Starting backend API server...', 'info');
  const child = spawn('pnpm', ['--filter', '@test-platform/orchestrator', 'run', 'server'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    detached: false,
  });

  log(`Backend started with PID ${child.pid}`, 'info');
  return child;
}

async function cmdBuild() {
  log('=== Build Frontend ===', 'info');
  const ok = buildFrontend();
  if (ok) {
    log('Build completed', 'info');
  } else {
    log('Build failed', 'error');
    process.exit(1);
  }
}

async function cmdRestart() {
  log('=== Restart All Services ===', 'info');

  stopAllServices();

  await waitForPortFree(CONFIG.backendPort);
  await waitForPortFree(CONFIG.frontendPort);

  if (!buildFrontend()) {
    log('Build failed, aborting restart', 'error');
    process.exit(1);
  }

  const backendChild = startBackendServer();

  await waitForPortListen(CONFIG.backendPort);

  let frontendServer = null;
  if (!existsSync(CONFIG.frontendDist)) {
    log('Frontend dist not found. Run build first.', 'error');
  } else {
    frontendServer = createFrontendServer({
      distDir: CONFIG.frontendDist,
      backendHost: '127.0.0.1',
      backendPort: CONFIG.backendPort,
    });
    frontendServer.listen(CONFIG.frontendPort, () => {
      log(`Frontend static server running on http://localhost:${CONFIG.frontendPort}`, 'info');
    });
  }

  savePids({
    backend: backendChild.pid,
    frontend: frontendServer ? process.pid : null,
  });

  servicesRunning = true;
  setupCleanup(frontendServer);

  log('', 'info');
  log('========================================', 'info');
  log('  Services restarted!', 'info');
  log(`  Frontend:  http://localhost:${CONFIG.frontendPort}/`, 'info');
  log(`  Backend:   http://localhost:${CONFIG.backendPort}/`, 'info');
  log(`  API Docs:  http://localhost:${CONFIG.backendPort}/health`, 'info');
  log('========================================', 'info');
  log('', 'info');
  log('Press Ctrl+C to stop all services', 'info');

  await new Promise(() => {});
}

async function cmdStop() {
  log('=== Stop All Services ===', 'info');
  stopAllServices();
}

async function cmdStatus() {
  log('=== Service Status ===', 'info');
  const backendPid = getPidByPort(CONFIG.backendPort);
  const frontendPid = getPidByPort(CONFIG.frontendPort);
  const pids = loadPids();

  log(`Backend (port ${CONFIG.backendPort}): ${backendPid ? `RUNNING (PID ${backendPid})` : 'STOPPED'}`, 'info');
  log(`Frontend (port ${CONFIG.frontendPort}): ${frontendPid ? `RUNNING (PID ${frontendPid})` : 'STOPPED'}`, 'info');
  log(`Saved PIDs: ${JSON.stringify(pids)}`, 'info');

  if (checkFrontendBuild()) {
    log(`Frontend build: EXISTS at ${CONFIG.frontendDist}`, 'info');
  } else {
    log(`Frontend build: NOT FOUND (run 'node scripts/restart.mjs build')`, 'warn');
  }
}

async function main() {
  const action = process.argv[2] || 'restart';

  switch (action) {
    case 'build':
      await cmdBuild();
      break;
    case 'restart':
      await cmdRestart();
      break;
    case 'stop':
      await cmdStop();
      break;
    case 'status':
      await cmdStatus();
      break;
    default:
      log(`Unknown action: ${action}`, 'error');
      log('Usage: node scripts/restart.mjs [build|restart|stop|status]', 'info');
      process.exit(1);
  }
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'error');
  process.exit(1);
});