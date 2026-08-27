/**
 * @file index.ts
 * @description 系统级编排器（Pipeline Orchestrator）
 * 职责：
 *   1. 初始化基础设施（Logger, Store）
 *   2. 统一管理浏览器引擎实例（Engine Factory）
 *   3. 按顺序调度所有 Stage 模块
 *   4. 处理跨 Stage 的数据流转（Output -> Input Mapping）
 *   5. 维护全局会话状态（SessionHandle）
 *
 * 数据流：
 *   LoginOutput.sessionHandle -> ExploreInput.sessionHandle
 *   ExploreOutput.moduleTree  -> FeatureInput.moduleTree
 *   FeatureOutput.featureTable-> CaseInput.featureTable
 *   CaseOutput.caseWorkbook   -> ExecuteInput.caseWorkbook
 *   ExecuteOutput.executionReport -> DefectInput.executionReport
 */

import { createLogger, type Logger, type LoggerConfig, type LogFileInfo } from '@test-platform/infra-logger';
import { createStore, type ProjectStore } from '@test-platform/infra-store';
import type { McpEngine, EngineConfig, PlaywrightStorageState, SemanticNode } from '@test-platform/engine-mcp';
import { createEngine } from '@test-platform/engine-mcp';

import type {
  LoginInput,
  LoginOutput,
  ExploreInput,
  ExploreOutput,
  FeatureInput,
  FeatureOutput,
  CaseInput,
  CaseOutput,
  CaseSheet,
  CaseGenerationContext,
  ExecuteInput,
  ExecuteOutput,
  DefectInput,
  DefectOutput,
  Project,
  SessionHandle,
  BrowserOS,
  ExploredElement,
  FeatureEvidence,
  FeatureProfile,
  FeatureRow,
  FeatureArtifactV2,
  System,
} from '@test-platform/contracts';
import { DEFAULT_FEATURE_COLUMNS } from '@test-platform/contracts';

import { createLoginStage } from '@test-platform/stage-login';
import { getTakeoverEngine, detectLoginState, extractDomWithRetry } from '@test-platform/stage-login';
import * as stageExplore from '@test-platform/stage-explore';
import * as stageFeature from '@test-platform/stage-feature';
import * as stageCase from '@test-platform/stage-case';
import * as stageExecute from '@test-platform/stage-execute';
import * as stageDefect from '@test-platform/stage-defect';
import { createAIClient, getDefault, getProvider, type AIClient, type AIVendor, type AIProviderConfig } from '@test-platform/infra-ai';
import { exploreFeatureEvidence, exploreFeatureEvidenceMap, isSafeNavigationUrl } from './featureEvidenceExplorer.js';

function mergeFeatureRows(existing: FeatureRow[][], incoming: FeatureRow[][], retainExistingIds: Set<string> = new Set()): FeatureRow[][] {
  const id = (row: FeatureRow): string => row[DEFAULT_FEATURE_COLUMNS.testPointId] ?? '';
  const replacements = new Map(incoming.flat().filter((row) => id(row) && !retainExistingIds.has(id(row))).map((row) => [id(row), row]));
  const existingIds = new Set(existing.flat().map(id));
  const merged = existing.map((group) => group.map((row) => replacements.get(id(row)) ?? row));
  const additions = incoming.flat().filter((row) => !existingIds.has(id(row)));
  if (additions.length) merged.push(additions);
  return merged;
}

function mergeByFeatureId<T extends { featureId: string }>(existing: T[] | undefined, incoming: T[] | undefined, retainExistingIds: Set<string> = new Set()): T[] | undefined {
  if (!existing?.length && !incoming?.length) return undefined;
  return [...new Map([...(existing ?? []), ...(incoming ?? []).filter((item) => !retainExistingIds.has(item.featureId))].map((item) => [item.featureId, item])).values()];
}

function mergeFeatureEvidence(
  existing: Record<string, FeatureEvidence> | undefined,
  incoming: Record<string, FeatureEvidence> | undefined,
  _existingProfiles?: FeatureProfile[],
  _incomingProfiles?: FeatureProfile[],
): Record<string, FeatureEvidence> {
  const merged = { ...(existing ?? {}) };
  for (const [featureId, evidence] of Object.entries(incoming ?? {})) {
    merged[featureId] = evidence;
  }
  return merged;
}

function mergeFeatureArtifact(existing: FeatureArtifactV2 | undefined, incoming: Pick<FeatureArtifactV2, 'table' | 'featurePaths' | 'featureProfiles' | 'featureEvidence' | 'provenance' | 'designSources'>): FeatureArtifactV2 {
  // Current confirmed input wins for matching feature IDs. Historical metadata
  // is only retained for IDs omitted by this input, never used to override it.
  const retainExistingIds = new Set<string>();
  const incomingPaths = incoming.featurePaths ?? {};
  return {
    version: 2,
    table: existing ? mergeFeatureRows(existing.table, incoming.table, retainExistingIds) : incoming.table,
    featurePaths: { ...(existing?.featurePaths ?? {}), ...incomingPaths },
    featureProfiles: mergeByFeatureId(existing?.featureProfiles, incoming.featureProfiles, retainExistingIds),
    featureEvidence: mergeFeatureEvidence(existing?.featureEvidence, incoming.featureEvidence, existing?.featureProfiles, incoming.featureProfiles),
    // Provenance only has row indexes, so retain prior records and let newer rows append rather than discarding API/HIS provenance.
    provenance: [...(existing?.provenance ?? []), ...(incoming.provenance ?? [])],
    designSources: [...new Set([...(existing?.designSources ?? []), ...(incoming.designSources ?? [])])],
  };
}

/**
 * Case generation consumes the confirmed feature table submitted by the caller.
 * Existing artifacts may contribute evidence/profile metadata for matching IDs,
 * but they must never add rows back into the case input.
 */
function alignArtifactToFeatureTable(artifact: FeatureArtifactV2, featureTable: FeatureRow[][]): FeatureArtifactV2 {
  const ids = new Set(featureTable.flat().map((row) => row[DEFAULT_FEATURE_COLUMNS.testPointId] ?? '').filter(Boolean));
  return {
    ...artifact,
    table: featureTable,
    featurePaths: Object.fromEntries(Object.entries(artifact.featurePaths ?? {}).filter(([id]) => ids.has(id))),
    featureProfiles: artifact.featureProfiles?.filter((profile) => ids.has(profile.featureId)),
    featureEvidence: Object.fromEntries(Object.entries(artifact.featureEvidence ?? {}).filter(([id]) => ids.has(id))),
  };
}

function collectMissingFeatureIds(
  featureTable: FeatureRow[][],
  scope: 'all' | 'selected_modules',
  selectedModuleIds: string[] | undefined,
  featurePaths: Record<string, string> | undefined,
  featureProfiles: FeatureProfile[] | undefined,
  featureEvidence: Record<string, FeatureEvidence> | undefined,
  systemId?: string,
  featureRevision?: string,
): Set<string> {
  const profileById = new Map((featureProfiles ?? []).map((profile) => [profile.featureId, profile]));
  const selected = new Set(selectedModuleIds ?? []);
  const missing = new Set<string>();
  for (const row of featureTable.flat()) {
    const featureId = row[DEFAULT_FEATURE_COLUMNS.testPointId] ?? '';
    if (!featureId) continue;
    if (scope === 'selected_modules' && selected.size > 0) {
      const inSelectedModule = selected.has(row[DEFAULT_FEATURE_COLUMNS.mainModule] ?? '')
        || selected.has(row[DEFAULT_FEATURE_COLUMNS.subModule] ?? '');
      if (!inSelectedModule) continue;
    }
    const gate = stageCase.gateFeatureEvidence(
      featureId,
      profileById.get(featureId),
      featureEvidence?.[featureId],
      featurePaths?.[featureId],
      { systemId, featureRevision },
    );
    if (!gate.hasEvidence || !gate.consistent) missing.add(featureId);
  }
  return missing;
}

function hasConcreteFeatureEvidence(evidence: FeatureEvidence): boolean {
  return (evidence.fields?.length ?? 0) > 0
    || (evidence.actionEntries?.length ?? 0) > 0
    || (evidence.tables?.length ?? 0) > 0
    || !!evidence.structuredDesign;
}

function retainConcreteEvidence(evidence: Record<string, FeatureEvidence>): Record<string, FeatureEvidence> {
  // Keep explicit review evidence even when no readable fields were found. It
  // must reach the case stage so the feature is reported as needs_review with
  // the concrete unsupported-surface reason, rather than being flattened into
  // an unexplained evidence_missing result.
  return Object.fromEntries(Object.entries(evidence).filter(([, value]) =>
    hasConcreteFeatureEvidence(value) || (value.needsReview === true && !!value.reviewReason),
  ));
}

/** 登录页 URL 判定（token 级匹配，避免误伤 /authority/ 等含 auth 的业务路径） */
function isLoginPageUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const segs = ((url.pathname || '') + '#' + (url.hash || '')).split(/[/#?&._-]+/);
    return segs.some((s) => ['login', 'signin', 'sso', 'logon'].includes(s.toLowerCase()));
  } catch {
    return false;
  }
}

function isUsableAIProvider(config: AIProviderConfig | undefined): config is AIProviderConfig {
  return Boolean(
    config?.enabled
      && config.baseUrl?.trim()
      && config.apiKeyRef?.trim()
      && config.model?.trim(),
  );
}

/** 编排器配置 */
export interface OrchestratorConfig {
  loggerConfig?: LoggerConfig;
  engineConfig?: EngineConfig;
  /** 复用已有 Logger/Store/Engine（用于依赖注入或测试） */
  logger?: Logger;
  store?: ProjectStore;
  engineFactory?: (config: EngineConfig) => McpEngine;
}

/** 流水线总输出 */
export interface PipelineResult {
  project: Project | null;
  login: LoginOutput;
  explore: ExploreOutput;
  feature: FeatureOutput;
  case: CaseOutput;
  execute: ExecuteOutput;
  defect: DefectOutput;
  /** 会话句柄（供后续步骤复用） */
  session: SessionHandle;
}

/** 流水线各阶段输入（除 login 外的前置数据由编排器自动串联） */
export interface PipelineInput {
  /** 登录输入 */
  login: LoginInput;
  /** 探索输入（可选；缺省由编排器根据 login.output.sessionHandle 生成） */
  explore?: Partial<Omit<ExploreInput, 'sessionHandle'>> & {
    /** AI 兜底配置（受应用层 AI 开关门控；enabled=false 或不传则不启用 AI） */
    aiConfig?: { enabled?: boolean; baseUrl?: string; apiKeyRef?: string; model?: string; temperature?: number; maxTokens?: number };
  };
  /** 功能点输入（可选；缺省由编排器根据 explore.output.moduleTree 生成） */
  feature?: Partial<Omit<FeatureInput, 'moduleTree' | 'systemName'>> & { systemName?: string };
  /** 用例输入（可选；缺省由编排器根据 feature.output.featureTable 生成） */
  case?: Partial<Omit<CaseInput, 'featureTable'>>;
  /** 执行输入（可选；缺省由编排器根据 case.output.caseWorkbook 生成） */
  execute?: Partial<Omit<ExecuteInput, 'caseWorkbook'>> & { browserOSMatrix?: BrowserOS[] };
  /** 缺陷输入（可选；缺省由编排器根据 execute.output.executionReport 生成） */
  defect?: Partial<Omit<DefectInput, 'executionReport'>>;
}

/** 编排器 */
export class PipelineOrchestrator {
  private logger: Logger;
  private store: ProjectStore;
  private engineFactory: (config: EngineConfig) => McpEngine;
  private engineConfig: EngineConfig;
  /** 当前会话的 Storage State（用于跨 engine 实例复用） */
  private currentStorageState?: PlaywrightStorageState;

  constructor(config: OrchestratorConfig = {}) {
    this.logger = config.logger ?? createLogger(config.loggerConfig ?? { dir: './logs', retentionDays: 30 });
    this.store = config.store ?? createStore();
    this.engineConfig = config.engineConfig ?? { headless: true };
    this.engineFactory = config.engineFactory ?? ((cfg) => createEngine(cfg));
  }

  /** 探索 AI 配置（与 case 阶段同级；受应用层 AI 开关门控） */
  private buildExploreAi(
    aiConfig?: { enabled?: boolean; baseUrl?: string; apiKeyRef?: string; model?: string; temperature?: number; maxTokens?: number },
  ): AIClient | undefined {
    if (!aiConfig || aiConfig.enabled === false) return undefined;
    if (!aiConfig.baseUrl || !aiConfig.apiKeyRef || !aiConfig.model) return undefined;
    try {
      return createAIClient({
        id: 'explore-ai',
        name: 'explore-ai',
        vendor: 'custom' as AIVendor,
        baseUrl: aiConfig.baseUrl,
        apiKeyRef: aiConfig.apiKeyRef,
        model: aiConfig.model,
        enabled: true,
        temperature: aiConfig.temperature,
        maxTokens: aiConfig.maxTokens,
      });
    } catch {
      return undefined;
    }
  }

  private async persistCaseProduct(systemId: string, sheets: CaseSheet[], generation: CaseGenerationContext): Promise<void> {
    const atomicStore = this.store as ProjectStore & {
      saveCaseProduct?: (id: string, workbook: CaseSheet[], batch: CaseGenerationContext) => Promise<void>;
    };
    if (atomicStore.saveCaseProduct) {
      await atomicStore.saveCaseProduct(systemId, sheets, generation);
      return;
    }
    // Compatibility for injected stores created before the atomic API existed.
    await this.store.saveCaseTable(systemId, sheets);
    await this.store.saveCaseGeneration(systemId, generation);
  }

  /**
   * T4：按 featureId 隔离的页面证据采集（替代旧 exploreByFeaturePaths 的全局合并）。
   * 委托给 featureEvidenceExplorer.exploreFeatureEvidenceMap，保持编排器方法层薄、可单测。
   * - 逐功能点独立抽取 → Record<featureId, FeatureEvidence>（隔离，杜绝跨功能点串用）；
   * - 保留 click: SPA 定位符路径；外链跳过；任一功能点失败仅告警跳过。
   */
  private async exploreFeatureEvidenceMap(
    engine: McpEngine,
    featurePaths: Record<string, string> | undefined,
    featureTable: FeatureRow[][],
    featureProfiles: FeatureProfile[] | undefined,
    selectedModuleIds: string[] | undefined,
    scope: 'all' | 'selected_modules',
    baseUrl?: string,
    featureIds?: Set<string>,
    systemId?: string,
    featureRevision?: string,
    extra?: { crossPathNavigation?: 'entry_only' | 'allow' },
  ): Promise<{ evidence: Record<string, FeatureEvidence>; elements: ExploredElement[] }> {
    const isWebProfile = (profile: FeatureProfile): boolean => (
      (!profile.source || profile.source === 'web')
      && !(!profile.source && profile.sourceSelector?.startsWith('design:'))
    );
    const profilesById = new Map((featureProfiles ?? []).map((profile) => [profile.featureId, profile]));
    const webProfiles = (featureProfiles ?? []).filter(isWebProfile);
    const webTable = featureTable.map((rows) => rows.filter((row) => {
      const profile = profilesById.get(row[DEFAULT_FEATURE_COLUMNS.testPointId] ?? '');
      return !profile || isWebProfile(profile);
    }));
    const webPaths = featurePaths && Object.fromEntries(
      Object.entries(featurePaths).filter(([featureId]) => {
        const profile = profilesById.get(featureId);
        return !profile || isWebProfile(profile);
      }),
    );
    // 委托给独立函数（featureEvidenceExplorer 模块），私有方法仅做薄适配
    return exploreFeatureEvidenceMap(engine, {
      featurePaths: webPaths,
      featureTable: webTable,
      featureProfiles: webProfiles,
      selectedModuleIds,
      scope,
      baseUrl,
      logger: this.logger,
      featureIds,
      systemId,
      featureRevision,
      ...(extra?.crossPathNavigation ? { crossPathNavigation: extra.crossPathNavigation } : {}),
    });
  }

  /** 创建项目（可选，用于绑定本次流水线） */
  async createProject(input: { name: string; description?: string; type?: 'standalone' | 'portal' | 'subsystem' }): Promise<Project> {
    const project = await this.store.createProject(input);
    this.logger.info('orchestrator', `project created: ${project.id}`);
    return project;
  }

  /**
   * 按功能点/测试点名称在系统页面找对应功能入口（菜单/按钮/链接）并点击抓取元素。
   * 兜底场景：探索阶段菜单识别失败、featurePaths 为空/无效时使用——用户明确要求
   * "如果没有找到 url 按照功能点名称取找对应功能"。绝不静默模板直出。
   * - 名称取功能点表「功能点」「测试点」两列（去重、去危险词、按长度降序优先精确）；
   * - 在当前页 DOM 中找文本匹配的可交互元素（a/button/role），点击进入后抓当前页元素；
   * - 任一失败仅告警跳过，不中断整体；危险操作文本（退出/注销/删除等）硬性跳过。
   */
  private async exploreByFeatureNames(
    engine: McpEngine,
    featureTable: FeatureRow[][],
    baseUrl?: string,
    featureIds?: Set<string>,
    featureProfiles?: FeatureProfile[],
    systemId?: string,
    featureRevision?: string,
  ): Promise<{ elements: ExploredElement[]; evidence: Record<string, FeatureEvidence> }> {
    const FC = DEFAULT_FEATURE_COLUMNS;
    const DANGEROUS = /退出|注销|登出|logout|sign\s?out|清空|重置|修改密码|解绑|删除/i;
    const profilesById = new Map((featureProfiles ?? []).map((profile) => [profile.featureId, profile]));
    const targets: Array<{ featureId: string; name: string; actionKind?: FeatureProfile['actionKind'] }> = [];
    const seenTargets = new Set<string>();
    for (const r of featureTable.flat()) {
      const featureId = r[FC.testPointId] ?? '';
      if (featureIds && !featureIds.has(featureId)) continue;
      if (!featureId) continue;
      for (const col of [FC.featureName, FC.testPoint]) {
        const t = (r[col] ?? '').trim();
        const targetKey = `${featureId}\u0000${t}`;
        if (!t || t.length < 2 || t.length > 40 || DANGEROUS.test(t) || seenTargets.has(targetKey)) continue;
        seenTargets.add(targetKey);
        targets.push({ featureId, name: t, actionKind: profilesById.get(featureId)?.actionKind });
      }
    }
    if (targets.length === 0) return { elements: [], evidence: {} };

    // 每个功能点单独定位、点击和采证，禁止把名称兜底结果合并成公共证据。
    const targetsByFeature = new Map<string, typeof targets>();
    for (const target of targets) {
      const list = targetsByFeature.get(target.featureId) ?? [];
      list.push(target);
      targetsByFeature.set(target.featureId, list);
    }
    const all: ExploredElement[] = [];
    const evidence: Record<string, FeatureEvidence> = {};

    // 子模块名索引：供「先进入子模块页再找页面内按钮」的二级定位（从入口按路径进入，不直接打开 URL）
    const subModuleNameById = new Map<string, string>();
    for (const r of featureTable.flat()) {
      const id = r[FC.testPointId] ?? '';
      const sub = (r[FC.subModule] ?? '').trim();
      if (id && sub) subModuleNameById.set(id, sub);
    }
    // 从功能名/测试点提取核心名词（如「新增用户」→「用户」、「查询角色列表」→「角色」），
    // 供多级菜单进入：父菜单展开后按名词点击匹配的子页面菜单（RuoYi 等「父菜单→子页面→按钮」层级）。
    const extractNoun = (text: string): string | undefined => {
      const cleaned = (text || '')
        .replace(/查询|新增|添加|创建|新建|修改|编辑|删除|批量|导出|导入|重置|刷新|查看|详情|分配|生成|下载|复制|同步|清理|清空|获取|列表|记录|保存|提交|立即执行|预览|监控/gi, '')
        .replace(/[()（）\[\]\s]/g, '');
      if (cleaned.length < 2) return undefined;
      // 优先 2 字核心词，避免过长串匹配不到子菜单
      return cleaned.slice(0, 2);
    };
    const findTargetInDom = (dom: SemanticNode[], query: string): SemanticNode | undefined => {
      let found: SemanticNode | undefined;
      const walk = (nodes: SemanticNode[]): void => {
        for (const n of nodes) {
          if (found) return;
          const text = (n.text || n.name || '').trim();
          const tag = n.tag.toLowerCase();
          const safeNativeLink = tag === 'a' && !!n.href && isSafeNavigationUrl(n.href);
          const safeDialogOpener = ['a', 'button'].includes(tag) && (n.ariaHasPopup === 'dialog' || n.safeReadOnlyOpener === true);
          if (n.interactive && !n.isDataControl && text && !DANGEROUS.test(text) && (safeNativeLink || safeDialogOpener)) {
            if (text === query || text.includes(query) || query.includes(text)) {
              found = n;
              return;
            }
          }
          if (n.children.length > 0) walk(n.children);
        }
      };
      walk(dom);
      return found;
    };
    // 在浏览器内给「文本最匹配的可点击元素」打唯一标记后精确点击：
    // 解决真实系统（RuoYi 等）语义 selector 匹配多个 DOM 节点导致的「selector 精确匹配」blocked。
    // 参考 D:\Test：用 XPath contains(text()) 定位可见可交互元素 + el.click() 直接点击（安全动作），
    // 不依赖语义 selector 的精确匹配，解决真实系统（RuoYi 等）「selector 精确匹配一个 DOM 节点」blocked。
    // 危险写操作文本（提交/保存/删除/导入/导出/发布/审核/重置等）一律不点击（只读红线）。
    const markAndClick = async (query: string): Promise<{ performed: boolean; reason?: string }> => {
      if (typeof engine.evaluate !== 'function') {
        return { performed: false, reason: '引擎缺少 evaluate 能力' };
      }
      try {
        const result = await engine.evaluate<{ clicked: boolean; reason?: string; tag?: string }>(`(args) => {
          const { name } = args;
          const norm = (v) => (v || '').replace(/\\s+/g, ' ').trim();
          const DANGEROUS = /提交|保存|删除|移除|导入|导出|发布|审核|重置|清空|注销|退出|approve|reject|submit|save|delete|remove|import|export|publish|reset/i;
          const queryName = norm(name);
          if (!queryName) return { clicked: false, reason: '空文本' };
          if (DANGEROUS.test(queryName)) return { clicked: false, reason: '危险动作文本，只读探索不点击: ' + queryName.slice(0, 20) };
          const iter = document.evaluate("//*[contains(text(), '" + queryName + "')]", document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          let best = null;
          let bestScore = 0;
          for (let i = 0; i < iter.snapshotLength; i++) {
            const el = iter.snapshotItem(i);
            if (!el || el.offsetParent === null) continue;
            const t = norm(el.textContent);
            if (!t || t.length < 1 || t.length > 60) continue;
            const tag = (el.tagName || '').toLowerCase();
            // 只选最可能是真实可点击入口的标签，避免误点容器/文本节点
            if (!['a', 'button', 'li'].includes(tag)) continue;
            let sc = 0;
            // 外链（a[href] 指向非当前域名）不点击：避免 el.click() 打开新标签导致浏览器上下文混乱
            if (tag === 'a' && el.getAttribute && el.getAttribute('href')) {
              try {
                const target = new URL(el.getAttribute('href'), location.href);
                if (target.origin !== location.origin) continue;
              } catch { continue; }
            }
            if (t === queryName) sc = 3;
            else if (t.includes(queryName)) sc = 2;
            else if (queryName.includes(t) && t.length >= 2) sc = 1;
            if (sc === 0) continue;
            const nestedInteractive = el.querySelectorAll('a, button').length;
            if (sc > bestScore || (sc === bestScore && best && nestedInteractive < (best.querySelectorAll('a, button').length || 0))) {
              best = el;
              bestScore = sc;
            }
          }
          if (!best) return { clicked: false, reason: '未找到匹配的可点击元素' };
          best.click();
          return { clicked: true, tag: best.tagName };
        }`, { name: query });
        return { performed: result?.clicked === true, reason: result?.reason ?? 'clicked' };
      } catch (e) {
        return { performed: false, reason: e instanceof Error ? e.message : String(e) };
      }
    };
    const clickNodeByName = async (query: string): Promise<boolean> => (await markAndClick(query)).performed;

    for (const [featureId, featureTargets] of targetsByFeature) {
      const sorted = featureTargets.slice().sort((a, b) => b.name.length - a.name.length);
      const subModuleName = subModuleNameById.get(featureId);
      // 只在离开入口时回入口一次；同文档（SPA hash 路由）不 reload，避免首页无限刷新
      try {
        if (baseUrl && isSafeNavigationUrl(baseUrl)) {
          const cur = await engine.getCurrentUrl().catch(() => '');
          let sameDoc = false;
          if (cur) {
            try {
              const a = new URL(cur);
              const b = new URL(baseUrl);
              sameDoc = a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
            } catch { sameDoc = false; }
          }
          if (!sameDoc) {
            await engine.navigate(baseUrl);
            await engine.waitForTimeout(500);
          }
        }
      } catch { /* 忽略导航失败 */ }
      for (const targetInfo of sorted) {
        const name = targetInfo.name;
        try {
        let target = findTargetInDom(await engine.extractSemanticDom().catch(() => [] as SemanticNode[]), name);
        // 二级：入口页找不到功能名时，先按子模块名进入页面，再找页面内按钮（支持 RuoYi 等「页面内新增/查询」，
        // 从入口按路径进入而非直接打开目标 URL，避免落在登录页/首页）。
        if (!target && subModuleName) {
          const entered = await clickNodeByName(subModuleName);
          if (entered) {
            await engine.waitForTimeout(700);
            target = findTargetInDom(await engine.extractSemanticDom().catch(() => [] as SemanticNode[]), name);
            if (!target) {
              // 三级：父菜单展开后，按功能名核心名词点击匹配的子页面菜单，再找页面内按钮
              const noun = extractNoun(name);
              if (noun) {
                const subEntered = await clickNodeByName(noun);
                if (subEntered) {
                  await engine.waitForTimeout(700);
                  target = findTargetInDom(await engine.extractSemanticDom().catch(() => [] as SemanticNode[]), name);
                }
              }
            }
          }
        }
        if (!target) continue;
        const matchedTarget = target;
        if (!engine.runReadOnlyClick) {
          this.logger.warn('orchestrator', `case: click-by-name skipped for "${name}"; engine lacks read-only click capability`);
          continue;
        }
        // 用浏览器内精确打标点击（解决真实系统 selector 匹配多个 DOM 节点被 blocked）；
        // 找不到精确目标时回退到语义 selector + has-text 重试。
        const mark = await markAndClick(name);
        let click: { status: string; reason?: string } = mark.performed
          ? { status: 'performed' }
          : { status: 'blocked', reason: mark.reason ?? 'markAndClick 未命中' };
        if (click.status !== 'performed' && matchedTarget.tag && name) {
          const escapeText = (t: string): string => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const sel = await engine.runReadOnlyClick(matchedTarget.selector, 'action');
          if (sel.status === 'performed') { click = sel; }
          else {
            click = sel; // 保留真实失败原因（如 unsupported: MCP unavailable）
            const ht = await engine.runReadOnlyClick(`${matchedTarget.tag.toLowerCase()}:has-text("${escapeText(name)}")`, 'action');
            if (ht.status === 'performed') { click = ht; }
          }
        }
        if (click.status !== 'performed') {
          const reason = `${click.status}: ${click.reason ?? 'unknown reason'}`;
          this.logger.warn('orchestrator', `case: click-by-name skipped for "${name}"; ${reason}`);
          evidence[featureId] = {
            featureId,
            ...(systemId ? { systemId } : {}),
            ...(featureRevision ? { featureRevision } : {}),
            pageEntry: baseUrl,
            actionKind: targetInfo.actionKind ?? 'other',
            states: [],
            fields: [],
            tables: [],
            actionEntries: [],
            containers: [],
            evidenceLevel: 'needs_review',
            coverageKeys: [],
            needsReview: true,
            reviewReason: `无法执行功能点级只读探索：${reason}`,
            uncovered: [{ kind: 'no_safe_sample', reason }],
          };
          continue;
        }
        await engine.waitForTimeout(700);
        const els = await engine.extractPageElements();
        all.push(...els);
        const pageUrl = typeof engine.getCurrentUrl === 'function'
          ? await engine.getCurrentUrl().catch(() => undefined)
          : undefined;
          const explored = await exploreFeatureEvidence(engine, {
            featureId,
            systemId,
            featureRevision,
            actionKind: targetInfo.actionKind,
          initialState: targetInfo.actionKind === 'create' || targetInfo.actionKind === 'update' || targetInfo.actionKind === 'detail'
            ? targetInfo.actionKind
            : undefined,
            pageUrl,
            pageEntry: pageUrl ?? baseUrl,
          });
        // The name fallback has already clicked the menu entry, so it is no
        // longer present in the target page DOM. Record that clicked entry
        // explicitly instead of asking the collector to click it a second time.
        if (matchedTarget.selector && !explored.evidence.actionEntries.some((entry) =>
          entry.selector === matchedTarget.selector || entry.ref === matchedTarget.selector,
        )) {
          explored.evidence.actionEntries.push({
            actionKind: targetInfo.actionKind ?? 'other',
            ref: matchedTarget.selector,
            selector: matchedTarget.selector,
            text: name,
            triggerable: true,
            observed: true,
          });
        }
        all.push(...explored.raw);
        evidence[featureId] = explored.evidence;
        this.logger.info('orchestrator', `case: click-by-name "${name}" -> ${els.length} elements`);
        break;
      } catch (e) {
        this.logger.warn('orchestrator', `case: click-by-name failed for "${name}": ${e instanceof Error ? e.message : e}`);
      }
      }
    }
    this.logger.info('orchestrator', `case fallback by feature names: ${all.length} elements from ${targets.length} feature-bound names`);
    return { elements: all, evidence };
  }

  /** 运行整条流水线 */
  async run(input: PipelineInput): Promise<PipelineResult> {
    this.logger.info('orchestrator', 'pipeline started');
    const project = await this.store.createProject({ name: `pipeline-${Date.now()}` });

    try {
      // 1. Login
      this.logger.info('orchestrator', '[1/6] login started');
      const loginStage = createLoginStage({
        engineFactory: this.engineFactory,
        store: this.store,
      });
      const loginOutput = await loginStage.run(input.login);
      this.logger.info('orchestrator', `[1/6] login finished: status=${loginOutput.loginStatus}`);

      if (loginOutput.loginStatus === 'failed') {
        throw new Error('Login failed');
      }

      // 保存会话到 Store（即使 stage-login 内部已保存，这里也确保持久化）
      if (loginOutput.loginStatus === 'ok') {
        try {
          await this.store.saveSession(input.login.systemId, loginOutput.sessionHandle);
        } catch (err) {
          this.logger.warn('orchestrator', `failed to persist session: ${err instanceof Error ? err.message : err}`);
        }
        // 记录登录后的浏览器 URL 为 capturedUrl（探索目标应为登录后的应用页，而非门户闸门根路径）
        try {
          const loginEngine = getTakeoverEngine(input.login.systemId);
          if (loginEngine) {
            const curUrl = await loginEngine.getCurrentUrl();
            if (curUrl && !isLoginPageUrl(curUrl)) {
              const ownerProjectId = await this.findProjectIdBySystemId(input.login.systemId);
              if (ownerProjectId) {
                await this.store.updateSystem(ownerProjectId, input.login.systemId, { capturedUrl: curUrl } as Partial<System> & { capturedUrl?: string });
                this.logger.info('orchestrator', `[1/6] login capturedUrl saved for ${input.login.systemId}: ${curUrl}`);
              } else {
                this.logger.warn('orchestrator', `[1/6] login capturedUrl not saved, owner project not found for ${input.login.systemId}`);
              }
            }
          }
        } catch (err) {
          this.logger.warn('orchestrator', `failed to save capturedUrl: ${err instanceof Error ? err.message : err}`);
        }
      }

      // 2. Explore
      this.logger.info('orchestrator', '[2/6] explore started');
      // 第一优先级：复用登录阶段的人工接管浏览器（会话随浏览器存活）
      const takeoverEngine = getTakeoverEngine(input.login.systemId);
      
      // 使用保存的 storageState 创建 engine（如果有的话）
      const exploreAi = this.buildExploreAi(input.explore?.aiConfig);
      const engineConfigWithState: EngineConfig = {
        ...this.engineConfig,
        ...(this.currentStorageState ? { storageState: this.currentStorageState } : {}),
        ...(exploreAi ? { ai: exploreAi } : {}),
      };

      const engine = takeoverEngine ?? this.engineFactory(engineConfigWithState);
      let sessionToUse = loginOutput.sessionHandle;
      let reuseActiveSession = false;

      if (takeoverEngine) {
        this.logger.info('orchestrator', `[2/6] explore reusing login browser for ${input.login.systemId}`);
        // 登录浏览器已带活跃会话：跳过会话注入（防止旧快照覆盖有效会话导致登出）
        reuseActiveSession = true;
      } else {
        await engine.launch();

        // 尝试复用会话（如果 login 没有返回有效会话，尝试从 Store 获取）
        if (!sessionToUse || sessionToUse.expiresAt < Date.now()) {
          const storedSession = await this.tryReuseSession(input.login.systemId);
          if (storedSession) {
            sessionToUse = storedSession;
          }
        }

        if (sessionToUse && (sessionToUse.cookies?.length || sessionToUse.headers || sessionToUse.tokens?.length)) {
          // 先导航到目标系统再注入 cookies（about:blank 注入会抛异常）
          const exploreUrl = input.explore?.systemUrl ?? input.login.systemUrl;
          if (exploreUrl) {
            await engine.navigate(exploreUrl);
          }
          await engine.applySession({
            cookies: sessionToUse.cookies,
            headers: sessionToUse.headers,
            tokens: sessionToUse.tokens,
          });
        }
        
        // 保存当前 engine 的 storageState，供后续阶段（如二次探索、execute）复用
        try {
          this.currentStorageState = await engine.getStorageState();
          if (this.currentStorageState) {
            await this.store.saveStorageState(input.login.systemId, this.currentStorageState);
            this.logger.info('orchestrator', `[2/6] saved storage state for session reuse`);
          }
        } catch (e) {
          this.logger.warn('orchestrator', `failed to save storage state: ${e instanceof Error ? e.message : e}`);
        }
      }

      const exploreInput: ExploreInput = {
        sessionHandle: sessionToUse,
        subsystemId: input.explore?.subsystemId ?? input.login.systemId,
        systemUrl: input.explore?.systemUrl ?? input.login.systemUrl,
        manualSupplement: input.explore?.manualSupplement,
        resumeFrom: input.explore?.resumeFrom,
      };
      const exploreOutput = await stageExplore.run(
        exploreInput,
        engine,
        {
          ...(reuseActiveSession ? { engineHasActiveSession: true } : {}),
          ...(exploreAi ? { ai: exploreAi } : {}),
        },
      );
      this.logger.info('orchestrator', `[2/6] explore finished: nodes=${exploreOutput.moduleTree.length}`);

      // 3. Feature
      this.logger.info('orchestrator', '[3/6] feature started');
      const featureInput: FeatureInput = {
        moduleTree: exploreOutput.moduleTree,
        systemName: input.feature?.systemName ?? input.login.systemId,
        confirmedOnly: input.feature?.confirmedOnly ?? false,
        designSources: input.feature?.designSources,
      };
      const featureOutput = await stageFeature.run(featureInput);
      this.logger.info('orchestrator', `[3/6] feature finished: rows=${featureOutput.featureTable.length}`);
      const storedArtifact = await this.store.getFeatureArtifact(input.login.systemId).catch(() => null);
      const existingFeatureArtifact = storedArtifact && !Array.isArray(storedArtifact) && storedArtifact.version === 2 ? storedArtifact : undefined;
      const mergedFeatureArtifact = mergeFeatureArtifact(existingFeatureArtifact, {
        table: featureOutput.featureTable,
        featurePaths: featureOutput.featurePaths,
        featureProfiles: featureOutput.featureProfiles,
        featureEvidence: featureOutput.featureEvidence,
        provenance: featureOutput.provenance,
        designSources: input.feature?.designSources?.map((source) => source.name ?? source.kind),
      });
      const caseFeatureArtifact = alignArtifactToFeatureTable(mergedFeatureArtifact, featureOutput.featureTable);

      // 4. Case
      this.logger.info('orchestrator', '[4/6] case started');

      // === 二次探索：按功能点 featurePaths（来自功能点阶段，根因解法）隔离采集真实页面证据 ===
      // T4：改为按 featureId 隔离的 Record<featureId, FeatureEvidence>，杜绝跨功能点串用
      let featureEvidence: Record<string, FeatureEvidence> = {};
      try {
        const scope = input.case?.scope ?? 'all';
        const selectedModuleIds = input.case?.selectedModuleIds;
        const missingFeatureIds = collectMissingFeatureIds(
          caseFeatureArtifact.table,
          scope,
          selectedModuleIds,
          caseFeatureArtifact.featurePaths,
          caseFeatureArtifact.featureProfiles,
          caseFeatureArtifact.featureEvidence,
          input.login.systemId,
          input.case?.featureRevision,
        );
        if (missingFeatureIds.size > 0) {
          const coll = await this.exploreFeatureEvidenceMap(
            engine,
            caseFeatureArtifact.featurePaths,
            caseFeatureArtifact.table,
            caseFeatureArtifact.featureProfiles,
            selectedModuleIds,
            scope,
            input.login.systemUrl,
            missingFeatureIds,
            input.login.systemId,
            input.case?.featureRevision,
          );
          featureEvidence = mergeFeatureEvidence(
            caseFeatureArtifact.featureEvidence,
            retainConcreteEvidence(coll.evidence),
            existingFeatureArtifact?.featureProfiles,
            caseFeatureArtifact.featureProfiles,
          );
          const remainingMissingFeatureIds = collectMissingFeatureIds(
            caseFeatureArtifact.table,
            scope,
            selectedModuleIds,
            caseFeatureArtifact.featurePaths,
            caseFeatureArtifact.featureProfiles,
            featureEvidence,
            input.login.systemId,
            input.case?.featureRevision,
          );
          if (remainingMissingFeatureIds.size > 0) {
            const fallback = await this.exploreByFeatureNames(
              engine,
              caseFeatureArtifact.table,
              input.login.systemUrl,
              remainingMissingFeatureIds,
              caseFeatureArtifact.featureProfiles,
              input.login.systemId,
              input.case?.featureRevision,
            );
            featureEvidence = mergeFeatureEvidence(
              featureEvidence,
              retainConcreteEvidence(fallback.evidence),
              existingFeatureArtifact?.featureProfiles,
              caseFeatureArtifact.featureProfiles,
            );
          }
        }
      } catch (e) {
        this.logger.warn('orchestrator', `case secondary exploration failed: ${e instanceof Error ? e.message : e}`);
      }
      const mergedFeatureEvidence = mergeFeatureEvidence(
        caseFeatureArtifact.featureEvidence,
        featureEvidence,
        existingFeatureArtifact?.featureProfiles,
        mergedFeatureArtifact.featureProfiles,
      );

      const caseInput: CaseInput = {
        featureTable: caseFeatureArtifact.table,
        systemId: input.login.systemId,
        featureRevision: input.case?.featureRevision,
        scope: input.case?.scope ?? 'all',
        selectedModuleIds: input.case?.selectedModuleIds,
        regenerateSelected: input.case?.regenerateSelected ?? false,
        currentCaseWorkbook: input.case?.currentCaseWorkbook,
        featurePaths: caseFeatureArtifact.featurePaths,
        featureProfiles: caseFeatureArtifact.featureProfiles,
        metaConfig: input.case?.metaConfig ?? {
          systemName: input.login.systemId,
          testPointId: '',
          testPoint: '',
          testers: '',
          clientStaff: '',
          developerStaff: '',
          firstTestDate: new Date().toISOString().slice(0, 10),
          regressionDate: new Date().toISOString().slice(0, 10),
          conclusionRule: '默认',
          precondition: '系统已登录并可访问',
        },
        aiConfig: input.case?.aiConfig,
        featureEvidence: Object.keys(mergedFeatureEvidence).length > 0
          ? mergedFeatureEvidence
          : undefined,
      };
      // AI 双模：任务级依赖注入（spec §6.5 / §10）。启用但无有效配置 → 生成前阻断，不静默回退无 AI。
      const caseAiEnabled = input.case?.aiConfig?.enabled === true;
      let caseAiClient: AIClient | undefined;
      if (caseAiEnabled) {
        const cfg = input.case?.aiConfig?.configId ? getProvider(input.case.aiConfig.configId) : getDefault();
        if (!isUsableAIProvider(cfg)) {
          throw new stageCase.CaseGenerationBlockedError(
            `测试用例 AI 已开启但未配置有效模型${input.case?.aiConfig?.configId ? `（${input.case.aiConfig.configId}）` : '（无默认配置）'}，请在生成前配置后再试`,
          );
        }
        try {
          caseAiClient = createAIClient(cfg);
        } catch (e) {
          throw new stageCase.CaseGenerationBlockedError(`测试用例 AI 客户端构建失败: ${e instanceof Error ? e.message : e}`);
        }
      }
      const caseOutput = await stageCase.run(caseInput, { aiClient: caseAiClient });
      this.logger.info('orchestrator', `[4/6] case finished: sheets=${caseOutput.caseWorkbook.length}`);

      // 5. Execute
      this.logger.info('orchestrator', '[5/6] execute started');
      const defaultEnv: BrowserOS = { os: 'Windows', browser: 'Chrome', version: '120' };
      const executeInput: ExecuteInput = {
        caseWorkbook: caseOutput.caseWorkbook,
        browserOSMatrix: input.execute?.browserOSMatrix ?? [defaultEnv],
        scope: input.execute?.scope ?? 'all',
        selectedModuleIds: input.execute?.selectedModuleIds,
      };
      let execEngine: McpEngine | undefined;
      let execOutput: ExecuteOutput;
      try {
        // 使用保存的 storageState 创建 engine，确保会话复用
        const execEngineConfig: EngineConfig = {
          ...this.engineConfig,
          ...(this.currentStorageState ? { storageState: this.currentStorageState } : {}),
        };
        execEngine = this.engineFactory(execEngineConfig);
        await execEngine.launch();
        await execEngine.navigate(input.login.systemUrl);
        
        // 使用有效的会话（优先 login 输出，回退到 Store 复用）
        let execSession = loginOutput.sessionHandle;
        if (!execSession || execSession.expiresAt < Date.now()) {
          const stored = await this.tryReuseSession(input.login.systemId);
          if (stored) execSession = stored;
        }
        
        if (execSession?.cookies?.length || execSession?.headers || execSession?.tokens?.length) {
          await execEngine.applySession({
            cookies: execSession?.cookies,
            headers: execSession?.headers,
            tokens: execSession?.tokens,
          });
        }
        execOutput = await stageExecute.run(executeInput, { engine: execEngine });
      } catch {
        execOutput = await stageExecute.run(executeInput);
      }
      // 注意：浏览器永不关闭，保持可视状态
      this.logger.info('orchestrator', `[5/6] execute finished: results=${execOutput.executionReport.length}`);

      // 6. Defect
      this.logger.info('orchestrator', '[6/6] defect started');
      const defectInput: DefectInput = {
        executionReport: execOutput.executionReport,
        moduleFilter: input.defect?.moduleFilter,
      };
      const defectOutput = await stageDefect.run(defectInput);
      this.logger.info('orchestrator', `[6/6] defect finished: groups=${defectOutput.defectTable.length}`);

      // 持久化结果
      await this.store.saveFeatureArtifact(input.login.systemId, {
        ...mergedFeatureArtifact,
        featureEvidence: Object.keys(mergedFeatureEvidence).length > 0 ? mergedFeatureEvidence : undefined,
      });
      if (caseOutput.generation) {
        await this.persistCaseProduct(input.login.systemId, caseOutput.caseWorkbook, caseOutput.generation);
      } else {
        await this.store.saveCaseTable(input.login.systemId, caseOutput.caseWorkbook);
      }
      await this.store.saveExecution(input.login.systemId, execOutput.executionReport);

      this.logger.info('orchestrator', 'pipeline completed successfully');

      return {
        project,
        login: loginOutput,
        explore: exploreOutput,
        feature: featureOutput,
        case: caseOutput,
        execute: execOutput,
        defect: defectOutput,
        session: loginOutput.sessionHandle,
      };
    } catch (err) {
      this.logger.error('orchestrator', `pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /** 单阶段执行 */
  async runStage(
    stageName: 'login' | 'explore' | 'feature' | 'case' | 'execute' | 'defect',
    input: Record<string, any>,
  ): Promise<any> {
    this.logger.info('orchestrator', `runStage: ${stageName} started`);

    switch (stageName) {
      case 'login': {
        // 已登录复用短路：避免反复登录（反复 launch 新浏览器撞验证码）。
        // 若本系统已有活跃登录浏览器且当前已离开登录页（即已登录态），
        // 直接复用，不再重新 launch 浏览器、不再触发验证码。
        // 注意：仅做 orchestrator 层会话复用判断，不改动 stage-login 业务代码（计划 §15 禁止范围）。
        const loginInputForShortcut = input as LoginInput;
        const shortcutSystemId = loginInputForShortcut.systemId;
        // 子系统登录（parentPortalUrl 存在）不做「已登录即复用」短路：
        // 既有浏览器可能停在门户工作台（门户已登录但尚未进入子系统），DOM 关键词
        // （工作台/控制台）会把它误判为登录成功，短路直接返回 ok 并把**门户 URL** 当
        // capturedUrl —— 正是「子系统登录不跳转、点击探索一直探索门户」的直接根因。
        // 此类请求委托 stage-login 的 confirm 流程完成「整体路径判定当前页是否在子系统 →
        // 检测子系统登录态 → 捕获子系统会话」（见下方委托分支）。
        const subsystemDelegation =
          !!loginInputForShortcut.parentPortalUrl &&
          (loginInputForShortcut.mode === 'credential' || loginInputForShortcut.mode === 'manual-takeover');
        // 已登录/已接管复用短路：避免反复登录（反复 launch 新浏览器撞验证码）。
        // 判定依据：本系统是否已有活跃接管浏览器（无论当前停在登录页还是应用页）。
        // 只要存在，就复用该浏览器检测登录态——绝不再开新浏览器（否则验证码站点会
        // 每次都重撞验证码，正是用户报告的"反复登录"根因）。
        // 注意：仅做 orchestrator 层会话复用判断，不改动 stage-login 业务代码（计划 §15 禁止范围）。
        if (shortcutSystemId && !subsystemDelegation) {
          const existingEngine = getTakeoverEngine(shortcutSystemId);
          if (existingEngine) {
            try {
              const curUrl = await existingEngine.getCurrentUrl();
              const onLoginPage = !!curUrl && isLoginPageUrl(curUrl);
              this.logger.info('orchestrator', `runStage: login reuse existing browser for ${shortcutSystemId} (url=${curUrl}, onLoginPage=${onLoginPage}), skip relaunch`);
              // 免登录模式：本就无登录概念，只要浏览器在即视为已登录，直接复用（不重新检测）。
              if (loginInputForShortcut.mode === 'no-login') {
                const stored = await this.tryReuseSession(shortcutSystemId);
                const reused: LoginOutput & { capturedUrl?: string } = {
                  loginStatus: 'ok',
                  cookies: stored?.cookies ?? [],
                  expiresAt: stored?.expiresAt ?? Date.now() + 8 * 60 * 60 * 1000,
                  sessionHandle: stored ?? {
                    sessionId: 'reused',
                    systemId: shortcutSystemId,
                    loginStatus: 'ok',
                    cookies: [],
                    headers: {},
                    tokens: [],
                    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
                    loginAt: Date.now(),
                    loginMode: 'no-login',
                    detectionReason: '复用既有免登录浏览器',
                  },
                  capturedUrl: curUrl,
                };
                return reused;
              }
              // 复用既有引擎检测登录态：在登录页=待用户补完（barrier），已离开=已登录（ok）。
              const dom = await extractDomWithRetry(existingEngine);
              const det = dom ? detectLoginState({ dom }) : { status: 'barrier' as const, reason: '无法读取登录页' };
              if (det.status === 'ok') {
                const stored = await this.tryReuseSession(shortcutSystemId);
                const reused: LoginOutput & { capturedUrl?: string } = {
                  loginStatus: 'ok',
                  cookies: stored?.cookies ?? [],
                  expiresAt: stored?.expiresAt ?? Date.now() + 8 * 60 * 60 * 1000,
                  sessionHandle: stored ?? {
                    sessionId: 'reused',
                    systemId: shortcutSystemId,
                    loginStatus: 'ok',
                    cookies: [],
                    headers: {},
                    tokens: [],
                    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
                    loginAt: Date.now(),
                    loginMode: loginInputForShortcut.mode,
                  },
                  capturedUrl: curUrl,
                };
                return reused;
              }
              // 仍在登录页：返回 barrier，提示用户在已有浏览器中完成登录后再次确认。
              // 关键：不重新 launch，复用同一浏览器，避免验证码反复出现。
              return {
                loginStatus: 'barrier',
                cookies: [],
                expiresAt: 0,
                sessionHandle: {
                  sessionId: 'reuse-barrier',
                  systemId: shortcutSystemId,
                  loginStatus: 'barrier',
                  cookies: [],
                  headers: {},
                  tokens: [],
                  expiresAt: 0,
                  loginMode: loginInputForShortcut.mode,
                  detectionReason: '已有浏览器在等待登录，请在浏览器中完成登录（含验证码）后再次点击「确认登录」',
                },
              };
            } catch (e) {
              this.logger.warn('orchestrator', `runStage: login reuse check failed for ${shortcutSystemId}: ${e instanceof Error ? e.message : e}`);
            }
          }
        }

        // 子系统登录委托：既有活跃浏览器时，不走上方短路，改由 stage-login 的 confirm
        // 流程处理（复用既有浏览器，不 relaunch、不撞验证码）：
        // confirm 内部按「整体路径前缀（host+pathname+hash）」判定当前页是否已在子系统
        // 中（D:\test 人工接管模式，全程不 navigate）：在子系统且无登录表单 → ok，此时
        // 当前 URL 即子系统入口，capturedUrl 由下方按 getCurrentUrl 记录 → 探索阶段
        // 随之探索子系统；仍在门户 → barrier，提示用户手动进入子系统后再次确认。
        // launch/confirm 两种入口统一转为 confirm：launch 场景下若浏览器已停在子系统则
        // 直接完成（「登录后自动跳转子系统」由用户手动导航完成）；否则返回 barrier 等待。
        if (shortcutSystemId && subsystemDelegation && getTakeoverEngine(shortcutSystemId)) {
          this.logger.info('orchestrator', `runStage: login subsystem delegation for ${shortcutSystemId} (reuse browser, delegate to stage-login confirm for subsystem navigation)`);
          input = { ...input, takeoverAction: 'confirm' };
        }

        const loginStage = createLoginStage({ engineFactory: this.engineFactory, store: this.store });
        const output = await loginStage.run(input as LoginInput);
        this.logger.info('orchestrator', `runStage: login finished: ${output.loginStatus}`);
        let outputWithUrl: LoginOutput & { capturedUrl?: string } = output;
        // 保存登录会话
        if (output.loginStatus === 'ok') {
          const loginSystemId = (input as LoginInput).systemId;
          try {
            await this.store.saveSession(loginSystemId, output.sessionHandle);
          } catch {
            // 会话持久化失败不阻断登录流程
          }
          // 持久化 storageState（cookies+localStorage），供后续独立 explore/execute 无失真复用登录
          await this.persistStorageStateFromEngine(loginSystemId);
          // 记录登录后的浏览器 URL 为 capturedUrl：探索目标应为登录后的应用页，
          // 而非门户闸门根路径（裸根路径重载后会被重定向到登录页，导致「探索后退登出」）。
          // 注意：capturedUrl 非契约 System 字段，但 store 以 JSON 整存 systems，运行时可达
          // （前端 dataApi 类型已含该字段）；此处仅做类型断言，不修改冻结的 contracts。
          // 归属项目按 systemId 全局查找（前端跨项目合并展示，传入的 projectId 可能不匹配）。
          try {
            const loginEngine = getTakeoverEngine(loginSystemId);
            if (loginEngine) {
              const curUrl = await loginEngine.getCurrentUrl();
              if (curUrl && !isLoginPageUrl(curUrl)) {
                const ownerProjectId = await this.findProjectIdBySystemId(loginSystemId);
                if (ownerProjectId) {
                  await this.store.updateSystem(ownerProjectId, loginSystemId, { capturedUrl: curUrl } as Partial<System> & { capturedUrl?: string });
                  this.logger.info('orchestrator', `runStage: login capturedUrl saved for ${loginSystemId}: ${curUrl}`);
                  outputWithUrl = { ...output, capturedUrl: curUrl };
                } else {
                  this.logger.warn('orchestrator', `runStage: login capturedUrl not saved, owner project not found for ${loginSystemId}`);
                }
              }
            }
          } catch (e) {
            this.logger.warn('orchestrator', `runStage: save capturedUrl failed: ${e instanceof Error ? e.message : e}`);
          }
        }
        return outputWithUrl;
      }

      case 'explore': {
        let engine: McpEngine | undefined;
        let finalInput = input as Record<string, any>;
        const rawInput = input as Record<string, any>;
        const systemId: string = rawInput.sessionHandle?.systemId ?? rawInput.systemId ?? rawInput.subsystemId;
        const exploreAi = this.buildExploreAi(rawInput.aiConfig);

        // ===== 第一优先级：复用登录阶段的人工接管浏览器（会话随浏览器存活） =====
        const takeoverEngine = systemId ? getTakeoverEngine(systemId) : undefined;
        if (takeoverEngine) {
          this.logger.info('orchestrator', `runStage: explore reusing login browser for ${systemId}`);
          engine = takeoverEngine;
          // 登录浏览器已带活跃会话：engineHasActiveSession=true 使 stage-explore
          // 跳过 ensureSession/applySession（旧会话快照注入会覆盖浏览器内最新有效会话导致登出）
          const output = await stageExplore.run(finalInput as ExploreInput, engine, {
            engineHasActiveSession: true,
            ...(exploreAi ? { ai: exploreAi } : {}),
          });
          this.logger.info('orchestrator', `runStage: explore finished: nodes=${output.moduleTree.length}`);
          return output;
        }

        // ===== 未命中登录浏览器：新建引擎 + 无失真会话恢复 =====
        try {
          // 优先用持久化的 storageState（cookies+localStorage），可无失真恢复 SPA 登录态。
          // 这是避免"探索后退出登录"的关键：cookie-only 的 applySession 无法恢复
          // localStorage 中的 token，导致 SPA 判定为未登录。
          const storedState = systemId ? await this.store.getStorageState(systemId) : null;
          const engineConfigWithState: EngineConfig = {
            ...this.engineConfig,
            ...(storedState ? { storageState: storedState as PlaywrightStorageState } : {}),
            ...(exploreAi ? { ai: exploreAi } : {}),
            ...(rawInput.readOnlyClickPolicy ? { readOnlyClickPolicy: rawInput.readOnlyClickPolicy } : {}),
          };
          engine = this.engineFactory(engineConfigWithState);
          await engine.launch();

          if (storedState) {
            // 已通过 context.storageState 完整恢复，无需再 applySession（避免覆盖最新有效会话）
            this.logger.info('orchestrator', `runStage: explore restored via storageState for ${systemId}`);
            if (rawInput.systemUrl) await engine.navigate(rawInput.systemUrl);
            // storageState 已是有效会话，透传给 stage-explore 以供合并/校验
            finalInput = { ...rawInput, sessionHandle: { ...(rawInput.sessionHandle ?? {}), systemId } };
          } else {
            // 兜底：cookie-only applySession（旧路径，SPA 可能判定未登录）
            let sessionToUse: SessionHandle | undefined;
            if (rawInput.sessionHandle && rawInput.sessionHandle.expiresAt > Date.now()) {
              sessionToUse = rawInput.sessionHandle as SessionHandle;
            } else if (rawInput.systemId) {
              const stored = await this.tryReuseSession(rawInput.systemId);
              if (stored) sessionToUse = stored;
            }
            if (sessionToUse) {
              if (rawInput.systemUrl) await engine.navigate(rawInput.systemUrl);
              await engine.applySession({
                cookies: sessionToUse.cookies,
                headers: sessionToUse.headers,
                tokens: sessionToUse.tokens,
              });
              this.logger.info('orchestrator', `runStage: explore session applied for ${sessionToUse.systemId}`);
              finalInput = { ...rawInput, sessionHandle: sessionToUse };
            }
          }
        } catch (e) {
          // 引擎已启动但会话注入失败：必须关闭浏览器避免窗口泄漏
          this.logger.warn('orchestrator', `runStage: explore engine/session failed: ${e instanceof Error ? e.message : e}`);
          try {
            await engine?.close();
          } catch {
            // 关闭失败忽略，继续置空引擎
          }
          engine = undefined;
        }
        const output = await stageExplore.run(finalInput as ExploreInput, engine, {
          ...(exploreAi ? { ai: exploreAi } : {}),
        });
        this.logger.info('orchestrator', `runStage: explore finished: nodes=${output.moduleTree.length}`);
        return output;
      }

      case 'feature': {
        const output = await stageFeature.run(input as FeatureInput);
        this.logger.info('orchestrator', `runStage: feature finished: rows=${output.featureTable.length}`);
        return output;
      }

      case 'case': {
        const rawInput = input as Record<string, any>;

        const featureTable: FeatureRow[][] = rawInput.featureTable ?? [];
        const scope = (rawInput.scope ?? 'all') as 'all' | 'selected_modules';
        const selectedModuleIds: string[] | undefined = rawInput.selectedModuleIds;
        const featurePaths: Record<string, string> | undefined = rawInput.featurePaths;
        const systemUrl: string | undefined = rawInput.systemUrl;

        // AI 双模：任务级依赖注入（spec §6.5 / §10）。启用但无有效配置 → 生成前阻断，不静默回退无 AI。
        const aiEnabled = rawInput.aiConfig?.enabled === true;
        let aiClient: AIClient | undefined;
        if (aiEnabled) {
          const cfg = rawInput.aiConfig?.configId ? getProvider(rawInput.aiConfig.configId) : getDefault();
          if (!isUsableAIProvider(cfg)) {
            throw new stageCase.CaseGenerationBlockedError(
              `测试用例 AI 已开启但未配置有效模型${rawInput.aiConfig?.configId ? `（${rawInput.aiConfig.configId}）` : '（无默认配置）'}，请在生成前配置后再试`,
            );
          }
          try {
            aiClient = createAIClient(cfg);
          } catch (e) {
            throw new stageCase.CaseGenerationBlockedError(`测试用例 AI 客户端构建失败: ${e instanceof Error ? e.message : e}`);
          }
        }

        // 二次探索（Playwright MCP）：无 exploredElements 时，按 featurePaths 探索选中模块；
        // featurePaths 缺失/无效时，重跑探索重建 featurePaths，仍失败则按功能点名称在页面找对应功能。
        // 绝不静默模板直出 —— 模板生成必须有明确告警（bug-fixing: 根因=探索未产 url，不能靠用例阶段掩盖）。
        const systemId: string | undefined = rawInput.systemId ?? rawInput.sessionHandle?.systemId;
        // Public exploredElements is compatibility input only; it cannot satisfy the
        // per-feature evidence gate or suppress precise exploration.
        const suppliedEvidence: Record<string, FeatureEvidence> = { ...(rawInput.featureEvidence ?? {}) };
        const existingArtifact = systemId ? await this.store.getFeatureArtifact(systemId).catch(() => null) : null;
        const existingV2 = existingArtifact && !Array.isArray(existingArtifact) && existingArtifact.version === 2 ? existingArtifact : undefined;
        // 本次传入的 featureTable 是生成权威输入（来自 UI 当前选中的功能点表）。
        // 历史 artifact 可能残留其他系统的脏功能点表，必须按本次功能点 ID 对齐过滤，
        // 否则会产生"82 条垃圾功能点 + 0 个有效用例组"的污染（bug-fixing: 脏数据合并）。
        // 仅复用与本次功能点 ID 匹配的 paths/evidence/profiles/provenance/designSources。
        const incomingFeatureIds = new Set(featureTable.flat().map((row) => row[8]).filter(Boolean));
        const alignedExisting = existingV2 && incomingFeatureIds.size > 0 ? {
          ...existingV2,
          table: existingV2.table.filter((group) => group.some((r) => incomingFeatureIds.has(r[8] ?? ''))),
          featurePaths: Object.fromEntries(Object.entries(existingV2.featurePaths ?? {}).filter(([id]) => incomingFeatureIds.has(id))),
          featureProfiles: existingV2.featureProfiles?.filter((p) => incomingFeatureIds.has(p.featureId)),
          featureEvidence: Object.fromEntries(Object.entries(existingV2.featureEvidence ?? {}).filter(([id]) => incomingFeatureIds.has(id))),
        } : existingV2;
        const mergedArtifact = mergeFeatureArtifact(alignedExisting, {
          table: featureTable,
          featurePaths,
          featureProfiles: rawInput.featureProfiles as FeatureProfile[] | undefined,
          featureEvidence: suppliedEvidence,
          provenance: undefined,
          designSources: undefined,
        });
        // The submitted confirmed table is the only authoritative case input.
        // Historical artifact rows may provide matching metadata, never extra features.
        const resolvedTable = featureTable;
        const resolvedPaths = mergedArtifact.featurePaths;
        const resolvedProfiles = mergedArtifact.featureProfiles;
        let evidenceMap = mergeFeatureEvidence(
          mergedArtifact.featureEvidence,
          undefined,
          existingV2?.featureProfiles,
          rawInput.featureProfiles as FeatureProfile[] | undefined,
        );
        const missingFeatureIds = collectMissingFeatureIds(
          resolvedTable,
          scope,
          selectedModuleIds,
          resolvedPaths,
          resolvedProfiles,
          evidenceMap,
          systemId,
          rawInput.featureRevision,
        );
        const hasUsablePaths = !!resolvedPaths && Object.values(resolvedPaths).some((u) =>
          /^https?:\/\//i.test(u) || u.startsWith('/') || u.startsWith('click:'),
        );
        if (missingFeatureIds.size > 0 && (hasUsablePaths || featureTable.flat().length > 0)) {
          try {
            // 优先复用登录浏览器；否则恢复 storageState，再回退到 SessionHandle。
            // case 阶段也必须在已登录上下文中二次探索，不能新建匿名浏览器后扫描登录页。
            const takeoverEngine = systemId ? getTakeoverEngine(systemId) : undefined;
            const storedState = systemId && !takeoverEngine ? await this.store.getStorageState(systemId) : null;
            const engineConfig: EngineConfig = {
              ...this.engineConfig,
              ...(storedState ? { storageState: storedState as PlaywrightStorageState } : {}),
              ...(rawInput.readOnlyClickPolicy ? { readOnlyClickPolicy: rawInput.readOnlyClickPolicy } : {}),
            };
            const engine = takeoverEngine ?? this.engineFactory(engineConfig);
            if (!takeoverEngine) await engine.launch();
            if (!takeoverEngine && !storedState) {
              const session = rawInput.sessionHandle?.expiresAt > Date.now()
                ? rawInput.sessionHandle as SessionHandle
                : systemId ? await this.tryReuseSession(systemId) : null;
              if (session) {
                // Browser session rule: navigate to http(s) before injecting cookies/headers/tokens.
                if (systemUrl) await engine.navigate(systemUrl);
                await engine.applySession({
                  cookies: session.cookies,
                  headers: session.headers,
                  tokens: session.tokens,
                });
                this.logger.info('orchestrator', `case: restored SessionHandle for ${systemId}`);
              }
            } else if (!takeoverEngine && storedState && systemUrl) {
              // storageState is applied by the browser context; navigate before extraction.
              await engine.navigate(systemUrl);
            }
            // 复用登录会话并按路径进入：入口取登录后应用页（capturedUrl 优先，避免直接打开目标 URL 落在登录页），
            // 导航入口并验证登录态；若落在登录页则标记会话失效并跳过二次探索（不反复重新登录）。
            const entryUrl = systemId
              ? ((await this.resolveCaseEntryUrl(systemId)) ?? systemUrl)
              : systemUrl;
            let sessionValid = true;
            // 入口本身是登录页（capturedUrl 未保存 = 登录未完成/未记录）：无有效会话，直接标记需要登录/人工接管，不在登录页空跑。
            if (entryUrl && isLoginPageUrl(entryUrl)) {
              this.logger.warn('orchestrator', `case: 入口 ${entryUrl} 为登录页（无 capturedUrl），需登录/人工接管后重试`);
              sessionValid = false;
            }
            try {
              if (engine && entryUrl && isSafeNavigationUrl(entryUrl)) {
                await engine.navigate(entryUrl);
                await engine.waitForTimeout(800);
                const after = await engine.getCurrentUrl().catch(() => '');
                if (after && isLoginPageUrl(after) && !isLoginPageUrl(entryUrl)) {
                  this.logger.warn('orchestrator', `case: 登录会话失效（${after} 为登录页），跳过二次探索避免反复重新登录`);
                  sessionValid = false;
                }
              }
            } catch (e) {
              this.logger.warn('orchestrator', `case: 入口导航失败: ${e instanceof Error ? e.message : e}`);
            }
            try {
              if (sessionValid) {
                if (hasUsablePaths) {
                  const coll = await this.exploreFeatureEvidenceMap(
                    engine, resolvedPaths, resolvedTable, resolvedProfiles, selectedModuleIds, scope, entryUrl, missingFeatureIds,
                    systemId, rawInput.featureRevision,
                    );
                  evidenceMap = mergeFeatureEvidence(evidenceMap, retainConcreteEvidence(coll.evidence), existingV2?.featureProfiles, resolvedProfiles);
                }

                // ③ 路径探索可能只覆盖部分功能点；名称兜底必须继续处理剩余缺失项（从入口按名称/菜单进入）。
                const remainingMissingFeatureIds = collectMissingFeatureIds(
                  resolvedTable,
                  scope,
                  selectedModuleIds,
                  resolvedPaths,
                  resolvedProfiles,
                  evidenceMap,
                  systemId,
                  rawInput.featureRevision,
                );
                if (remainingMissingFeatureIds.size > 0) {
                  const fallback = await this.exploreByFeatureNames(
                    engine,
                    resolvedTable,
                    entryUrl,
                    remainingMissingFeatureIds,
                    resolvedProfiles,
                    systemId,
                    rawInput.featureRevision,
                  );
                  evidenceMap = mergeFeatureEvidence(evidenceMap, retainConcreteEvidence(fallback.evidence), existingV2?.featureProfiles, resolvedProfiles);
                }
              } else {
                // 会话失效：缺失功能点明确 needs_review（不伪造证据、不反复自动登录）
                for (const id of missingFeatureIds) {
                  evidenceMap[id] = {
                    featureId: id,
                    ...(systemId ? { systemId } : {}),
                    ...(rawInput.featureRevision ? { featureRevision: rawInput.featureRevision } : {}),
                    pageEntry: entryUrl,
                    actionKind: (resolvedProfiles ?? []).find((p) => p.featureId === id)?.actionKind ?? 'other',
                    states: [],
                    fields: [],
                    tables: [],
                    actionEntries: [],
                    containers: [],
                    evidenceLevel: 'needs_review',
                    coverageKeys: [],
                    needsReview: true,
                    reviewReason: '登录会话失效（入口为登录页），请重新登录或人工接管后重试；未反复自动登录',
                    uncovered: [{ kind: 'no_safe_sample', reason: '登录会话失效' }],
                  };
                }
              }
            } finally {
              // 复用登录浏览器不关闭（保持会话），新建引擎才关闭
              if (!takeoverEngine) await engine.close().catch(() => {});
            }
          } catch (e) {
            this.logger.warn('orchestrator', `case engine launch failed: ${e instanceof Error ? e.message : e}`);
          }
        }
        const unresolvedFeatureIds = collectMissingFeatureIds(
          resolvedTable,
          scope,
          selectedModuleIds,
          resolvedPaths,
          resolvedProfiles,
          evidenceMap,
          systemId,
          rawInput.featureRevision,
        );
        if (unresolvedFeatureIds.size > 0) {
          this.logger.warn('orchestrator', `case: ${unresolvedFeatureIds.size} 个功能点仍无专属探索证据，阻断对应功能点并保留当前产物`);
        }

        const caseInput = {
          ...(input as CaseInput),
          featureTable: resolvedTable,
          scope,
          selectedModuleIds,
          featurePaths: resolvedPaths,
          featureProfiles: resolvedProfiles,
          featureEvidence: Object.keys(evidenceMap).length > 0 ? evidenceMap : undefined,
        } as CaseInput;
        const output = await stageCase.run(caseInput, { aiClient });
        if (systemId && (existingV2 || Object.keys(evidenceMap).length > 0)) {
          await this.store.saveFeatureArtifact(systemId, {
            version: 2,
            table: resolvedTable,
            featurePaths: resolvedPaths,
            featureProfiles: resolvedProfiles,
            // The persisted artifact is the base, while current per-feature evidence wins only for IDs just collected.
            featureEvidence: mergeFeatureEvidence(existingV2?.featureEvidence, evidenceMap, existingV2?.featureProfiles, resolvedProfiles),
            provenance: mergedArtifact.provenance,
            designSources: mergedArtifact.designSources,
          }).catch((error) => this.logger.warn('orchestrator', `case: 保存 feature evidence 失败: ${error instanceof Error ? error.message : error}`));
        }
        // 用例产物落盘（spec §12 / §17.8）：单阶段路径必须持久化合并后的 workbook 与批次元数据，
        // 否则生成的用例组仅停留在内存、刷新即丢失。
        if (systemId) {
          if (output.generation) {
            await this.persistCaseProduct(systemId, output.caseWorkbook, output.generation);
          } else {
            await this.store.saveCaseTable(systemId, output.caseWorkbook);
          }
        }
        // 任务级 AI 客户端随本次 run 注入，无进程级全局状态，无需复位
        this.logger.info('orchestrator', `runStage: case finished: sheets=${output.caseWorkbook.length}`);
        return output;
      }

      case 'execute': {
        const rawInput = input as Record<string, any>;
        let engine: McpEngine | undefined;
        try {
          engine = this.engineFactory(this.engineConfig);
          await engine.launch();
          if (rawInput.systemUrl) {
            await engine.navigate(rawInput.systemUrl);
          }
          
          // 尝试复用会话
          let sessionCookies = rawInput.cookies as string[] | undefined;
          let sessionHeaders = rawInput.headers as Record<string, string> | undefined;
          let sessionTokens = rawInput.tokens as string[] | undefined;
          
          // 如果没有传入会话，尝试从 Store 获取
          if ((!sessionCookies || sessionCookies.length === 0) && rawInput.systemId) {
            const stored = await this.tryReuseSession(rawInput.systemId);
            if (stored) {
              sessionCookies = stored.cookies;
              sessionHeaders = stored.headers;
              sessionTokens = stored.tokens;
              this.logger.info('orchestrator', `runStage: execute session reused for ${rawInput.systemId}`);
            }
          }
          
          if (sessionCookies?.length || sessionHeaders || sessionTokens?.length) {
            await engine.applySession({
              cookies: sessionCookies ?? [],
              headers: sessionHeaders,
              tokens: sessionTokens,
            });
          }
        } catch {
          engine = undefined;
        }
        const output = await stageExecute.run(input as ExecuteInput, engine ? { engine } : {});
        this.logger.info('orchestrator', `runStage: execute finished: results=${output.executionReport.length}`);
        // 注意：浏览器永不关闭，保持可视状态
        return output;
      }

      case 'defect': {
        const output = await stageDefect.run(input as DefectInput);
        this.logger.info('orchestrator', `runStage: defect finished: groups=${output.defectTable.length}`);
        return output;
      }

      default:
        throw new Error(`Unknown stage: ${stageName}`);
    }
  }

  /** 获取 Logger 实例（供外部使用） */
  getLogger(): Logger {
    return this.logger;
  }

  /** 获取 Store 实例（供外部使用） */
  getStore(): ProjectStore {
    return this.store;
  }

  /** 获取日志文件列表 */
  async listLogFiles(): Promise<LogFileInfo[]> {
    return this.logger.listLogFiles();
  }

  /** 删除单个日志文件 */
  async deleteLogFile(filename: string): Promise<void> {
    return this.logger.deleteLogFile(filename);
  }

  /** 清空所有日志 */
  async clearAllLogs(): Promise<void> {
    return this.logger.clearAllLogs();
  }

  /** 获取日志目录路径 */
  getLogDir(): string {
    return this.logger.getLogDir();
  }

  /**
   * 从当前活跃的接管浏览器（登录阶段保留）抓取 storageState 并持久化到 Store。
   * storageState 含 cookies + localStorage，可在后续独立 explore/execute 阶段无失真恢复登录态。
   */
  /**
   * 按 systemId 全局查找归属项目（前端跨项目合并展示系统，登录/探索时传的 projectId
   * 可能不是系统真实归属项目，导致 updateSystem 报 system not found、capturedUrl 存不上）。
   */
  private async findProjectIdBySystemId(systemId: string): Promise<string | undefined> {
    try {
      const summaries = await this.store.listProjects();
      for (const p of summaries) {
        const proj = await this.store.getProject(p.id);
        if (proj?.systems?.some((s) => s.id === systemId)) return p.id;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** 解析用例阶段二次探索的登录后入口 URL：capturedUrl 优先（登录后应用页），避免落在登录页 */
  private async resolveCaseEntryUrl(systemId: string): Promise<string | undefined> {
    try {
      const pid = await this.findProjectIdBySystemId(systemId);
      if (!pid) return undefined;
      const project = await this.store.getProject(pid);
      const sys = project?.systems?.find((item) => item.id === systemId) as (System & { capturedUrl?: string }) | undefined;
      return sys?.capturedUrl;
    } catch {
      return undefined;
    }
  }

  private async persistStorageStateFromEngine(systemId: string): Promise<void> {
    try {
      const takeover = getTakeoverEngine(systemId);
      if (!takeover) return;
      const state = await takeover.getStorageState();
      if (state) {
        await this.store.saveStorageState(systemId, state);
        this.currentStorageState = state;
        this.logger.info('orchestrator', `persisted storageState for ${systemId}`);
      }
    } catch (e) {
      this.logger.warn('orchestrator', `persistStorageStateFromEngine failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * 尝试从 Store 获取并复用会话
   * @param systemId 系统 ID
   * @returns 有效会话或 null
   */
  private async tryReuseSession(systemId: string): Promise<SessionHandle | null> {
    try {
      const session = await this.store.getSession(systemId);
      if (session && session.expiresAt > Date.now()) {
        this.logger.info('orchestrator', `reusing valid session for system ${systemId}`);
        return session;
      }
      // 会话不存在或已过期
      return null;
    } catch (err) {
      this.logger.warn('orchestrator', `failed to get session: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}

export { BrowserCaptureService } from './browser-capture.js';
export type { CaptureSession, CaptureResult } from './browser-capture.js';
