/**
 * @file server.mjs
 * @description App ↔ Orchestrator 后端桥接层
 *   浏览器 App 通过 HTTP API 调用 Node.js 后端，后端执行真实 Playwright
 *   支持凭证管理 API + 单阶段执行 + 全流水线
 *
 *   启动: pnpm build && node server.mjs  (默认端口 3001)
 */

import http from 'node:http';
import { PipelineOrchestrator, BrowserCaptureService } from '@test-platform/orchestrator';
import { createCredentialStore } from '@test-platform/infra-cred';

const PORT = process.env.PORT || 3001;

// 凭证存储（文件级 AES-256-GCM 加密）
const credDir = process.env.TEST_PLATFORM_CRED_DIR || '.credentials';
const credMasterKey = process.env.TEST_PLATFORM_MASTER_KEY || 'dev-insecure-master-key';
const credStore = createCredentialStore({ dir: credDir, masterKey: credMasterKey });

const orchestrator = new PipelineOrchestrator({
  engineConfig: { headless: true },
});

// 浏览器捕获服务
const captureService = new BrowserCaptureService();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 凭证预处理：若 login input 包含 username/password（无 credentialRef），
 * 自动存入凭证存储并注入 credentialRef，实现"输入参数即执行"的通用模式。
 * 返回的 input 会移除 username/password，仅保留 credentialRef。
 */
async function preprocessLoginInput(input) {
  if (input.mode === 'credential' && !input.credentialRef && input.username && input.password) {
    const credRef = await credStore.save(input.username, input.password);
    console.log(`[server] auto-stored credential: ${credRef} for system ${input.systemId}`);
    const { username, password, ...rest } = input;
    return { ...rest, credentialRef: credRef };
  }
  return input;
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }

  // 凭证管理 API
  if (req.method === 'POST' && req.url === '/api/credentials') {
    try {
      const { username, password, ref } = await readBody(req);
      if (!username || !password) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: false, error: 'username and password required' }));
      }
      const credRef = ref || await credStore.save(username, password);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data: { credentialRef: credRef } }));
    } catch (err) {
      console.error(`[server] ERROR:`, err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'GET' && req.url === '/api/credentials') {
    try {
      const list = await credStore.list();
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data: list }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/stage') {
    try {
      const { stage, input } = await readBody(req);
      console.log(`[server] stage=${stage}`);

      const validStages = ['login', 'explore', 'feature', 'case', 'execute', 'defect'];
      if (!validStages.includes(stage)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: `Invalid stage: ${stage}` }));
      }

      // 登录阶段：自动预处理凭证
      let processedInput = input ?? {};
      if (stage === 'login') {
        processedInput = await preprocessLoginInput(processedInput);
      }

      const output = await orchestrator.runStage(stage, processedInput);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data: output }));
    } catch (err) {
      console.error(`[server] ERROR:`, err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/full-pipeline') {
    try {
      const input = await readBody(req);
      console.log(`[server] full pipeline started`);

      // 预处理 login 凭证
      if (input.login) {
        input.login = await preprocessLoginInput(input.login);
      }

      const result = await orchestrator.run(input);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data: result }));
    } catch (err) {
      console.error(`[server] ERROR:`, err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // ===== 浏览器捕获 API =====
  if (req.method === 'POST' && req.url === '/api/capture/start') {
    try {
      const { portalUrl, systemId } = await readBody(req);
      if (!portalUrl) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: false, error: 'portalUrl is required' }));
      }
      const session = await captureService.startCapture(portalUrl, systemId);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data: session }));
    } catch (err) {
      console.error('[capture] start error:', err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/capture/status/')) {
    const sessionId = decodeURIComponent(req.url.split('/').pop());
    const status = captureService.getStatus(sessionId);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, data: status }));
  }

  if (req.method === 'POST' && req.url.startsWith('/api/capture/complete/')) {
    try {
      const sessionId = decodeURIComponent(req.url.split('/').pop());
      const result = await captureService.completeCapture(sessionId);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data: result }));
    } catch (err) {
      console.error('[capture] complete error:', err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && req.url.startsWith('/api/capture/cancel/')) {
    try {
      const sessionId = decodeURIComponent(req.url.split('/').pop());
      await captureService.cancelCapture(sessionId);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n  Test Platform Backend Bridge running on http://localhost:${PORT}`);
  console.log(`  ├── POST /api/credentials   Store credentials (username, password)`);
  console.log(`  ├── GET  /api/credentials   List stored credentials`);
  console.log(`  ├── POST /api/stage         Run a single stage`);
  console.log(`  ├── POST /api/full-pipeline Run the full pipeline`);
  console.log(`  ├── POST /api/capture/start    Start browser capture (Playwright direct)`);
  console.log(`  ├── GET  /api/capture/status/:id  Get capture session status`);
  console.log(`  ├── POST /api/capture/complete/:id Complete capture and get results`);
  console.log(`  ├── POST /api/capture/cancel/:id  Cancel capture session`);
  console.log(`  └── GET  /health            Health check\n`);
});
