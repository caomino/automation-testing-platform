/**
 * @file dataApi.ts
 * @description 前端 ↔ 后端 ProjectStore CRUD API 客户端
 *   所有数据持久化通过此文件走真实后端 API
 *   后端: http://localhost:3001 (Vite proxy /api → localhost:3001)
 */

import type { Project, System, FeatureRow, CaseSheet, ExecutionResult } from '@test-platform/contracts';

/**
 * 判断响应是否为 JSON。部署态若 /api 未被反向代理，自写静态服务器会返回
 * index.html（Content-Type: text/html），此时 res.json() 会抛 "Unexpected token '<'"，
 * 用户只看到天书报错。这里提前识别并返回可读诊断。
 */
function isJsonResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json');
}

function nonJsonDiagnostic(res: Response): string {
  const ct = res.headers.get('content-type') || '未知';
  return `接口返回的不是 JSON（Content-Type: ${ct}），很可能是前端 /api 未被反向代理到后端，或后端服务未启动。请确认部署时 5173 端口已配置 /api → 3001 代理。`;
}

const API = '/api/store';

async function apiCall<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    if (!isJsonResponse(res)) throw new Error(nonJsonDiagnostic(res));
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;

  if (!isJsonResponse(res)) throw new Error(nonJsonDiagnostic(res));

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Unknown error');
  return json.data as T;
}

// ===== 启动加载 =====

export interface KnowledgeEntryApi {
  id: string;
  scope: 'project' | 'system';
  projectId: string;
  systemId?: string;
  content: string;
  updatedAt?: number;
}

export interface BootstrapData {
  projects: Project[];
  systemData: Record<string, { featureTable?: any; caseTable?: any; execution?: any }>;
  knowledge: KnowledgeEntryApi[];
}

export async function loadBootstrap(): Promise<BootstrapData> {
  return apiCall<BootstrapData>('/bootstrap');
}

// ===== Project CRUD =====

export async function listProjects(): Promise<{ id: string; name: string; systemCount: number; updatedAt: number }[]> {
  return apiCall('/projects');
}

export async function getProject(id: string): Promise<Project | null> {
  return apiCall(`/projects/${id}`);
}

export async function createProject(input: { name: string; description?: string; type?: string }): Promise<Project> {
  return apiCall('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  return apiCall(`/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteProject(id: string): Promise<void> {
  return apiCall(`/projects/${id}`, { method: 'DELETE' });
}

// ===== System CRUD =====

export async function addSystem(projectId: string, input: {
  name: string;
  url: string;
  type: string;
  credentialMode?: string;
  loginState?: string;
  parentPortalId?: string;
}): Promise<System> {
  return apiCall(`/projects/${projectId}/systems`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateSystem(projectId: string, systemId: string, patch: Partial<System>): Promise<System> {
  return apiCall(`/projects/${projectId}/systems/${systemId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function removeSystem(projectId: string, systemId: string): Promise<void> {
  return apiCall(`/projects/${projectId}/systems/${systemId}`, { method: 'DELETE' });
}

// ===== Stage Data =====

export async function setActiveSystem(projectId: string, systemId: string): Promise<void> {
  return apiCall(`/projects/${projectId}/active-system`, {
    method: 'POST',
    body: JSON.stringify({ systemId }),
  });
}

export async function saveFeatureTable(projectId: string, systemId: string, table: FeatureRow[][]): Promise<void> {
  return apiCall(`/projects/${projectId}/feature-table`, {
    method: 'PUT',
    body: JSON.stringify({ systemId, table }),
  });
}

export async function getFeatureTable(projectId: string, systemId?: string): Promise<FeatureRow[][] | null> {
  const qs = systemId ? `?systemId=${encodeURIComponent(systemId)}` : '';
  return apiCall(`/projects/${projectId}/feature-table${qs}`);
}

export async function saveCaseTable(projectId: string, systemId: string, sheets: CaseSheet[]): Promise<void> {
  return apiCall(`/projects/${projectId}/case-table`, {
    method: 'PUT',
    body: JSON.stringify({ systemId, sheets }),
  });
}

export async function getCaseTable(projectId: string, systemId?: string): Promise<CaseSheet[] | null> {
  const qs = systemId ? `?systemId=${encodeURIComponent(systemId)}` : '';
  return apiCall(`/projects/${projectId}/case-table${qs}`);
}

export async function saveMetaConfig(projectId: string, systemId: string, meta: Record<string, any>): Promise<void> {
  return apiCall(`/projects/${projectId}/meta-config`, {
    method: 'PUT',
    body: JSON.stringify({ systemId, meta }),
  });
}

export async function getMetaConfig(projectId: string, systemId?: string): Promise<Record<string, any> | null> {
  const qs = systemId ? `?systemId=${encodeURIComponent(systemId)}` : '';
  return apiCall(`/projects/${projectId}/meta-config${qs}`);
}

export async function saveExecution(projectId: string, systemId: string, report: ExecutionResult[]): Promise<void> {
  return apiCall(`/projects/${projectId}/execution`, {
    method: 'PUT',
    body: JSON.stringify({ systemId, report }),
  });
}

export async function getExecution(projectId: string, systemId?: string): Promise<ExecutionResult[] | null> {
  const qs = systemId ? `?systemId=${encodeURIComponent(systemId)}` : '';
  return apiCall(`/projects/${projectId}/execution${qs}`);
}

// ===== Log Management =====

export interface LogFileView {
  filename: string;
  size: number;
  lastWrite: number;
  subsystem: string;
  task: string;
}

export interface LogPolicy {
  retentionDays: number;
  maxFileSizeMB: number;
  maxFiles: number;
}

const LOG_STORAGE_KEY = 'test-platform:log-files';
const LOG_POLICY_KEY = 'test-platform:log-policy';
const LOG_DIR_KEY = 'test-platform:log-dir';

const DEFAULT_LOG_DIR = 'D:/test-platform-data/logs';

function loadLocalFiles(): LogFileView[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
    return createSampleLogs();
  } catch {
    return createSampleLogs();
  }
}

function saveLocalFiles(files: LogFileView[]): void {
  localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(files));
}

function createSampleLogs(): LogFileView[] {
  const now = Date.now();
  const samples: LogFileView[] = [
    {
      subsystem: '门户系统',
      task: '登录流程',
      filename: 'app.log',
      size: 2048,
      lastWrite: now,
    },
    {
      subsystem: '门户系统',
      task: '功能探索',
      filename: 'app.log.1',
      size: 15360,
      lastWrite: now - 3600_000,
    },
    {
      subsystem: '订单子系统',
      task: '用例生成',
      filename: 'app.log.2',
      size: 10240,
      lastWrite: now - 86400_000,
    },
    {
      subsystem: '订单子系统',
      task: '测试执行',
      filename: 'app.log.3',
      size: 5120,
      lastWrite: now - 172800_000,
    },
  ];
  localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(samples));
  return samples;
}

function loadLocalPolicy(): LogPolicy {
  try {
    const raw = localStorage.getItem(LOG_POLICY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 };
}

function saveLocalPolicy(policy: LogPolicy): void {
  localStorage.setItem(LOG_POLICY_KEY, JSON.stringify(policy));
}

function getLocalLogDir(): string {
  try {
    return localStorage.getItem(LOG_DIR_KEY) || DEFAULT_LOG_DIR;
  } catch {
    return DEFAULT_LOG_DIR;
  }
}

export async function listLogs(): Promise<LogFileView[]> {
  return loadLocalFiles();
}

export async function getLogDir(): Promise<string> {
  return getLocalLogDir();
}

export async function cleanupExpiredLogs(): Promise<number> {
  const policy = loadLocalPolicy();
  const threshold = Date.now() - policy.retentionDays * 86_400_000;
  const files = loadLocalFiles();
  const kept: LogFileView[] = [];
  let deleted = 0;
  for (const f of files) {
    if (f.lastWrite < threshold) {
      deleted++;
    } else {
      kept.push(f);
    }
  }
  saveLocalFiles(kept);
  return deleted;
}

export async function clearAllLogs(): Promise<void> {
  saveLocalFiles([]);
}

export async function deleteLogFile(filename: string): Promise<void> {
  const files = loadLocalFiles();
  const kept = files.filter((f) => f.filename !== filename);
  saveLocalFiles(kept);
}

export async function updateLogPolicy(policy: LogPolicy): Promise<void> {
  saveLocalPolicy(policy);
}

// ===== Module Tree =====

export async function saveModuleTree(projectId: string, systemId: string, tree: any[]): Promise<void> {
  return apiCall(`/projects/${projectId}/module-tree`, {
    method: 'PUT',
    body: JSON.stringify({ systemId, tree }),
  });
}

export async function getModuleTree(projectId: string, systemId?: string): Promise<any[] | null> {
  const qs = systemId ? `?systemId=${encodeURIComponent(systemId)}` : '';
  return apiCall(`/projects/${projectId}/module-tree${qs}`);
}

// ===== Recording (Manual Supplement) =====

export async function startRecording(systemId: string, url: string): Promise<{ recordingId: string; browserUrl: string }> {
  const res = await fetch(`${API}/explore/start-recording`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemId, url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

export async function stopRecording(recordingId: string): Promise<{ recordingId: string; capturedUrl: string; capturedTitle: string; clickPath: { steps: any[] }; duration: number }> {
  const res = await fetch(`${API}/explore/stop-recording`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

// ===== Browser Capture (MCP 浏览器捕获) =====

const CAPTURE_API = '/api/capture';

export interface CaptureSessionApi {
  id: string;
  status: 'idle' | 'capturing' | 'completing' | 'completed' | 'cancelling' | 'failed';
  portalUrl: string;
  systemId?: string;
  createdAt: number;
  capturedResult?: CaptureResultApi;
  error?: string;
}

export interface CaptureResultApi {
  capturedUrl: string;
  capturedTitle: string;
  cookies: string[];
  headers: Record<string, string>;
  tokens: string[];
  navigationPath: string[];
  capturedAt: number;
}

async function captureApiCall<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CAPTURE_API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    if (!isJsonResponse(res)) throw new Error(nonJsonDiagnostic(res));
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;

  if (!isJsonResponse(res)) throw new Error(nonJsonDiagnostic(res));

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Unknown error');
  return json.data as T;
}

/** 启动 MCP 浏览器捕获 */
export async function startCapture(portalUrl: string, systemId?: string): Promise<CaptureSessionApi> {
  return captureApiCall('/start', {
    method: 'POST',
    body: JSON.stringify({ portalUrl, systemId }),
  });
}

/** 查询捕获状态 */
export async function getCaptureStatus(sessionId: string): Promise<CaptureSessionApi | null> {
  return captureApiCall(`/status/${encodeURIComponent(sessionId)}`);
}

/** 完成捕获，获取结果 */
export async function completeCapture(sessionId: string): Promise<CaptureResultApi> {
  return captureApiCall(`/complete/${encodeURIComponent(sessionId)}`, { method: 'POST' });
}

/** 取消捕获 */
export async function cancelCapture(sessionId: string): Promise<void> {
  return captureApiCall(`/cancel/${encodeURIComponent(sessionId)}`, { method: 'POST' });
}

// ===== AI Config =====

export interface AIConfigApi {
  id: string;
  name: string;
  vendor: string;
  baseUrl: string;
  apiKeyRef: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  temperature?: number;
  maxTokens?: number;
  createdAt: number;
  updatedAt: number;
}

export interface VendorInfo {
  vendor: string;
  label: string;
  baseUrl: string;
  models: string[];
  description: string;
}

export interface TestConnectionResultApi {
  success: boolean;
  status: number;
  message: string;
  latencyMs: number;
}

const AI_API = '/api/ai';

async function aiApiCall<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${AI_API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    if (!isJsonResponse(res)) throw new Error(nonJsonDiagnostic(res));
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;

  if (!isJsonResponse(res)) throw new Error(nonJsonDiagnostic(res));

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Unknown error');
  return json.data as T;
}

export async function listVendorsApi(): Promise<VendorInfo[]> {
  return aiApiCall<VendorInfo[]>('/vendors');
}

export async function getVendorModels(vendor: string): Promise<{ models: string[]; baseUrl: string }> {
  return aiApiCall(`/models?vendor=${encodeURIComponent(vendor)}`);
}

export async function fetchRemoteModelsApi(baseUrl: string, apiKey: string): Promise<{ success: boolean; models: string[]; message: string }> {
  return aiApiCall('/models/remote', {
    method: 'POST',
    body: JSON.stringify({ baseUrl, apiKey }),
  });
}

export async function testAIConnection(config: { baseUrl: string; model: string; configId?: string; apiKey?: string; apiKeyRef?: string }): Promise<TestConnectionResultApi> {
  return aiApiCall('/test-connection', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function listAIConfigs(): Promise<AIConfigApi[]> {
  return aiApiCall<AIConfigApi[]>('/configs');
}

export async function getAIConfig(id: string): Promise<AIConfigApi | null> {
  return aiApiCall(`/configs/${id}`);
}

export async function createAIConfig(config: {
  name: string;
  vendor: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyRef?: string;
  model: string;
  enabled?: boolean;
  isDefault?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<AIConfigApi> {
  return aiApiCall('/configs', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function updateAIConfig(id: string, config: {
  name?: string;
  vendor?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyRef?: string;
  model?: string;
  enabled?: boolean;
  isDefault?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<AIConfigApi> {
  return aiApiCall(`/configs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function deleteAIConfig(id: string): Promise<void> {
  return aiApiCall(`/configs/${id}`, { method: 'DELETE' });
}

export async function toggleAIConfig(id: string, enabled: boolean): Promise<AIConfigApi> {
  return aiApiCall(`/configs/${id}/enable`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export async function setDefaultAIConfig(id: string): Promise<void> {
  return aiApiCall(`/configs/${id}/default`, { method: 'POST' });
}

// ===== Knowledge Base =====

export async function listKnowledgeEntries(): Promise<KnowledgeEntryApi[]> {
  return apiCall<KnowledgeEntryApi[]>('/knowledge', { method: 'GET' });
}

export async function saveKnowledgeEntry(entry: KnowledgeEntryApi): Promise<KnowledgeEntryApi> {
  const url = entry.id ? `/knowledge/${entry.id}` : '/knowledge';
  const method = entry.id ? 'PUT' : 'POST';
  return apiCall<KnowledgeEntryApi>(url, {
    method,
    body: JSON.stringify(entry),
  });
}

export async function deleteKnowledgeEntry(id: string): Promise<void> {
  return apiCall(`/knowledge/${id}`, { method: 'DELETE' });
}
