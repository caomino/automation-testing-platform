/**
 * @file index.ts
 * @description 持久化层冻结接口（infra-store）
 * @frozen v1.0 — 接口不可改，仅可替换实现（当前内存实现；SQLite 后续替换，接口不变）
 */
import type { Project, FeatureRow, CaseSheet, ExecutionResult, SystemType } from '@test-platform/contracts';
import { randomUUID } from 'node:crypto';

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

/**
 * 持久化存储接口（冻结）。
 * 所有业务数据（项目/系统/功能点/用例/执行结果）经此落库，外部化于代码工作空间。
 */
export interface ProjectStore {
  createProject(input: NewProjectInput): Promise<Project>;
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | null>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  setActiveSystem(projectId: string, systemId: string): Promise<void>;
  saveFeatureTable(systemId: string, table: FeatureRow[][]): Promise<void>;
  saveCaseTable(systemId: string, sheets: CaseSheet[]): Promise<void>;
  saveExecution(systemId: string, report: ExecutionResult[]): Promise<void>;
  getFeatureTable(systemId: string): Promise<FeatureRow[][] | null>;
  getCaseTable(systemId: string): Promise<CaseSheet[] | null>;
  getExecution(systemId: string): Promise<ExecutionResult[] | null>;
}

/** 冻结接口的内存实现（SQLite 替换时保持本接口不变） */
class InMemoryProjectStore implements ProjectStore {
  private projects = new Map<string, Project>();
  private featureTables = new Map<string, FeatureRow[][]>();
  private caseTables = new Map<string, CaseSheet[]>();
  private executions = new Map<string, ExecutionResult[]>();

  async createProject(input: NewProjectInput): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      type: input.type ?? 'standalone',
      systems: [],
      logRetentionDays: input.logRetentionDays ?? 30,
      aiAssistEnabled: input.aiAssistEnabled ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    return project;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.projects.values()].map((p) => ({
      id: p.id,
      name: p.name,
      systemCount: p.systems.length,
      updatedAt: p.updatedAt,
    }));
  }

  async getProject(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const cur = this.projects.get(id);
    if (!cur) throw new Error(`project not found: ${id}`);
    const next: Project = { ...cur, ...patch, id: cur.id, updatedAt: Date.now() };
    this.projects.set(id, next);
    return next;
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
  }

  async setActiveSystem(projectId: string, systemId: string): Promise<void> {
    const p = this.projects.get(projectId);
    if (!p) throw new Error(`project not found: ${projectId}`);
    if (!p.systems.some((s) => s.id === systemId)) {
      throw new Error(`system not in project: ${systemId}`);
    }
    await this.updateProject(projectId, { updatedAt: Date.now() });
  }

  async saveFeatureTable(systemId: string, table: FeatureRow[][]): Promise<void> {
    this.featureTables.set(systemId, table);
  }

  async saveCaseTable(systemId: string, sheets: CaseSheet[]): Promise<void> {
    this.caseTables.set(systemId, sheets);
  }

  async saveExecution(systemId: string, report: ExecutionResult[]): Promise<void> {
    this.executions.set(systemId, report);
  }

  async getFeatureTable(systemId: string): Promise<FeatureRow[][] | null> {
    return this.featureTables.get(systemId) ?? null;
  }

  async getCaseTable(systemId: string): Promise<CaseSheet[] | null> {
    return this.caseTables.get(systemId) ?? null;
  }

  async getExecution(systemId: string): Promise<ExecutionResult[] | null> {
    return this.executions.get(systemId) ?? null;
  }
}

/** 工厂：当前返回内存实现；后续接入 SQLite 时在此切换，调用方无感 */
export function createStore(): ProjectStore {
  return new InMemoryProjectStore();
}
