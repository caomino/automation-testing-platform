/**
 * @file index.ts
 * @description 持久化层（infra-store）
 *   SQLite 数据库实现。数据外部化落库至 D:\test-platform-data\store\projects.db。
 *   接口冻结，实现可替换。
 */
import type { Project, System, FeatureRow, CaseSheet, ExecutionResult, SystemType, SessionHandle } from '@test-platform/contracts';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import initSqlJs from 'sql.js';

/** Playwright storageState 形状（cookies + localStorage/origins），用于无失真会话复用 */
export interface StorageState {
  cookies: Array<Record<string, any>>;
  origins: Array<Record<string, any>>;
}

/** 新建项目输入 */
export interface NewProjectInput {
  name: string;
  description?: string;
  type?: SystemType;
  logRetentionDays?: number;
  aiAssistEnabled?: boolean;
}

/** 项目摘要（列表用） */
export interface ProjectSummary {
  id: string;
  name: string;
  systemCount: number;
  updatedAt: number;
}

/** 系统操作输入 */
export interface SystemInput {
  id?: string;
  name: string;
  url: string;
  type: SystemType;
  credentialMode?: System['credentialMode'];
  loginState?: System['loginState'];
  pageTitle?: string;
  parentPortalId?: string;
  parentPortalPath?: string;
  credentials?: { username: string; credentialRef: string };
  sessionState?: System['sessionState'];
  navigationPath?: string[];
}

/** 知识库条目 */
export interface KnowledgeEntry {
  id: string;
  scope: 'project' | 'system';
  projectId: string;
  systemId?: string;
  content: string;
  updatedAt: number;
}

/** AI 配置记录 */
export interface AIConfigRecord {
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

/**
 * 持久化存储接口（冻结）。
 * 所有业务数据（项目/系统/功能点/用例/执行结果）经此落库。
 */
export interface ProjectStore {
  createProject(input: NewProjectInput): Promise<Project>;
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | null>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  addSystem(projectId: string, system: SystemInput): Promise<System>;
  updateSystem(projectId: string, systemId: string, patch: Partial<System>): Promise<System>;
  removeSystem(projectId: string, systemId: string): Promise<void>;
  setActiveSystem(projectId: string, systemId: string): Promise<void>;
  saveFeatureTable(systemId: string, table: FeatureRow[][]): Promise<void>;
  saveCaseTable(systemId: string, sheets: CaseSheet[]): Promise<void>;
  saveExecution(systemId: string, report: ExecutionResult[]): Promise<void>;
  getFeatureTable(systemId: string): Promise<FeatureRow[][] | null>;
  getCaseTable(systemId: string): Promise<CaseSheet[] | null>;
  getExecution(systemId: string): Promise<ExecutionResult[] | null>;
  saveSession(systemId: string, session: SessionHandle): Promise<void>;
  getSession(systemId: string): Promise<SessionHandle | null>;
  invalidateSession(systemId: string): Promise<void>;
  saveModuleTree(systemId: string, tree: any[]): Promise<void>;
  getModuleTree(systemId: string): Promise<any[] | null>;

  /** 保存/读取系统的元配置（如用例表头 meta、前置条件等） */
  saveMetaConfig(systemId: string, meta: Record<string, any>): Promise<void>;
  getMetaConfig(systemId: string): Promise<Record<string, any> | null>;

  /** 持久化浏览器 storageState（cookies+localStorage），用于探索/执行阶段无失真复用登录会话 */
  saveStorageState(systemId: string, state: StorageState): Promise<void>;
  getStorageState(systemId: string): Promise<StorageState | null>;

  // Knowledge Base
  listKnowledgeEntries(): Promise<KnowledgeEntry[]>;
  getKnowledgeEntry(projectId: string, systemId?: string): Promise<KnowledgeEntry | null>;
  saveKnowledgeEntry(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  deleteKnowledgeEntry(id: string): Promise<void>;

  // AI Config
  listAIConfigs(): Promise<AIConfigRecord[]>;
  getAIConfig(id: string): Promise<AIConfigRecord | null>;
  saveAIConfig(config: AIConfigRecord): Promise<AIConfigRecord>;
  updateAIConfig(id: string, patch: Partial<AIConfigRecord>): Promise<AIConfigRecord>;
  deleteAIConfig(id: string): Promise<void>;
  setDefaultAIConfig(id: string): Promise<void>;
  toggleAIConfigEnabled(id: string, enabled: boolean): Promise<AIConfigRecord>;
}

const DEFAULT_DATA_DIR = join('D:', 'test-platform-data', 'store');
const DEFAULT_DB_PATH = join(DEFAULT_DATA_DIR, 'projects.db');

let sqlJsPromise: Promise<any> | null = null;

function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

type SqlDb = any;
type SqlStmt = any;

/** SQLite 持久化实现 */
class SqliteProjectStore implements ProjectStore {
  private dbPath: string;
  private db: SqlDb = null as any;
  private initPromise: Promise<void>;
  private inMemory: boolean;

  constructor(dbPath?: string) {
    this.inMemory = !dbPath && process.env.NODE_ENV === 'test';
    this.dbPath = dbPath ?? (this.inMemory ? ':memory:' : DEFAULT_DB_PATH);
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const SQL = await getSqlJs();

    if (this.inMemory) {
      this.db = new SQL.Database();
    } else {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (existsSync(this.dbPath)) {
        const data = readFileSync(this.dbPath);
        this.db = new SQL.Database(data);
      } else {
        this.db = new SQL.Database();
      }
    }

    const db = this.ready();
    db.run(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      type TEXT DEFAULT 'standalone', log_retention_days INTEGER DEFAULT 30,
      ai_assist_enabled INTEGER DEFAULT 0, systems TEXT DEFAULT '[]',
      active_system_id TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    
    // 迁移：检查并添加缺失的列
    try {
      const columns = db.exec("PRAGMA table_info(projects)");
      const columnNames = columns[0]?.values.map((row: any) => row[1]) || [];
      if (!columnNames.includes('active_system_id')) {
        db.run('ALTER TABLE projects ADD COLUMN active_system_id TEXT DEFAULT NULL');
        console.log('[infra-store] Migration: added active_system_id column to projects table');
      }
    } catch (migrationErr) {
      console.warn('[infra-store] Migration check failed:', migrationErr instanceof Error ? migrationErr.message : migrationErr);
    }
    db.run(`CREATE TABLE IF NOT EXISTS feature_tables (
      system_id TEXT PRIMARY KEY, data TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS case_tables (
      system_id TEXT PRIMARY KEY, data TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS executions (
      system_id TEXT PRIMARY KEY, data TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
      system_id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS module_trees (
      system_id TEXT PRIMARY KEY, data TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS meta_configs (
      system_id TEXT PRIMARY KEY, data TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS storage_states (
      system_id TEXT PRIMARY KEY, data TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS knowledge_base (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('project', 'system')),
      project_id TEXT NOT NULL,
      system_id TEXT,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS ai_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      vendor TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_ref TEXT NOT NULL,
      model TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    if (!this.inMemory) this.flush();
  }

  private flush(): void {
    if (this.inMemory) return;
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  private ready(): SqlDb {
    if (!this.db) throw new Error('store not initialized');
    return this.db;
  }

  private all(stmt: SqlStmt): Record<string, any>[] {
    const rows: Record<string, any>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  private one(stmt: SqlStmt): Record<string, any> | null {
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  // --- Project ---

  async createProject(input: NewProjectInput): Promise<Project> {
    await this.initPromise;
    const now = Date.now();
    const id = randomUUID();
    const project: Project = {
      id,
      name: input.name,
      description: input.description ?? '',
      type: input.type ?? 'standalone',
      systems: [],
      logRetentionDays: input.logRetentionDays ?? 30,
      aiAssistEnabled: input.aiAssistEnabled ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.ready().run(
      `INSERT INTO projects (id, name, description, type, log_retention_days, ai_assist_enabled, systems, active_system_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, project.name, project.description, project.type, project.logRetentionDays, project.aiAssistEnabled ? 1 : 0, JSON.stringify([]), null, now, now]
    );
    this.flush();
    return project;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT id, name, systems, updated_at FROM projects ORDER BY created_at');
    const rows = this.all(stmt);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      systemCount: JSON.parse(row.systems || '[]').length,
      updatedAt: row.updated_at,
    }));
  }

  async getProject(id: string): Promise<Project | null> {
    await this.initPromise;
    const stmt = this.ready().prepare(
      'SELECT id, name, description, type, log_retention_days, ai_assist_enabled, systems, active_system_id, created_at, updated_at FROM projects WHERE id = ?'
    );
    stmt.bind([id]);
    const row = this.one(stmt);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      logRetentionDays: row.log_retention_days,
      aiAssistEnabled: !!row.ai_assist_enabled,
      systems: JSON.parse(row.systems || '[]'),
      activeSystemId: row.active_system_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    await this.initPromise;
    const cur = await this.getProject(id);
    if (!cur) throw new Error(`project not found: ${id}`);
    const now = Date.now();
    const nextTs = Math.max(now, cur.updatedAt + 1);
    const next: Project = { ...cur, ...patch, id: cur.id, updatedAt: nextTs };

    const sets = ['name = ?', 'description = ?', 'type = ?', 'log_retention_days = ?', 'ai_assist_enabled = ?', 'systems = ?', 'active_system_id = ?', 'updated_at = ?'];
    const vals = [next.name, next.description, next.type, next.logRetentionDays, next.aiAssistEnabled ? 1 : 0, JSON.stringify(next.systems), next.activeSystemId || null, nextTs, id];
    this.ready().run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, vals);
    this.flush();
    return next;
  }

  async deleteProject(id: string): Promise<void> {
    await this.initPromise;
    const cur = await this.getProject(id);
    if (!cur) throw new Error(`project not found: ${id}`);
    this.ready().run('DELETE FROM projects WHERE id = ?', [id]);
    for (const sys of cur.systems) {
      this.ready().run('DELETE FROM feature_tables WHERE system_id = ?', [sys.id]);
      this.ready().run('DELETE FROM case_tables WHERE system_id = ?', [sys.id]);
      this.ready().run('DELETE FROM executions WHERE system_id = ?', [sys.id]);
    }
    this.flush();
  }

  // --- System ---

  async addSystem(projectId: string, input: SystemInput): Promise<System> {
    await this.initPromise;
    const cur = await this.getProject(projectId);
    if (!cur) throw new Error(`project not found: ${projectId}`);
    const now = Date.now();
    const system: System = {
      id: input.id ?? randomUUID(),
      name: input.name,
      url: input.url,
      type: input.type,
      pageTitle: input.pageTitle,
      parentPortalId: input.parentPortalId,
      parentPortalPath: input.parentPortalPath,
      credentialMode: input.credentialMode ?? 'no-login',
      credentials: input.credentials,
      sessionState: input.sessionState,
      navigationPath: input.navigationPath ?? [],
      loginState: input.loginState ?? 'logged_out',
      progress: { explored: false, featured: false, cased: false, executed: false },
      createdAt: now,
      updatedAt: now,
    };
    cur.systems.push(system);
    await this.updateProject(projectId, { systems: cur.systems });
    return system;
  }

  async updateSystem(projectId: string, systemId: string, patch: Partial<System>): Promise<System> {
    await this.initPromise;
    const cur = await this.getProject(projectId);
    if (!cur) throw new Error(`project not found: ${projectId}`);
    const sysIdx = cur.systems.findIndex((s) => s.id === systemId);
    if (sysIdx === -1) throw new Error(`system not found: ${systemId}`);
    const sys = cur.systems[sysIdx];
    const now = Date.now();
    const next: System = { ...sys, ...patch, id: sys.id, updatedAt: now };
    cur.systems[sysIdx] = next;
    await this.updateProject(projectId, { systems: cur.systems });
    return next;
  }

  async removeSystem(projectId: string, systemId: string): Promise<void> {
    await this.initPromise;
    const cur = await this.getProject(projectId);
    if (!cur) throw new Error(`project not found: ${projectId}`);
    const idx = cur.systems.findIndex((s) => s.id === systemId);
    if (idx === -1) throw new Error(`system not found: ${systemId}`);
    cur.systems.splice(idx, 1);
    this.ready().run('DELETE FROM feature_tables WHERE system_id = ?', [systemId]);
    this.ready().run('DELETE FROM case_tables WHERE system_id = ?', [systemId]);
    this.ready().run('DELETE FROM executions WHERE system_id = ?', [systemId]);
    await this.updateProject(projectId, { systems: cur.systems });
  }

  // --- Stage data ---

  async setActiveSystem(projectId: string, systemId: string): Promise<void> {
    await this.initPromise;
    const cur = await this.getProject(projectId);
    if (!cur) throw new Error(`project not found: ${projectId}`);
    if (!cur.systems.some((s) => s.id === systemId)) {
      throw new Error(`system not in project: ${systemId}`);
    }
    await this.updateProject(projectId, { activeSystemId: systemId });
  }

  async saveFeatureTable(systemId: string, table: FeatureRow[][]): Promise<void> {
    await this.initPromise;
    this.ready().run(
      `INSERT INTO feature_tables (system_id, data) VALUES (?, ?)
       ON CONFLICT(system_id) DO UPDATE SET data = excluded.data`,
      [systemId, JSON.stringify(table)]
    );
    this.flush();
  }

  async saveCaseTable(systemId: string, sheets: CaseSheet[]): Promise<void> {
    await this.initPromise;
    this.ready().run(
      `INSERT INTO case_tables (system_id, data) VALUES (?, ?)
       ON CONFLICT(system_id) DO UPDATE SET data = excluded.data`,
      [systemId, JSON.stringify(sheets)]
    );
    this.flush();
  }

  async saveExecution(systemId: string, report: ExecutionResult[]): Promise<void> {
    await this.initPromise;
    this.ready().run(
      `INSERT INTO executions (system_id, data) VALUES (?, ?)
       ON CONFLICT(system_id) DO UPDATE SET data = excluded.data`,
      [systemId, JSON.stringify(report)]
    );
    this.flush();
  }

  async getFeatureTable(systemId: string): Promise<FeatureRow[][] | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT data FROM feature_tables WHERE system_id = ?');
    stmt.bind([systemId]);
    const row = this.one(stmt);
    return row ? JSON.parse(row.data) : null;
  }

  async getCaseTable(systemId: string): Promise<CaseSheet[] | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT data FROM case_tables WHERE system_id = ?');
    stmt.bind([systemId]);
    const row = this.one(stmt);
    return row ? JSON.parse(row.data) : null;
  }

  async getExecution(systemId: string): Promise<ExecutionResult[] | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT data FROM executions WHERE system_id = ?');
    stmt.bind([systemId]);
    const row = this.one(stmt);
    return row ? JSON.parse(row.data) : null;
  }

  // --- Session ---

  async saveSession(systemId: string, session: SessionHandle): Promise<void> {
    await this.initPromise;
    this.ready().run(
      `INSERT INTO sessions (system_id, data, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(system_id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
      [systemId, JSON.stringify(session), session.expiresAt]
    );
    this.flush();
  }

  async getSession(systemId: string): Promise<SessionHandle | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT data, expires_at FROM sessions WHERE system_id = ?');
    stmt.bind([systemId]);
    const row = this.one(stmt);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      await this.invalidateSession(systemId);
      return null;
    }
    return JSON.parse(row.data) as SessionHandle;
  }

  async invalidateSession(systemId: string): Promise<void> {
    await this.initPromise;
    this.ready().run('DELETE FROM sessions WHERE system_id = ?', [systemId]);
    this.flush();
  }

  // --- Module Tree ---

  async saveModuleTree(systemId: string, tree: any[]): Promise<void> {
    await this.initPromise;
    this.ready().run(
      `INSERT INTO module_trees (system_id, data) VALUES (?, ?)
       ON CONFLICT(system_id) DO UPDATE SET data = excluded.data`,
      [systemId, JSON.stringify(tree)]
    );
    this.flush();
  }

  async getModuleTree(systemId: string): Promise<any[] | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT data FROM module_trees WHERE system_id = ?');
    stmt.bind([systemId]);
    const row = this.one(stmt);
    return row ? JSON.parse(row.data) : null;
  }

  // --- Meta Config ---

  async saveMetaConfig(systemId: string, meta: Record<string, any>): Promise<void> {
    await this.initPromise;
    this.ready().run(
      `INSERT INTO meta_configs (system_id, data) VALUES (?, ?)
       ON CONFLICT(system_id) DO UPDATE SET data = excluded.data`,
      [systemId, JSON.stringify(meta)]
    );
    this.flush();
  }

  async getMetaConfig(systemId: string): Promise<Record<string, any> | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT data FROM meta_configs WHERE system_id = ?');
    stmt.bind([systemId]);
    const row = this.one(stmt);
    return row ? JSON.parse(row.data) : null;
  }

  // --- Storage State (无失真会话复用) ---

  async saveStorageState(systemId: string, state: StorageState): Promise<void> {
    await this.initPromise;
    this.ready().run(
      `INSERT INTO storage_states (system_id, data) VALUES (?, ?)
       ON CONFLICT(system_id) DO UPDATE SET data = excluded.data`,
      [systemId, JSON.stringify(state)]
    );
    this.flush();
  }

  async getStorageState(systemId: string): Promise<StorageState | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT data FROM storage_states WHERE system_id = ?');
    stmt.bind([systemId]);
    const row = this.one(stmt);
    return row ? (JSON.parse(row.data) as StorageState) : null;
  }

  // --- Knowledge Base ---

  async listKnowledgeEntries(): Promise<KnowledgeEntry[]> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT * FROM knowledge_base ORDER BY scope, project_id, system_id');
    const rows = this.all(stmt);
    return rows.map(this.rowToKnowledgeEntry);
  }

  async getKnowledgeEntry(projectId: string, systemId?: string): Promise<KnowledgeEntry | null> {
    await this.initPromise;
    let stmt;
    if (systemId) {
      stmt = this.ready().prepare(
        'SELECT * FROM knowledge_base WHERE project_id = ? AND system_id = ?'
      );
      stmt.bind([projectId, systemId]);
    } else {
      stmt = this.ready().prepare(
        'SELECT * FROM knowledge_base WHERE project_id = ? AND system_id IS NULL'
      );
      stmt.bind([projectId]);
    }
    const row = this.one(stmt);
    return row ? this.rowToKnowledgeEntry(row) : null;
  }

  async saveKnowledgeEntry(entry: KnowledgeEntry): Promise<KnowledgeEntry> {
    await this.initPromise;
    const now = Date.now();
    const record: KnowledgeEntry = { ...entry, updatedAt: now };

    this.ready().run(
      `INSERT INTO knowledge_base (id, scope, project_id, system_id, content, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         scope = excluded.scope,
         project_id = excluded.project_id,
         system_id = excluded.system_id,
         content = excluded.content,
         updated_at = excluded.updated_at`,
      [record.id, record.scope, record.projectId, record.systemId ?? null, record.content, record.updatedAt]
    );
    this.flush();
    return record;
  }

  async deleteKnowledgeEntry(id: string): Promise<void> {
    await this.initPromise;
    this.ready().run('DELETE FROM knowledge_base WHERE id = ?', [id]);
    this.flush();
  }

  // --- AI Config ---

  async listAIConfigs(): Promise<AIConfigRecord[]> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT * FROM ai_configs ORDER BY created_at');
    const rows = this.all(stmt);
    return rows.map(this.rowToAIConfig);
  }

  async getAIConfig(id: string): Promise<AIConfigRecord | null> {
    await this.initPromise;
    const stmt = this.ready().prepare('SELECT * FROM ai_configs WHERE id = ?');
    stmt.bind([id]);
    const row = this.one(stmt);
    return row ? this.rowToAIConfig(row) : null;
  }

  async saveAIConfig(config: AIConfigRecord): Promise<AIConfigRecord> {
    await this.initPromise;
    const now = Date.now();
    const record: AIConfigRecord = { ...config, createdAt: now, updatedAt: now };

    if (record.isDefault) {
      this.ready().run('UPDATE ai_configs SET is_default = 0');
    }

    this.ready().run(
      `INSERT INTO ai_configs (id, name, vendor, base_url, api_key_ref, model, enabled, is_default, temperature, max_tokens, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id, record.name, record.vendor, record.baseUrl,
        record.apiKeyRef, record.model, record.enabled ? 1 : 0,
        record.isDefault ? 1 : 0, record.temperature ?? 0.7,
        record.maxTokens ?? null, record.createdAt, record.updatedAt,
      ]
    );
    this.flush();
    return record;
  }

  async updateAIConfig(id: string, patch: Partial<AIConfigRecord>): Promise<AIConfigRecord> {
    await this.initPromise;
    const cur = await this.getAIConfig(id);
    if (!cur) throw new Error(`AI config not found: ${id}`);

    if (patch.isDefault) {
      this.ready().run('UPDATE ai_configs SET is_default = 0');
    }

    const now = Date.now();
    const next: AIConfigRecord = { ...cur, ...patch, id: cur.id, updatedAt: now };

    const sets = ['name = ?', 'vendor = ?', 'base_url = ?', 'api_key_ref = ?', 'model = ?', 'enabled = ?', 'is_default = ?', 'temperature = ?', 'max_tokens = ?', 'updated_at = ?'];
    const vals = [
      next.name, next.vendor, next.baseUrl, next.apiKeyRef, next.model,
      next.enabled ? 1 : 0, next.isDefault ? 1 : 0,
      next.temperature ?? 0.7, next.maxTokens ?? null, now, id,
    ];
    this.ready().run(`UPDATE ai_configs SET ${sets.join(', ')} WHERE id = ?`, vals);
    this.flush();
    return next;
  }

  async deleteAIConfig(id: string): Promise<void> {
    await this.initPromise;
    this.ready().run('DELETE FROM ai_configs WHERE id = ?', [id]);
    this.flush();
  }

  async setDefaultAIConfig(id: string): Promise<void> {
    await this.initPromise;
    const cur = await this.getAIConfig(id);
    if (!cur) throw new Error(`AI config not found: ${id}`);

    this.ready().run('UPDATE ai_configs SET is_default = 0');
    this.ready().run('UPDATE ai_configs SET is_default = 1 WHERE id = ?', [id]);
    this.flush();
  }

  async toggleAIConfigEnabled(id: string, enabled: boolean): Promise<AIConfigRecord> {
    await this.initPromise;
    const cur = await this.getAIConfig(id);
    if (!cur) throw new Error(`AI config not found: ${id}`);
    return this.updateAIConfig(id, { enabled });
  }

  private rowToAIConfig(row: Record<string, any>): AIConfigRecord {
    return {
      id: row.id,
      name: row.name,
      vendor: row.vendor,
      baseUrl: row.base_url,
      apiKeyRef: row.api_key_ref,
      model: row.model,
      enabled: !!row.enabled,
      isDefault: !!row.is_default,
      temperature: row.temperature ?? undefined,
      maxTokens: row.max_tokens ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToKnowledgeEntry(row: Record<string, any>): KnowledgeEntry {
    return {
      id: row.id,
      scope: row.scope,
      projectId: row.project_id,
      systemId: row.system_id ?? undefined,
      content: row.content,
      updatedAt: row.updated_at,
    };
  }
}

/** 工厂：返回 SQLite 持久化实现 */
export function createStore(dbPath?: string): ProjectStore {
  return new SqliteProjectStore(dbPath);
}