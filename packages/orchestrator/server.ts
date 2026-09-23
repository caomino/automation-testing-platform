/**
 * @file server.ts
 * @description App ↔ Orchestrator 后端桥接层
 *   - /api/credentials      凭证管理（自动加密存储）
 *   - /api/stage          单阶段执行（登录凭证自动预处理）
 *   - /api/full-pipeline  全流水线
 *   - /api/store/*        ProjectStore CRUD（项目/系统/功能点/用例/执行结果）
 *   - /health             健康检查
 *
 *   启动: pnpm server  (从根目录)
 *   前端: Vite dev server (端口 5173)
 */

import http from 'node:http';
import { URL } from 'node:url';
import { PipelineOrchestrator, BrowserCaptureService } from './src/index.js';
import { validateNewProject } from './src/storeValidation.js';
import type { ProjectStore, AIConfigRecord } from '@test-platform/infra-store';
import { createCredentialStore } from '@test-platform/infra-cred';
import { getTakeoverEngine } from '@test-platform/stage-login';
// T5：复用已冻结契约的人工补录合并逻辑（支持 above/below/end + relativeToNodeId + 去重 + 带 url/type）
import { mergeManualSupplement } from '@test-platform/stage-explore';
import type { ManualSupplement } from '@test-platform/contracts';
import {
  testConnection as testAIConnection,
  fetchRemoteModels,
  listVendors,
  getModelsForVendor,
  getBaseUrlForVendor,
  type AIVendor,
} from '@test-platform/infra-ai';

const PORT = 3001;

// 凭证存储（AES-256-GCM 加密落盘）
const credDir = process.env.TEST_PLATFORM_CRED_DIR || '.credentials';
const credMasterKey = process.env.TEST_PLATFORM_MASTER_KEY || 'dev-insecure-master-key';
const credStore = createCredentialStore({ dir: credDir, masterKey: credMasterKey });

const orchestrator = new PipelineOrchestrator({
  engineConfig: { headless: false },
  credStore,
});

// 浏览器捕获服务（Playwright 直连模式）
const captureService = new BrowserCaptureService();

// 录制会话存储（内存）
interface RecordingSession {
  systemId: string;
  systemUrl: string;
  startTime: number;
  clicks: Array<{ url: string; selector: string; text: string; timestamp: number }>;
}
const activeRecordings = new Map<string, RecordingSession>();

/** 判定 URL 是否为占位/示例地址（example.com 等），这类地址会导致探索/录制打开打不开的页面 */
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

function setCors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req: http.IncomingMessage): Promise<any> {
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

function jsonResponse(res: http.ServerResponse, code: number, ok: boolean, data?: any, error?: string) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = code;
  res.end(JSON.stringify(ok ? { ok, data } : { ok, error }));
}

/**
 * 凭证预处理：若 login input 包含 username/password（无 credentialRef），
 * 自动存入凭证存储并注入 credentialRef，实现"输入参数即执行"的通用模式。
 *
 * 补充：冻结契约 LoginInputSchema 要求 mode=credential 时 credentialRef 必填，
 * 但业务允许「未配置凭证的账号密码模式」——stage-login 会先打开浏览器由用户手动登录。
 * 此处为该场景注入占位 credentialRef 以通过契约校验；stage-login 查不到对应凭证时
 * 自动降级为人工接管（barrier），不会因占位引用被阻断。
 */
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

async function handleStore(
  method: string,
  url: string,
  body: any,
  res: http.ServerResponse,
) {
  const store: ProjectStore = orchestrator.getStore();

  const parsed = new URL(url, 'http://localhost');
  const pathname = parsed.pathname;
  const query = parsed.searchParams;

  try {
    // GET /api/store/projects → list
    if (method === 'GET' && pathname === '/api/store/projects') {
      const list = await store.listProjects();
      return jsonResponse(res, 200, true, list);
    }

    // GET /api/store/projects/:id → get
    let m = pathname.match(/^\/api\/store\/projects\/([^/]+)$/);
    if (method === 'GET' && m) {
      const p = await store.getProject(m[1]);
      if (!p) return jsonResponse(res, 404, false, undefined, 'Project not found');
      return jsonResponse(res, 200, true, p);
    }

    // POST /api/store/projects → create
    if (method === 'POST' && pathname === '/api/store/projects') {
      const v = validateNewProject(body);
      if (!v.ok) return jsonResponse(res, 400, false, undefined, (v as any).error);
      const p = await store.createProject(v.value as any);
      return jsonResponse(res, 201, true, p);
    }

    // PUT /api/store/projects/:id → update
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)$/);
    if (method === 'PUT' && m) {
      const p = await store.updateProject(m[1], body);
      return jsonResponse(res, 200, true, p);
    }

    // DELETE /api/store/projects/:id → delete
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)$/);
    if (method === 'DELETE' && m) {
      await store.deleteProject(m[1]);
      return jsonResponse(res, 204, true);
    }

    // POST /api/store/projects/:id/systems → addSystem
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/systems$/);
    if (method === 'POST' && m) {
      const sys = await store.addSystem(m[1], body);
      return jsonResponse(res, 201, true, sys);
    }

    // PUT /api/store/projects/:id/systems/:sysId → updateSystem
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/systems\/([^/]+)$/);
    if (method === 'PUT' && m) {
      const sys = await store.updateSystem(m[1], m[2], body);
      return jsonResponse(res, 200, true, sys);
    }

    // DELETE /api/store/projects/:id/systems/:sysId → removeSystem
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/systems\/([^/]+)$/);
    if (method === 'DELETE' && m) {
      await store.removeSystem(m[1], m[2]);
      try { await store.saveModuleTree(m[2], []); } catch {}
      return jsonResponse(res, 204, true);
    }

    // POST /api/store/projects/:id/active-system → setActiveSystem
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/active-system$/);
    if (method === 'POST' && m) {
      await store.setActiveSystem(m[1], body.systemId);
      return jsonResponse(res, 200, true);
    }

    // PUT /api/store/projects/:id/feature-table → saveFeatureTable
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/feature-table$/);
    if (method === 'PUT' && m) {
      await store.saveFeatureTable(body.systemId, body.table);
      return jsonResponse(res, 200, true);
    }

    // GET /api/store/projects/:id/feature-table?systemId=xxx → getFeatureTable
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/feature-table$/);
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? m[1];
      const table = await store.getFeatureTable(systemId);
      return jsonResponse(res, 200, true, table);
    }

    // PUT/GET /api/store/projects/:id/feature-artifact → v2 feature artifact（旧 table 路由保持兼容）
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/feature-artifact$/);
    if (method === 'PUT' && m) {
      await store.saveFeatureArtifact(body.systemId, body.artifact);
      return jsonResponse(res, 200, true);
    }
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? m[1];
      return jsonResponse(res, 200, true, await store.getFeatureArtifact(systemId));
    }

    // PUT /api/store/projects/:id/case-table → saveCaseTable
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/case-table$/);
    if (method === 'PUT' && m) {
      await store.saveCaseTable(body.systemId, body.sheets);
      return jsonResponse(res, 200, true);
    }

    // GET /api/store/projects/:id/case-table?systemId=xxx → getCaseTable
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/case-table$/);
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? m[1];
      const sheets = await store.getCaseTable(systemId);
      return jsonResponse(res, 200, true, sheets);
    }

    // GET /api/store/projects/:id/case-generation?systemId=xxx → getCaseGenerations（批次元数据，§6.5 / §17.7）
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/case-generation$/);
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? m[1];
      const gens = await store.getCaseGenerations(systemId);
      return jsonResponse(res, 200, true, gens);
    }

    // PUT /api/store/projects/:id/execution → saveExecution
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/execution$/);
    if (method === 'PUT' && m) {
      await store.saveExecution(body.systemId, body.report);
      return jsonResponse(res, 200, true);
    }

    // GET /api/store/projects/:id/execution?systemId=xxx → getExecution
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/execution$/);
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? m[1];
      const report = await store.getExecution(systemId);
      return jsonResponse(res, 200, true, report);
    }

    // PUT /api/store/projects/:id/module-tree → saveModuleTree
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/module-tree$/);
    if (method === 'PUT' && m) {
      await store.saveModuleTree(body.systemId, body.tree);
      return jsonResponse(res, 200, true);
    }

    // GET /api/store/projects/:id/module-tree?systemId=xxx → getModuleTree
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/module-tree$/);
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? m[1];
      const tree = await store.getModuleTree(systemId);
      return jsonResponse(res, 200, true, tree);
    }

    /**
     * T5：**仅合并**人工补录（不重新探索）—— 前端「入树」调用。
     * 复用已冻结契约 `mergeManualSupplement`（above/below/end + relativeToNodeId + 去重 +
     * 写 label/url/type/actionKind/manuallyAdded），落库后返回新树。
     * ⇒ 入树不再是前端本地插入，**不会丢 URL**。
     *
     * ⚠ 路径不能放在 `/api/store/explore/` 下：index 里的分发明确把
     * `/api/store/explore/*` 排除在 handleStore 之外（那段专供录制接口）。
     */
    m = pathname.match(/^\/api\/store\/promote-manual$/);
    if (method === 'POST' && m) {
      const { systemId, manualSupplement } = body as {
        systemId?: string;
        manualSupplement?: ManualSupplement;
      };
      if (!systemId || !manualSupplement) {
        return jsonResponse(res, 400, false, undefined, 'systemId 与 manualSupplement 必填');
      }
      const current = ((await store.getModuleTree(systemId)) || []) as any[];
      // 合并前先记下已有 id，合并后 diff 出**本次新增**的节点 id。
      // 「全部入树」逐条合并时需要它：子条目要挂到父条目的真实 id 下，而父 id 只有它入树后才存在。
      const idsOf = (ns: any[]): string[] => ns.flatMap((n) => [String(n.id), ...idsOf(n.children || [])]);
      const beforeIds = new Set(idsOf(current));
      const merged = mergeManualSupplement(current, manualSupplement, systemId);
      const addedNodeIds = idsOf(merged).filter((id) => !beforeIds.has(id));
      await store.saveModuleTree(systemId, merged);
      console.log(
        `[store] promote-manual: system=${systemId} paths=${manualSupplement.clickPath.length} ` +
          `pos=${manualSupplement.insertPosition} -> nodes=${merged.length} added=${addedNodeIds.length}`,
      );
      return jsonResponse(res, 200, true, { moduleTree: merged, addedNodeIds });
    }

    // --- T6：待入树列表持久化（两段式第 3 步的"永久卡片"必须刷新/重启后仍在）---
    // GET /api/store/pending-tree?systemId=xxx
    m = pathname.match(/^\/api\/store\/pending-tree$/);
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? '';
      if (!systemId) return jsonResponse(res, 400, false, undefined, 'systemId 必填');
      const items = (await store.getPendingTree(systemId)) || [];
      return jsonResponse(res, 200, true, items);
    }
    // PUT /api/store/pending-tree  body: { systemId, items }
    if (method === 'PUT' && m) {
      const { systemId, items } = body as { systemId?: string; items?: any[] };
      if (!systemId || !Array.isArray(items)) {
        return jsonResponse(res, 400, false, undefined, 'systemId 与 items 必填');
      }
      await store.savePendingTree(systemId, items);
      return jsonResponse(res, 200, true, { count: items.length });
    }

    // PUT /api/store/projects/:id/meta-config → saveMetaConfig
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/meta-config$/);
    if (method === 'PUT' && m) {
      await store.saveMetaConfig(body.systemId, body.meta);
      return jsonResponse(res, 200, true);
    }

    // GET /api/store/projects/:id/meta-config?systemId=xxx → getMetaConfig
    m = pathname.match(/^\/api\/store\/projects\/([^/]+)\/meta-config$/);
    if (method === 'GET' && m) {
      const systemId = query.get('systemId') ?? m[1];
      const meta = await store.getMetaConfig(systemId);
      return jsonResponse(res, 200, true, meta);
    }

    // GET /api/store/bootstrap → load all data for frontend init
    if (method === 'GET' && pathname === '/api/store/bootstrap') {
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
      return jsonResponse(res, 200, true, { projects: fullProjects, systemData, knowledge });
    }

    // Knowledge Base routes
    if (method === 'GET' && pathname === '/api/store/knowledge') {
      const entries = await store.listKnowledgeEntries();
      return jsonResponse(res, 200, true, entries);
    }

    if (method === 'POST' && pathname === '/api/store/knowledge') {
      const entry = await store.saveKnowledgeEntry(body);
      return jsonResponse(res, 201, true, entry);
    }

    m = pathname.match(/^\/api\/store\/knowledge\/([^/]+)$/);
    if (method === 'PUT' && m) {
      const entry = await store.saveKnowledgeEntry({ ...body, id: m[1] });
      return jsonResponse(res, 200, true, entry);
    }

    m = pathname.match(/^\/api\/store\/knowledge\/([^/]+)$/);
    if (method === 'DELETE' && m) {
      await store.deleteKnowledgeEntry(m[1]);
      return jsonResponse(res, 204, true);
    }

    return jsonResponse(res, 404, false, undefined, `Unknown store route: ${method} ${url}`);
  } catch (err: any) {
    console.error(`[server] store ERROR:`, err.message);
    return jsonResponse(res, 500, false, undefined, err.message);
  }
}

async function handleAIConfig(
  method: string,
  url: string,
  body: any,
  res: http.ServerResponse,
) {
  const store: ProjectStore = orchestrator.getStore();
  const parsed = new URL(url, 'http://localhost');
  const pathname = parsed.pathname;

  try {
    // GET /api/ai/vendors - list vendor presets
    if (method === 'GET' && pathname === '/api/ai/vendors') {
      const vendors = listVendors();
      return jsonResponse(res, 200, true, vendors);
    }

    // GET /api/ai/models?vendor=xxx - get preset models for a vendor
    if (method === 'GET' && pathname === '/api/ai/models') {
      const vendor = parsed.searchParams.get('vendor') as AIVendor;
      if (!vendor) return jsonResponse(res, 400, false, undefined, 'vendor required');
      const models = getModelsForVendor(vendor);
      const baseUrl = getBaseUrlForVendor(vendor);
      return jsonResponse(res, 200, true, { models, baseUrl });
    }

    // POST /api/ai/models/remote - fetch remote models
    if (method === 'POST' && pathname === '/api/ai/models/remote') {
      const { baseUrl, apiKey } = body;
      if (!baseUrl || !apiKey) return jsonResponse(res, 400, false, undefined, 'baseUrl and apiKey required');
      const result = await fetchRemoteModels(baseUrl, apiKey);
      return jsonResponse(res, 200, true, result);
    }

    // POST /api/ai/test-connection - test AI connection
    if (method === 'POST' && pathname === '/api/ai/test-connection') {
      const config = body;
      if (!config.baseUrl || !config.model) {
        return jsonResponse(res, 400, false, undefined, 'baseUrl and model required');
      }

      let apiKey = config.apiKey;
      if (config.configId) {
        const savedConfig = await store.getAIConfig(config.configId);
        if (!savedConfig) {
          return jsonResponse(res, 404, false, undefined, 'Config not found');
        }
        const cred = await credStore.get(savedConfig.apiKeyRef);
        if (!cred) {
          return jsonResponse(res, 400, false, undefined, 'API Key 解密失败，请重新配置密钥');
        }
        apiKey = cred.password;
      } else if (config.apiKeyRef) {
        const cred = await credStore.get(config.apiKeyRef);
        if (cred) {
          apiKey = cred.password;
        }
      }

      if (!apiKey) {
        return jsonResponse(res, 400, false, undefined, 'API Key 不可用，请重新配置');
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
      return jsonResponse(res, 200, true, result);
    }

    // GET /api/ai/configs - list all AI configs
    if (method === 'GET' && pathname === '/api/ai/configs') {
      const configs = await store.listAIConfigs();
      return jsonResponse(res, 200, true, configs);
    }

    // GET /api/ai/configs/:id - get one AI config
    let m = pathname.match(/^\/api\/ai\/configs\/([^/]+)$/);
    if (method === 'GET' && m) {
      const config = await store.getAIConfig(m[1]);
      if (!config) return jsonResponse(res, 404, false, undefined, 'AI config not found');
      return jsonResponse(res, 200, true, config);
    }

    // POST /api/ai/configs - create AI config (encrypt API key)
    if (method === 'POST' && pathname === '/api/ai/configs') {
      const { apiKey, ...configData } = body;
      let apiKeyRef = configData.apiKeyRef;

      if (apiKey) {
        apiKeyRef = await credStore.save('ai-key', apiKey);
      }
      if (!apiKeyRef) {
        return jsonResponse(res, 400, false, undefined, 'apiKey or apiKeyRef required');
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
      return jsonResponse(res, 201, true, saved);
    }

    // PUT /api/ai/configs/:id - update AI config
    m = pathname.match(/^\/api\/ai\/configs\/([^/]+)$/);
    if (method === 'PUT' && m) {
      const id = m[1];
      const patch: any = { ...body };

      if (body.apiKey) {
        const apiKeyRef = await credStore.save('ai-key', body.apiKey);
        patch.apiKeyRef = apiKeyRef;
        delete patch.apiKey;
      }

      const updated = await store.updateAIConfig(id, patch);
      return jsonResponse(res, 200, true, updated);
    }

    // DELETE /api/ai/configs/:id - delete AI config
    m = pathname.match(/^\/api\/ai\/configs\/([^/]+)$/);
    if (method === 'DELETE' && m) {
      await store.deleteAIConfig(m[1]);
      return jsonResponse(res, 204, true);
    }

    // POST /api/ai/configs/:id/enable - toggle enabled
    m = pathname.match(/^\/api\/ai\/configs\/([^/]+)\/enable$/);
    if (method === 'POST' && m) {
      const { enabled } = body;
      const updated = await store.toggleAIConfigEnabled(m[1], enabled);
      return jsonResponse(res, 200, true, updated);
    }

    // POST /api/ai/configs/:id/default - set as default
    m = pathname.match(/^\/api\/ai\/configs\/([^/]+)\/default$/);
    if (method === 'POST' && m) {
      await store.setDefaultAIConfig(m[1]);
      return jsonResponse(res, 200, true);
    }

    return jsonResponse(res, 404, false, undefined, `Unknown AI route: ${method} ${url}`);
  } catch (err: any) {
    console.error(`[server] ai-config ERROR:`, err.message);
    return jsonResponse(res, 500, false, undefined, err.message);
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const url = req.url ?? '';

  if (req.method === 'GET' && url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }

  // Store CRUD routes（录制类 /api/store/explore/* 不在此处理，见下方独立分支）
  if (url.startsWith('/api/store') && !url.startsWith('/api/store/explore/')) {
    const body = req.method !== 'GET' && req.method !== 'DELETE' ? await readBody(req) : {};
    return handleStore(req.method, url, body, res);
  }

  // AI Config routes
  if (url.startsWith('/api/ai')) {
    const body = req.method !== 'GET' && req.method !== 'DELETE' ? await readBody(req) : {};
    return handleAIConfig(req.method, url, body, res);
  }

  // Credential management routes
  if (req.method === 'POST' && url === '/api/credentials') {
    try {
      const { username, password, ref } = await readBody(req);
      if (!username || !password) {
        return jsonResponse(res, 400, false, undefined, 'username and password required');
      }
      const credRef = ref || await credStore.save(username, password);
      return jsonResponse(res, 200, true, { credentialRef: credRef });
    } catch (err: any) {
      console.error(`[server] ERROR:`, err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  if (req.method === 'GET' && url === '/api/credentials') {
    try {
      const list = await credStore.list();
      return jsonResponse(res, 200, true, list);
    } catch (err: any) {
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  // Recording routes for manual supplement (人工补录)
  // 复用登录阶段的人工接管浏览器，记录点击位置/路径，stop 时与已探索模块树去重后并入
  if (url === '/api/store/explore/start-recording' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { systemId, url: systemUrl } = body;
      if (!systemId) {
        return jsonResponse(res, 400, false, undefined, 'systemId required');
      }
      const engine = getTakeoverEngine(systemId);
      if (!engine) {
        return jsonResponse(res, 400, false, undefined, '未找到登录浏览器，请先在「登录」阶段完成人工登录');
      }
      if (systemUrl) {
        if (isInvalidSystemUrl(systemUrl)) {
          return jsonResponse(res, 400, false, undefined, '系统 URL 无效，请配置真实系统地址（不要使用 example.com 占位地址）');
        }
        await engine.navigate(systemUrl);
      }
      // 在登录浏览器内注入点击录制器：捕获每次点击的 url/selector/text
      // 以字符串形式注入，避免在 Node(无 DOM 类型) 下触发类型检查
      // 收窄 selector + 过滤外链/锚点/装饰元素 + text 取 aria-label/直接文本，避免路径噪音
      try {
        await engine.evaluate(`(function(){
          if (window.__tpCapture) {
            try { document.removeEventListener('click', window.__tpCapture, true); } catch (e) {}
          }
          window.__tpClicks = [];
          window.__tpLastMenu = '';
          // HARD RULE #0：可点击元素只用【标准元素 + ARIA role】，禁止框架类名。
          // 历史违规已清除：.ant-tabs-tab / .el-tabs__item / .ant-list-item / [role="listitem"] / tr / select / textarea
          // （人工补充只需要「菜单项 + 页面按钮/功能」，表格行与表单控件不是功能点）
          var SEL = 'a[href],button,[role="button"],[role="tab"],[role="menuitem"],input[type="button"],input[type="submit"]';
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
          /**
           * 导航区判定（几何，与自动探索 navZoneShape 同口径，零类名）：
           * 侧栏=贴边竖向窄条；顶栏=贴顶横向矮条。命中 ⇒ 本次点击是「菜单项」，
           * 否则是「页面按钮/功能」（人工补充的最小颗粒度）。
           */
          var inNavZone = function(el){
            var vw = window.innerWidth || document.documentElement.clientWidth || 1;
            var vh = window.innerHeight || document.documentElement.clientHeight || 1;
            var p = el, d = 0;
            while(p && p !== document.body && d < 8){
              var r = p.getBoundingClientRect ? p.getBoundingClientRect() : null;
              if(r && r.width > 0 && r.height > 0){
                if((r.left <= vw*0.12 || r.right >= vw*0.88) && r.width <= vw*0.45 && r.height >= vh*0.08) return true;
                if(r.top <= vh*0.12 && r.height <= vh*0.15 && r.width >= vw*0.35) return true;
              }
              p = p.parentElement; d++;
            }
            return false;
          };
          /**
           * 动作语义分类（**通用业务动词**，与 contracts 的 ModuleNode.actionKind 同枚举；
           * 不含任何系统/框架指纹，不违反 HARD RULE #0）。
           * 目的：让待入树条目字段与「模块树节点所需参数」一致（用户要求），入树时无损直传。
           */
          var classifyAction = function(t){
            t = (t||'').trim();
            if(/新增|新建|添加|创建|add|create|new/i.test(t)) return 'create';
            if(/编辑|修改|更新|edit|update/i.test(t)) return 'update';
            if(/删除|移除|delete|remove/i.test(t)) return 'delete';
            if(/查询|搜索|检索|search|query|filter/i.test(t)) return 'query';
            if(/重置|清空|reset/i.test(t)) return 'reset';
            if(/详情|查看|detail|view/i.test(t)) return 'detail';
            if(/导入|上传|import|upload/i.test(t)) return 'import';
            if(/导出|下载|export|download/i.test(t)) return 'export';
            if(/列表|list/i.test(t)) return 'list';
            return 'other';
          };
          /**
           * DOM 层级（**判断父子关系的结构信号，与系统无关**）：
           * 统计元素向上穿过的「列表容器」个数（ul/ol 或 role=menu/group/tree/menubar）。
           * 同一容器内并列的菜单项 level 相同 ⇒ 同级；嵌套列表里的 level 更大 ⇒ 子级。
           * 用途：修正「点击顺序 ≠ 层级」——依次点几个同级 tab 不应被串成深层链。
           */
          var domLevel = function(el){
            var lvl = 0, p = el.parentElement, d = 0;
            while(p && p !== document.body && d < 12){
              var tag = p.tagName;
              var role = (p.getAttribute && (p.getAttribute('role') || '').toLowerCase()) || '';
              if(tag === 'UL' || tag === 'OL' || role === 'menu' || role === 'group' || role === 'tree' || role === 'menubar') lvl++;
              p = p.parentElement; d++;
            }
            return lvl;
          };
          // DOM 祖先菜单链：向上收集"含子菜单的 li"的标题文本 —— 这是**真实层级**，
          // 与点击顺序无关（用户跳跃点击、来回切换都不会再串链或拍平）。
          // 只依赖 ul/li 标准列表结构（结构判据，非框架类名，符合 HARD RULE #0）。
          var menuPath = function(el){
            var path = [];
            var li = el.closest ? el.closest('li') : null;
            var guard = 0;
            while (li && guard++ < 12) {
              var outer = li.parentElement ? li.parentElement.closest('li') : null;
              if (!outer) break;
              // 祖先 li 的标题 = 其直接子节点中非 UL 部分的文本（不含子菜单内容）
              var t = '';
              for (var cn = outer.firstChild; cn; cn = cn.nextSibling) {
                if (cn.nodeType === 1 && !/^UL$/i.test(cn.tagName)) t += ' ' + (cn.textContent || '');
              }
              t = t.replace(/\s+/g, ' ').trim();
              if (t) path.unshift(t.slice(0, 40));
              li = outer;
            }
            return path;
          };
          var capture = function(e){
            var t = e.target;
            var el = (t && t.closest) ? t.closest(SEL) : null;
            if(!el || !isVisible(el)) return;
            if(el.tagName==='A' && isExternalLink(el)) return;
            var text = textOf(el||t);
            // 无文本的图标/装饰链接不是可入树的菜单项（实测 fantastic 首页会混入空文本项）
            if(!text) return;
            var kind = inNavZone(el) ? 'menu' : 'action';
            var rec = {
              url: location.href,           // 先入数组（不丢），URL 稍后修正为真实落地地址
              text: text,
              selector: describe(el||t),
              timestamp: Date.now(),
              kind: kind,
              // 结构信号：所在列表容器的嵌套层数（供前端判定父子，替代"点击顺序即层级"）
              domLevel: domLevel(el),
              // **权威层级信号**：DOM 祖先菜单链（真实 ul/li 嵌套里的祖先菜单标题）。
              // 前端按它建层级 ⇒ 与点击顺序完全无关（修正"层级拍平/串深链"两类问题）。
              menuPath: kind === 'menu' ? menuPath(el) : undefined,
              // 归属**只对「页面按钮/功能」有意义**（它属于最近一次点开的菜单）；
              // 菜单项自身写 parentMenu 会造成语义混乱（实测暴露）。
              parentMenu: kind === 'action' ? (window.__tpLastMenu || undefined) : undefined,
              // 与 ModuleNode 对齐：动作语义分类（仅按钮/功能有值）
              actionKind: kind === 'action' ? classifyAction(text) : undefined,
            };
            window.__tpClicks.push(rec);
            if(kind === 'menu') window.__tpLastMenu = text;
            // **关键修复**：click 事件里立即读 location.href 拿到的是「点击前」地址（SPA/hash/iframe 场景
            // 会导致整段录制 url 全同 → 前端按 URL 分组后只剩一条）。延迟读取真实落地地址；
            // 同时优先用该元素自身的 href 解析出目标地址（更贴近"这个菜单通向哪"）。
            var href = (el.getAttribute && el.getAttribute('href')) || '';
            setTimeout(function(){
              var u = location.href;
              if(href && !/^(javascript:|#)/i.test(href)){
                try { var abs = new URL(href, location.href).href; if(/^https?:$/i.test(new URL(abs).protocol)) u = abs; } catch(err){}
              }
              rec.url = u;
            }, 400);
          };
          window.__tpCapture = capture;
          document.addEventListener('click', capture, true);
        })()`);
      } catch {
        // 录制器注入失败不阻断录制流程
      }
      const recordingId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeRecordings.set(recordingId, { systemId, systemUrl: systemUrl ?? '', startTime: Date.now(), clicks: [] });
      console.log(`[server] Started recording ${recordingId} for system ${systemId}`);
      return jsonResponse(res, 200, true, { recordingId, browserUrl: systemUrl ?? '' });
    } catch (err: any) {
      console.error(`[server] ERROR start-recording:`, err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  if (url === '/api/store/explore/stop-recording' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { recordingId } = body;
      if (!recordingId) {
        return jsonResponse(res, 400, false, undefined, 'recordingId required');
      }
      const recording = activeRecordings.get(recordingId);
      if (!recording) {
        return jsonResponse(res, 404, false, undefined, 'Recording not found');
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
      console.log(`[server] Stopped recording ${recordingId}, captured ${clicks.length} clicks`);
      return jsonResponse(res, 200, true, {
        recordingId,
        capturedUrl,
        capturedTitle,
        clickPath: { steps: clicks },
        duration: Date.now() - recording.startTime,
      });
    } catch (err: any) {
      console.error(`[server] ERROR stop-recording:`, err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  if (url === '/api/store/explore/list-recordings' && req.method === 'GET') {
    try {
      const recordings = Array.from(activeRecordings.entries()).map(([id, data]) => ({
        recordingId: id,
        systemId: data.systemId,
        systemUrl: data.systemUrl,
        startTime: data.startTime,
        clickCount: data.clicks.length,
      }));
      return jsonResponse(res, 200, true, recordings);
    } catch (err: any) {
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  /**
   * T5 的「仅合并」路由见上方 `/api/store/projects/:id/module-tree` 同作用域处
   * （那里才有 store，`url ===` 作用域内无 store 变量）。
   */

  if (req.method === 'POST' && url === '/api/stage') {
    try {
      const { stage, input } = await readBody(req);
      console.log(`[server] stage=${stage}`);

      const validStages = ['login', 'explore', 'feature', 'case', 'execute', 'defect'];
      if (!validStages.includes(stage)) {
        return jsonResponse(res, 400, false, undefined, `Invalid stage: ${stage}`);
      }

      // 登录阶段：自动预处理凭证（直接传 username/password 即可，无需 credentialRef）
      let processedInput = input ?? {};
      if (stage === 'login') {
        processedInput = await preprocessLoginInput(processedInput);
      }

      const output = await orchestrator.runStage(stage, processedInput);
      return jsonResponse(res, 200, true, output);
    } catch (err: any) {
      console.error(`[server] ERROR:`, err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  if (req.method === 'POST' && url === '/api/full-pipeline') {
    try {
      const input = await readBody(req);
      console.log(`[server] full pipeline started`);

      // 预处理 login 凭证
      if (input.login) {
        input.login = await preprocessLoginInput(input.login);
      }

      const result = await orchestrator.run(input);
      return jsonResponse(res, 200, true, result);
    } catch (err: any) {
      console.error(`[server] ERROR:`, err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  // ===== 浏览器捕获 API =====
  if (url === '/api/capture/start' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { portalUrl, systemId } = body;
      if (!portalUrl) {
        return jsonResponse(res, 400, false, undefined, 'portalUrl is required');
      }
      const session = await captureService.startCapture(portalUrl, systemId);
      return jsonResponse(res, 200, true, session);
    } catch (err: any) {
      console.error('[capture] start error:', err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  if (url.startsWith('/api/capture/status/') && req.method === 'GET') {
    const sessionId = decodeURIComponent(url.split('/').pop() || '');
    const status = captureService.getStatus(sessionId);
    return jsonResponse(res, 200, true, status);
  }

  if (url.startsWith('/api/capture/complete/') && req.method === 'POST') {
    try {
      const sessionId = decodeURIComponent(url.split('/').pop() || '');
      const result = await captureService.completeCapture(sessionId);
      return jsonResponse(res, 200, true, result);
    } catch (err: any) {
      console.error('[capture] complete error:', err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  if (url.startsWith('/api/capture/cancel/') && req.method === 'POST') {
    try {
      const sessionId = decodeURIComponent(url.split('/').pop() || '');
      await captureService.cancelCapture(sessionId);
      return jsonResponse(res, 200, true);
    } catch (err: any) {
      console.error('[capture] cancel error:', err.message);
      return jsonResponse(res, 500, false, undefined, err.message);
    }
  }

  jsonResponse(res, 404, false, undefined, 'Not Found');
});

server.listen(PORT, () => {
  console.log(`\n  Test Platform Backend Bridge running on http://localhost:${PORT}`);
  console.log(`  ├── POST /api/credentials   Store credentials (auto-encrypt)`);
  console.log(`  ├── GET  /api/credentials   List stored credentials`);
  console.log(`  ├── POST /api/stage         Run a single stage (login auto-preprocesses credentials)`);
  console.log(`  ├── POST /api/full-pipeline Run the full pipeline`);
  console.log(`  ├── POST /api/capture/start    Start browser capture (Playwright direct)`);
  console.log(`  ├── GET  /api/capture/status/:id  Get capture session status`);
  console.log(`  ├── POST /api/capture/complete/:id Complete capture and get results`);
  console.log(`  ├── POST /api/capture/cancel/:id  Cancel capture session`);
  console.log(`  ├── GET  /api/store/bootstrap  Load all data (frontend init)`);
  console.log(`  ├── GET  /api/store/projects  List projects`);
  console.log(`  ├── POST /api/store/projects  Create project`);
  console.log(`  └── ... /api/store/projects/:id/*  CRUD + stage data\n`);
});
