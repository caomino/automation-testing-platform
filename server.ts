/**
 * @file server.ts
 * @description 自动化测试平台全栈服务入口（Express + Vite 中间件）
 *   - /api/credentials      凭证管理（自动加密存储）
 *   - /api/stage          单阶段执行（登录凭证自动预处理）
 *   - /api/full-pipeline  全流水线
 *   - /api/store/*        ProjectStore CRUD（项目/系统/功能点/用例/执行结果/知识库）
 *   - /api/ai/*           AI 模型配置与连接测试
 *   - /api/capture/*      浏览器捕获（Playwright 直连模式）
 *   - /health             健康检查
 *   - 前端 SPA 页面挂载与路由回退
 */

import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

import { PipelineOrchestrator, BrowserCaptureService } from './packages/orchestrator/src/index.ts';
import { validateNewProject } from './packages/orchestrator/src/storeValidation.ts';
import type { ProjectStore, AIConfigRecord } from './packages/infra-store/src/index.ts';
import { createCredentialStore } from './packages/infra-cred/src/index.ts';
import { getTakeoverEngine } from './packages/stage-login/src/index.ts';
import {
  testConnection as testAIConnection,
  fetchRemoteModels,
  listVendors,
  getModelsForVendor,
  getBaseUrlForVendor,
  type AIVendor,
} from './packages/infra-ai/src/index.ts';

const PORT = 3000;
const HOST = '0.0.0.0';

// 凭证存储（AES-256-GCM 加密落盘）
const credDir = process.env.TEST_PLATFORM_CRED_DIR || (process.platform === 'win32' ? '.credentials' : path.join(process.cwd(), '.data', 'credentials'));
const credMasterKey = process.env.TEST_PLATFORM_MASTER_KEY || 'dev-insecure-master-key';
const credStore = createCredentialStore({ dir: credDir, masterKey: credMasterKey });

// 编排器实例
const orchestrator = new PipelineOrchestrator({
  engineConfig: { headless: process.env.HEADLESS !== 'false' },
  credStore,
});

// 浏览器捕获服务
const captureService = new BrowserCaptureService();

// 录制会话存储（内存）
interface RecordingSession {
  systemId: string;
  systemUrl: string;
  startTime: number;
  clicks: Array<{ url: string; selector: string; text: string; timestamp: number }>;
}
const activeRecordings = new Map<string, RecordingSession>();

function isInvalidSystemUrl(url: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return true;
    return /example\.(com|org|net)$/i.test(parsed.hostname);
  } catch {
    return true;
  }
}

async function preprocessLoginInput(input: any): Promise<any> {
  if ((input?.mode === 'credential' || input?.mode === 'manual-takeover') && !input.credentialRef) {
    if (input.username && input.password) {
      const credRef = await credStore.save(input.username, input.password);
      console.log(`[server] auto-stored credential: ${credRef} for system ${input.systemId}`);
      const { username, password, ...rest } = input;
      return { ...rest, credentialRef: credRef };
    }
    if (input.mode === 'credential') {
      const placeholderRef = `manual-${input.systemId ?? 'system'}-${Date.now()}`;
      console.log(`[server] credential mode without credentials for ${input.systemId}, inject placeholder credentialRef: ${placeholderRef}`);
      return { ...input, credentialRef: placeholderRef };
    }
  }
  return input;
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CORS 支持
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // ===== 健康检查 =====
  app.get(['/health', '/api/health'], (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ===== 凭证管理 =====
  app.get('/api/credentials', async (_req: Request, res: Response) => {
    try {
      const list = await credStore.list();
      res.json({ ok: true, data: list });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/credentials', async (req: Request, res: Response) => {
    try {
      const { username, password, ref } = req.body;
      if (!username || !password) {
        return res.status(400).json({ ok: false, error: 'username and password required' });
      }
      const credRef = ref || (await credStore.save(username, password));
      res.json({ ok: true, data: { credentialRef: credRef } });
    } catch (err: any) {
      console.error(`[server] ERROR:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===== 流水线阶段执行 =====
  app.post('/api/stage', async (req: Request, res: Response) => {
    try {
      const { stage, input } = req.body;
      console.log(`[server] stage=${stage}`);

      const validStages = ['login', 'explore', 'feature', 'case', 'execute', 'defect'];
      if (!validStages.includes(stage)) {
        return res.status(400).json({ ok: false, error: `Invalid stage: ${stage}` });
      }

      let processedInput = input ?? {};
      if (stage === 'login') {
        processedInput = await preprocessLoginInput(processedInput);
      }

      const output = await orchestrator.runStage(stage, processedInput);
      res.json({ ok: true, data: output });
    } catch (err: any) {
      console.error(`[server] ERROR:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/full-pipeline', async (req: Request, res: Response) => {
    try {
      const input = req.body;
      console.log(`[server] full pipeline started`);

      if (input.login) {
        input.login = await preprocessLoginInput(input.login);
      }

      const result = await orchestrator.run(input);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      console.error(`[server] ERROR:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===== 浏览器捕获 API =====
  app.post('/api/capture/start', async (req: Request, res: Response) => {
    try {
      const { portalUrl, systemId } = req.body;
      if (!portalUrl) {
        return res.status(400).json({ ok: false, error: 'portalUrl is required' });
      }
      const session = await captureService.startCapture(portalUrl, systemId);
      res.json({ ok: true, data: session });
    } catch (err: any) {
      console.error('[capture] start error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/capture/status/:id', (req: Request, res: Response) => {
    const sessionId = decodeURIComponent(req.params.id);
    const status = captureService.getStatus(sessionId);
    res.json({ ok: true, data: status });
  });

  app.post('/api/capture/complete/:id', async (req: Request, res: Response) => {
    try {
      const sessionId = decodeURIComponent(req.params.id);
      const result = await captureService.completeCapture(sessionId);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      console.error('[capture] complete error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/capture/cancel/:id', async (req: Request, res: Response) => {
    try {
      const sessionId = decodeURIComponent(req.params.id);
      await captureService.cancelCapture(sessionId);
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[capture] cancel error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===== 录制探索 =====
  app.post('/api/store/explore/start-recording', async (req: Request, res: Response) => {
    try {
      const { systemId, url: systemUrl } = req.body;
      if (!systemId) {
        return res.status(400).json({ ok: false, error: 'systemId required' });
      }
      const engine = getTakeoverEngine(systemId);
      if (!engine) {
        return res.status(400).json({ ok: false, error: '未找到登录浏览器，请先在「登录」阶段完成人工登录' });
      }
      if (systemUrl) {
        if (isInvalidSystemUrl(systemUrl)) {
          return res.status(400).json({ ok: false, error: '系统 URL 无效，请配置真实系统地址（不要使用 example.com 占位地址）' });
        }
        await engine.navigate(systemUrl);
      }
      try {
        await engine.evaluate(`(function(){
          if (window.__tpCapture) {
            try { document.removeEventListener('click', window.__tpCapture, true); } catch (e) {}
          }
          window.__tpClicks = [];
          var SEL = 'button,a[href],a[role="button"],[role="button"],input,select,textarea,[role="tab"],.ant-tabs-tab,.el-tabs__item,tr,.ant-list-item,[role="listitem"]';
          var isVisible = function(n){
            if(!n) return false;
            if(n.getAttribute && n.getAttribute('aria-hidden')==='true') return false;
            var r = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
            if(r && (r.width===0 || r.height===0)) return false;
            return true;
          };
          var isExternalLink = function(a){
            if(!a || a.tagName!=='A') return false;
            var href = a.getAttribute('href') || '';
            if(!href || href==='#' || /^javascript:/i.test(href)) return false;
            try { var u = new URL(href, location.href); return u.origin !== location.origin && /^https?:$/.test(u.protocol); }
            catch(e){ return false; }
          };
          var textOf = function(n){
            if(!n) return '';
            var aria = n.getAttribute ? n.getAttribute('aria-label') : '';
            if(aria && aria.trim()) return aria.trim().slice(0,40);
            var direct = '';
            if(n.childNodes){ for(var i=0;i<n.childNodes.length;i++){ if(n.childNodes[i].nodeType===3) direct += n.childNodes[i].textContent; } }
            direct = (direct||'').replace(/\\s+/g,' ').trim();
            if(direct) return direct.slice(0,40);
            return (n.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40);
          };
          var describe = function(n){
            if(!n) return '';
            if(n.id) return '#'+n.id;
            if(n.className && typeof n.className==='string' && n.className.trim()) return '.'+n.className.trim().split(/\\s+/).join('.');
            return n.tagName ? n.tagName.toLowerCase() : '';
          };
          var capture = function(e){
            var t = e.target;
            var el = (t && t.closest) ? t.closest(SEL) : null;
            if(!el || !isVisible(el)) return;
            if(el.tagName==='A' && isExternalLink(el)) return;
            window.__tpClicks.push({ url: location.href, text: textOf(el||t), selector: describe(el||t), timestamp: Date.now() });
          };
          window.__tpCapture = capture;
          document.addEventListener('click', capture, true);
        })()`);
      } catch {}
      const recordingId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeRecordings.set(recordingId, { systemId, systemUrl: systemUrl ?? '', startTime: Date.now(), clicks: [] });
      res.json({ ok: true, data: { recordingId, browserUrl: systemUrl ?? '' } });
    } catch (err: any) {
      console.error(`[server] ERROR start-recording:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/store/explore/stop-recording', async (req: Request, res: Response) => {
    try {
      const { recordingId } = req.body;
      if (!recordingId) {
        return res.status(400).json({ ok: false, error: 'recordingId required' });
      }
      const recording = activeRecordings.get(recordingId);
      if (!recording) {
        return res.status(404).json({ ok: false, error: 'Recording not found' });
      }
      const engine = getTakeoverEngine(recording.systemId);
      let clicks: Array<{ url: string; selector: string; text: string; timestamp: number }> = recording.clicks;
      let capturedUrl = recording.systemUrl;
      let capturedTitle = recording.systemId;
      if (engine) {
        try {
          clicks = (await engine.evaluate('window.__tpClicks || []')) as typeof clicks;
        } catch {}
        try {
          capturedUrl = await engine.getCurrentUrl();
        } catch {}
        try {
          if (typeof (engine as any).getCurrentTitle === 'function') {
            capturedTitle = await (engine as any).getCurrentTitle();
          }
        } catch {}
      }
      activeRecordings.delete(recordingId);
      res.json({
        ok: true,
        data: {
          recordingId,
          capturedUrl,
          capturedTitle,
          clickPath: { steps: clicks },
          duration: Date.now() - recording.startTime,
        },
      });
    } catch (err: any) {
      console.error(`[server] ERROR stop-recording:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/explore/list-recordings', (_req: Request, res: Response) => {
    const recordings = Array.from(activeRecordings.entries()).map(([id, data]) => ({
      recordingId: id,
      systemId: data.systemId,
      systemUrl: data.systemUrl,
      startTime: data.startTime,
      clickCount: data.clicks.length,
    }));
    res.json({ ok: true, data: recordings });
  });

  // ===== Store CRUD =====
  const store: ProjectStore = orchestrator.getStore();

  app.get('/api/store/bootstrap', async (_req: Request, res: Response) => {
    try {
      const projects = await store.listProjects();
      const fullProjects = [];
      const systemData: Record<string, { featureTable?: any; featureArtifact?: any; caseTable?: any; execution?: any }> = {};

      for (const s of projects) {
        const p = await store.getProject(s.id);
        if (p) {
          fullProjects.push(p);
          for (const sys of p.systems) {
            const [ft, fa, ct, ex] = await Promise.all([
              store.getFeatureTable(sys.id),
              store.getFeatureArtifact(sys.id),
              store.getCaseTable(sys.id),
              store.getExecution(sys.id),
            ]);
            systemData[sys.id] = {
              featureTable: ft ?? undefined,
              featureArtifact: fa ?? undefined,
              caseTable: ct ?? undefined,
              execution: ex ?? undefined,
            };
          }
        }
      }

      const knowledge = await store.listKnowledgeEntries();
      res.json({ ok: true, data: { projects: fullProjects, systemData, knowledge } });
    } catch (err: any) {
      console.error(`[server] bootstrap ERROR:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects', async (_req: Request, res: Response) => {
    try {
      const list = await store.listProjects();
      res.json({ ok: true, data: list });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/store/projects', async (req: Request, res: Response) => {
    try {
      const v = validateNewProject(req.body);
      if (!v.ok) {
        return res.status(400).json({ ok: false, error: (v as any).error });
      }
      const p = await store.createProject(v.value as any);
      res.status(201).json({ ok: true, data: p });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id', async (req: Request, res: Response) => {
    try {
      const p = await store.getProject(req.params.id);
      if (!p) return res.status(404).json({ ok: false, error: 'Project not found' });
      res.json({ ok: true, data: p });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id', async (req: Request, res: Response) => {
    try {
      const p = await store.updateProject(req.params.id, req.body);
      res.json({ ok: true, data: p });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/store/projects/:id', async (req: Request, res: Response) => {
    try {
      await store.deleteProject(req.params.id);
      res.status(204).json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/store/projects/:id/systems', async (req: Request, res: Response) => {
    try {
      const sys = await store.addSystem(req.params.id, req.body);
      res.status(201).json({ ok: true, data: sys });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id/systems/:sysId', async (req: Request, res: Response) => {
    try {
      const sys = await store.updateSystem(req.params.id, req.params.sysId, req.body);
      res.json({ ok: true, data: sys });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/store/projects/:id/systems/:sysId', async (req: Request, res: Response) => {
    try {
      await store.removeSystem(req.params.id, req.params.sysId);
      try { await store.saveModuleTree(req.params.sysId, []); } catch {}
      res.status(204).json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/store/projects/:id/active-system', async (req: Request, res: Response) => {
    try {
      await store.setActiveSystem(req.params.id, req.body.systemId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id/feature-table', async (req: Request, res: Response) => {
    try {
      const systemId = (req.query.systemId as string) ?? req.params.id;
      const table = await store.getFeatureTable(systemId);
      res.json({ ok: true, data: table });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id/feature-table', async (req: Request, res: Response) => {
    try {
      await store.saveFeatureTable(req.body.systemId, req.body.table);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id/feature-artifact', async (req: Request, res: Response) => {
    try {
      const systemId = (req.query.systemId as string) ?? req.params.id;
      const artifact = await store.getFeatureArtifact(systemId);
      res.json({ ok: true, data: artifact });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id/feature-artifact', async (req: Request, res: Response) => {
    try {
      await store.saveFeatureArtifact(req.body.systemId, req.body.artifact);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id/case-table', async (req: Request, res: Response) => {
    try {
      const systemId = (req.query.systemId as string) ?? req.params.id;
      const sheets = await store.getCaseTable(systemId);
      res.json({ ok: true, data: sheets });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id/case-table', async (req: Request, res: Response) => {
    try {
      await store.saveCaseTable(req.body.systemId, req.body.sheets);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id/case-generation', async (req: Request, res: Response) => {
    try {
      const systemId = (req.query.systemId as string) ?? req.params.id;
      const gens = await store.getCaseGenerations(systemId);
      res.json({ ok: true, data: gens });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id/execution', async (req: Request, res: Response) => {
    try {
      const systemId = (req.query.systemId as string) ?? req.params.id;
      const report = await store.getExecution(systemId);
      res.json({ ok: true, data: report });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id/execution', async (req: Request, res: Response) => {
    try {
      await store.saveExecution(req.body.systemId, req.body.report);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id/module-tree', async (req: Request, res: Response) => {
    try {
      const systemId = (req.query.systemId as string) ?? req.params.id;
      const tree = await store.getModuleTree(systemId);
      res.json({ ok: true, data: tree });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id/module-tree', async (req: Request, res: Response) => {
    try {
      await store.saveModuleTree(req.body.systemId, req.body.tree);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/store/projects/:id/meta-config', async (req: Request, res: Response) => {
    try {
      const systemId = (req.query.systemId as string) ?? req.params.id;
      const meta = await store.getMetaConfig(systemId);
      res.json({ ok: true, data: meta });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/projects/:id/meta-config', async (req: Request, res: Response) => {
    try {
      await store.saveMetaConfig(req.body.systemId, req.body.meta);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===== 知识库 =====
  app.get('/api/store/knowledge', async (_req: Request, res: Response) => {
    try {
      const entries = await store.listKnowledgeEntries();
      res.json({ ok: true, data: entries });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/store/knowledge', async (req: Request, res: Response) => {
    try {
      const entry = await store.saveKnowledgeEntry(req.body);
      res.status(201).json({ ok: true, data: entry });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/store/knowledge/:id', async (req: Request, res: Response) => {
    try {
      const entry = await store.saveKnowledgeEntry({ ...req.body, id: req.params.id });
      res.json({ ok: true, data: entry });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/store/knowledge/:id', async (req: Request, res: Response) => {
    try {
      await store.deleteKnowledgeEntry(req.params.id);
      res.status(204).json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===== AI 模型配置与连接 =====
  app.get('/api/ai/vendors', (_req: Request, res: Response) => {
    const vendors = listVendors();
    res.json({ ok: true, data: vendors });
  });

  app.get('/api/ai/models', (req: Request, res: Response) => {
    const vendor = req.query.vendor as AIVendor;
    if (!vendor) return res.status(400).json({ ok: false, error: 'vendor required' });
    const models = getModelsForVendor(vendor);
    const baseUrl = getBaseUrlForVendor(vendor);
    res.json({ ok: true, data: { models, baseUrl } });
  });

  app.post('/api/ai/models/remote', async (req: Request, res: Response) => {
    try {
      const { baseUrl, apiKey } = req.body;
      if (!baseUrl || !apiKey) {
        return res.status(400).json({ ok: false, error: 'baseUrl and apiKey required' });
      }
      const result = await fetchRemoteModels(baseUrl, apiKey);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/ai/test-connection', async (req: Request, res: Response) => {
    try {
      const config = req.body;
      if (!config.baseUrl || !config.model) {
        return res.status(400).json({ ok: false, error: 'baseUrl and model required' });
      }

      let apiKey = config.apiKey;
      if (config.configId) {
        const savedConfig = await store.getAIConfig(config.configId);
        if (!savedConfig) {
          return res.status(404).json({ ok: false, error: 'Config not found' });
        }
        const cred = await credStore.get(savedConfig.apiKeyRef);
        if (!cred) {
          return res.status(400).json({ ok: false, error: 'API Key 解密失败，请重新配置密钥' });
        }
        apiKey = cred.password;
      } else if (config.apiKeyRef) {
        const cred = await credStore.get(config.apiKeyRef);
        if (cred) {
          apiKey = cred.password;
        }
      }

      if (!apiKey) {
        return res.status(400).json({ ok: false, error: 'API Key 不可用，请重新配置' });
      }

      const result = await testAIConnection({
        id: config.configId ?? 'test',
        name: config.name ?? 'test',
        vendor: config.vendor ?? 'custom',
        baseUrl: config.baseUrl,
        apiKeyRef: apiKey,
        model: config.model,
        enabled: true,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/ai/configs', async (_req: Request, res: Response) => {
    try {
      const configs = await store.listAIConfigs();
      res.json({ ok: true, data: configs });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/ai/configs/:id', async (req: Request, res: Response) => {
    try {
      const config = await store.getAIConfig(req.params.id);
      if (!config) return res.status(404).json({ ok: false, error: 'AI config not found' });
      res.json({ ok: true, data: config });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/ai/configs', async (req: Request, res: Response) => {
    try {
      const { apiKey, ...configData } = req.body;
      let apiKeyRef = configData.apiKeyRef;

      if (apiKey) {
        apiKeyRef = await credStore.save('ai-key', apiKey);
      }
      if (!apiKeyRef) {
        return res.status(400).json({ ok: false, error: 'apiKey or apiKeyRef required' });
      }

      const config: AIConfigRecord = {
        id: configData.id ?? crypto.randomUUID(),
        name: configData.name,
        vendor: configData.vendor,
        baseUrl: configData.baseUrl,
        apiKeyRef,
        model: configData.model,
        enabled: configData.enabled ?? true,
        isDefault: configData.isDefault ?? false,
        temperature: configData.temperature,
        maxTokens: configData.maxTokens,
        createdAt: 0,
        updatedAt: 0,
      };

      const saved = await store.saveAIConfig(config);
      res.status(201).json({ ok: true, data: saved });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/ai/configs/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const patch: any = { ...req.body };

      if (req.body.apiKey) {
        const apiKeyRef = await credStore.save('ai-key', req.body.apiKey);
        patch.apiKeyRef = apiKeyRef;
        delete patch.apiKey;
      }

      const updated = await store.updateAIConfig(id, patch);
      res.json({ ok: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/ai/configs/:id', async (req: Request, res: Response) => {
    try {
      await store.deleteAIConfig(req.params.id);
      res.status(204).json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/ai/configs/:id/enable', async (req: Request, res: Response) => {
    try {
      const { enabled } = req.body;
      const updated = await store.toggleAIConfigEnabled(req.params.id, enabled);
      res.json({ ok: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/ai/configs/:id/default', async (req: Request, res: Response) => {
    try {
      await store.setDefaultAIConfig(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===== 前端静态资源与 Vite 中间件 =====
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`\n========================================`);
    console.log(`自动化测试平台 (TestMaster) 服务已就绪`);
    console.log(`访问地址: http://${HOST}:${PORT}`);
    console.log(`========================================\n`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
