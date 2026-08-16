/**
 * @file server.mjs
 * @description App ↔ Orchestrator 后端桥接层
 *   浏览器 App 通过 HTTP API 调用 Node.js 后端，后端执行真实 Playwright MCP
 *
 *   启动: pnpm server  (从根目录)
 *   前端: Vite dev server (端口 5173)
 */

import http from 'node:http';
import { PipelineOrchestrator } from './dist/index.js';

const PORT = process.env.PORT || 3001;

const orchestrator = new PipelineOrchestrator({
  engineConfig: { headless: true },
});

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

      const output = await orchestrator.runStage(stage, input ?? {});
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

  // --- Store Bootstrap ---
  if (req.method === 'GET' && req.url === '/api/store/bootstrap') {
    try {
      const store = orchestrator.getStore();
      const projects = await store.listProjects();
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data: { projects } }));
    } catch (err) {
      console.error(`[server] ERROR:`, err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // --- Project CRUD ---
  if (req.method === 'GET' && req.url === '/api/store/projects') {
    try {
      const store = orchestrator.getStore();
      const data = await store.listProjects();
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data }));
    } catch (err) {
      console.error(`[server] ERROR:`, err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/store/projects') {
    try {
      const input = await readBody(req);
      const store = orchestrator.getStore();
      const data = await store.createProject(input);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, data }));
    } catch (err) {
      console.error(`[server] ERROR:`, err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  const projectMatch = req.url.match(/^\/api\/store\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectId = projectMatch[1];
    if (req.method === 'GET') {
      try {
        const store = orchestrator.getStore();
        const data = await store.getProject(projectId);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, data }));
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
    if (req.method === 'PUT') {
      try {
        const patch = await readBody(req);
        const store = orchestrator.getStore();
        const data = await store.updateProject(projectId, patch);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, data }));
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
    if (req.method === 'DELETE') {
      try {
        const store = orchestrator.getStore();
        await store.deleteProject(projectId);
        res.statusCode = 204;
        return res.end();
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  }

  // --- Active System ---
  const activeSysMatch = req.url.match(/^\/api\/store\/projects\/([^/]+)\/active-system$/);
  if (activeSysMatch && req.method === 'POST') {
    try {
      const projectId = activeSysMatch[1];
      const { systemId } = await readBody(req);
      const store = orchestrator.getStore();
      await store.setActiveSystem(projectId, systemId);
      res.statusCode = 204;
      return res.end();
    } catch (err) {
      console.error(`[server] ERROR:`, err.message);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // --- Feature Table ---
  const featureTableMatch = req.url.match(/^\/api\/store\/projects\/([^/]+)\/feature-table$/);
  if (featureTableMatch) {
    const projectId = featureTableMatch[1];
    if (req.method === 'PUT') {
      try {
        const { systemId, table } = await readBody(req);
        const store = orchestrator.getStore();
        await store.saveFeatureTable(systemId, table);
        res.statusCode = 204;
        return res.end();
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
    if (req.method === 'GET') {
      try {
        // Note: getFeatureTable uses systemId, not projectId.
        // The URL path uses projectId for REST consistency.
        // We need to resolve systemId from the project.
        const store = orchestrator.getStore();
        const project = await store.getProject(projectId);
        if (!project) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ok: false, error: 'Project not found' }));
        }
        const systemId = project.systems[0]?.id || project.id;
        const data = await store.getFeatureTable(systemId);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, data }));
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  }

  // --- Case Table ---
  const caseTableMatch = req.url.match(/^\/api\/store\/projects\/([^/]+)\/case-table$/);
  if (caseTableMatch) {
    const projectId = caseTableMatch[1];
    if (req.method === 'PUT') {
      try {
        const { systemId, sheets } = await readBody(req);
        const store = orchestrator.getStore();
        await store.saveCaseTable(systemId, sheets);
        res.statusCode = 204;
        return res.end();
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
    if (req.method === 'GET') {
      try {
        const store = orchestrator.getStore();
        const project = await store.getProject(projectId);
        if (!project) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ok: false, error: 'Project not found' }));
        }
        const systemId = project.systems[0]?.id || project.id;
        const data = await store.getCaseTable(systemId);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, data }));
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  }

  // --- Execution ---
  const executionMatch = req.url.match(/^\/api\/store\/projects\/([^/]+)\/execution$/);
  if (executionMatch) {
    const projectId = executionMatch[1];
    if (req.method === 'PUT') {
      try {
        const { systemId, report } = await readBody(req);
        const store = orchestrator.getStore();
        await store.saveExecution(systemId, report);
        res.statusCode = 204;
        return res.end();
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
    if (req.method === 'GET') {
      try {
        const store = orchestrator.getStore();
        const project = await store.getProject(projectId);
        if (!project) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ok: false, error: 'Project not found' }));
        }
        const systemId = project.systems[0]?.id || project.id;
        const data = await store.getExecution(systemId);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, data }));
      } catch (err) {
        console.error(`[server] ERROR:`, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n  Test Platform Backend Bridge running on http://localhost:${PORT}`);
  console.log(`  ├── POST /api/stage         Run a single stage`);
  console.log(`  ├── POST /api/full-pipeline Run the full pipeline`);
  console.log(`  └── GET  /health            Health check\n`);
});