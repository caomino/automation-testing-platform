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
  ExecuteInput,
  ExecuteOutput,
  DefectInput,
  DefectOutput,
  Project,
  SessionHandle,
  BrowserOS,
  ExploredElement,
  FeatureRow,
  System,
} from '@test-platform/contracts';
import { DEFAULT_FEATURE_COLUMNS } from '@test-platform/contracts';

import { createLoginStage } from '@test-platform/stage-login';
import { getTakeoverEngine } from '@test-platform/stage-login';
import * as stageExplore from '@test-platform/stage-explore';
import * as stageFeature from '@test-platform/stage-feature';
import * as stageCase from '@test-platform/stage-case';
import * as stageExecute from '@test-platform/stage-execute';
import * as stageDefect from '@test-platform/stage-defect';
import { createAIClient, getDefault, type AIClient, type AIVendor } from '@test-platform/infra-ai';

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

  /**
   * 按功能点 featurePaths（来自功能点阶段，根因解法）做 Playwright MCP 二次探索。
   * 仅导航「生成范围内」的功能点对应页面，提取真实元素供用例步骤生成。
   * - 相对路径（以 / 开头）若提供 baseUrl 则拼接为绝对地址；
   * - 任一 URL 探索失败仅告警跳过，不中断整体。
   */
  private async exploreByFeaturePaths(
    engine: McpEngine,
    featurePaths: Record<string, string> | undefined,
    featureTable: FeatureRow[][],
    selectedModuleIds: string[] | undefined,
    scope: 'all' | 'selected_modules',
    baseUrl?: string,
  ): Promise<ExploredElement[]> {
    if (!featurePaths) return [];
    const FC = DEFAULT_FEATURE_COLUMNS;
    const scopeAll = scope === 'all' || !selectedModuleIds || selectedModuleIds.length === 0;

    // 计算生成范围内的测试点标识集合
    const inScopeIds = new Set<string>();
    for (const r of featureTable.flat()) {
      const id = r[FC.testPointId] ?? '';
      if (!id) continue;
      if (scopeAll) {
        inScopeIds.add(id);
        continue;
      }
      const sub = r[FC.subModule];
      const main = r[FC.mainModule];
      if (selectedModuleIds!.includes(sub) || selectedModuleIds!.includes(main)) inScopeIds.add(id);
    }

    const norm = (u: string): string => {
      if (/^https?:\/\//i.test(u)) return u;
      if (u.startsWith('/') && baseUrl) return baseUrl.replace(/\/$/, '') + u;
      return u;
    };

    const hostOf = (u: string): string | null => {
      try {
        return new URL(u).host;
      } catch {
        return null;
      }
    };

    // 分离真实 URL 与「点击定位符」（SPA 未换 URL 的兜底；探索阶段编码为 click:<selector>）
    const raw = [
      ...new Set([...inScopeIds].map((id) => featurePaths[id]).filter((u): u is string => !!u)),
    ];
    const clickLocators = raw.filter((u) => u.startsWith('click:')).map((u) => u.slice('click:'.length));
    const candidateUrls = raw
      .filter((u) => !u.startsWith('click:'))
      .map(norm)
      .filter((u) => /^https?:\/\//i.test(u));

    // 系统域名判定：优先 baseUrl 的 host；否则取候选 URL 中出现最多的 host。
    // 目的：剔除「若依官网」这类外链（如 http://ruoyi.vip），避免 case 二次探索导航到 bogus 地址挂死（M6）。
    // 注意：点击定位符（click:）同源 SPA 菜单常驻，不走域名过滤，直接计入。
    let systemHost = baseUrl ? hostOf(baseUrl) : null;
    if (!systemHost) {
      const hostCounts = new Map<string, number>();
      for (const u of candidateUrls) {
        const h = hostOf(u);
        if (h) hostCounts.set(h, (hostCounts.get(h) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestN = 0;
      for (const [h, n] of hostCounts) {
        if (n > bestN) {
          bestN = n;
          best = h;
        }
      }
      systemHost = best;
    }

    const urls = [
      ...new Set(
        candidateUrls.filter((u) => {
          if (!systemHost) return true; // 无法判定域名时不过滤，保持旧行为
          return hostOf(u) === systemHost;
        }),
      ),
    ].slice(0, 10);

    const locators = clickLocators.slice(0, 10);

    // 点击定位符需先回到系统首页（提供 baseUrl 时），确保菜单常驻可点
    if (locators.length > 0 && baseUrl) {
      try {
        await engine.navigate(baseUrl);
      } catch {
        /* 导航失败忽略，交由下方点击兜底 */
      }
    }

    if (urls.length === 0 && locators.length === 0) return [];
    const all: ExploredElement[] = [];

    // 真实 URL：导航到对应页面后抓元素
    for (const url of urls) {
      try {
        // 单 URL 超时兜底：导航到慢/挂死页面（如外链）最多 15s，避免整条 case 链卡死
        const els = await Promise.race([
          engine.extractPageElements(url), // 内部会 navigate(url)
          new Promise<ExploredElement[]>((_, reject) =>
            setTimeout(() => reject(new Error(`navigation timeout after 15s`)), 15000),
          ),
        ]);
        all.push(...els);
      } catch (e) {
        this.logger.warn('orchestrator', `case secondary exploration failed for ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 点击定位符：按功能点精确重开对应页面（SPA 未换 URL 的兜底），再抓当前页元素
    for (const sel of locators) {
      try {
        const els = await Promise.race([
          (async () => {
            await engine.runStep({ kind: 'click', selector: sel });
            await engine.waitForTimeout(600);
            return engine.extractPageElements(); // 抓已打开的当前页
          })(),
          new Promise<ExploredElement[]>((_, reject) =>
            setTimeout(() => reject(new Error(`click-locator timeout after 15s`)), 15000),
          ),
        ]);
        all.push(...els);
      } catch (e) {
        this.logger.warn('orchestrator', `case secondary exploration (click locator) failed for ${sel}: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.logger.info('orchestrator', `case secondary exploration: ${all.length} elements from ${urls.length} urls + ${locators.length} click-locators`);
    return all;
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
  ): Promise<ExploredElement[]> {
    const FC = DEFAULT_FEATURE_COLUMNS;
    const DANGEROUS = /退出|注销|登出|logout|sign\s?out|清空|重置|修改密码|解绑|删除/i;
    const names: string[] = [];
    const seen = new Set<string>();
    for (const r of featureTable.flat()) {
      for (const col of [FC.featureName, FC.testPoint]) {
        const t = (r[col] ?? '').trim();
        if (!t || t.length < 2 || t.length > 40 || DANGEROUS.test(t) || seen.has(t)) continue;
        seen.add(t);
        names.push(t);
      }
    }
    if (names.length === 0) return [];

    // 名称越长越精确，优先点击；避免同名重复点击（matched 已点 selector 去重）
    const sorted = names.slice().sort((a, b) => b.length - a.length);
    const matchedSelectors = new Set<string>();
    const all: ExploredElement[] = [];

    for (const name of sorted) {
      try {
        // 回到系统首页确保菜单常驻可点
        if (baseUrl) {
          try {
            await engine.navigate(baseUrl);
          } catch {
            /* 忽略导航失败 */
          }
          await engine.waitForTimeout(500);
        }
        const dom = await engine.extractSemanticDom().catch(() => [] as SemanticNode[]);
        // 找与名称匹配的可交互节点（文本相等 > 包含；跳过已点击 selector）
        let target: SemanticNode | undefined;
        const walk = (nodes: SemanticNode[]): void => {
          for (const n of nodes) {
            if (target) return;
            const text = (n.text || n.name || '').trim();
            if (n.interactive && text && !DANGEROUS.test(text) && !matchedSelectors.has(n.selector)) {
              if (text === name || text.includes(name) || name.includes(text)) {
                target = n;
                return;
              }
            }
            if (n.children.length > 0) walk(n.children);
          }
        };
        walk(dom);
        if (!target) continue;
        matchedSelectors.add(target.selector);
        await engine.runStep({ kind: 'click', selector: target.selector });
        await engine.waitForTimeout(700);
        const els = await engine.extractPageElements();
        all.push(...els);
        this.logger.info('orchestrator', `case: click-by-name "${name}" -> ${els.length} elements`);
      } catch (e) {
        this.logger.warn('orchestrator', `case: click-by-name failed for "${name}": ${e instanceof Error ? e.message : e}`);
      }
    }
    this.logger.info('orchestrator', `case fallback by feature names: ${all.length} elements from ${names.length} names`);
    return all;
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
      };
      const featureOutput = await stageFeature.run(featureInput);
      this.logger.info('orchestrator', `[3/6] feature finished: rows=${featureOutput.featureTable.length}`);

      // 4. Case
      this.logger.info('orchestrator', '[4/6] case started');

      // === 二次探索：按功能点 featurePaths（来自功能点阶段，根因解法）提取真实页面元素 ===
      let exploredElements: ExploredElement[] = [];
      try {
        const scope = input.case?.scope ?? 'all';
        const selectedModuleIds = input.case?.selectedModuleIds;
        exploredElements = await this.exploreByFeaturePaths(
          engine,
          featureOutput.featurePaths,
          featureOutput.featureTable,
          selectedModuleIds,
          scope,
          input.login.systemUrl,
        );
      } catch (e) {
        this.logger.warn('orchestrator', `case secondary exploration failed: ${e instanceof Error ? e.message : e}`);
      }

      const caseInput: CaseInput = {
        featureTable: featureOutput.featureTable,
        scope: input.case?.scope ?? 'all',
        selectedModuleIds: input.case?.selectedModuleIds,
        featurePaths: featureOutput.featurePaths,
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
        exploredElements: exploredElements.length > 0 ? exploredElements : undefined,
      };
      // AI 双模：enabled 时注入默认 AI 客户端；否则模板生成
      const caseAiEnabled = input.case?.aiConfig?.enabled === true;
      if (caseAiEnabled) {
        try {
          const cfg = getDefault();
          if (cfg) stageCase.setAIClient(createAIClient(cfg));
        } catch {
          /* 无默认 provider → 模板兜底 */
        }
      }
      const caseOutput = await stageCase.run(caseInput);
      stageCase.setAIClient(null); // 复位，避免跨调用泄漏
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
      await this.store.saveFeatureTable(input.login.systemId, featureOutput.featureTable);
      await this.store.saveCaseTable(input.login.systemId, caseOutput.caseWorkbook);
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

        // AI 双模：enabled 时注入默认 AI 客户端；否则模板生成
        const aiEnabled = rawInput.aiConfig?.enabled === true;
        if (aiEnabled) {
          try {
            const cfg = getDefault();
            if (cfg) stageCase.setAIClient(createAIClient(cfg));
          } catch {
            /* 无默认 provider → 模板兜底 */
          }
        }

        // 二次探索（Playwright MCP）：无 exploredElements 时，按 featurePaths 探索选中模块；
        // featurePaths 缺失/无效时，重跑探索重建 featurePaths，仍失败则按功能点名称在页面找对应功能。
        // 绝不静默模板直出 —— 模板生成必须有明确告警（bug-fixing: 根因=探索未产 url，不能靠用例阶段掩盖）。
        const systemId: string | undefined = rawInput.systemId ?? rawInput.sessionHandle?.systemId;
        let exploredElements: ExploredElement[] = rawInput.exploredElements ?? [];
        const hasUsablePaths = !!featurePaths && Object.values(featurePaths).some((u) =>
          /^https?:\/\//i.test(u) || u.startsWith('/') || u.startsWith('click:'),
        );
        if (exploredElements.length === 0 && (hasUsablePaths || featureTable.flat().length > 0)) {
          try {
            // 优先复用登录浏览器（会话随浏览器存活），否则新建引擎并恢复持久化 storageState。
            // 旧实现无条件新建未登录浏览器，导航到真实系统会撞登录页、抽不到真实元素。
            const takeoverEngine = systemId ? getTakeoverEngine(systemId) : undefined;
            const storedState = systemId && !takeoverEngine ? await this.store.getStorageState(systemId) : null;
            const engineConfig: EngineConfig = {
              ...this.engineConfig,
              ...(storedState ? { storageState: storedState as PlaywrightStorageState } : {}),
            };
            const engine = takeoverEngine ?? this.engineFactory(engineConfig);
            if (!takeoverEngine) await engine.launch();
            try {
              if (hasUsablePaths) {
                exploredElements = await this.exploreByFeaturePaths(
                  engine, featurePaths, featureTable, selectedModuleIds, scope, systemUrl,
                );
              }

              // ② featurePaths 空/无效 → 重跑探索重建（降级路径现已带 url 兜底）
              if (exploredElements.length === 0) {
                this.logger.warn('orchestrator', `case: featurePaths 缺失或无效，重跑探索重建（systemId=${systemId ?? '?'}）`);
                const freshTree = await engine.exploreModules().catch((e) => {
                  this.logger.warn('orchestrator', `case: re-explore failed: ${e instanceof Error ? e.message : e}`);
                  return [];
                });
                if (freshTree.length > 0) {
                  const systemName = (rawInput.metaConfig as { systemName?: string } | undefined)?.systemName ?? systemId ?? 'system';
                  const fresh = await stageFeature.run({ moduleTree: freshTree, systemName, confirmedOnly: false });
                  const freshPaths = fresh.featurePaths ?? {};
                  const freshUsable = Object.values(freshPaths).some((u) =>
                    /^https?:\/\//i.test(u) || u.startsWith('/') || u.startsWith('click:'),
                  );
                  if (freshUsable) {
                    exploredElements = await this.exploreByFeaturePaths(
                      engine, freshPaths, fresh.featureTable.length ? fresh.featureTable : featureTable, selectedModuleIds, scope, systemUrl,
                    );
                  }
                }
              }

              // ③ 仍无有效定位 → 按功能点/测试点名称在页面找对应功能（用户明确要求）
              if (exploredElements.length === 0) {
                exploredElements = await this.exploreByFeatureNames(engine, featureTable, systemUrl);
              }
            } finally {
              // 复用登录浏览器不关闭（保持会话），新建引擎才关闭
              if (!takeoverEngine) await engine.close().catch(() => {});
            }
          } catch (e) {
            this.logger.warn('orchestrator', `case engine launch failed: ${e instanceof Error ? e.message : e}`);
          }
        }
        if (exploredElements.length === 0) {
          this.logger.warn('orchestrator', 'case: 无任何探索证据（url 缺失且按名称兜底失败），退化为模板生成，请检查探索阶段菜单识别');
        }

        const caseInput: CaseInput = {
          ...(input as CaseInput),
          featureTable,
          scope,
          selectedModuleIds,
          featurePaths,
          exploredElements: exploredElements.length > 0 ? exploredElements : undefined,
        };
        const output = await stageCase.run(caseInput);
        stageCase.setAIClient(null); // 复位，避免跨调用泄漏
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
