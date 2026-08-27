
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from "react";
import type { ReactNode } from "react";
import { createPipelineService, toFeatureView, toCaseView, toDefectView, toModuleView, toExecView, fromFeatureViewToTable, moduleTreeToFeatureTable } from "./services/pipeline";
import type { PipelineService } from "./services/pipeline";
import { nextTestPointIdFor, toAbbrToken } from "./services/abbr";
import * as dataApi from "./services/dataApi";
import type { CaseRow, CaseSheet, DesignSource, FeatureEvidence, FeatureProfile, FeatureProvenance, FeatureRow, QualityGateIssue, CaseGenerationContext } from '@test-platform/contracts';

// ===== 类型定义 =====

export type SystemType = "portal" | "standalone" | "subsystem";
export type LoginMode = "no-login" | "credential" | "manual-takeover";
export type LoginStatus = "logged_out" | "logging_in" | "logged_in";

export const loginModeLabel: Record<LoginMode, string> = {
  "no-login": "免登录",
  "credential": "账号密码登录",
  "manual-takeover": "人工接管登录",
};

export const loginStatusLabel: Record<LoginStatus, string> = {
  "logged_out": "未登录",
  "logging_in": "登录中",
  "logged_in": "已登录",
};

export interface SystemInfo {
  id: string;
  name: string;
  type: SystemType;
  url: string;
  captured: boolean;
  parent: string;
  loginMode: LoginMode;
  credentialMode?: LoginMode;
  loginStatus: LoginStatus;
  // 所属项目
  projectId?: string;
  // 子系统专属字段
  parentPortalId?: string;
  parentPortalPath?: { name: string; url: string };
  capturedUrl?: string;
  // 登录凭证
  username?: string;
  passwordRef?: string;
  /** 持久化凭证引用（AES-256-GCM 加密，落库于凭证库）。passwordRef 仅作 UI 临时输入。 */
  credentials?: { username: string; credentialRef: string };
  // 会话状态
  sessionState?: {
    cookies?: string[];
    headers?: Record<string, string>;
    tokens?: string[];
  };
  navigationPath?: string[];
}

export interface ProjectInfo {
  id: string;
  name: string;
  type: SystemType;
  description: string;
  systemCount: number;
  caseCount: number;
  createdAt: string;
  lastActive: string;
  status: "活跃" | "空闲";
  activeSystemId?: string;
}

export interface FeatureRowView {
  seq: string;
  type: string;
  chapter: string;
  system: string;
  mainModule: string;
  subModule: string;
  feature: string;
  testPoint: string;
  testPointId: string;
  needsReview?: boolean;
  merge?: boolean;
}

export interface CaseRowView {
  id?: CaseRow['id'];
  targetTestPoint?: CaseRow['targetTestPoint'];
  caseNo: string;
  content: string;
  step: string;
  operation: string;
  expected: string;
  firstResult: string;
  regressionResult: string;
  conclusion: string;
  scenarioId?: string;
  scenarioName?: string;
  priority?: 'P0' | 'P1' | 'P2';
  coverageKeys?: string[];
  evidenceLevel?: 'observed' | 'derived' | 'needs_review';
  needsReview?: boolean;
  reviewReason?: string;
  featureId?: string;
  evidenceId?: CaseRow['evidenceId'];
  origin?: CaseRow['origin'];
  confidence?: CaseRow['confidence'];
  manualEdited?: CaseRow['manualEdited'];
  quality?: CaseRow['quality'];
  qualityGateStatus?: CaseRow['qualityGateStatus'];
  /** @新增 生成批次 ID（spec §6.5 / §17.8：每组可追溯生成来源） */
  batchId?: string;
}

export interface CaseStepView {
  id?: CaseRow['id'];
  targetTestPoint?: CaseRow['targetTestPoint'];
  stepId: string;
  stepNumber: string;
  operation: string;
  expected: string;
  firstResult: string;
  regressionResult: string;
  conclusion: string;
  scenarioId?: string;
  scenarioName?: string;
  priority?: 'P0' | 'P1' | 'P2';
  coverageKeys?: string[];
  evidenceLevel?: 'observed' | 'derived' | 'needs_review';
  needsReview?: boolean;
  reviewReason?: string;
  featureId?: string;
  evidenceId?: CaseRow['evidenceId'];
  origin?: CaseRow['origin'];
  confidence?: CaseRow['confidence'];
  manualEdited?: CaseRow['manualEdited'];
  quality?: CaseRow['quality'];
  qualityGateStatus?: CaseRow['qualityGateStatus'];
  /** @新增 生成批次 ID（spec §6.5 / §17.8：每组可追溯生成来源） */
  batchId?: string;
}

export interface CaseGroupView {
  id?: CaseRow['id'];
  targetTestPoint?: CaseRow['targetTestPoint'];
  groupId: string;
  caseNo: string;
  content: string;
  moduleName: string;
  precondition: string;
  scenarioId?: string;
  scenarioName?: string;
  priority?: 'P0' | 'P1' | 'P2';
  coverageKeys?: string[];
  evidenceLevel?: 'observed' | 'derived' | 'needs_review';
  needsReview?: boolean;
  reviewReason?: string;
  featureId?: string;
  evidenceId?: CaseRow['evidenceId'];
  origin?: CaseRow['origin'];
  confidence?: CaseRow['confidence'];
  manualEdited?: CaseRow['manualEdited'];
  quality?: CaseRow['quality'];
  qualityGateStatus?: CaseRow['qualityGateStatus'];
  /** 生成批次来源（用于区分不同 scope/mode 的追加结果） */
  batchId?: CaseRow['batchId'];
  steps: CaseStepView[];
}

export interface MetaHeader {
  system: string;
  testPointId: string;
  testPoint: string;
  testers: string;
  clientStaff: string;
  developerStaff: string;
  firstTestDate: string;
  regressionDate: string;
  conclusionRule: string;
  precondition: string;
}

export interface DefectRowView {
  seq: number;
  description: string;
  screenshot?: string;
  level: "高" | "中" | "低";
  qualityAttribute: string;
  environment: string;
}

export interface ModuleNodeView {
  id: string;
  name: string;
  /** 节点类型：system(系统) / module(目录) / page(页面) / action(功能·按钮级)。结构化人工补录会区分设置，避免数据糊成一坨 */
  type?: "system" | "module" | "page" | "action";
  children?: ModuleNodeView[];
  status?: "已覆盖" | "needs_review" | "未探索";
}

export interface PendingTreeItem {
  seq: number;
  path: string;
  module: string;
  confidence: string;
  status: "待入树" | "已去重";
}

export interface AiConfigView {
  id: string;
  enabled: boolean;
  name: string;
  vendor: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  apiKeyRef?: string;
  temperature?: number;
  maxTokens?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface LogFileView {
  subsystem: string;
  task: string;
  filename: string;
  size: number;
  lastWrite: number;
}

export interface ExecModuleState {
  name: string;
  cases: number;
  pass?: number;
  running?: number;
  fail?: number;
  pending?: boolean;
  note?: string;
}

export interface ExecMatrixCell {
  browser: string;
  status: "pass" | "running" | "pending";
}

export interface ExecMatrixRow {
  caseNo: string;
  steps: number;
  cells: ExecMatrixCell[];
}

export interface KnowledgeEntry {
  id: string;
  scope: 'project' | 'system';
  projectId: string;
  systemId?: string;
  content: string;
  updatedAt?: number;
}

export interface LogPolicy {
  retentionDays: number;
  maxFileSizeMB: number;
  maxFiles: number;
}

export interface ActivityItem {
  id: string;
  time: string;
  text: string;
}

// ===== State =====

// 前端会话态凭证（仅内存，绝不落库/绝不写 Vault；刷新即清空）
const credentialSecretStore = new Map<string, { username: string; password: string }>();
export function setCredentialSecret(systemId: string, username: string, password: string): void {
  if (!systemId) return;
  credentialSecretStore.set(systemId, { username, password });
}
export function getCredentialSecret(systemId: string): { username: string; password: string } | undefined {
  return credentialSecretStore.get(systemId);
}
export function clearCredentialSecret(systemId: string): void {
  credentialSecretStore.delete(systemId);
}

export interface AppState {
  project: ProjectInfo;
  system: SystemInfo;
  projects: ProjectInfo[];
  systems: SystemInfo[];
  activeScreen: string;
  toastMsg: string;
  featureRows: FeatureRowView[];
  featureConfirmed: boolean;
  caseRows: CaseRowView[];
  caseGroups: CaseGroupView[];
  /** 当前持久化用例工作簿，保留人工编辑及表级元数据供下一次生成合并。 */
  currentCaseWorkbook: CaseSheet[];
  metaHeader: MetaHeader;
  caseSelectedModules: string[];
  caseAiOn: boolean;
  /** 探索阶段是否启用 AI 辅助（独立开关，默认关闭，与用例页 AI 解耦） */
  exploreAiOn: boolean;
  /** 只读点击安全策略（页面可配置）：strict=严格（默认放行面窄）；allow_all=放行所有非写操作按钮，仍拦截删除/提交/导出等写操作 */
  readOnlyClickPolicy: "strict" | "allow_all";
  execModules: ExecModuleState[];
  execBrowsers: string[];
  execMatrix: ExecMatrixRow[];
  execCheckedModules: string[];
  execIsolationPassed: boolean;
  defectRows: DefectRowView[];
  defectFilter: string;
  moduleTree: ModuleNodeView[];
  pendingTree: PendingTreeItem[];
  selectedModuleId: string | null;
  treeChecked: string[];
  aiConfigs: AiConfigView[];
  aiCurrentDefault: string;
  logPolicy: LogPolicy;
  logFiles: LogFileView[];
  knowledge: KnowledgeEntry[];
  activities: ActivityItem[];
  pipelineLoading: boolean;
  pipelineStage: string | null;
  pipelineError: string | null;
  pipelineMode: 'mock' | 'real';
  bootstrapping: boolean;
  exploredElements: any[];
  /** 功能点测试点标识 → 来源页面 URL（来自功能点阶段产物，供用例阶段按所选模块探索） */
  featurePaths: Record<string, string>;
  featureProfiles: FeatureProfile[];
  featureEvidence: Record<string, FeatureEvidence>;
  featureProvenance: FeatureProvenance[];
  featureDesignSources: string[];
  caseQualityGateIssues: QualityGateIssue[];
  /** 生成批次元数据列表（spec §6.5 / §17.7：每组用例可追溯其生成来源 batchId/mode/aiConfigId） */
  caseGenerations: CaseGenerationContext[];
}

// ===== Actions =====

export type Action =
  | { type: "SET_SCREEN"; screen: string }
  | { type: "SHOW_TOAST"; msg: string }
  | { type: "CLEAR_TOAST" }
  | { type: "SET_PROJECT"; id: string }
  | { type: "ADD_PROJECT"; project: ProjectInfo }
  | { type: "UPDATE_PROJECT"; id: string; patch: Partial<ProjectInfo> }
  | { type: "REMOVE_PROJECT"; id: string }
  | { type: "SET_SYSTEM"; id: string }
  | { type: "ADD_SYSTEM"; system: SystemInfo }
  | { type: "UPDATE_SYSTEM"; id: string; patch: Partial<SystemInfo> }
  | { type: "REMOVE_SYSTEM"; id: string }
  | { type: "SET_LOGIN_STATUS"; id: string; status: LoginStatus }
  | { type: "SET_SESSION_STATE"; id: string; sessionState: SystemInfo["sessionState"] }
  | { type: "FEATURE_ADD_ROW"; afterIndex?: number }
  | { type: "FEATURE_UPDATE_ROW"; index: number; patch: Partial<FeatureRowView> }
  | { type: "FEATURE_REMOVE_ROW"; index: number }
  | { type: "FEATURE_ADD_MODULE"; module: FeatureRowView }
  | { type: "FEATURE_CONFIRM" }
  | { type: "FEATURE_UNCONFIRM" }
  | { type: "FEATURE_TOGGLE_REVIEW"; index: number }
  | { type: "CASE_ADD_ROW"; afterIndex?: number }
  | { type: "CASE_UPDATE_ROW"; index: number; patch: Partial<CaseRowView> }
  | { type: "CASE_REMOVE_ROW"; index: number }
  | { type: "CASE_UPDATE_META"; patch: Partial<MetaHeader> }
  | { type: "CASE_SET_SELECTION"; modules: string[] }
  | { type: "CASE_TOGGLE_AI"; on: boolean }
  | { type: "EXPLORE_TOGGLE_AI"; on: boolean }
  | { type: "SET_READONLY_CLICK_POLICY"; policy: "strict" | "allow_all" }
  | { type: "CASE_REGENERATE" }
  | { type: "CASE_GROUP_ADD"; group?: Partial<CaseGroupView> }
  | { type: "CASE_GROUP_REMOVE"; groupId: string }
  | { type: "CASE_GROUP_UPDATE"; groupId: string; patch: Partial<CaseGroupView> }
  | { type: "CASE_STEP_ADD"; groupId: string; afterStepId?: string }
  | { type: "CASE_STEP_REMOVE"; groupId: string; stepId: string }
  | { type: "CASE_STEP_UPDATE"; groupId: string; stepId: string; patch: Partial<CaseStepView> }
  | { type: "EXEC_TOGGLE_MODULE"; name: string }
  | { type: "EXEC_TOGGLE_ALL"; checked: boolean }
  | { type: "EXEC_RUN"; target: "selected" | "all" }
  | { type: "EXEC_SET_CELL"; caseNo: string; browser: string; status: ExecMatrixCell["status"] }
  | { type: "EXEC_VERIFY_ISOLATION" }
  | { type: "DEFECT_ADD"; defect: DefectRowView }
  | { type: "DEFECT_UPDATE"; seq: number; patch: Partial<DefectRowView> }
  | { type: "DEFECT_REMOVE"; seq: number }
  | { type: "DEFECT_SET_FILTER"; filter: string }
  | { type: "EXPLORE_SET_SELECTED"; id: string | null }
  | { type: "EXPLORE_TOGGLE_CHECKED"; id: string }
  | { type: "EXPLORE_ADD_MODULE"; parentId: string | null; module: ModuleNodeView }
  | { type: "EXPLORE_UPDATE_MODULE"; id: string; patch: Partial<ModuleNodeView> }
  | { type: "EXPLORE_REMOVE_MODULE"; id: string }
  | { type: "EXPLORE_ADD_PENDING"; item: PendingTreeItem }
  | { type: "EXPLORE_REMOVE_PENDING"; seq: number }
  | { type: "EXPLORE_UPDATE_PENDING"; seq: number; patch: Partial<PendingTreeItem> }
  | { type: "EXPLORE_PROMOTE_TO_TREE"; seq: number }
  | { type: "EXPLORE_PROMOTE_ALL" }
  | { type: "EXPLORE_SELECT_ALL" }
  | { type: "EXPLORE_INVERT_SELECTION" }
  | { type: "EXPLORE_REMOVE_MODULES_BATCH"; ids: string[] }
  | { type: "EXPLORE_MOVE_NODE"; sourceId: string; targetId: string; position: "before" | "after" | "child" }
  | { type: "AI_ADD"; config: AiConfigView }
  | { type: "AI_UPDATE"; id: string; patch: Partial<AiConfigView> }
  | { type: "AI_REMOVE"; id: string }
  | { type: "AI_TOGGLE_ENABLED"; id: string }
  | { type: "AI_SET_DEFAULT"; id: string }
  | { type: "LOG_UPDATE_POLICY"; patch: Partial<LogPolicy> }
  | { type: "LOG_CLEANUP_EXPIRED" }
  | { type: "LOG_CLEAR_ALL" }
  | { type: "LOG_REMOVE_FILE"; filename: string }
  | { type: "LOG_LIST_FILES"; files: LogFileView[] }
  | { type: "KNOWLEDGE_UPDATE"; id: string; content: string }
  | { type: "KNOWLEDGE_ADD"; entry: KnowledgeEntry }
  | { type: "KNOWLEDGE_REMOVE"; id: string }
  | { type: "ADD_ACTIVITY"; item: ActivityItem }
  | { type: "PIPELINE_SET_LOADING"; loading: boolean; stage?: string | null }
  | { type: "PIPELINE_SET_ERROR"; error: string | null }
  | { type: "PIPELINE_SET_MODE"; mode: "mock" | "real" }
  | { type: "PIPELINE_UPDATE_FEATURE"; rows: FeatureRowView[] }
  | { type: "PIPELINE_SET_FEATURE_PATHS"; paths: Record<string, string> }
  | { type: "PIPELINE_SET_FEATURE_PROFILES"; profiles: FeatureProfile[] }
  | { type: "PIPELINE_SET_FEATURE_EVIDENCE"; evidence: Record<string, FeatureEvidence> }
  | { type: "PIPELINE_SET_FEATURE_ARTIFACT_META"; provenance: FeatureProvenance[]; designSources: string[] }
  | { type: "PIPELINE_UPDATE_CASE"; rows: CaseRowView[]; groups: CaseGroupView[]; meta: MetaHeader; workbook?: CaseSheet[]; issues?: QualityGateIssue[] }
  | { type: "PIPELINE_SET_CASE_GENERATIONS"; generations: CaseGenerationContext[] }
  | { type: "PIPELINE_UPDATE_MODULE_TREE"; nodes: ModuleNodeView[] }
  | { type: "PIPELINE_UPDATE_DEFECT"; rows: DefectRowView[] }
  | { type: "PIPELINE_UPDATE_EXEC"; matrix: ExecMatrixRow[]; modules: ExecModuleState[] }
  | { type: "BOOTSTRAP_DONE"; state: Partial<AppState> };

// ===== Helpers =====

let seqCounter = 100;
export const nextSeq = () => "F" + (++seqCounter);
let caseCounter = 200;
export const nextCaseNo = (prefix: string) => prefix + "_" + String(++caseCounter - 200 + 5).padStart(2, "0");

export function removeFromArray<T>(arr: T[], predicate: (item: T, index: number) => boolean): T[] {
  const idx = arr.findIndex(predicate);
  if (idx === -1) return arr;
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

export function insertInArray<T>(arr: T[], index: number, item: T): T[] {
  return [...arr.slice(0, index + 1), item, ...arr.slice(index + 1)];
}

export function updateInArray<T>(arr: T[], predicate: (item: T, index: number) => boolean, patch: Partial<T>): T[] {
  return arr.map((item, index) => (predicate(item, index) ? { ...item, ...patch } : item));
}

function clearSystemScopedState(state: AppState, system: SystemInfo, projects: ProjectInfo[], project: ProjectInfo): AppState {
  return {
    ...state,
    system,
    projects,
    project,
    featureRows: [],
    featureConfirmed: false,
    featurePaths: {},
    featureProfiles: [],
    featureEvidence: {},
    featureProvenance: [],
    featureDesignSources: [],
    caseRows: [],
    caseGroups: [],
    currentCaseWorkbook: [],
    caseQualityGateIssues: [],
    caseGenerations: [],
    metaHeader: initialState.metaHeader,
    caseSelectedModules: [],
    exploredElements: [],
    moduleTree: [],
    pendingTree: [],
    selectedModuleId: null,
    treeChecked: [],
    pipelineLoading: false,
    pipelineStage: null,
    pipelineError: null,
  };
}

// ===== Initial State =====

export const initialState: AppState = {
  project: { id: "", name: "", type: "standalone", description: "", systemCount: 0, caseCount: 0, createdAt: "", lastActive: "", status: "空闲" },
  systems: [],
  system: { id: "", name: "", type: "standalone", url: "", captured: false, parent: "", loginMode: "no-login", loginStatus: "logged_out" },
  projects: [],
  activeScreen: "s1",
  toastMsg: "",

  featureRows: [],
  featureConfirmed: false,

    caseRows: [],
    caseGroups: [],
    currentCaseWorkbook: [],
  caseQualityGateIssues: [],
    caseGenerations: [],
  metaHeader: { system: "", testPointId: "", testPoint: "", testers: "", clientStaff: "", developerStaff: "", firstTestDate: "", regressionDate: "", conclusionRule: "", precondition: "" },
  caseSelectedModules: [],
  caseAiOn: false,
  exploreAiOn: false,
  readOnlyClickPolicy: "allow_all",

  execModules: [],
  execBrowsers: ["Win11·Chrome", "Win11·Edge", "macOS·Safari", "Win10·Chrome"],
  execMatrix: [],
  execCheckedModules: [],
  execIsolationPassed: false,

  defectRows: [],
  defectFilter: "",

  moduleTree: [],
  pendingTree: [],
  selectedModuleId: null,
  treeChecked: [],

  aiConfigs: [],
  aiCurrentDefault: "",

  logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
  logFiles: [],

  knowledge: [],

  activities: [],

  pipelineLoading: false,
  pipelineStage: null,
  pipelineError: null,
  pipelineMode: 'real',
  bootstrapping: true,
  exploredElements: [],
  featurePaths: {},
  featureProfiles: [],
  featureEvidence: {},
  featureProvenance: [],
  featureDesignSources: [],
};

// ===== Reducer =====

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_SCREEN":
      return { ...state, activeScreen: action.screen };
    case "SHOW_TOAST":
      return { ...state, toastMsg: action.msg };
    case "CLEAR_TOAST":
      return { ...state, toastMsg: "" };

    case "SET_PROJECT": {
      const p = state.projects.find((x) => x.id === action.id);
      if (!p) return state;
      const projectSystems = state.systems.filter((s) => s.projectId === p.id);
      const found = (p.activeSystemId && projectSystems.find((s) => s.id === p.activeSystemId)) || projectSystems[0];
      const system = found ?? state.system;
      return system.id === state.system.id && p.id === state.project.id
        ? { ...state, project: p }
        : clearSystemScopedState(state, system, state.projects, p);
    }
    case "ADD_PROJECT":
      return { ...state, projects: [...state.projects, action.project], project: action.project };
    case "UPDATE_PROJECT":
      return {
        ...state,
        projects: updateInArray(state.projects, (p) => p.id === action.id, action.patch),
        project: state.project.id === action.id ? { ...state.project, ...action.patch } : state.project,
      };
    case "REMOVE_PROJECT": {
      if (state.projects.length <= 1) return state;
      const remaining = state.projects.filter((p) => p.id !== action.id);
      return { ...state, projects: remaining, project: state.project.id === action.id ? remaining[0] : state.project };
    }

    case "SET_SYSTEM": {
      const s = state.systems.find((x) => x.id === action.id);
      if (!s) return state;
      const projects = state.projects.map((p) =>
        p.id === s.projectId ? { ...p, activeSystemId: s.id } : p
      );
      // 关键修复：切换系统时 project 必须跟随系统归属项目（systems 是跨项目合并展示的，
      // 若仍保留当前 project，后续 login/explore 传 project.id 会与系统真实归属不符，
      // 导致后端 updateSystem 报 system not found、capturedUrl 存不上 → 探索门户）。
      const project = state.projects.find((p) => p.id === s.projectId)
        ?? (state.project.id === s.projectId ? { ...state.project, activeSystemId: s.id } : state.project);
      return s.id === state.system.id && project.id === state.project.id
        ? { ...state, system: s, projects, project }
        : clearSystemScopedState(state, s, projects, project);
    }
    case "ADD_SYSTEM":
      return { ...state, systems: [...state.systems, action.system] };
    case "UPDATE_SYSTEM":
      return {
        ...state,
        systems: updateInArray(state.systems, (s) => s.id === action.id, action.patch),
        system: state.system.id === action.id ? { ...state.system, ...action.patch } : state.system,
      };
    case "REMOVE_SYSTEM": {
      if (state.systems.length <= 1) return state;
      const remaining = state.systems.filter((s) => s.id !== action.id);
      return { ...state, systems: remaining, system: state.system.id === action.id ? remaining[0] : state.system };
    }
    case "SET_LOGIN_STATUS":
      return {
        ...state,
        systems: updateInArray(state.systems, (s) => s.id === action.id, { loginStatus: action.status }),
        system: state.system.id === action.id ? { ...state.system, loginStatus: action.status } : state.system,
      };
    case "SET_SESSION_STATE":
      return {
        ...state,
        systems: updateInArray(state.systems, (s) => s.id === action.id, { sessionState: action.sessionState }),
        system: state.system.id === action.id ? { ...state.system, sessionState: action.sessionState } : state.system,
      };

    case "FEATURE_ADD_ROW": {
      // 新增行 testPointId 必须遵循 docs §5.3：「子系统维度 NN 递增」
      // —— 不再用全局 nextCaseNo（会跨分组乱递增，还会把 state.metaHeader.testPointId 当前缀用）。
      const anchor = action.afterIndex !== undefined ? action.afterIndex : state.featureRows.length - 1;
      const anchorRow = state.featureRows[anchor];
      const target = {
        system: anchorRow?.system ?? state.featureRows[0]?.system ?? state.system.name ?? '',
        mainModule: anchorRow?.mainModule ?? state.featureRows[0]?.mainModule ?? '',
        subModule: anchorRow?.subModule ?? state.featureRows[0]?.subModule ?? '',
      };
      // 用户规则：点 + 后，新行测试点标识 = 锚点行同 base（系统_主_子 前 3 段）+ 组内重排后的下一号。
      // 插入后同 base 组内统一从 01 重新编号：点 _01 的 + → 新行 _02，原 _02→_03，原 _03→_04。
      // 绝不重新按 system/main/sub 派生（subModule 为空时重新派生会退化成主模块缩写 → RUOYI_SY_SY 错）。
      const anchorId = anchorRow?.testPointId ?? '';
      const anchorParts = anchorId.split('_');
      const hasBase = anchorParts.length >= 3;
      const base = hasBase ? anchorParts.slice(0, 3).join('_') : '';
      const newRow: FeatureRowView = {
        seq: nextSeq(),
        type: anchorRow?.type ?? state.featureRows[0]?.type ?? "功能性测试",
        chapter: anchorRow?.chapter ?? state.featureRows[0]?.chapter ?? "",
        system: target.system,
        mainModule: target.mainModule,
        subModule: target.subModule,
        feature: anchorRow?.feature ?? state.featureRows[0]?.feature ?? "",
        testPoint: "新功能点",
        // 先占位为 base_01，随后按同 base 组内行序统一重排
        testPointId: base ? `${base}_01` : nextTestPointIdFor(state.featureRows, target),
      };
      const after = action.afterIndex !== undefined ? action.afterIndex : state.featureRows.length - 1;
      const inserted = action.afterIndex === undefined
        ? [...state.featureRows, newRow]
        : insertInArray(state.featureRows, action.afterIndex, newRow);
      // 同 base 组内重排 NN：保持行序 01..N 连续（新行紧跟锚点 = 锚点号+1）
      if (base) {
        let nn = 0;
        return {
          ...state,
          featureRows: inserted.map((r) => {
            const p = (r.testPointId ?? '').split('_');
            if (p.length >= 3 && p.slice(0, 3).join('_') === base) {
              nn += 1;
              return { ...r, testPointId: `${base}_${String(nn).padStart(2, '0')}` };
            }
            return r;
          }),
        };
      }
      return { ...state, featureRows: inserted };
    }
    case "FEATURE_UPDATE_ROW":
      return { ...state, featureRows: updateInArray(state.featureRows, (_, i) => i === action.index, action.patch) };
    case "FEATURE_REMOVE_ROW":
      return { ...state, featureRows: removeFromArray(state.featureRows, (_, i) => i === action.index) };
    case "FEATURE_ADD_MODULE":
      return { ...state, featureRows: [...state.featureRows, action.module] };
    case "FEATURE_CONFIRM":
      return { ...state, featureConfirmed: true };
    case "FEATURE_UNCONFIRM":
      return { ...state, featureConfirmed: false };
    case "FEATURE_TOGGLE_REVIEW":
      return {
        ...state,
        featureRows: state.featureRows.map((r, i) => (i === action.index ? { ...r, needsReview: !r.needsReview } : r)),
      };

    case "CASE_ADD_ROW": {
      const newRow: CaseRowView = {
        caseNo: state.caseRows[0]?.caseNo ?? "NEW_01",
        content: "新内容",
        step: "Step 1",
        operation: "点击操作",
        expected: "预期结果",
        firstResult: "\\",
        regressionResult: "\\",
        conclusion: "\\",
      };
      if (action.afterIndex === undefined) {
        return { ...state, caseRows: [...state.caseRows, newRow] };
      }
      return { ...state, caseRows: insertInArray(state.caseRows, action.afterIndex, newRow) };
    }
    case "CASE_UPDATE_ROW":
      return { ...state, caseRows: updateInArray(state.caseRows, (_, i) => i === action.index, action.patch) };
    case "CASE_REMOVE_ROW":
      return { ...state, caseRows: removeFromArray(state.caseRows, (_, i) => i === action.index) };
    case "CASE_UPDATE_META":
      return { ...state, metaHeader: { ...state.metaHeader, ...action.patch } };
    case "CASE_SET_SELECTION":
      return { ...state, caseSelectedModules: action.modules };
    case "CASE_TOGGLE_AI":
      return { ...state, caseAiOn: action.on };
    case "EXPLORE_TOGGLE_AI":
      return { ...state, exploreAiOn: action.on };
    case "SET_READONLY_CLICK_POLICY":
      return { ...state, readOnlyClickPolicy: action.policy };
    case "CASE_REGENERATE":
      return { ...state, caseRows: state.caseRows.map((r) => ({ ...r, firstResult: "\\", regressionResult: "\\", conclusion: "\\" })) };
    case "CASE_GROUP_ADD": {
      const g: CaseGroupView = {
        groupId: "grp-" + Date.now(),
        caseNo: action.group?.caseNo ?? "NEW_01",
        content: action.group?.content ?? "新用例",
        moduleName: action.group?.moduleName ?? "",
        precondition: action.group?.precondition ?? "",
        steps: action.group?.steps ?? [{ stepId: "step-" + Date.now(), stepNumber: "Step1", operation: "", expected: "", firstResult: "\\", regressionResult: "\\", conclusion: "\\" }],
      };
      return { ...state, caseGroups: [...state.caseGroups, g] };
    }
    case "CASE_GROUP_REMOVE":
      return { ...state, caseGroups: state.caseGroups.filter((g) => g.groupId !== action.groupId) };
    case "CASE_GROUP_UPDATE":
      return { ...state, caseGroups: state.caseGroups.map((g) => g.groupId === action.groupId ? { ...g, ...action.patch } : g) };
    case "CASE_STEP_ADD": {
      const newStep: CaseStepView = {
        stepId: "step-" + Date.now(),
        stepNumber: "Step" + 1,
        operation: "",
        expected: "",
        firstResult: "\\",
        regressionResult: "\\",
        conclusion: "\\",
      };
      return { ...state, caseGroups: state.caseGroups.map((g) => {
        if (g.groupId !== action.groupId) return g;
        const steps = [...g.steps];
        if (action.afterStepId) {
          const idx = steps.findIndex((s) => s.stepId === action.afterStepId);
          if (idx >= 0) {
            steps.splice(idx + 1, 0, newStep);
          } else {
            steps.push(newStep);
          }
        } else {
          steps.push(newStep);
        }
        return { ...g, steps };
      }) };
    }
    case "CASE_STEP_REMOVE":
      return { ...state, caseGroups: state.caseGroups.map((g) => {
        if (g.groupId !== action.groupId) return g;
        return { ...g, steps: g.steps.filter((s) => s.stepId !== action.stepId) };
      }).filter((g) => g.steps.length > 0) };
    case "CASE_STEP_UPDATE":
      return { ...state, caseGroups: state.caseGroups.map((g) => {
        if (g.groupId !== action.groupId) return g;
        return { ...g, steps: g.steps.map((s) => s.stepId === action.stepId ? { ...s, ...action.patch } : s) };
      }) };

    case "EXEC_TOGGLE_MODULE": {
      const checked = state.execCheckedModules.includes(action.name);
      return {
        ...state,
        execCheckedModules: checked ? state.execCheckedModules.filter((n) => n !== action.name) : [...state.execCheckedModules, action.name],
      };
    }
    case "EXEC_TOGGLE_ALL": {
      const allNames = state.execModules.filter((m) => !m.pending).map((m) => m.name);
      return { ...state, execCheckedModules: action.checked ? allNames : [] };
    }
    case "EXEC_RUN": {
      const targets = action.target === "all" ? state.execModules.map((m) => m.name) : state.execCheckedModules;
      const newRows = state.execMatrix.map((row) => ({
        ...row,
        cells: row.cells.map((c) => ({ ...c, status: Math.random() > 0.3 ? "pass" as const : "pending" as const })),
      }));
      return {
        ...state,
        execMatrix: newRows,
        execModules: state.execModules.map((m) =>
          targets.includes(m.name) && !m.pending
            ? { ...m, pass: m.cases, running: 0, note: "执行完成" }
            : m,
        ),
        execCheckedModules: [],
      };
    }
    case "EXEC_SET_CELL":
      return {
        ...state,
        execMatrix: state.execMatrix.map((row) =>
          row.caseNo === action.caseNo
            ? { ...row, cells: row.cells.map((c) => (c.browser === action.browser ? { ...c, status: action.status } : c)) }
            : row,
        ),
      };
    case "EXEC_VERIFY_ISOLATION":
      return { ...state, execIsolationPassed: true };

    case "DEFECT_ADD":
      return { ...state, defectRows: [...state.defectRows, action.defect] };
    case "DEFECT_UPDATE":
      return { ...state, defectRows: updateInArray(state.defectRows, (d) => d.seq === action.seq, action.patch) };
    case "DEFECT_REMOVE":
      return { ...state, defectRows: removeFromArray(state.defectRows, (d) => d.seq === action.seq) };
    case "DEFECT_SET_FILTER":
      return { ...state, defectFilter: action.filter };

    case "EXPLORE_SET_SELECTED":
      return { ...state, selectedModuleId: action.id };
    case "EXPLORE_TOGGLE_CHECKED": {
      const collectNodeIds = (node: ModuleNodeView): string[] => [
        node.id,
        ...(node.children?.flatMap(collectNodeIds) ?? []),
      ];
      const findAndCollect = (nodes: ModuleNodeView[], id: string): string[] | null => {
        for (const n of nodes) {
          if (n.id === id) return collectNodeIds(n);
          if (n.children) {
            const found = findAndCollect(n.children, id);
            if (found) return found;
          }
        }
        return null;
      };
      const targetIds = findAndCollect(state.moduleTree, action.id);
      if (!targetIds) return state;
      const hasAll = targetIds.every((id) => state.treeChecked.includes(id));
      let newChecked: string[];
      if (hasAll) {
        newChecked = state.treeChecked.filter((id) => !targetIds.includes(id));
      } else {
        newChecked = [...new Set([...state.treeChecked, ...targetIds])];
      }
      return { ...state, treeChecked: newChecked };
    }
    case "EXPLORE_SELECT_ALL": {
      const collectAllIds = (nodes: ModuleNodeView[]): string[] =>
        nodes.flatMap((n) => [n.id, ...(n.children ? collectAllIds(n.children) : [])]);
      return { ...state, treeChecked: collectAllIds(state.moduleTree) };
    }
    case "EXPLORE_INVERT_SELECTION": {
      const collectAllIds = (nodes: ModuleNodeView[]): string[] =>
        nodes.flatMap((n) => [n.id, ...(n.children ? collectAllIds(n.children) : [])]);
      const allIds = collectAllIds(state.moduleTree);
      return { ...state, treeChecked: allIds.filter((id) => !state.treeChecked.includes(id)) };
    }
    case "EXPLORE_REMOVE_MODULES_BATCH": {
      const collectDescendants = (node: ModuleNodeView): string[] => [
        node.id,
        ...(node.children?.flatMap(collectDescendants) ?? []),
      ];
      const idsWithDescendants = new Set<string>();
      action.ids.forEach((id) => {
        const find = (nodes: ModuleNodeView[]): ModuleNodeView | null => {
          for (const n of nodes) {
            if (n.id === id) return n;
            if (n.children) {
              const f = find(n.children);
              if (f) return f;
            }
          }
          return null;
        };
        const node = find(state.moduleTree);
        if (node) {
          collectDescendants(node).forEach((d) => idsWithDescendants.add(d));
        }
      });
      const removeFromTree = (nodes: ModuleNodeView[]): ModuleNodeView[] =>
        nodes
          .filter((n) => !idsWithDescendants.has(n.id))
          .map((n) => ({ ...n, children: n.children ? removeFromTree(n.children) : undefined }));
      return {
        ...state,
        moduleTree: removeFromTree(state.moduleTree),
        treeChecked: state.treeChecked.filter((id) => !idsWithDescendants.has(id)),
        selectedModuleId: idsWithDescendants.has(state.selectedModuleId ?? "") ? null : state.selectedModuleId,
      };
    }
    case "EXPLORE_ADD_MODULE": {
      if (!action.parentId) {
        return { ...state, moduleTree: [...state.moduleTree, action.module] };
      }
      const addToTree = (nodes: ModuleNodeView[]): ModuleNodeView[] =>
        nodes.map((n) => (n.id === action.parentId ? { ...n, children: [...(n.children ?? []), action.module] } : { ...n, children: n.children ? addToTree(n.children) : undefined }));
      return { ...state, moduleTree: addToTree(state.moduleTree) };
    }
    case "EXPLORE_UPDATE_MODULE": {
      const updateNode = (nodes: ModuleNodeView[]): ModuleNodeView[] =>
        nodes.map((n) => (n.id === action.id ? { ...n, ...action.patch } : { ...n, children: n.children ? updateNode(n.children) : undefined }));
      return { ...state, moduleTree: updateNode(state.moduleTree) };
    }
    case "EXPLORE_REMOVE_MODULE": {
      const removeNode = (nodes: ModuleNodeView[]): ModuleNodeView[] =>
        nodes.filter((n) => n.id !== action.id).map((n) => ({ ...n, children: n.children ? removeNode(n.children) : undefined }));
      return { ...state, moduleTree: removeNode(state.moduleTree) };
    }
    case "EXPLORE_ADD_PENDING":
      return { ...state, pendingTree: [...state.pendingTree, action.item] };
    case "EXPLORE_REMOVE_PENDING":
      return { ...state, pendingTree: removeFromArray(state.pendingTree, (p) => p.seq === action.seq) };
    case "EXPLORE_UPDATE_PENDING":
      return { ...state, pendingTree: updateInArray(state.pendingTree, (p) => p.seq === action.seq, action.patch) };
    case "EXPLORE_PROMOTE_TO_TREE": {
      const item = state.pendingTree.find((p) => p.seq === action.seq);
      if (!item || !state.selectedModuleId || item.status === "已去重") return state;
      const newModule: ModuleNodeView = { id: "pm-" + item.seq, name: item.path.split("/").pop() ?? item.path };
      const addToTree = (nodes: ModuleNodeView[]): ModuleNodeView[] =>
        nodes.map((n) => (n.id === state.selectedModuleId ? { ...n, children: [...(n.children ?? []), newModule] } : { ...n, children: n.children ? addToTree(n.children) : undefined }));
      return {
        ...state,
        moduleTree: addToTree(state.moduleTree),
        pendingTree: removeFromArray(state.pendingTree, (p) => p.seq === action.seq),
      };
    }
    case "EXPLORE_PROMOTE_ALL": {
      if (!state.selectedModuleId) return state;
      const pendingOnly = state.pendingTree.filter((p) => p.status === "待入树");
      const kept = state.pendingTree.filter((p) => p.status !== "待入树");
      const addToTree = (nodes: ModuleNodeView[], items: PendingTreeItem[]): ModuleNodeView[] =>
        nodes.map((n) => {
          if (n.id === state.selectedModuleId) {
            const children = [...(n.children ?? [])];
            items.forEach((item) => {
              children.push({ id: "pm-" + item.seq, name: item.path.split("/").pop() ?? item.path });
            });
            return { ...n, children };
          }
          return { ...n, children: n.children ? addToTree(n.children, items) : undefined };
        });
      return {
        ...state,
        moduleTree: addToTree(state.moduleTree, pendingOnly),
        pendingTree: kept,
      };
    }
    case "EXPLORE_MOVE_NODE": {
      const { sourceId, targetId, position } = action;
      const removeSource = (nodes: ModuleNodeView[]): { tree: ModuleNodeView[]; removed: ModuleNodeView | null } => {
        let removed: ModuleNodeView | null = null;
        const result = nodes
          .filter((n) => {
            if (n.id === sourceId) {
              removed = n;
              return false;
            }
            return true;
          })
          .map((n) => {
            const { tree: childTree, removed: childRemoved } = removeSource(n.children ?? []);
            if (childRemoved) removed = childRemoved;
            return { ...n, children: childTree.length > 0 ? childTree : undefined };
          });
        return { tree: result, removed };
      };
      const isDescendant = (node: ModuleNodeView, targetId: string): boolean => {
        if (node.id === targetId) return true;
        return node.children?.some((c) => isDescendant(c, targetId)) ?? false;
      };
      const findNode = (nodes: ModuleNodeView[], id: string): ModuleNodeView | null => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if (n.children) {
            const f = findNode(n.children, id);
            if (f) return f;
          }
        }
        return null;
      };
      const sourceNode = findNode(state.moduleTree, sourceId);
      if (!sourceNode || isDescendant(sourceNode, targetId)) return state;
      const { tree: treeWithoutSource, removed } = removeSource(state.moduleTree);
      if (!removed) return state;
      const insertAt = (nodes: ModuleNodeView[]): ModuleNodeView[] => {
        const result: ModuleNodeView[] = [];
        for (const n of nodes) {
          if (n.id === targetId) {
            if (position === "before") {
              result.push(removed!);
              result.push(n);
            } else if (position === "after") {
              result.push(n);
              result.push(removed!);
            } else {
              result.push({ ...n, children: [...(n.children ?? []), removed!] });
            }
          } else {
            result.push({ ...n, children: n.children ? insertAt(n.children) : undefined });
          }
        }
        return result;
      };
      return { ...state, moduleTree: insertAt(treeWithoutSource) };
    }

    case "AI_ADD":
      return { ...state, aiConfigs: [...state.aiConfigs, action.config] };
    case "AI_UPDATE":
      return { ...state, aiConfigs: updateInArray(state.aiConfigs, (a) => a.id === action.id, action.patch) };
    case "AI_REMOVE":
      return { ...state, aiConfigs: removeFromArray(state.aiConfigs, (a) => a.id === action.id) };
    case "AI_TOGGLE_ENABLED":
      return { ...state, aiConfigs: state.aiConfigs.map((a) => (a.id === action.id ? { ...a, enabled: !a.enabled } : a)) };
    case "AI_SET_DEFAULT":
      return {
        ...state,
        aiConfigs: state.aiConfigs.map((a) => ({ ...a, isDefault: a.id === action.id })),
        aiCurrentDefault: action.id,
      };

    case "LOG_UPDATE_POLICY":
      return { ...state, logPolicy: { ...state.logPolicy, ...action.patch } };
    case "LOG_CLEANUP_EXPIRED":
      return { ...state, logFiles: state.logFiles.slice(0, 3) };
    case "LOG_CLEAR_ALL":
      return { ...state, logFiles: [] };
    case "LOG_REMOVE_FILE":
      return { ...state, logFiles: removeFromArray(state.logFiles, (f) => f.filename === action.filename) };
    case "LOG_LIST_FILES":
      return { ...state, logFiles: action.files };

    case "KNOWLEDGE_UPDATE":
      return {
        ...state,
        knowledge: state.knowledge.map((k) => (k.id === action.id ? { ...k, content: action.content } : k)),
      };
    case "KNOWLEDGE_ADD":
      return {
        ...state,
        knowledge: [...state.knowledge.filter((k) => k.id !== action.entry.id), action.entry],
      };
    case "KNOWLEDGE_REMOVE":
      return {
        ...state,
        knowledge: state.knowledge.filter((k) => k.id !== action.id),
      };

    case "ADD_ACTIVITY":
      return { ...state, activities: [action.item, ...state.activities] };

    case "PIPELINE_SET_LOADING":
      return { ...state, pipelineLoading: action.loading, pipelineStage: action.stage ?? state.pipelineStage };
    case "PIPELINE_SET_ERROR":
      return { ...state, pipelineError: action.error };
    case "PIPELINE_SET_MODE":
      return { ...state, pipelineMode: action.mode };
    case "PIPELINE_UPDATE_FEATURE":
      return { ...state, featureRows: action.rows };
    case "PIPELINE_SET_FEATURE_PATHS":
      return { ...state, featurePaths: action.paths };
    case "PIPELINE_SET_FEATURE_PROFILES":
      return { ...state, featureProfiles: action.profiles };
    case "PIPELINE_SET_FEATURE_EVIDENCE":
      return { ...state, featureEvidence: action.evidence };
    case "PIPELINE_SET_FEATURE_ARTIFACT_META":
      return { ...state, featureProvenance: action.provenance, featureDesignSources: action.designSources };
    case "PIPELINE_UPDATE_CASE":
      return {
        ...state,
        caseRows: action.rows,
        caseGroups: action.groups,
        currentCaseWorkbook: action.workbook ?? state.currentCaseWorkbook,
        metaHeader: action.meta,
        caseQualityGateIssues: action.issues ?? [],
      };
    case "PIPELINE_SET_CASE_GENERATIONS":
      return { ...state, caseGenerations: action.generations };
    case "PIPELINE_UPDATE_MODULE_TREE":
      return { ...state, moduleTree: action.nodes };
    case "PIPELINE_UPDATE_DEFECT":
      return { ...state, defectRows: action.rows };
    case "PIPELINE_UPDATE_EXEC":
      return { ...state, execMatrix: action.matrix, execModules: action.modules };

    case "BOOTSTRAP_DONE":
      return { ...state, ...action.state, bootstrapping: false };

    default:
      return state;
  }
}

// ===== Context & Provider =====

interface SystemIdentity {
  projectId: string;
  systemId: string;
  revision: number;
}

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<Action>; showToast: (msg: string) => void; getPipelineService: () => PipelineService; activateSystem: (projectId: string, systemId: string) => void; captureActiveSystem: () => SystemIdentity; isActiveSystem: (identity: SystemIdentity) => boolean } | null>(null);

const typeLabel: Record<SystemType, string> = { portal: "门户", standalone: "单系统", subsystem: "子系统" };

export function systemTypeLabel(t: SystemType): string {
  return typeLabel[t];
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeSystemRef = useRef<SystemIdentity>({ projectId: initialState.project.id, systemId: initialState.system.id, revision: 0 });

  const activateSystem = useCallback((projectId: string, systemId: string) => {
    activeSystemRef.current = { projectId, systemId, revision: activeSystemRef.current.revision + 1 };
  }, []);

  const captureActiveSystem = useCallback(() => ({ ...activeSystemRef.current }), []);

  const isActiveSystem = useCallback((identity: SystemIdentity) => (
    activeSystemRef.current.projectId === identity.projectId
    && activeSystemRef.current.systemId === identity.systemId
    && activeSystemRef.current.revision === identity.revision
  ), []);

  const showToast = useCallback((msg: string) => {
    dispatch({ type: "SHOW_TOAST", msg });
    window.setTimeout(() => dispatch({ type: "CLEAR_TOAST" }), 2200);
  }, []);

  const pipelineServiceRef = useRef<PipelineService | null>(null);

  const getPipelineService = useCallback(() => {
    if (pipelineServiceRef.current) return pipelineServiceRef.current;
    const svc = createPipelineService();
    pipelineServiceRef.current = svc;
    return svc;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bootstrap = await dataApi.loadBootstrap();
        if (cancelled) return;

        const projects: ProjectInfo[] = bootstrap.projects.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          description: p.description,
          systemCount: p.systems?.length ?? 0,
          caseCount: 0,
          createdAt: new Date(p.createdAt).toISOString().slice(0, 10),
          lastActive: "最近",
          status: "活跃",
          activeSystemId: p.activeSystemId,
        }));

        // 收集所有系统到 Map，便于跨项目查找父门户
        const systemMap = new Map<string, { name: string; url: string }>();
        for (const p of bootstrap.projects) {
          for (const s of p.systems ?? []) {
            systemMap.set(s.id, { name: s.name, url: s.url });
          }
        }
        console.log('[debug] systemMap built:', Object.fromEntries(systemMap));

        const allSystems: SystemInfo[] = [];
        for (const p of bootstrap.projects) {
          for (const s of p.systems ?? []) {
            // 对于子系统，查找父门户信息
            let parentPortalPath: { name: string; url: string } | undefined;
            if (s.type === 'subsystem' && s.parentPortalId) {
              const parent = systemMap.get(s.parentPortalId);
              console.log(`[debug] Subsystem ${s.name} (${s.id}) parentPortalId=${s.parentPortalId}, found=${!!parent}`);
              if (parent) {
                parentPortalPath = parent;
                console.log(`[debug] parentPortalPath set:`, parent);
              }
            }

            allSystems.push({
              id: s.id,
              name: s.name,
              type: s.type,
              url: s.url,
              captured: !!s.url,
              parent: p.name,
              projectId: p.id,
              loginMode: s.credentialMode,
              loginStatus: s.loginState === 'logged_in' ? 'logged_in' : 'logged_out',
              parentPortalId: s.parentPortalId,
              parentPortalPath,
              sessionState: s.sessionState,
              username: s.credentials?.username,
              passwordRef: undefined,
              credentials: s.credentials,
              credentialMode: s.credentialMode,
              // 登录成功后浏览器所在的应用页 URL（子系统探索目标）。非冻结契约字段，
              // 但 store 以 JSON 整存 systems，运行时可达；重启后若丢失会回退门户 URL
              // → 探索门户而非子系统。
              capturedUrl: (s as typeof s & { capturedUrl?: string }).capturedUrl,
            });
          }
        }

        const activeProjectRaw = bootstrap.projects.find((p) => p.systems?.some((s) => s.id === p.activeSystemId)) ?? bootstrap.projects[0];
        const activeProject = activeProjectRaw ? {
          id: activeProjectRaw.id,
          name: activeProjectRaw.name,
          type: activeProjectRaw.type,
          description: activeProjectRaw.description,
          systemCount: activeProjectRaw.systems?.length ?? 0,
          caseCount: 0,
          createdAt: new Date(activeProjectRaw.createdAt).toISOString().slice(0, 10),
          lastActive: "最近",
          status: "活跃" as const,
          activeSystemId: activeProjectRaw.activeSystemId,
        } : undefined;
        const savedActiveSystemId = activeProjectRaw?.activeSystemId;
        const activeSystem = (savedActiveSystemId ? allSystems.find((s) => s.id === savedActiveSystemId) : undefined)
          ?? allSystems.find((s) => activeProjectRaw && s.parent === activeProjectRaw.name)
          ?? allSystems[0];

        const systemData = bootstrap.systemData ?? {};
        let featureRows = initialState.featureRows;
        let featureProfiles = initialState.featureProfiles;
        let featurePaths = initialState.featurePaths;
        let featureEvidence = initialState.featureEvidence;
        let featureProvenance = initialState.featureProvenance;
        let featureDesignSources = initialState.featureDesignSources;
        let caseRows = initialState.caseRows;
        let caseGroups = initialState.caseGroups;
        let currentCaseWorkbook = initialState.currentCaseWorkbook;
        let metaHeader = initialState.metaHeader;

        if (activeSystem) {
          const sysData = systemData[activeSystem.id];
          if (sysData?.featureTable && Array.isArray(sysData.featureTable)) {
            featureRows = toFeatureView(sysData.featureTable as any);
          }
          if (sysData?.featureArtifact && !Array.isArray(sysData.featureArtifact)) {
            featureProfiles = sysData.featureArtifact.featureProfiles ?? [];
            featurePaths = sysData.featureArtifact.featurePaths ?? {};
            featureEvidence = sysData.featureArtifact.featureEvidence ?? {};
            featureProvenance = sysData.featureArtifact.provenance ?? [];
            featureDesignSources = sysData.featureArtifact.designSources ?? [];
          }
          if (sysData?.caseTable && Array.isArray(sysData.caseTable)) {
            const conv = toCaseView(sysData.caseTable as any[]);
            caseRows = conv.rows;
            caseGroups = conv.groups;
            currentCaseWorkbook = sysData.caseTable as CaseSheet[];
            metaHeader = conv.meta;
          }
          try {
            const savedMeta = await dataApi.getMetaConfig(activeProject?.id ?? '', activeSystem.id);
            if (savedMeta && typeof savedMeta === 'object') {
              metaHeader = { ...metaHeader, ...savedMeta };
            }
          } catch {
            // Meta is optional during bootstrap.
          }
        }

        let aiConfigs = initialState.aiConfigs;
        let aiCurrentDefault = initialState.aiCurrentDefault;
        try {
          const loadedConfigs = await dataApi.listAIConfigs();
          aiConfigs = loadedConfigs.map((c) => ({
            id: c.id,
            enabled: c.enabled,
            name: c.name,
            vendor: c.vendor,
            baseUrl: c.baseUrl,
            model: c.model,
            isDefault: c.isDefault,
            apiKeyRef: c.apiKeyRef,
            temperature: c.temperature,
            maxTokens: c.maxTokens,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          }));
          const def = aiConfigs.find((c) => c.isDefault);
          aiCurrentDefault = def ? def.id : (aiConfigs[0]?.id ?? '');
        } catch {
          // AI configs not available, use empty
        }

        let knowledge: KnowledgeEntry[] = [];
        try {
          if (bootstrap.knowledge && Array.isArray(bootstrap.knowledge)) {
            knowledge = bootstrap.knowledge.map((k) => ({
              id: k.id,
              scope: k.scope,
              projectId: k.projectId,
              systemId: k.systemId,
              content: k.content,
              updatedAt: k.updatedAt,
            }));
          }
        } catch {
          // knowledge not available, use empty
        }

        dispatch({
          type: "BOOTSTRAP_DONE",
          state: {
            projects,
            systems: allSystems,
            project: activeProject ?? initialState.project,
            system: activeSystem ?? initialState.system,
            featureRows,
            featureProfiles,
            featurePaths,
            featureEvidence,
            featureProvenance,
            featureDesignSources,
            caseRows,
            caseGroups,
            currentCaseWorkbook,
            metaHeader,
            aiConfigs,
            aiCurrentDefault,
            knowledge,
          },
        });
        activateSystem(activeProject?.id ?? '', activeSystem?.id ?? '');
      } catch {
        if (!cancelled) {
          dispatch({ type: "BOOTSTRAP_DONE", state: {} });
          showToast("后端未连接，使用空数据");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  useEffect(() => {
    if (state.bootstrapping) return;
    if (!state.project?.id || !state.system?.id) return;

    const identity = captureActiveSystem();
    let cancelled = false;

    (async () => {
      try {
        const [ft, artifact, ct, meta, gens] = await Promise.all([
          dataApi.getFeatureTable(state.project.id, state.system.id),
          dataApi.getFeatureArtifact(state.project.id, state.system.id),
          dataApi.getCaseTable(state.project.id, state.system.id),
          dataApi.getMetaConfig(state.project.id, state.system.id).catch(() => null),
          dataApi.getCaseGenerations(state.project.id, state.system.id).catch(() => null),
        ]);
        if (cancelled || !isActiveSystem(identity)) return;
        if (ft && Array.isArray(ft)) {
          dispatch({ type: "PIPELINE_UPDATE_FEATURE", rows: toFeatureView(ft as any) });
        }
        if (artifact && !Array.isArray(artifact)) {
          dispatch({ type: "PIPELINE_SET_FEATURE_PROFILES", profiles: artifact.featureProfiles ?? [] });
          dispatch({ type: "PIPELINE_SET_FEATURE_PATHS", paths: artifact.featurePaths ?? {} });
          dispatch({ type: "PIPELINE_SET_FEATURE_EVIDENCE", evidence: artifact.featureEvidence ?? {} });
          dispatch({ type: "PIPELINE_SET_FEATURE_ARTIFACT_META", provenance: artifact.provenance ?? [], designSources: artifact.designSources ?? [] });
        } else {
          dispatch({ type: "PIPELINE_SET_FEATURE_PROFILES", profiles: [] });
          dispatch({ type: "PIPELINE_SET_FEATURE_PATHS", paths: {} });
          dispatch({ type: "PIPELINE_SET_FEATURE_EVIDENCE", evidence: {} });
          dispatch({ type: "PIPELINE_SET_FEATURE_ARTIFACT_META", provenance: [], designSources: [] });
        }
        if (ct && Array.isArray(ct)) {
          const conv = toCaseView(ct as any[]);
          const mergedMeta = meta && typeof meta === 'object' ? { ...conv.meta, ...meta } : conv.meta;
          dispatch({ type: "PIPELINE_UPDATE_CASE", rows: conv.rows, groups: conv.groups, meta: mergedMeta, workbook: ct as CaseSheet[] });
        } else if (meta && typeof meta === 'object') {
          dispatch({ type: "CASE_UPDATE_META", patch: meta as Partial<MetaHeader> });
        }
        if (gens && Array.isArray(gens)) {
          dispatch({ type: "PIPELINE_SET_CASE_GENERATIONS", generations: gens as CaseGenerationContext[] });
        }
      } catch (e) {
        if (cancelled || !isActiveSystem(identity)) return;
        console.warn('Failed to reload system data:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [state.project?.id, state.system?.id, state.bootstrapping, captureActiveSystem, isActiveSystem]);

  const value = { state, dispatch, showToast, getPipelineService, activateSystem, captureActiveSystem, isActiveSystem };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  const { state, dispatch, showToast, getPipelineService, activateSystem, captureActiveSystem, isActiveSystem } = ctx;

  return {
    // State
    project: state.project,
    system: state.system,
    projects: state.projects,
    systems: state.systems,
    activeScreen: state.activeScreen,
    toastMsg: state.toastMsg,
    featureRows: state.featureRows,
    featureConfirmed: state.featureConfirmed,
    featurePaths: state.featurePaths,
    featureProfiles: state.featureProfiles,
    featureEvidence: state.featureEvidence,
    featureProvenance: state.featureProvenance,
    featureDesignSources: state.featureDesignSources,
    caseQualityGateIssues: state.caseQualityGateIssues,
    currentCaseWorkbook: state.currentCaseWorkbook,
    caseRows: state.caseRows,
    caseGroups: state.caseGroups,
    metaHeader: state.metaHeader,
    caseSelectedModules: state.caseSelectedModules,
    caseGenerations: state.caseGenerations,
    caseAiOn: state.caseAiOn,
    exploreAiOn: state.exploreAiOn,
    readOnlyClickPolicy: state.readOnlyClickPolicy,
    execModules: state.execModules,
    execBrowsers: state.execBrowsers,
    execMatrix: state.execMatrix,
    execCheckedModules: state.execCheckedModules,
    execIsolationPassed: state.execIsolationPassed,
    defectRows: state.defectRows,
    defectFilter: state.defectFilter,
    moduleTree: state.moduleTree,
    pendingTree: state.pendingTree,
    selectedModuleId: state.selectedModuleId,
    treeChecked: state.treeChecked,
    aiConfigs: state.aiConfigs,
    aiCurrentDefault: state.aiCurrentDefault,
    logPolicy: state.logPolicy,
    logFiles: state.logFiles,
    knowledge: state.knowledge,
    activities: state.activities,
    systemTypeLabel,
    loginModeLabel,
    loginStatusLabel,

    // Pipeline state
    pipelineLoading: state.pipelineLoading,
    pipelineStage: state.pipelineStage,
    pipelineError: state.pipelineError,
    pipelineMode: state.pipelineMode,
    bootstrapping: state.bootstrapping,

    // Pipeline operations
    runPipelineLogin: async (input?: any) => {
      const identity = captureActiveSystem();
      dispatch({ type: "PIPELINE_SET_LOADING", loading: true, stage: "login" });
      dispatch({ type: "PIPELINE_SET_ERROR", error: null });
      try {
        const svc = getPipelineService();
        const out = await svc.runStageLogin(input ?? {});
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "SET_LOGIN_STATUS", id: identity.systemId, status: out.loginStatus === 'ok' ? 'logged_in' as const : 'logged_out' as const });
        if (out.loginStatus === 'ok' && out.cookies && out.cookies.length > 0) {
          const sessionState = { cookies: out.cookies, headers: out.sessionHandle?.headers, tokens: out.sessionHandle?.tokens };
          dispatch({ type: "SET_SESSION_STATE", id: identity.systemId, sessionState });
          try {
            // 登录后浏览器所在的应用页 URL 一并持久化为 capturedUrl：
            // 探索应导航到登录后的应用页，而非门户闸门根路径（裸根路径重载后跳登录页 = 探索后退登出）
            const capturedUrl = (out as any).capturedUrl;
            await dataApi.updateSystem(identity.projectId, identity.systemId, {
              loginState: 'logged_in',
              sessionState,
              ...(capturedUrl ? { capturedUrl } : {}),
            } as any);
            // 同步更新内存中的 system，使随后的探索立即使用 capturedUrl（无需刷新页面）
            if (capturedUrl && isActiveSystem(identity)) {
              dispatch({ type: "UPDATE_SYSTEM", id: identity.systemId, patch: { capturedUrl } });
            }
          } catch (persistErr) {
            console.warn('Failed to persist session state:', persistErr);
          }
        } else if (out.loginStatus === 'ok' && state.system.credentialMode !== 'no-login') {
          console.warn('[pipeline] Login succeeded but no valid cookies captured');
          showToast("警告：登录成功但未获取到有效会话，探索功能可能需要重新登录");
        }
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "ADD_ACTIVITY", item: { id: "p-" + Date.now(), time: new Date().toLocaleTimeString(), text: `登录完成: ${out.loginStatus}${out.sessionHandle?.detectionReason ? ` - ${out.sessionHandle.detectionReason}` : ''}` } });
        return out;
      } catch (e: any) {
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "PIPELINE_SET_ERROR", error: e.message });
        showToast(`登录失败: ${e.message}`);
        return null;
      } finally {
        if (isActiveSystem(identity)) dispatch({ type: "PIPELINE_SET_LOADING", loading: false, stage: null });
      }
    },

    runPipelineExplore: async (input?: any) => {
      const identity = captureActiveSystem();
      dispatch({ type: "PIPELINE_SET_LOADING", loading: true, stage: "explore" });
      dispatch({ type: "PIPELINE_SET_ERROR", error: null });
      try {
        const svc = getPipelineService();
        // 注入探索阶段独立 AI 开关：默认关闭（state.exploreAiOn=false），开启后由后端 buildExploreAi 启用 AI 探索
        const exploreInput = {
          ...(input ?? {}),
          aiConfig: { configId: state.aiCurrentDefault || 'default', enabled: !!state.exploreAiOn },
          readOnlyClickPolicy: state.readOnlyClickPolicy,
        };
        const out = await svc.runStageExplore(exploreInput);
        if (!isActiveSystem(identity)) return null;
        if (out.moduleTree) {
          const nodes = toModuleView(out.moduleTree);
          dispatch({ type: "PIPELINE_UPDATE_MODULE_TREE", nodes });
        }
        if (identity.projectId && identity.systemId) {
          try {
            await dataApi.saveModuleTree(identity.projectId, identity.systemId, out.moduleTree);
          } catch (e) {
            console.warn('Failed to persist explore results:', e);
          }
        }
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "ADD_ACTIVITY", item: { id: "p-" + Date.now(), time: new Date().toLocaleTimeString().slice(0, 5), text: `探索完成: ${out.moduleTree?.length ?? 0} 个模块` } });
        return out;
      } catch (e: any) {
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "PIPELINE_SET_ERROR", error: e.message });
        showToast(`探索失败: ${e.message}`);
        return null;
      } finally {
        if (isActiveSystem(identity)) dispatch({ type: "PIPELINE_SET_LOADING", loading: false, stage: null });
      }
    },

    runPipelineFeature: async (input?: any) => {
      const identity = captureActiveSystem();
      dispatch({ type: "PIPELINE_SET_LOADING", loading: true, stage: "feature" });
      dispatch({ type: "PIPELINE_SET_ERROR", error: null });
      try {
        const svc = getPipelineService();
        const out = await svc.runStageFeature(input ?? {});
        if (!isActiveSystem(identity)) return null;
        if (out.featureTable) {
          const rows = toFeatureView(out.featureTable as unknown as string[][]);
          dispatch({ type: "PIPELINE_UPDATE_FEATURE", rows });
        }
        // 捕获功能点阶段带出的页面路径，供用例阶段按所选模块真实探索
        dispatch({ type: "PIPELINE_SET_FEATURE_PATHS", paths: (out.featurePaths ?? {}) as Record<string, string> });
        dispatch({ type: "PIPELINE_SET_FEATURE_PROFILES", profiles: (out.featureProfiles ?? []) as FeatureProfile[] });
        dispatch({ type: "PIPELINE_SET_FEATURE_EVIDENCE", evidence: (out.featureEvidence ?? {}) as Record<string, FeatureEvidence> });
        const designSources = (input?.designSources as DesignSource[] | undefined)?.map((source) => source.name ?? source.kind) ?? [];
        dispatch({ type: "PIPELINE_SET_FEATURE_ARTIFACT_META", provenance: out.provenance ?? [], designSources });
        // Persist feature table to backend
        if (identity.projectId && identity.systemId && isActiveSystem(identity)) {
          try {
            await dataApi.saveFeatureArtifact(identity.projectId, identity.systemId, {
              version: 2,
              table: out.featureTable as FeatureRow[][],
              featurePaths: out.featurePaths,
              featureProfiles: out.featureProfiles,
              featureEvidence: out.featureEvidence,
              provenance: out.provenance,
              designSources,
            });
          } catch (e) {
            console.warn('Failed to persist feature results:', e);
          }
        }
        dispatch({ type: "ADD_ACTIVITY", item: { id: "p-" + Date.now(), time: new Date().toLocaleTimeString(), text: `功能点生成: ${out.featureIds?.length ?? 0} 个` } });
        return out;
      } catch (e: any) {
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "PIPELINE_SET_ERROR", error: e.message });
        showToast(`功能点生成失败: ${e.message}`);
        return null;
      } finally {
        if (isActiveSystem(identity)) dispatch({ type: "PIPELINE_SET_LOADING", loading: false, stage: null });
      }
    },

    runPipelineCase: async (input?: any) => {
      const identity = captureActiveSystem();
      dispatch({ type: "PIPELINE_SET_LOADING", loading: true, stage: "case" });
      dispatch({ type: "PIPELINE_SET_ERROR", error: null });
      try {
        const svc = getPipelineService();
        const featureTable = input?.featureTable ?? fromFeatureViewToTable(state.featureRows);
        const metaConfig = input?.metaConfig ?? {
          systemName: state.metaHeader.system || state.system.name || '',
          testPointId: state.metaHeader.testPointId || '',
          testPoint: state.metaHeader.testPoint || '',
          testers: state.metaHeader.testers || '',
          clientStaff: state.metaHeader.clientStaff || '',
          developerStaff: state.metaHeader.developerStaff || '',
          firstTestDate: state.metaHeader.firstTestDate || '',
          regressionDate: state.metaHeader.regressionDate || '',
          conclusionRule: state.metaHeader.conclusionRule || '',
          precondition: state.metaHeader.precondition || '',
        };
        const scope = input?.scope ?? (state.caseSelectedModules.length > 0 ? 'selected_modules' : 'all');
        const selectedModuleIds = input?.selectedModuleIds ?? (scope === 'selected_modules' ? state.caseSelectedModules : undefined);
        const exploredElements = input?.exploredElements ?? state.exploredElements ?? undefined;
        const featurePaths = input?.featurePaths ?? state.featurePaths ?? undefined;
        const featureProfiles = input?.featureProfiles ?? state.featureProfiles ?? undefined;
        const featureEvidence = input?.featureEvidence ?? state.featureEvidence ?? undefined;
        const aiEnabled = input?.aiConfig?.enabled ?? state.caseAiOn;
        const requestedAiConfig = input?.aiConfig;
        const regenerateSelected = input?.regenerateSelected ?? false;

        const contractInput = {
          featureTable,
          scope,
          selectedModuleIds,
          featurePaths,
          featureProfiles,
          featureEvidence,
          currentCaseWorkbook: input?.currentCaseWorkbook ?? state.currentCaseWorkbook,
          systemId: state.system.id,
          // 用例阶段二次探索必须复用登录会话：入口取登录后的应用页（capturedUrl），而非可能为登录页的配置 URL
          systemUrl: state.system.capturedUrl || state.system.url,
          aiConfig: requestedAiConfig ?? (aiEnabled
            ? { configId: state.aiCurrentDefault || 'default', enabled: true as const }
            : { enabled: false as const }),
          metaConfig,
          ...(input && Object.prototype.hasOwnProperty.call(input, 'regenerateSelected')
            ? { regenerateSelected: input.regenerateSelected }
            : regenerateSelected ? { regenerateSelected: true } : {}),
          ...(exploredElements ? { exploredElements } : {}),
          readOnlyClickPolicy: state.readOnlyClickPolicy,
        };
        const out = await svc.runStageCase(contractInput);
        if (!isActiveSystem(identity)) return null;
        const featureResults = (out.featureResults ?? []) as Array<{ featureId?: string; status: string; reasons?: string[]; generatedCaseGroup?: boolean }>;
        const failedFeatures = featureResults.filter((result) => !['generated', 'skipped_existing'].includes(result.status));
        const blockingQualityIssues = (out.qualityGateIssues ?? []).filter((issue: { blocking?: boolean }) => issue.blocking);
        // 部分功能点失败不是整体失败：成功组必须可见（spec §12/§13），失败原因必须明确展示。
        // 只有既无任何成功产物、又存在失败项时才按整体失败处理。
        const generatedCount = featureResults.filter((r) => r.status === 'generated').length;
        const hasAnyProduct = (out.caseWorkbook ?? []).some((sheet: { rows?: unknown[] }) => (sheet.rows?.length ?? 0) > 0);
        if (failedFeatures.length > 0 || blockingQualityIssues.length > 0) {
          const featureDetails = failedFeatures.map((result) =>
            `${result.featureId ?? 'unknown'}=${result.status}${result.reasons?.length ? `（${result.reasons.join('；')}）` : ''}`,
          );
          const qualityDetails = blockingQualityIssues.map((issue: { message?: string }) => issue.message ?? '质量门阻断');
          const details = [...featureDetails, ...qualityDetails];
          const message = generatedCount > 0 || hasAnyProduct
            ? `用例生成完成但部分功能点未完成：成功 ${generatedCount} 个，${details.join('；')}`
            : `用例生成未完成：${details.join('；')}`;
          dispatch({ type: "PIPELINE_SET_ERROR", error: message });
          showToast(message);
          if (!hasAnyProduct && generatedCount === 0) return null;
        }
        if (out.caseWorkbook) {
          const { rows, groups, meta } = toCaseView(out.caseWorkbook);
          // 失败功能点明细转为阻断性质量门问题透传页面（spec §6.6/§13：失败按功能点记录并可见）
          const failedIssues = failedFeatures.map((result) => ({
            caseRowId: result.featureId ?? 'unknown',
            type: '缺证据' as const,
            message: `${result.featureId ?? 'unknown'} ${result.status}${result.reasons?.length ? `（${result.reasons.join('；')}）` : ''}`,
            blocking: true,
          }));
          dispatch({ type: "PIPELINE_UPDATE_CASE", rows, groups, meta, workbook: out.caseWorkbook, issues: [...(out.qualityGateIssues ?? []), ...failedIssues] });
        }
        if (identity.projectId && identity.systemId && isActiveSystem(identity)) {
          await dataApi.saveCaseTable(identity.projectId, identity.systemId, out.caseWorkbook);
          const gens = await dataApi.getCaseGenerations(identity.projectId, identity.systemId).catch(() => null);
          if (gens && Array.isArray(gens) && isActiveSystem(identity)) {
            dispatch({ type: "PIPELINE_SET_CASE_GENERATIONS", generations: gens as CaseGenerationContext[] });
          }
        }
        dispatch({ type: "ADD_ACTIVITY", item: { id: "p-" + Date.now(), time: new Date().toLocaleTimeString(), text: `用例生成` } });
        return out;
      } catch (e: any) {
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "PIPELINE_SET_ERROR", error: e.message });
        showToast(`用例生成失败: ${e.message}`);
        return null;
      } finally {
        if (isActiveSystem(identity)) dispatch({ type: "PIPELINE_SET_LOADING", loading: false, stage: null });
      }
    },

    getFeatureModules: () => {
      const subModules = new Set<string>();
      const mainModules = new Set<string>();
      for (const row of state.featureRows) {
        if (row.subModule) subModules.add(row.subModule);
        if (row.mainModule) mainModules.add(row.mainModule);
      }
      return {
        subModules: Array.from(subModules),
        mainModules: Array.from(mainModules),
      };
    },

    runPipelineExecute: async (input?: any) => {
      const identity = captureActiveSystem();
      dispatch({ type: "PIPELINE_SET_LOADING", loading: true, stage: "execute" });
      dispatch({ type: "PIPELINE_SET_ERROR", error: null });
      try {
        const svc = getPipelineService();
        const out = await svc.runStageExecute(input ?? {});
        if (!isActiveSystem(identity)) return null;
        if (out.executionReport) {
          const matrix = toExecView(out.executionReport, state.execBrowsers);
          dispatch({ type: "PIPELINE_UPDATE_EXEC", matrix, modules: state.execModules });
        }
        if (out.isolationVerified !== undefined) {
          dispatch({ type: "EXEC_VERIFY_ISOLATION" });
        }
        // Persist execution results to backend
        if (identity.projectId && identity.systemId) {
          try {
            await dataApi.saveExecution(identity.projectId, identity.systemId, out.executionReport);
          } catch (e) {
            console.warn('Failed to persist execution results:', e);
          }
        }
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "ADD_ACTIVITY", item: { id: "p-" + Date.now(), time: new Date().toLocaleTimeString(), text: `执行完成` } });
        return out;
      } catch (e: any) {
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "PIPELINE_SET_ERROR", error: e.message });
        showToast(`执行失败: ${e.message}`);
        return null;
      } finally {
        if (isActiveSystem(identity)) dispatch({ type: "PIPELINE_SET_LOADING", loading: false, stage: null });
      }
    },

    runPipelineDefect: async (input?: any) => {
      const identity = captureActiveSystem();
      dispatch({ type: "PIPELINE_SET_LOADING", loading: true, stage: "defect" });
      dispatch({ type: "PIPELINE_SET_ERROR", error: null });
      try {
        const svc = getPipelineService();
        const out = await svc.runStageDefect(input ?? {});
        if (!isActiveSystem(identity)) return null;
        const rows = toDefectView(out);
        dispatch({ type: "PIPELINE_UPDATE_DEFECT", rows });
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "ADD_ACTIVITY", item: { id: "p-" + Date.now(), time: new Date().toLocaleTimeString(), text: `缺陷分析完成: ${rows.length} 个缺陷` } });
        return out;
      } catch (e: any) {
        if (!isActiveSystem(identity)) return null;
        dispatch({ type: "PIPELINE_SET_ERROR", error: e.message });
        showToast(`缺陷分析失败: ${e.message}`);
        return null;
      } finally {
        if (isActiveSystem(identity)) dispatch({ type: "PIPELINE_SET_LOADING", loading: false, stage: null });
      }
    },

    setPipelineMode: (mode: 'mock' | 'real') => {
      dispatch({ type: "PIPELINE_SET_MODE", mode });
      showToast(`已切换到 ${mode === 'mock' ? 'Mock' : '真实'} 模式`);
    },


    // Navigation
    setActiveScreen: (s: string) => dispatch({ type: "SET_SCREEN", screen: s }),
    toast: showToast,

    // Project
    setProject: (id: string) => {
      const project = state.projects.find((item) => item.id === id);
      const activeSystem = project
        ? state.systems.find((item) => item.id === project.activeSystemId && item.projectId === project.id)
        : undefined;
      const system = activeSystem ?? state.systems.find((item) => item.projectId === project?.id);
      if (project && system) {
        activateSystem(project.id, system.id);
      }
      dispatch({ type: "SET_PROJECT", id });
    },
    addProject: async (p: ProjectInfo) => {
      try {
        const created = await dataApi.createProject({ name: p.name, description: p.description, type: p.type });
        const info: ProjectInfo = { ...p, id: created.id, systemCount: 0, createdAt: new Date(created.createdAt).toISOString().slice(0, 10), lastActive: "最近" };
        dispatch({ type: "ADD_PROJECT", project: info });
        showToast(`项目 "${p.name}" 已创建`);
      } catch (e: any) {
        showToast(`创建失败: ${e.message}`);
      }
    },
    updateProject: async (id: string, patch: Partial<ProjectInfo>) => {
      try {
        const cur = await dataApi.getProject(id);
        if (cur) {
          const backendPatch: any = { ...patch };
          delete backendPatch.systemCount;
          delete backendPatch.caseCount;
          delete backendPatch.createdAt;
          delete backendPatch.lastActive;
          delete backendPatch.status;
          await dataApi.updateProject(id, backendPatch);
          dispatch({ type: "UPDATE_PROJECT", id, patch });
        }
      } catch (e: any) {
        showToast(`更新失败: ${e.message}`);
      }
    },
    removeProject: async (id: string) => {
      try {
        await dataApi.deleteProject(id);
        dispatch({ type: "REMOVE_PROJECT", id });
        showToast("项目已删除");
      } catch (e: any) {
        showToast(`删除失败: ${e.message}`);
      }
    },

    // System
    setSystem: async (id: string) => {
      const next = state.systems.find((item) => item.id === id);
      if (!next?.projectId) return;
      activateSystem(next.projectId, next.id);
      dispatch({ type: "SET_SYSTEM", id });
      if (state.project?.id) {
        try {
          await dataApi.setActiveSystem(next.projectId, id);
        } catch (e) {
          console.warn('Failed to persist active system:', e);
        }
      }
    },
    addSystem: async (s: SystemInfo) => {
      const targetProjectId = s.projectId || state.project.id;
      if (!targetProjectId) {
        showToast("请先创建或选择一个项目");
        return;
      }
      try {
        const created = await dataApi.addSystem(targetProjectId, {
          name: s.name,
          url: s.url,
          type: s.type,
          credentialMode: s.loginMode,
          loginState: s.loginStatus === 'logged_in' ? 'logged_in' : 'logged_out',
          credentials: s.credentials,
          // 登录后应用页 URL（子系统探索目标）与会话状态一并落库：
          // 此前被丢弃 → 重启后 capturedUrl 回退门户 URL → 探索门户而非子系统。
          capturedUrl: s.capturedUrl,
          sessionState: s.sessionState,
        });
        const info: SystemInfo = {
          ...s,
          id: created.id,
          projectId: targetProjectId,
          loginMode: created.credentialMode as LoginMode,
          loginStatus: created.loginState === 'logged_in' ? 'logged_in' : 'logged_out',
          captured: !!created.url,
          credentials: created.credentials,
        };
        dispatch({ type: "ADD_SYSTEM", system: info });
        showToast(`系统 "${s.name}" 已添加`);
        return info;
      } catch (e: any) {
        showToast(`添加系统失败: ${e.message}`);
        return undefined;
      }
    },
    updateSystem: async (id: string, patch: Partial<SystemInfo>) => {
      const sys = state.systems.find((s) => s.id === id);
      const projectId = patch.projectId || sys?.projectId || state.project.id;
      if (!projectId) return;
      try {
        const backendPatch: any = {};
        if (patch.name !== undefined) backendPatch.name = patch.name;
        if (patch.url !== undefined) backendPatch.url = patch.url;
        if (patch.type !== undefined) backendPatch.type = patch.type;
        if (patch.loginMode !== undefined) backendPatch.credentialMode = patch.loginMode;
        if (patch.loginStatus !== undefined) backendPatch.loginState = patch.loginStatus === 'logged_in' ? 'logged_in' : 'logged_out';
        if (patch.parentPortalId !== undefined) backendPatch.parentPortalId = patch.parentPortalId;
        if (patch.credentials !== undefined) backendPatch.credentials = patch.credentials;
        // capturedUrl/sessionState 此前不在白名单：项目管理编辑保存（含浏览器捕获回填）
        // 会把它们丢掉 → 重启后 capturedUrl 回退门户 URL → 探索门户而非子系统。
        if (patch.capturedUrl !== undefined) backendPatch.capturedUrl = patch.capturedUrl;
        if (patch.sessionState !== undefined) backendPatch.sessionState = patch.sessionState;
        if (Object.keys(backendPatch).length > 0) {
          await dataApi.updateSystem(projectId, id, backendPatch);
        }
        dispatch({ type: "UPDATE_SYSTEM", id, patch });
      } catch (e: any) {
        showToast(`更新系统失败: ${e.message}`);
      }
    },
    removeSystem: async (id: string) => {
      const sys = state.systems.find((s) => s.id === id);
      const projectId = sys?.projectId || state.project.id;
      if (!projectId) {
        showToast("缺少项目关联，无法删除");
        return;
      }
      try {
        await dataApi.removeSystem(projectId, id);
        dispatch({ type: "REMOVE_SYSTEM", id });
        showToast("系统已删除");
      } catch (e: any) {
        showToast(`删除系统失败: ${e.message}`);
      }
    },
    setLoginStatus: async (id: string, status: LoginStatus) => {
      dispatch({ type: "SET_LOGIN_STATUS", id, status });
      const sys = state.systems.find((s) => s.id === id);
      const projectId = sys?.projectId || state.project.id;
      if (projectId) {
        try {
          await dataApi.updateSystem(projectId, id, {
            loginState: status === 'logged_in' ? 'logged_in' : 'logged_out',
          });
        } catch {
          // 静默失败，前端状态已更新
        }
      }
    },

    // Knowledge
    addKnowledge: async (entry: KnowledgeEntry) => {
      try {
        const saved = await dataApi.saveKnowledgeEntry(entry);
        dispatch({ type: "KNOWLEDGE_ADD", entry: saved });
        showToast("知识库已保存");
      } catch (e: any) {
        showToast(`保存失败: ${e.message}`);
      }
    },
    updateKnowledge: async (id: string, content: string) => {
      const entry = state.knowledge.find((k) => k.id === id);
      if (!entry) {
        showToast("知识库条目不存在");
        return;
      }
      try {
        const updated = await dataApi.saveKnowledgeEntry({ ...entry, content });
        dispatch({ type: "KNOWLEDGE_ADD", entry: updated });
        showToast("知识库已更新");
      } catch (e: any) {
        showToast(`更新失败: ${e.message}`);
      }
    },
    removeKnowledge: async (id: string) => {
      try {
        await dataApi.deleteKnowledgeEntry(id);
        dispatch({ type: "KNOWLEDGE_REMOVE", id });
        showToast("知识库已删除");
      } catch (e: any) {
        showToast(`删除失败: ${e.message}`);
      }
    },

    // Feature
    featureAddRow: (afterIndex?: number) => dispatch({ type: "FEATURE_ADD_ROW", afterIndex }),
    featureUpdateRow: (index: number, patch: Partial<FeatureRowView>) => dispatch({ type: "FEATURE_UPDATE_ROW", index, patch }),
    featureRemoveRow: (index: number) => dispatch({ type: "FEATURE_REMOVE_ROW", index }),
    featureAddModule: (module: FeatureRowView) => dispatch({ type: "FEATURE_ADD_MODULE", module }),
    featureConfirm: () => dispatch({ type: "FEATURE_CONFIRM" }),
    featureUnconfirm: () => dispatch({ type: "FEATURE_UNCONFIRM" }),
    featureToggleReview: (index: number) => dispatch({ type: "FEATURE_TOGGLE_REVIEW", index }),
    saveFeatureTable: async () => {
      if (!state.project.id || !state.system.id) {
        showToast("请先选择项目和系统");
        return;
      }
      try {
        await dataApi.saveFeatureArtifact(state.project.id, state.system.id, {
          version: 2,
          table: fromFeatureViewToTable(state.featureRows),
          featurePaths: state.featurePaths,
          featureProfiles: state.featureProfiles,
          featureEvidence: state.featureEvidence,
          provenance: state.featureProvenance,
          designSources: state.featureDesignSources,
        });
        showToast("功能点表已保存");
      } catch (e: any) {
        showToast("保存失败: " + e.message);
      }
    },
    reloadFeatureTable: async () => {
      if (!state.project.id || !state.system.id) {
        showToast("请先选择项目和系统");
        return;
      }
      try {
        const artifact = await dataApi.getFeatureArtifact(state.project.id, state.system.id);
        if (artifact) {
          const table = Array.isArray(artifact) ? artifact : artifact.table;
          dispatch({ type: "PIPELINE_UPDATE_FEATURE", rows: toFeatureView(table as any) });
          if (!Array.isArray(artifact)) {
            dispatch({ type: "PIPELINE_SET_FEATURE_PATHS", paths: artifact.featurePaths ?? {} });
            dispatch({ type: "PIPELINE_SET_FEATURE_PROFILES", profiles: artifact.featureProfiles ?? [] });
            dispatch({ type: "PIPELINE_SET_FEATURE_EVIDENCE", evidence: artifact.featureEvidence ?? {} });
            dispatch({ type: "PIPELINE_SET_FEATURE_ARTIFACT_META", provenance: artifact.provenance ?? [], designSources: artifact.designSources ?? [] });
          }
          showToast("已加载本轮版本");
        } else {
          showToast("暂无已保存的功能点数据");
        }
      } catch (e: any) {
        showToast("加载失败: " + e.message);
      }
    },
    loadFeatureTemplate: () => {
      // ⚠️ 该按钮是"金标准格式演示样例"：不会伪造虚假测试点，也绝对不会冒充真实业务数据。
      //   仅展示"按 docs 规范 (系统_主_子_NN) 生成九列 + 合并"的长啥样，便于你肉眼对照金标准 Excel。
      //   若要生成"你截图左侧真实模块树（如 ruoyi 首页/AI对话/系统管理…）"的功能点，
      //   请点击右侧蓝色「生成功能点」按钮 —— 那才是调用真实 pipeline feature stage，
      //   以左侧 moduleTree（真实 login→explore 跑出来的节点）为输入，经过后端 buildFeatureTable。
      const sysName = (state.system.name?.trim() || '金标准示例').replace(/\s*[(（\[][^)）\]]{0,80}[)）\]]\s*/g, ' ').trim();
      // 真实转换器，真实模块树生成；样例名字取自 docs 已知词条（检查室(JCX)/医师站(YSZ)/影像报告(YXBG)），
      // —— 不是"冒充真实业务数据"，仅演示：缩写冻结字典如何映射到 4 段 ID。
      const demoTree: ModuleNodeView[] = [
        { id: 'demo-pei', type: 'module', name: '配置', status: '已覆盖', manuallyAdded: true, children: [
          { id: 'demo-jcs', type: 'page', name: '检查室', status: '已覆盖', manuallyAdded: true, children: [
            { id: 'a1', type: 'action', name: '查询', status: '已覆盖', manuallyAdded: true, children: [] },
            { id: 'a2', type: 'action', name: '新增', status: '已覆盖', manuallyAdded: true, children: [] },
            { id: 'a3', type: 'action', name: '修改', status: '已覆盖', manuallyAdded: true, children: [] },
          ]},
          { id: 'demo-ysz', type: 'page', name: '医师站', status: '已覆盖', manuallyAdded: true, children: [
            { id: 'a4', type: 'action', name: '查询', status: '已覆盖', manuallyAdded: true, children: [] },
            { id: 'a5', type: 'action', name: '新增', status: '已覆盖', manuallyAdded: true, children: [] },
            { id: 'a6', type: 'action', name: '删除', status: '已覆盖', manuallyAdded: true, children: [] },
          ]},
        ]},
        { id: 'demo-bg', type: 'module', name: '报告', status: '已覆盖', manuallyAdded: true, children: [
          { id: 'demo-yxbg', type: 'page', name: '影像报告', status: '已覆盖', manuallyAdded: true, children: [
            { id: 'a7', type: 'action', name: '查询', status: '已覆盖', manuallyAdded: true, children: [] },
            { id: 'a8', type: 'action', name: '导出', status: '已覆盖', manuallyAdded: true, children: [] },
            { id: 'a9', type: 'action', name: '超大报告导出', status: 'needs_review', manuallyAdded: true, children: [] },
          ]},
        ]},
      ];
      const rows = moduleTreeToFeatureTable(demoTree, sysName).map((r, i) =>
        i === 8 ? { ...r, type: '边界测试' } : r,
      );
      let main = ''; let chapterMain = 0;
      for (const r of rows) {
        if (r.mainModule !== main) { main = r.mainModule; chapterMain += 1; }
        r.chapter = `${chapterMain}.1`;
      }
      dispatch({ type: "PIPELINE_UPDATE_FEATURE", rows });
      showToast("已载入金标准格式演示样例（非业务数据）；真实业务数据请点击「生成功能点」");
    },

    // Case
    caseAddRow: (afterIndex?: number) => dispatch({ type: "CASE_ADD_ROW", afterIndex }),
    caseUpdateRow: (index: number, patch: Partial<CaseRowView>) => dispatch({ type: "CASE_UPDATE_ROW", index, patch }),
    caseRemoveRow: (index: number) => dispatch({ type: "CASE_REMOVE_ROW", index }),
    caseUpdateMeta: async (patch: Partial<MetaHeader>) => {
      dispatch({ type: "CASE_UPDATE_META", patch });
      if (state.project.id && state.system.id) {
        try {
          const curMeta = { ...state.metaHeader, ...patch };
          await dataApi.saveMetaConfig(state.project.id, state.system.id, curMeta as unknown as Record<string, any>);
        } catch {
          // Meta is still held in memory when persistence is unavailable.
        }
      }
    },
    caseSetSelection: (modules: string[]) => dispatch({ type: "CASE_SET_SELECTION", modules }),
    caseToggleAi: (on: boolean) => dispatch({ type: "CASE_TOGGLE_AI", on }),
    exploreToggleAi: (on: boolean) => dispatch({ type: "EXPLORE_TOGGLE_AI", on }),
    setReadOnlyClickPolicy: (policy: "strict" | "allow_all") => dispatch({ type: "SET_READONLY_CLICK_POLICY", policy }),
    caseRegenerate: () => dispatch({ type: "CASE_REGENERATE" }),
    caseGroupAdd: (group?: Partial<CaseGroupView>) => dispatch({ type: "CASE_GROUP_ADD", group }),
    caseGroupRemove: (groupId: string) => dispatch({ type: "CASE_GROUP_REMOVE", groupId }),
    caseGroupUpdate: (groupId: string, patch: Partial<CaseGroupView>) => dispatch({ type: "CASE_GROUP_UPDATE", groupId, patch }),
    caseStepAdd: (groupId: string, afterStepId?: string) => dispatch({ type: "CASE_STEP_ADD", groupId, afterStepId }),
    caseStepRemove: (groupId: string, stepId: string) => dispatch({ type: "CASE_STEP_REMOVE", groupId, stepId }),
    caseStepUpdate: (groupId: string, stepId: string, patch: Partial<CaseStepView>) => dispatch({ type: "CASE_STEP_UPDATE", groupId, stepId, patch }),

    // Execute
    execToggleModule: (name: string) => dispatch({ type: "EXEC_TOGGLE_MODULE", name }),
    execToggleAll: (checked: boolean) => dispatch({ type: "EXEC_TOGGLE_ALL", checked }),
    execRun: (target: "selected" | "all") => dispatch({ type: "EXEC_RUN", target }),
    execSetCell: (caseNo: string, browser: string, status: ExecMatrixCell["status"]) => dispatch({ type: "EXEC_SET_CELL", caseNo, browser, status }),
    execVerifyIsolation: () => dispatch({ type: "EXEC_VERIFY_ISOLATION" }),

    // Defect
    defectAdd: (defect: DefectRowView) => dispatch({ type: "DEFECT_ADD", defect }),
    defectUpdate: (seq: number, patch: Partial<DefectRowView>) => dispatch({ type: "DEFECT_UPDATE", seq, patch }),
    defectRemove: (seq: number) => dispatch({ type: "DEFECT_REMOVE", seq }),
    defectSetFilter: (filter: string) => dispatch({ type: "DEFECT_SET_FILTER", filter }),

    // Explore
    exploreSetSelected: (id: string | null) => dispatch({ type: "EXPLORE_SET_SELECTED", id }),
    exploreToggleChecked: (id: string) => dispatch({ type: "EXPLORE_TOGGLE_CHECKED", id }),
    exploreAddModule: (parentId: string | null, module: ModuleNodeView) => dispatch({ type: "EXPLORE_ADD_MODULE", parentId, module }),
    exploreUpdateModule: (id: string, patch: Partial<ModuleNodeView>) => dispatch({ type: "EXPLORE_UPDATE_MODULE", id, patch }),
    exploreRemoveModule: (id: string) => dispatch({ type: "EXPLORE_REMOVE_MODULE", id }),
    exploreRemoveModulesBatch: (ids: string[]) => dispatch({ type: "EXPLORE_REMOVE_MODULES_BATCH", ids }),
    exploreSelectAll: () => dispatch({ type: "EXPLORE_SELECT_ALL" }),
    exploreInvertSelection: () => dispatch({ type: "EXPLORE_INVERT_SELECTION" }),
    exploreMoveNode: (sourceId: string, targetId: string, position: "before" | "after" | "child") => dispatch({ type: "EXPLORE_MOVE_NODE", sourceId, targetId, position }),
    exploreAddPending: (item: PendingTreeItem) => dispatch({ type: "EXPLORE_ADD_PENDING", item }),
    exploreRemovePending: (seq: number) => dispatch({ type: "EXPLORE_REMOVE_PENDING", seq }),
    exploreUpdatePending: (seq: number, patch: Partial<PendingTreeItem>) => dispatch({ type: "EXPLORE_UPDATE_PENDING", seq, patch }),
    explorePromoteToTree: (seq: number) => dispatch({ type: "EXPLORE_PROMOTE_TO_TREE", seq }),
    explorePromoteAll: () => dispatch({ type: "EXPLORE_PROMOTE_ALL" }),
    updateModuleTree: (nodes: ModuleNodeView[]) => dispatch({ type: "PIPELINE_UPDATE_MODULE_TREE", nodes }),
    /** 用结构化模块树转换得到的九列功能表整体替换当前功能点（人工补录闭环：树 → 功能表） */
    updateFeatureTable: (rows: FeatureRowView[]) => dispatch({ type: "PIPELINE_UPDATE_FEATURE", rows }),

    // AI Config
    aiListVendors: async () => {
      try {
        return await dataApi.listVendorsApi();
      } catch {
        return [];
      }
    },
    aiGetVendorModels: async (vendor: string) => {
      try {
        return await dataApi.getVendorModels(vendor);
      } catch {
        return { models: [] as string[], baseUrl: '' };
      }
    },
    aiFetchRemoteModels: async (baseUrl: string, apiKey: string) => {
      try {
        return await dataApi.fetchRemoteModelsApi(baseUrl, apiKey);
      } catch {
        return { success: false, models: [] as string[], message: '获取失败' };
      }
    },
    aiTestConnection: async (config: { baseUrl: string; model: string; configId?: string; apiKey?: string; apiKeyRef?: string }) => {
      try {
        return await dataApi.testAIConnection(config);
      } catch (e: any) {
        return { success: false, status: 0, message: e.message, latencyMs: 0 };
      }
    },
    aiAdd: async (config: Omit<AiConfigView, 'id' | 'createdAt' | 'updatedAt'> & { apiKey?: string }) => {
      try {
        const created = await dataApi.createAIConfig(config);
        dispatch({ type: "AI_ADD", config: created });
        showToast(`AI 配置 "${config.name}" 已创建`);
        return created;
      } catch (e: any) {
        showToast(`创建失败: ${e.message}`);
        return null;
      }
    },
    aiUpdate: async (id: string, patch: Partial<AiConfigView> & { apiKey?: string }) => {
      try {
        const updated = await dataApi.updateAIConfig(id, patch);
        dispatch({ type: "AI_UPDATE", id, patch: updated });
        showToast("AI 配置已更新");
        return updated;
      } catch (e: any) {
        showToast(`更新失败: ${e.message}`);
        return null;
      }
    },
    aiRemove: async (id: string) => {
      try {
        await dataApi.deleteAIConfig(id);
        dispatch({ type: "AI_REMOVE", id });
        showToast("AI 配置已删除");
      } catch (e: any) {
        showToast(`删除失败: ${e.message}`);
      }
    },
    aiToggleEnabled: async (id: string) => {
      const config = state.aiConfigs.find((c) => c.id === id);
      if (!config) return;
      try {
        const updated = await dataApi.toggleAIConfig(id, !config.enabled);
        dispatch({ type: "AI_UPDATE", id, patch: updated });
      } catch (e: any) {
        showToast(`操作失败: ${e.message}`);
      }
    },
    aiSetDefault: async (id: string) => {
      try {
        await dataApi.setDefaultAIConfig(id);
        dispatch({ type: "AI_SET_DEFAULT", id });
        showToast("已设为默认");
      } catch (e: any) {
        showToast(`设置失败: ${e.message}`);
      }
    },

    // Log
    logUpdatePolicy: async (patch: Partial<LogPolicy>) => {
      const newPolicy = { ...state.logPolicy, ...patch };
      dispatch({ type: "LOG_UPDATE_POLICY", patch });
      try {
        await dataApi.updateLogPolicy(newPolicy);
      } catch {
        // Local settings remain usable when the backend is unavailable.
      }
      showToast("策略已保存");
    },
    logCleanupExpired: async () => {
      try {
        const deleted = await dataApi.cleanupExpiredLogs();
        const files = await dataApi.listLogs();
        dispatch({ type: "LOG_LIST_FILES", files });
        showToast(`已清理 ${deleted} 个过期日志`);
        return deleted;
      } catch (e: any) {
        showToast("清理失败: " + e.message);
        return 0;
      }
    },
    logClearAll: async () => {
      try {
        await dataApi.clearAllLogs();
        dispatch({ type: "LOG_CLEAR_ALL" });
        showToast("已清空全部日志");
      } catch (e: any) {
        showToast("清空失败: " + e.message);
      }
    },
    logRemoveFile: async (filename: string) => {
      try {
        await dataApi.deleteLogFile(filename);
        dispatch({ type: "LOG_REMOVE_FILE", filename });
        showToast(`已删除 ${filename}`);
      } catch (e: any) {
        showToast("删除失败: " + e.message);
      }
    },
    logListFiles: async () => {
      try {
        const files = await dataApi.listLogs();
        dispatch({ type: "LOG_LIST_FILES", files });
        return files;
      } catch {
        return [];
      }
    },
    logGetDir: async () => {
      try {
        return await dataApi.getLogDir();
      } catch {
        return "";
      }
    },

    // Knowledge
    knowledgeUpdate: (id: string, content: string) => dispatch({ type: "KNOWLEDGE_UPDATE", id, content }),

    // Activity
    addActivity: (item: ActivityItem) => dispatch({ type: "ADD_ACTIVITY", item }),
  };
}
