/**
 * @file featureEvidenceExplorer.ts
 * @description T4：按 featureId 隔离的只读页面证据采集器。
 *
 * 根因（问题②）：orchestrator 旧实现把所有功能点的 ExploredElement[] 扁平合并成一个数组，
 * 丢失了「元素属于哪个功能点」的归属，导致 stage-case 跨功能点串用元素。
 * 本模块改为「逐功能点独立采集 → 产出隔离的 FeatureEvidence」，从根上解决串用。
 *
 * 三重保护（只读红线）：
 *   1) 仅进入页面：导航 URL 或点击 SPA 定位符（click:）打开目标页；绝不 fill/submit/delete/import/export 等写操作；
 *   2) 危险操作拦截：clickSelector 命中写操作文本（提交/保存/删除…）直接跳过点击，不得伪装点击成功；
 *   3) 契约兜底：产出的 FeatureEvidence 经 FeatureEvidenceSchema 校验，失败一律置 needsReview（不得伪装覆盖）。
 */
import type { McpEngine } from '@test-platform/engine-mcp';
import type {
  ActionKind,
  ExploredElement,
  FeatureEvidence,
  FeatureProfile,
  FeatureRow,
  FieldSemantic,
  TableSemantic,
  UncoveredItem,
} from '@test-platform/contracts';
import { DEFAULT_FEATURE_COLUMNS, FeatureEvidenceSchema } from '@test-platform/contracts';

/** 日志器（结构类型，避免与具体 Logger 实现耦合；缺省静默） */
export interface EvidenceLogger {
  info: (channel: string, message: string) => void;
  warn: (channel: string, message: string) => void;
}

export interface FeatureEvidenceMapOptions {
  featurePaths: Record<string, string> | undefined;
  featureTable: FeatureRow[][];
  featureProfiles?: FeatureProfile[];
  selectedModuleIds?: string[];
  scope: 'all' | 'selected_modules';
  baseUrl?: string;
  /** 可选日志器（缺省静默） */
  logger?: EvidenceLogger;
  /** 单功能点探索超时（ms），透传给单点采集 */
  timeoutMs?: number;
  /** 采集预算，测试可注入较小值 */
  budget?: Partial<FeatureEvidenceBudget>;
  /** 仅对证据门未通过的功能点补采。 */
  featureIds?: Set<string>;
  /** 任务级身份，写入每个证据包，避免跨系统复用 */
  systemId?: string;
  featureRevision?: string;
  /** 跨路径页面导航策略：allow=直接导航到目标 URL（默认，保持兼容）；entry_only=仅同文档 hash 路由可导航，跨路径改由名称兜底从入口进入（复用登录会话、避免直接打开 URL 落在登录页） */
  crossPathNavigation?: 'entry_only' | 'allow';
}

/** 危险写操作文本（命中则禁止点击，避免只读探索误触提交/删除/导入等写操作） */
const DANGEROUS_CLICK = /提交|保存|新增|创建|删除|清空|重置|导入|导出|发布|上架|下架|审核|修改|编辑|send|publish|submit|delete|create|import|export|reset|update/i;
const UNSAFE_CLICK = /checkbox|radio|switch|toggle|icon(?:-only)?|row[-_ ]?action|inline[-_ ]?action/i;
const SAFE_READ_ONLY_OPENER = /aria-haspopup\s*=\s*['"]?dialog|data-(?:readonly|safe)-opener|role=link|(?:^|[\s>])a(?:[.#[:]|$)|#(?:open|detail|view|menu)[\w-]*$/i;
const DANGEROUS_URL_TOKENS = ['delete', 'remove', 'destroy', 'submit', 'approve', 'reject', 'publish', 'import', 'export', 'reset', 'clear', 'logout', 'signout'];
const SAFE_SAMPLE = /data-(?:safe|readonly)-sample/i;

export function isSafeReadOnlyOpener(selector: string): boolean {
  return !DANGEROUS_CLICK.test(selector) && !UNSAFE_CLICK.test(selector) && SAFE_READ_ONLY_OPENER.test(selector);
}

export function isSafeNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://test-platform.invalid');
    return !containsDangerousUrlToken(`${parsed.pathname} ${parsed.search} ${parsed.hash}`);
  } catch {
    return !containsDangerousUrlToken(url);
  }
}

/** Split separators and camelCase before comparison: /deleteUser and ?action=batchDelete are unsafe too. */
function containsDangerousUrlToken(value: string): boolean {
  const compact = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
  return DANGEROUS_URL_TOKENS.some((token) => compact.split(/\s+/).some((part) => part === token || part.startsWith(token)));
}

function isSafeActionOpener(actionKind: ActionKind, selector: string): boolean {
  if (UNSAFE_CLICK.test(selector)) return false;
  // 新增/详情/查看等「打开只读界面」动作：只要节点级安全判定通过即可点击（由 isSafeCurrentNode 保证）。
  // 修改（update）仍要求安全 opener 模式（data-safe-opener/aria-haspopup=dialog/a/#open 等），
  // 且必须有安全样例（由 triggerable 外层 (actionKind !== 'update' || !!sample) 保证）。
  if (actionKind === 'create' || actionKind === 'detail') return true;
  return isSafeReadOnlyOpener(selector);
}

type ElementReadOnlySemantics = ExploredElement & {
  role?: string;
  ariaHasPopup?: string;
  safeReadOnlyOpener?: boolean;
};

function findCurrentElement(
  elements: ExploredElement[],
  selector: string,
  text?: string,
): ElementReadOnlySemantics | undefined {
  const bySelector = elements.find((element) => element.selector === selector || element.ref === selector);
  if (bySelector) return bySelector as ElementReadOnlySemantics | undefined;
  // selector 失配（探索阶段生成的 selector 可能不可用）时，按功能点动作文本在当前页 DOM 中回退定位，
  // 保证「按路径点击」在真实按钮上执行而不是静默跳过。
  if (text?.trim()) {
    const norm = (v: string): string => v.replace(/\s+/g, '').toLowerCase();
    const target = norm(text);
    return elements.find((element) => {
      const t = norm(`${element.text ?? ''} ${element.label ?? ''}`);
      return t.includes(target) || target.includes(t);
    }) as ElementReadOnlySemantics | undefined;
  }
  return undefined;
}

function isSafeCurrentNode(element: ElementReadOnlySemantics | undefined, purpose: 'action' | 'sample' | 'container'): boolean {
  if (!element || !element.interactive || element.isFormControl || element.disabled || element.checked !== undefined || element.role === 'switch') return false;
  const tag = element.tag.toLowerCase();
  const type = (element.inputType ?? '').toLowerCase();
  const text = `${element.text ?? ''} ${element.label ?? ''}`.trim();
  if (!text || ['input', 'select', 'textarea', 'option'].includes(tag) || ['checkbox', 'radio', 'file', 'submit'].includes(type)) return false;
  const identity = `${element.selector} ${element.ref} ${text}`;
  // “新增/修改”可能是只读弹窗 opener；提交、保存、删除及传输/审批始终不可点。
  const hardDangerous = /提交|保存|删除|移除|导入|导出|发布|审核|approve|reject|submit|save|delete|remove|import|export|publish/i;
  if (hardDangerous.test(identity) || UNSAFE_CLICK.test(identity)) return false;
  if (purpose === 'container') return element.containers?.some((container) => (container.kind === 'tab' || container.kind === 'collapse') && container.selector === element.selector) === true;
  if (purpose === 'sample') return SAFE_SAMPLE.test(identity);
  // 打开只读界面的语义按钮（新增/添加/创建/新建/详情/查看/打开/录入）：
  // 不含提交/保存/删除/导入/导出/审核等硬危险词即可作为安全打开入口。
  const openerIntent = /新增|添加|创建|新建|详情|查看|打开|录入|create|add|detail|view|open/i;
  return (tag === 'a' && !!element.href && isSafeNavigationUrl(element.href))
    || element.role === 'link'
    || element.ariaHasPopup === 'dialog'
    || element.safeReadOnlyOpener === true
    || (openerIntent.test(text) && !hardDangerous.test(identity));
}

export interface FeatureEvidenceBudget {
  maxStates: number;
  maxSemanticNodes: number;
  maxVirtualScrollSteps: number;
  timeoutMs: number;
}

export const DEFAULT_FEATURE_EVIDENCE_BUDGET: FeatureEvidenceBudget = {
  maxStates: 50,
  maxSemanticNodes: 5000,
  maxVirtualScrollSteps: 100,
  timeoutMs: 60_000,
};

export interface FeatureEvidenceOptions {
  /** 测试点标识（base_NN） */
  featureId: string;
  systemId?: string;
  featureRevision?: string;
  /** 名称兜底已点击进入目标动作页时的初始状态 */
  initialState?: FeatureEvidence['states'][number];
  /** 动作身份（探索阶段透传；缺省 other） */
  actionKind?: ActionKind;
  /** 真实页面 URL（导航进入） */
  url?: string;
  /** SPA 点击定位符（click: 之后的 selector），仅用于打开页面 */
  clickSelector?: string;
  /** 功能点自身的安全状态入口（在 base 页面采集后才使用） */
  actionSelector?: string;
  /** 原始入口文本，仅作为证据记录，不参与点击判断 */
  actionText?: string;
  /** 来源页 URL（用于证据记录） */
  pageUrl?: string;
  /** 当前功能点的稳定页面入口，用于证据身份校验 */
  pageEntry?: string;
  /** 单功能点探索超时（ms） */
  timeoutMs?: number;
  /** 采集预算，默认使用 DEFAULT_FEATURE_EVIDENCE_BUDGET */
  budget?: Partial<FeatureEvidenceBudget>;
}

export interface FeatureEvidenceResult {
  evidence: FeatureEvidence;
  /** 原始抽取元素（保持完整，供 stage-case 旧路径消费；T6 迁移到 evidence 后可弃） */
  raw: ExploredElement[];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

/** 从 fields/tables 派生确定性覆盖键（T6 动作矩阵将消费 coverageKeys 做质量门） */
function deriveCoverageKeys(
  fields: FieldSemantic[],
  tables: TableSemantic[],
  actionKind: ActionKind,
  states: FeatureEvidence['states'],
  actionEntries: FeatureEvidence['actionEntries'],
): string[] {
  const keys = new Set<string>();
  if (actionKind === 'list') {
    for (const table of tables) {
      keys.add('list.display');
      if (table.columns.length) keys.add('list.headers');
      if (table.hasPagination) keys.add('list.pagination');
      if (table.hasSorting || table.sortableColumns?.length) keys.add('list.sort');
      for (const column of table.columns) keys.add(`list.column.${column}`);
      for (const column of table.sortableColumns ?? []) keys.add(`list.sort.${column}`);
    }
  }
  if (actionKind === 'query' || actionKind === 'reset') {
    for (const field of fields) keys.add(`query.field.${field.name || field.ref}`);
  }
  if ((actionKind === 'create' || actionKind === 'update') && states.includes(actionKind)) {
    keys.add(`${actionKind}.ready`);
    for (const field of fields) {
      const name = field.name || field.ref;
      if (field.required) { keys.add(`${actionKind}.required`); keys.add(`${actionKind}.required.${name}`); }
      if (field.pattern) { keys.add(`${actionKind}.format`); keys.add(`${actionKind}.pattern.${name}`); }
      if (field.minLength !== undefined || field.maxLength !== undefined) { keys.add(`${actionKind}.length`); keys.add(`${actionKind}.length.${name}`); }
      if (field.minimum !== undefined || field.maximum !== undefined) { keys.add(`${actionKind}.range`); keys.add(`${actionKind}.range.${name}`); }
      if (field.options?.length) { keys.add(`${actionKind}.enum`); keys.add(`${actionKind}.enum.${name}`); }
      if (actionKind === 'update' && field.readonly) { keys.add('update.readonly'); keys.add(`update.readonly.${name}`); }
    }
  }
  for (const entry of actionEntries) {
    if (!entry.observed) continue;
    if (entry.actionKind === 'delete') keys.add('delete.entry');
    if (entry.actionKind === 'batch_delete') keys.add('batch_delete.entry');
    if (entry.actionKind === 'import') keys.add('import.entry');
    if (entry.actionKind === 'export') keys.add('export.entry');
  }
  return [...keys];
}

function snapshotFingerprint(elements: ExploredElement[]): string {
  return elements
    .map((element) => `${element.selector}|${element.text ?? ''}|${element.label ?? ''}|${element.containers?.map((container) => `${container.kind}:${container.expanded}`).join(',') ?? ''}`)
    .sort()
    .join('\n');
}

function addUncovered(uncovered: UncoveredItem[], item: UncoveredItem): void {
  if (!uncovered.some((existing) => existing.kind === item.kind && existing.reason === item.reason)) uncovered.push(item);
}

async function currentUrl(engine: McpEngine): Promise<string | undefined> {
  try {
    return (await engine.getCurrentUrl()) || undefined;
  } catch {
    return undefined;
  }
}

/** 登录页 URL 判定（token 级匹配，避免误伤含 auth 的业务路径） */
function isLoginPageUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const segs = ((url.pathname || '') + '#' + (url.hash || '')).split(/[/#?&._-]+/);
    return segs.some((seg) => ['login', 'signin', 'sso', 'logon'].includes(seg.toLowerCase()));
  } catch {
    return false;
  }
}

/** 同文档判定：同 origin+pathname+search（仅 hash 可能不同）。SPA hash 路由切换不重载、会话安全。 */
function sameDocUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return false;
  }
}

function isExpectedPostClickUrl(before: string | undefined, after: string, allowSafePathChange = false): boolean {
  if (!isSafeNavigationUrl(after)) return false;
  if (!before) return true;
  try {
    const previous = new URL(before);
    const next = new URL(after);
    return previous.origin === next.origin && (allowSafePathChange || previous.pathname === next.pathname);
  } catch {
    return before === after;
  }
}

async function restoreBase(engine: McpEngine, baseUrl: string | undefined): Promise<void> {
  if (!baseUrl || !isSafeNavigationUrl(baseUrl)) return;
  const cur = await currentUrl(engine);
  if (cur && sameDocUrl(baseUrl, cur)) {
    // 同文档（SPA hash 路由）：仅切换 hash，避免整页 reload（首页无限刷新根因之一）
    try {
      const target = new URL(baseUrl);
      const current = new URL(cur);
      if (current.hash !== target.hash && typeof engine.evaluate === 'function') {
        await engine.evaluate('((hash) => { try { window.location.hash = hash; } catch (e) {} })', target.hash);
        await engine.waitForTimeout(300);
      }
      return;
    } catch {
      /* 回退到 navigate */
    }
  }
  await engine.navigate(baseUrl);
}

async function restoreAndVerifyBase(engine: McpEngine, baseUrl: string | undefined, uncovered: UncoveredItem[]): Promise<void> {
  await restoreBase(engine, baseUrl);
  if (!baseUrl) return;
  const restored = await currentUrl(engine);
  if (!restored || !isExpectedPostClickUrl(baseUrl, restored)) {
    addUncovered(uncovered, { kind: 'write_required_state', reason: '只读状态采集后未能验证恢复到 base URL' });
  }
}

/** fail-safe：任何异常都返回 needsReview 证据，绝不抛出、绝不伪装覆盖 */
function needsReviewEvidence(
  opts: FeatureEvidenceOptions,
  reason: string,
  partial?: Partial<FeatureEvidence>,
): FeatureEvidenceResult {
  const base: FeatureEvidence = {
    featureId: opts.featureId,
    actionKind: opts.actionKind ?? 'other',
    ...(opts.systemId ? { systemId: opts.systemId } : {}),
    ...(opts.featureRevision ? { featureRevision: opts.featureRevision } : {}),
    pageUrl: opts.pageUrl ?? opts.url,
    ...(opts.pageEntry ? { pageEntry: opts.pageEntry } : {}),
    states: [],
    fields: [],
    tables: [],
    actionEntries: [],
    containers: [],
    evidenceLevel: 'needs_review',
    coverageKeys: [],
    needsReview: true,
    reviewReason: reason,
    uncovered: [],
  };
  return { evidence: { ...base, ...partial }, raw: [] };
}

/**
 * 对单个功能点做只读证据采集，返回隔离的 FeatureEvidence（含原始元素）。
 * 失败一律 fail-safe：返回 needsReview 证据，绝不抛出。
 */
export async function exploreFeatureEvidence(engine: McpEngine, opts: FeatureEvidenceOptions): Promise<FeatureEvidenceResult> {
  const budget = { ...DEFAULT_FEATURE_EVIDENCE_BUDGET, ...opts.budget };
  const timeout = opts.timeoutMs ?? budget.timeoutMs;
  const deadline = Date.now() + timeout;
  const timed = <T>(operation: Promise<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    return remaining > 0 ? withTimeout(operation, remaining) : Promise.reject(new Error(`timeout after ${timeout}ms`));
  };
  try {
    // ① 进入目标页（只读进入，不写）
    if (opts.url) {
      if (!isSafeNavigationUrl(opts.url)) {
        return needsReviewEvidence(opts, `危险导航 URL，跳过访问以防触发写操作: ${opts.url}`);
      }
      await timed(engine.navigate(opts.url));
      // SPA 页面导航后需等待渲染稳定（RuoYi 等重后台需 3-5s），否则表格/表单还未挂载、采到空页面
      await timed(engine.waitForTimeout(3000));
      // 通用：导航后验证是否落在登录页（会话失效）。不伪造证据、不反复自动登录。
      const afterNav = await currentUrl(engine);
      if (afterNav && isLoginPageUrl(afterNav) && !isLoginPageUrl(opts.url)) {
        return needsReviewEvidence(opts, `登录会话失效（${opts.url} 导航后落在登录页 ${afterNav}），请重新登录/人工接管后重试；未反复自动登录`);
      }
    } else if (opts.clickSelector) {
      const currentElements = await timed(engine.extractPageElements());
      if (!isSafeReadOnlyOpener(opts.clickSelector) || !isSafeCurrentNode(findCurrentElement(currentElements, opts.clickSelector), 'action')) {
        return needsReviewEvidence(opts, `clickSelector 未匹配当前安全语义节点，跳过点击以防误触: ${opts.clickSelector}`);
      }
      if (!engine.runReadOnlyClick) return needsReviewEvidence(opts, '引擎未提供只读点击能力，MCP/未知引擎不会执行点击');
      const result = await timed(engine.runReadOnlyClick(opts.clickSelector, 'action'));
      if (result.status !== 'performed') return needsReviewEvidence(opts, `只读点击未执行: ${result.reason ?? result.status}`);
      await timed(engine.waitForTimeout(600));
    }

    // ② 有界状态采集：base + 一个安全动作状态 + 至多两个 Tab/折叠状态。
    const fields: FieldSemantic[] = [];
    const tables: TableSemantic[] = [];
    const containers = [] as FeatureEvidence['containers'];
    const uncovered: UncoveredItem[] = [];
    const actionKind = opts.actionKind ?? 'other';
    const states: FeatureEvidence['states'] = [];
    const actionEntries: FeatureEvidence['actionEntries'] = [];
    const fingerprints = new Set<string>();
    const raw: ExploredElement[] = [];
    const appendSnapshot = (state: FeatureEvidence['states'][number], elements: ExploredElement[]): boolean => {
      const fingerprint = snapshotFingerprint(elements);
      if (fingerprints.has(fingerprint)) return false;
      if (states.length >= budget.maxStates) {
        addUncovered(uncovered, { kind: 'budget_exceeded', reason: `状态采集达到上限 ${budget.maxStates}` });
        return false;
      }
      const remainingNodes = budget.maxSemanticNodes - raw.length;
      if (remainingNodes <= 0) {
        addUncovered(uncovered, { kind: 'budget_exceeded', reason: `语义节点采集达到上限 ${budget.maxSemanticNodes}` });
        return false;
      }
      fingerprints.add(fingerprint);
      const snapshot = elements.slice(0, remainingNodes);
      raw.push(...snapshot);
      states.push(state);
      if (snapshot.length < elements.length) addUncovered(uncovered, { kind: 'budget_exceeded', reason: `语义节点采集达到上限 ${budget.maxSemanticNodes}` });
      for (const element of snapshot) {
        containers.push(...(element.containers ?? []));
        for (const item of element.uncovered ?? []) addUncovered(uncovered, item);
        if (element.isFormControl) {
          fields.push({
            ref: element.ref,
            selector: element.selector,
            name: element.label ?? element.text ?? '',
            inputType: element.inputType,
            required: element.required,
            readonly: element.readonly,
            disabled: element.disabled,
            minLength: element.minLength,
            maxLength: element.maxLength,
            minimum: element.minimum,
            maximum: element.maximum,
            pattern: element.pattern,
            options: element.options,
            multiple: element.multiple,
          });
        } else if (element.tableInfo) {
          tables.push({
            ref: element.ref,
            selector: element.selector,
            columns: element.tableInfo.columns,
            rowCount: element.tableInfo.rowCount,
            hasPagination: element.tableInfo.hasPagination,
            paginationInfo: element.tableInfo.paginationInfo,
            hasSorting: element.tableInfo.hasSorting,
            sortableColumns: element.tableInfo.sortableColumns,
            hasFilter: element.tableInfo.hasFilter,
            filterFields: element.tableInfo.filterFields,
            hasEmptyState: false,
            isVirtualList: element.tableInfo.isVirtualList,
          });
        }
      }
      return true;
    };

    const baseElements = await timed(engine.extractPageElements());
    appendSnapshot(opts.initialState ?? 'base', baseElements);
    const baseUrl = opts.url ?? await currentUrl(engine);
    const clickAndCheck = async (selector: string, purpose: 'action' | 'sample' | 'container', currentElements: ExploredElement[], allowSafePathChange = false): Promise<boolean> => {
      const node = purpose === 'action'
        ? findCurrentElement(currentElements, selector, opts.actionText)
        : findCurrentElement(currentElements, selector);
      if (!isSafeCurrentNode(node, purpose)) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: `selector 未匹配当前 ${purpose} 安全语义节点，未点击: ${selector}` });
        return false;
      }
      if (!engine.runReadOnlyClick) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: '引擎未提供可拦截网络和下载的只读点击能力，未点击' });
        return false;
      }
      const effectiveSelector = node?.selector || node?.ref || selector;
      const before = await currentUrl(engine);
      // selector 可能不精确（匹配多个节点）导致 runReadOnlyClick 拒绝：先试节点 selector，
      // 失败时用 Playwright 原生 `tag:has-text("动作文本")` 精确定位重试（allow_all 策略下按钮可点）。
      let result = await timed(engine.runReadOnlyClick(effectiveSelector, purpose));
      if (result.status !== 'performed' && purpose === 'action' && opts.actionText?.trim() && node?.tag) {
        const escaped = opts.actionText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        result = await timed(engine.runReadOnlyClick(`${node.tag}:has-text("${escaped}")`, purpose));
      }
      if (result.status !== 'performed') {
        addUncovered(uncovered, { kind: 'write_required_state', reason: `只读点击被阻止或不支持: ${result.reason ?? result.status}` });
        await restoreBase(engine, baseUrl);
        return false;
      }
      await timed(engine.waitForTimeout(300));
      const after = await currentUrl(engine);
      if (!after) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: '点击后的 URL/下载/网络副作用观察能力不可用' });
        await restoreBase(engine, baseUrl);
        return false;
      }
      if (!isExpectedPostClickUrl(before ?? baseUrl, after, allowSafePathChange)) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: `安全点击后出现危险或非预期 URL，已停止采集: ${after}` });
        await restoreBase(engine, baseUrl);
        return false;
      }
      return true;
    };

    if (opts.actionSelector) {
      const state = actionKind === 'create' || actionKind === 'detail' || actionKind === 'update' ? actionKind : undefined;
      const actionNode = findCurrentElement(baseElements, opts.actionSelector, opts.actionText);
      const sample = actionKind === 'update'
        ? baseElements.find((element) => isSafeCurrentNode(element as ElementReadOnlySemantics, 'sample'))
        : undefined;
      const triggerable = !!state && isSafeActionOpener(actionKind, opts.actionSelector) && isSafeCurrentNode(actionNode, 'action') && (actionKind !== 'update' || !!sample);
      const observed = !!actionNode && actionNode.interactive && !actionNode.isFormControl;
      actionEntries.push({ actionKind, ref: opts.actionSelector, selector: opts.actionSelector, text: opts.actionText, triggerable, observed });
      if (triggerable && state) {
        const sampleSelected = actionKind !== 'update' || await clickAndCheck(sample!.selector, 'sample', baseElements);
        if (sampleSelected && await clickAndCheck(opts.actionSelector, 'action', baseElements, true)) {
          try {
            appendSnapshot(state, await timed(engine.extractPageElements()));
          } finally {
            await restoreAndVerifyBase(engine, baseUrl, uncovered);
          }
        }
      } else if (actionKind === 'update') {
        addUncovered(uncovered, { kind: 'no_safe_sample', reason: '修改功能缺少明确安全样例 data-safe-sample/data-readonly-sample 选择器或独立安全入口，未点击任意行操作' });
      } else if (state) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: observed ? `${state} 入口不是允许的只读打开入口` : `${state} 入口 selector 未匹配当前页面节点，未采集状态` });
      }
    }

    const queuedContainers = baseElements.flatMap((element) => element.containers ?? []);
    const visitedContainers = new Set<string>();
    for (let index = 0; index < queuedContainers.length; index++) {
      const container = queuedContainers[index];
      if (visitedContainers.has(container.selector) || !(container.kind === 'tab' || container.kind === 'collapse') || container.expanded !== false) continue;
      visitedContainers.add(container.selector);
      if (DANGEROUS_CLICK.test(container.selector) || UNSAFE_CLICK.test(container.selector)) continue;
      if (states.length >= budget.maxStates) {
        addUncovered(uncovered, { kind: 'budget_exceeded', reason: `状态采集达到上限 ${budget.maxStates}` });
        break;
      }
      const containerNode = findCurrentElement(baseElements, container.selector);
      if (!await clickAndCheck(container.selector, 'container', baseElements)) break;
      try {
        const snapshot = await timed(engine.extractPageElements());
        appendSnapshot('views', snapshot);
        for (const element of snapshot) queuedContainers.push(...(element.containers ?? []));
      } finally {
        // Tab/折叠只恢复自身原状态；不会触碰保存、提交或任意行内操作。
        if (containerNode && engine.runReadOnlyClick) {
          const restored = await timed(engine.runReadOnlyClick(container.selector, 'container'));
          if (restored.status !== 'performed') addUncovered(uncovered, { kind: 'write_required_state', reason: `容器状态无法安全恢复: ${restored.reason ?? restored.status}` });
        }
      }
    }

    const virtualSelectors = raw
      .filter((element) => element.tableInfo?.isVirtualList || element.containers?.some((container) => container.kind === 'virtual_list'))
      .map((element) => element.tableInfo?.isVirtualList ? element.selector : element.containers?.find((container) => container.kind === 'virtual_list')?.selector)
      .filter((selector): selector is string => !!selector);
    for (const selector of new Set(virtualSelectors)) {
      let stable = false;
      for (let step = 0; step < budget.maxVirtualScrollSteps; step++) {
        try {
          const moved = await timed(engine.evaluate<boolean>(
            '(target) => { const element = document.querySelector(target); if (!element) return false; const previous = element.scrollTop; element.scrollTop += Math.max(element.clientHeight, 1); return element.scrollTop !== previous; }',
            selector,
          ));
          if (!moved) {
            stable = true;
            break;
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          addUncovered(uncovered, /timeout/i.test(reason)
            ? { kind: 'budget_exceeded', reason: `虚拟列表采集超时: ${reason}` }
            : { kind: 'write_required_state', reason: `虚拟列表 ${selector} 的安全滚动/副作用观察能力不可用` });
          stable = true;
          break;
        }
        await timed(engine.waitForTimeout(150));
        if (!appendSnapshot('views', await timed(engine.extractPageElements()))) {
          stable = true;
          break;
        }
      }
      if (!stable) addUncovered(uncovered, { kind: 'budget_exceeded', reason: `虚拟列表滚动达到上限 ${budget.maxVirtualScrollSteps}` });
    }

    const coverageKeys = deriveCoverageKeys(fields, tables, actionKind, states, actionEntries);
    const uniqueContainers = containers.filter((container, index, all) => all.findIndex((item) => item.kind === container.kind && item.selector === container.selector) === index);
    const uniqueUncovered = uncovered.filter((item, index, all) => all.findIndex((other) => other.kind === item.kind && other.reason === item.reason) === index);
    const observed = fields.length > 0 || tables.length > 0 || uniqueContainers.length > 0;
    const needsReview = uniqueUncovered.length > 0;

    const evidence: FeatureEvidence = {
      featureId: opts.featureId,
      actionKind,
      ...(opts.systemId ? { systemId: opts.systemId } : {}),
      ...(opts.featureRevision ? { featureRevision: opts.featureRevision } : {}),
      pageUrl: opts.pageUrl ?? opts.url,
      ...(opts.pageEntry ? { pageEntry: opts.pageEntry } : {}),
      states,
      fields,
      tables,
      actionEntries,
      containers: uniqueContainers,
      evidenceLevel: needsReview ? 'needs_review' : observed ? 'observed' : 'derived',
      coverageKeys,
      needsReview,
      ...(needsReview ? { reviewReason: uniqueUncovered.map((item) => item.reason).join('; ') } : {}),
      uncovered: uniqueUncovered,
    };

    // ④ 三重保护：契约校验，失败置 needsReview（不得伪装覆盖）
    const parsed = FeatureEvidenceSchema.safeParse(evidence);
    if (!parsed.success) {
      return needsReviewEvidence(opts, `FeatureEvidence 契约校验失败: ${parsed.error.message}`, {
        ...evidence,
        evidenceLevel: 'needs_review',
        needsReview: true,
      });
    }
    return { evidence: parsed.data, raw };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const reason = `功能点证据采集异常: ${detail}`;
    return needsReviewEvidence(opts, reason, /timeout/i.test(detail) ? { uncovered: [{ kind: 'timeout', reason }] } : undefined);
  }
}

/**
 * T4：按 featureId 隔离的页面证据采集（替代旧 exploreByFeaturePaths 的全局合并）。
 * 逐功能点独立抽取 → Record<featureId, FeatureEvidence>（隔离，杜绝跨功能点串用）；
 * 同时返回扁平 elements 供 stage-case 旧路径消费（T6 迁移到 evidence 后可弃）。
 * - 保留 click: SPA 定位符路径（点击打开菜单常驻页）；
 * - 外链（非系统域名）跳过，避免导航到 bogus 地址挂死；
 * - 任一功能点失败仅告警跳过，不中断整体。
 */
export async function exploreFeatureEvidenceMap(
  engine: McpEngine,
  opts: FeatureEvidenceMapOptions,
): Promise<{ evidence: Record<string, FeatureEvidence>; elements: ExploredElement[] }> {
  const { featurePaths, featureTable, featureProfiles, selectedModuleIds, scope, baseUrl, logger, timeoutMs, budget, featureIds, systemId, featureRevision, crossPathNavigation = 'allow' } = opts;
  const evidence: Record<string, FeatureEvidence> = {};
  const elements: ExploredElement[] = [];
  const log = logger ?? { info: () => {}, warn: () => {} };
  if (!featurePaths && !(featureProfiles ?? []).some((profile) => profile.pageUrl || profile.sourceSelector || profile.clickSelector)) {
    return { evidence, elements };
  }

  const FC = DEFAULT_FEATURE_COLUMNS;
  const profilesById = new Map((featureProfiles ?? []).map((profile) => [profile.featureId, profile]));
  const scopeAll = scope === 'all' || !selectedModuleIds || selectedModuleIds.length === 0;

  // 计算生成范围内的测试点标识集合
  // 约定：featureTable 形态为 [[...行]]（外层再包一层），与 exploreByFeatureNames / stageCase 一致，用 .flat() 取行
  const inScopeIds = new Set<string>();
  for (const r of featureTable.flat()) {
    const id = r[FC.testPointId] ?? '';
    if (!id) continue;
    if (featureIds && !featureIds.has(id)) continue;
    const profile = profilesById.get(id);
    if (profile?.source && profile.source !== 'web') continue;
    if (!profile?.source && profile?.sourceSelector?.startsWith('design:')) continue;
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
    if (baseUrl) {
      if (u.startsWith('/')) {
        // 相对路径必须用 baseUrl 的 origin 拼接：capturedUrl 可能是 /index 等子路径，
        // 直接用 baseUrl 全串会把子路径误当前缀（如 /index + /system/user = /index/system/user）。
        try {
          return new URL(u, new URL(baseUrl).origin).href;
        } catch {
          return baseUrl.replace(/\/$/, '') + u;
        }
      }
      // 纯 hash 定位符（#/a/b）同文档切换，用 baseUrl 补全
      if (u.startsWith('#')) return baseUrl.replace(/\/$/, '') + u;
    }
    return u;
  };
  const hostOf = (u: string): string | null => {
    try {
      return new URL(u).host;
    } catch {
      return null;
    }
  };
  /** 同文档判定：同 origin+pathname+search（仅 hash 可能不同）。SPA hash 路由切换不重载、会话安全，可安全导航；跨路径页面不直接打开。 */
  const isSameDocUrl = (a: string, b: string): boolean => {
    try {
      const ua = new URL(a);
      const ub = new URL(b);
      return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search;
    } catch {
      return false;
    }
  };

  // 系统域名判定：优先 baseUrl 的 host；否则取候选 URL 中出现最多的 host（剔除外链）。
  let systemHost = baseUrl ? hostOf(baseUrl) : null;
  if (!systemHost) {
    const hostCounts = new Map<string, number>();
    for (const id of inScopeIds) {
      const u = featurePaths?.[id] ?? profilesById.get(id)?.pageUrl;
      if (!u || u.startsWith('click:')) continue;
      const h = hostOf(norm(u));
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

  // 点击定位符（click:）需先回到系统首页（菜单常驻可点）
  const clickLocators = [...inScopeIds]
    .map((id) => featurePaths?.[id] ?? profilesById.get(id)?.pageUrl)
    .filter((u): u is string => !!u && u.startsWith('click:'))
    .map((u) => u.slice('click:'.length));
  if (clickLocators.length > 0 && baseUrl && isSafeNavigationUrl(baseUrl)) {
    try {
      await engine.navigate(baseUrl);
    } catch {
      /* 导航失败忽略，交由下方点击兜底 */
    }
  }

  // 同页面功能点共享一次导航（参考 D:\\Test 逐页面采集）：按 norm URL 分组，避免 48 个功能点逐页导航导致卡死/超慢。
  let lastPageUrl = '';
  for (const id of inScopeIds) {
    const profile = profilesById.get(id);
    const loc = featurePaths?.[id] ?? profile?.pageUrl ?? ((profile?.sourceSelector || profile?.clickSelector) ? baseUrl : undefined);
    if (!loc) {
      evidence[id] = needsReviewEvidence({ featureId: id, actionKind: profile?.actionKind }, '缺少安全页面 URL，无法采集功能点证据').evidence;
      continue;
    }

    let nu = '';
    if (!loc.startsWith('click:')) {
      nu = norm(loc);
      if (!/^https?:\/\//i.test(nu)) continue;
      if (!isSafeNavigationUrl(nu)) {
        evidence[id] = needsReviewEvidence({ featureId: id, actionKind: profile?.actionKind, url: nu }, `危险导航 URL，跳过访问以防触发写操作: ${nu}`).evidence;
        continue;
      }
      // 外链（非系统域名）跳过，避免导航到 bogus 地址挂死（M6）
      if (systemHost && hostOf(nu) !== systemHost) {
        log.warn('orchestrator', `feature ${id} 外链 ${nu} 跳过（非系统域名）`);
        continue;
      }
    }

    // 同页面（同 origin+path，仅 hash 可能不同）复用当前页，不重复导航；不同页才导航（含跨路径）
    const reusePage = !loc.startsWith('click:') && lastPageUrl !== '' && sameDocUrl(lastPageUrl, nu);
    if (!reusePage && !loc.startsWith('click:') && nu) {
      lastPageUrl = nu;
    }

    try {
      const res = await exploreFeatureEvidence(engine, {
        featureId: id,
        systemId,
        featureRevision,
        actionKind: profile?.actionKind,
        // 同页复用：不传 url（不重复导航，exploreFeatureEvidence 在当前页采集并恢复）；不同页：传 url 导航
        url: loc.startsWith('click:') ? undefined : (reusePage ? undefined : nu),
        clickSelector: loc.startsWith('click:') ? loc.slice('click:'.length) : undefined,
        actionSelector: profile?.sourceSelector ?? profile?.clickSelector,
        actionText: profile?.sourceLabel,
        pageUrl: loc.startsWith('click:') ? baseUrl : nu,
        pageEntry: loc,
        timeoutMs,
        budget,
      });
      evidence[id] = res.evidence;
      elements.push(...res.raw);
    } catch (e) {
      log.warn('orchestrator', `feature ${id} 证据采集失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  log.info('orchestrator', `T4 按功能点隔离证据采集完成: ${Object.keys(evidence).length} 个功能点, ${elements.length} 个元素`);
  return { evidence, elements };
}
