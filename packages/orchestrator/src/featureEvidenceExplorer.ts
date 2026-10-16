
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
import type { McpEngine, ReadOnlyClickResult } from '@test-platform/engine-mcp';
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

/**
 * 判断字段标签是否疑似 DOM name/id token 泄漏（如 theSelect、btSelectItem、userName）。
 * 规则：纯英文/数字标识符、无中文字符、长度适中 → 视为不可读 token，应在字段采集中跳过（而非泄漏进用例）。
 * 仅当控件完全没有可读中文标签（aria-label/placeholder/关联 label 均缺失）时才命中，避免误伤带中文 placeholder 的正常字段。
 */
export function isLeakedToken(label: string | undefined): boolean {
  if (!label) return false;
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(label) && label.length <= 40 && !/[\u4e00-\u9fff]/.test(label);
}

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

/**
 * 危险写操作文本（命中则禁止点击，避免只读探索误触提交/删除/导入等写操作）。
 *
 * **分层原则（本项目最重要的安全语义）**：
 *   - 「**提交类**」= 真正会写入数据：提交/保存/删除/导入/导出/发布/审核/…
 *     → 任何情况下都不得点击（红线，由引擎层写请求拦截兜底）。
 *   - 「**打开类**」= 只打开一个界面，不产生写入：新增/添加/创建/详情/查看/**修改**/编辑
 *     → 允许点击（打开表单不等于提交表单），这正是二次探索要采的证据。
 *
 * 真实事故（用户症状：个别菜单里「新增/修改」按钮始终没被点过）：
 *   旧实现在 DANGEROUS_CLICK 与遍历层 writeWords 里都把「修改|编辑」列为危险词，
 *   导致修改按钮**双重不可达** —— 遍历候选阶段就被过滤掉；即便进来，
 *   isSafeCurrentNode 的 openerIntent 也不含「修改」而被拒。结果是修改表单的
 *   字段（编辑态比新增态多出「不可编辑字段」这类关键覆盖点）永远采不到。
 *   反过来，若把「新增」也当危险词，则新增表单同样采不到（与注释自相矛盾）。
 */
const DANGEROUS_CLICK = /提交|保存|删除|清空|重置|导入|导出|发布|上架|下架|审核|send|publish|submit|delete|import|export|reset/i;
const UNSAFE_CLICK = /checkbox|radio|switch|toggle|icon(?:-only)?|row[-_ ]?action|inline[-_ ]?action/i;
const SAFE_READ_ONLY_OPENER = /aria-haspopup\s*=\s*['"]?dialog|data-(?:readonly|safe)-opener|role=link|(?:^|[\s>])a(?:[.#[:]|$)|#(?:open|detail|view|menu)[\w-]*$/i;
const DANGEROUS_URL_TOKENS = ['delete', 'remove', 'destroy', 'submit', 'approve', 'reject', 'publish', 'import', 'export', 'reset', 'clear', 'logout', 'signout'];
const SAFE_SAMPLE = /data-(?:safe|readonly)-sample/i;

/**
 * 「打开只读界面」的动作语义（通用动作词，非系统指纹）：进入后只多出一个表单/详情界面，
 * 不写数据。用于放开遍历候选与 openerIntent 校验。含修改/编辑 —— 它们与新增同性质。
 */
const OPEN_FORM_INTENT = /新增|添加|创建|新建|录入|登记|修改|编辑|变更|详情|查看|明细|预览|查阅|打开|create|add|new|edit|update|modify|detail|view|open/i;

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
  // 新增/修改/详情/查看等「打开只读界面」动作：只要节点级安全判定通过即可点击（由 isSafeCurrentNode 保证）。
  // 打开编辑表单不产生写入（写入只发生在点保存/提交时），因此 update 与 create/detail 同性质，
  // 不再额外要求 data-safe-opener/aria-haspopup 这类**自定义属性**（通用系统根本没有该属性，
  // 会导致修改入口一律判不可点 —— 真实事故：菜单里「修改」按钮从未被探索）。
  // 修改的前置安全条件是「先选中一行」，由 triggerable 的 sample 要求保证。
  if (actionKind === 'create' || actionKind === 'detail' || actionKind === 'update') return true;
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

/** 基础安全（任何点击的前置条件）：可见可交互、非表单控件、无**提交类**写操作语义。
 *  注意与 DANGEROUS_CLICK 的差异：新增/详情/修改等「只读打开器」不是写操作 —— 打开表单不等于提交，
 *  真正的写入由引擎层写请求拦截 + 写入守卫兜底；故这里只拦硬写词（提交/保存/删除/导入/导出/审核…）。
 *  「修改|编辑」必须放行：它们与「新增」同性质（只打开编辑表单），拦掉会导致修改表单字段永远采不到。 */
function isBasicSafeNode(element: ElementReadOnlySemantics | undefined): boolean {
  if (!element) return false;
  const text = `${element.text ?? ''} ${element.label ?? ''}`.trim();
  if (/提交|保存|删除|移除|导入|导出|发布|上架|下架|审核|清空|重置|登录|退出|send|submit|save|delete|remove|import|export|publish|reset|logout/i.test(text)) return false;
  if (element.isFormControl || element.disabled) return false;
  return element.interactive === true;
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
  // 打开只读界面的语义按钮（新增/添加/创建/新建/修改/编辑/详情/查看/打开/录入）：
  // 不含提交/保存/删除/导入/导出/审核等硬危险词即可作为安全打开入口。
  return (tag === 'a' && !!element.href && isSafeNavigationUrl(element.href))
    || element.role === 'link'
    || element.ariaHasPopup === 'dialog'
    || element.safeReadOnlyOpener === true
    || (OPEN_FORM_INTENT.test(text) && !hardDangerous.test(identity));
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
  /**
   * 本次点击是否为「页面进入」型菜单点击（只读导航）。
   * 菜单项语义各异（有的是纯导航链接、有的是展开父菜单），不能按「动作 opener」白名单判定；
   * 置 true 后放行 opener 语义校验，但**仍保留节点级安全校验**（命中提交/保存/删除等写操作词一律不点）。
   */
  entryClick?: boolean;
  /** 系统入口 URL（entryClick 模式下重放菜单点击前先回到这里）；缺省时不重放 */
  entryUrl?: string;
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

/**
 * 页面状态指纹（**走引擎既有通道** `extractPageElements`，不使用 evaluate）。
 * 原因（真实事故）：evaluate 在 direct 引擎下运行于只读沙箱副本，与真实页 DOM 不同步 ——
 * 在沙箱里判「基页是否恢复」永远失真（实测按钮数 6→3 漂移）。
 * 指纹 = 可见可交互元素文本集合 + 表单控件数 + 表格数，跨系统成立、无框架指纹。
 */
async function pageFingerprint(engine: McpEngine): Promise<string> {
  try {
    const elements = await engine.extractPageElements();
    const texts = elements
      .map((el) => `${el.tag}:${String(el.label ?? el.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)}`)
      .filter((t) => !/^[a-z]+:$/.test(t))
      .sort()
      .join('|');
    const fields = elements.filter((el) => el.isFormControl).length;
    const tables = elements.filter((el) => el.tableInfo).length;
    return `${fields}#${tables}#${texts}`;
  } catch {
    return '';
  }
}


/**
 * 判断节点在**当前页面**是否仍可见（只读采集一次）。
 * 用于点击失败归因：节点刚刚可点、现在不可见 ⇒ 页面已切换（离开当前功能页），
 * 与具体系统无关（通用判据）。采集失败时保守返回 true（不误判为离开）。
 */
async function isNodeStillVisible(engine: McpEngine, node: { selector?: string; ref?: string }): Promise<boolean> {
  try {
    const elements = await engine.extractPageElements();
    const key = (node.selector ?? node.ref ?? '').trim();
    if (!key) return true;
    return elements.some((el) => (el.selector ?? el.ref ?? '') === key || (el.ref ?? '') === (node.ref ?? ''));
  } catch {
    return true;
  }
}

/**
 * 导航/结构标签集合（HTML 语义，非系统指纹）：这些标签承载「跳转到别处」或数据结构，
 * 不是页面内动作控件 —— 全按钮遍历必须跳过，否则点了就离开当前功能页。
 */
const NAVIGATION_TAGS = new Set([
  'link', 'nav', 'li', 'ul', 'ol', 'dl', 'dd', 'dt', 'menu',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
]);

/**
 * 是否属于「会离开当前功能页的导航元素」（通用判据，HTML 规范层面，非系统指纹）。
 *
 * 关键点：**不能只看标签**。大量后台把动作按钮写成
 * `<a class="btn" href="javascript:;" onclick="add()">新增</a>` ——
 * 按标签一刀切会把动作按钮全灭（真实事故：某系统工具栏的「新增/修改/删除/导入/导出」
 * 全是 a 标签 → 候选为 0 → 遍历只跑菜单两次、证据只剩 base）。
 * 真正决定「是否导航」的是 **href 是否指向真实地址**：
 *   - 有真实地址（http(s)/相对路径）→ 导航，排除
 *   - 空 / javascript: / mailto: / tel: / about: / # → 命令式动作控件，保留
 * 标签本身只排除纯结构元素（li/ul/nav/table 系等，它们从不承载动作）。
 */
function isNavigationElement(element: ExploredElement): boolean {
  if (element.tag === 'a') {
    const href = String(element.href ?? '').trim();
    if (!href || href === '#' || /^(javascript|mailto|tel|about|data):/i.test(href)) return false;
    return true;
  }
  return NAVIGATION_TAGS.has(element.tag);
}

/**
 * 页面身份（通用判据，无框架指纹）：当前功能页的**可读语义特征** —— 表格列标题集合 +
 * 表单字段标签集合。身份变了就说明「不在同一个功能页」了。
 * 用途：点击后判断这是「页面内动作」（特征仍在/增加）还是「切换到另一个页面」
 * （特征被换掉）。侧栏菜单 `<li>` 常被语义层标为可交互、点击后整页内容被换掉 ——
 * 只靠 URL 判定在 iframe/SPA 形态下会失效（真实事故：点了侧栏「首页」导致后续按钮
 * 全部点不到，states 只剩 base）。
 */
function pageIdentity(elements: readonly ExploredElement[]): string {
  const cols: string[] = [];
  const labels: string[] = [];
  for (const el of elements) {
    for (const c of el.tableInfo?.columns ?? []) { const t = String(c).replace(/\s+/g, '').trim(); if (t) cols.push(t); }
    if (el.isFormControl) {
      const l = String(el.label ?? el.text ?? '').replace(/\s+/g, ' ').trim();
      if (l && l.length <= 24 && !isLeakedToken(l)) labels.push(l);
    }
  }
  return [...new Set(cols)].sort().join(',') + '||' + [...new Set(labels)].sort().join(',');
}

/**
 * 身份关系判定：**新增了大量原页没有的特征 ⇒ 同页叠加层（弹窗/抽屉/Tab）；原页特征
 * 整体消失且没有新特征 ⇒ 换到了另一个页面**。
 *
 * 为什么不能只看「原特征是否还在」：弹窗打开后会覆盖内容区，表格列往往随之采不到
 * （实测：列表页 8 列 → 弹窗打开后 0 列，但换来 10 个表单字段）。只按「原特征还在吗」
 * 判断会把弹窗误判成换页 → create/detail 状态全被丢弃（真实事故：点新增 performed、
 * 采到 11 个字段，证据里却只有 base）。
 */
function isSamePageIdentity(before: string, after: string): boolean {
  if (!before || !after) return true;               // 特征不足时不误判
  const [colsA, labelsA] = before.split('||');
  const [colsB, labelsB] = after.split('||');
  const colsAArr = String(colsA).split(',').filter(Boolean);
  const labelsAArr = String(labelsA).split(',').filter(Boolean);
  const colsBArr = String(colsB).split(',').filter(Boolean);
  const labelsBArr = String(labelsB).split(',').filter(Boolean);
  const colsBSet = new Set(colsBArr);
  const labelsBSet = new Set(labelsBArr);
  if (colsAArr.length === 0 && labelsAArr.length === 0) return true;
  // ① 叠加层：出现了多项原页没有的新特征
  const newLabels = labelsBArr.filter((l) => !labelsAArr.includes(l)).length;
  const newCols = colsBArr.filter((c) => !colsAArr.includes(c)).length;
  if (newLabels >= 3 || newCols >= 3) return true;
  // ② 换页：原特征整体消失，且没有新增特征
  const keptCols = colsAArr.filter((c) => colsBSet.has(c)).length;
  const keptLabels = labelsAArr.filter((l) => labelsBSet.has(l)).length;
  if (colsAArr.length >= 2 && keptCols === 0 && labelsAArr.length >= 2 && keptLabels === 0) return false;
  return true;
}

/**
 * 关闭语义词表（**通用动作语义，非系统指纹**）：表达「关闭当前浮层」这一动作的
 * 中/英/简/繁写法与符号形式。注意判据同时取「可见文本 / aria-label / placeholder /
 * title」，因此图标化按钮（无可见文本但带 aria-label）也能命中，不依赖任何框架类名。
 * 覆盖面不足时由 Escape 键通道与重放菜单通道兜底，三条通道互不依赖。
 */
const OVERLAY_CLOSE_TEXT =
  /^(取消|關閉|关闭|關閉|×|✕|✖|╳|⨯|close|dismiss|cancel|hide|×)$/i;

/** 浮层关闭控件定位（通用判据：关闭动作语义 + 多来源可访问名，不依赖弹层类名） */
function findOverlayCloseControl(elements: readonly ExploredElement[]): ExploredElement | undefined {
  return elements.find((el) => {
    if (!el.interactive || el.isFormControl) return false;
    // 可见文本与可访问名都作为来源：图标化关闭钮常常只有 aria-label/title
    const candidates = [el.text, el.label, (el as { placeholder?: string }).placeholder, (el as { ariaLabel?: string }).ariaLabel];
    for (const raw of candidates) {
      const text = String(raw ?? '').replace(/\s+/g, '').trim();
      if (text.length > 0 && text.length <= 12 && OVERLAY_CLOSE_TEXT.test(text)) return true;
    }
    return false;
  });
}

/**
 * 关闭浮层：基于**已采集元素**定位关闭控件并真实点击（**零额外元素采集**）。
 * 为什么不自行采集：采集有预算与调用序列语义；触发 reset 时该次快照的元素已在手（lastSnapshotElements），
 * 直接复用。另：evaluate 不可用于此处 —— direct 引擎下 evaluate 跑在只读沙箱副本，与真实页不同步
 * （真实事故：按钮数 6→3 漂移 → 误判基页未恢复）。
 */
async function closeOverlayFromSnapshot(
  engine: McpEngine,
  elements: readonly ExploredElement[],
): Promise<boolean> {
  const clickFn = engine.runReadOnlyClick?.bind(engine);
  if (!clickFn) return false;
  // 通道①（常规路径，零额外采集）：按「关闭动作语义」定位控件并真实点击。
  // 语义词表覆盖中/英/简/繁 + 符号，且同时取可见文本与 aria-label/placeholder，
  // 因此图标化关闭钮也能命中，不需要依赖任何框架类名。
  const target = findOverlayCloseControl(elements);
  if (!target) {
    // 通道②（兜底，零文案依赖）：找不到语义控件时按 Escape。多数系统给弹层绑定了 Esc。
    // 按下即认为「已尝试关闭」，**不做验证性采集**（采集有预算与调用序列语义，且此处验证
    // 不影响正确性）：Esc 本身无副作用；若该系统没绑定 Esc，浮层会继续遮挡后续点击，
    // 由 clickAndCheck 的「目标节点不可见」归因触发基页恢复自愈。
    try {
      await engine.runStep({ kind: 'press', selector: 'body', key: 'Escape' });
      await engine.waitForTimeout(700);
      return true;
    } catch {
      return false;
    }
  }
  const label = String(target.label ?? target.text ?? '').replace(/\s+/g, ' ').trim();
  const candidates = [target.selector, target.ref].filter((v): v is string => !!v);
  // 语义节点导出的 selector 常是结构路径（如 body > div > div > button），可能匹配多个节点
  // 而被引擎拒绝（实测「要求 selector 精确匹配一个当前 DOM 节点」）→ 用「标签+可见文本」
  // 精确定位重试（与 clickAndCheck 的重试策略同源，通用判据非系统指纹）。
  if (label) {
    const escaped = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // `:visible` 只匹配可见元素 —— 多个弹层同时存在于 DOM 时（多数只打开其一），
    // 无 :visible 的文本定位会匹配到隐藏副本 → 引擎按「非唯一」拒绝（实测）。
    candidates.push(`${target.tag}:has-text("${escaped}"):visible`);
    if (target.tag !== 'button') candidates.push(`button:has-text("${escaped}"):visible`);
  }
  for (const selector of candidates) {
    try {
      const result = await withTimeout(clickFn(selector, 'action') as Promise<ReadOnlyClickResult>, 8000);
      if (result.status === 'performed') {
        await engine.waitForTimeout(900);
        return true;
      }
    } catch {
      /* 试下一个候选 */
    }
  }
  return false;
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
        await engine.evaluate('(hash: string) => { try { window.location.hash = hash; } catch {} }', target.hash);
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

/**
 * 在系统入口页（baseUrl）上，按目标页面 URL 或菜单文本定位「进入该页面的菜单链接」选择器。
 * 用于 entry_only 模式：复用登录会话、经菜单点击进入目标页（而非直接 navigate 深链 —— 深链在 SPA 下常因
 * 会话未持久化而落在登录页）。优先按 href（普通路由 / hash 路由均可）精确匹配；否则按可见文本兜底。
 * 返回可直接交给 runReadOnlyClick 的 CSS 选择器（如 `a[href="/system/user"]`），未命中返回 undefined。
 */
/** 菜单文本段是否可点击（危险语义拦截 —— 菜单路径也不得命中写操作词） */
function isSafeMenuSegment(text: string): boolean {
  return !DANGEROUS_CLICK.test(text) && !UNSAFE_CLICK.test(text);
}

/**
 * 按菜单路径逐级点击进入（'menu:一级>二级'）：每段按可见文本精确匹配定位（打标），
 * 点击后等待下级菜单展开 —— 与「人在侧车里逐级点菜单」完全同构，不依赖 URL。
 * 段命中写操作/危险语义立即拒绝（不伪装点击成功）。
 */
async function clickMenuByPath(
  engine: McpEngine,
  segments: string[],
): Promise<{ status: 'performed' | 'blocked'; reason?: string }> {
  const labels = segments.map((seg) => seg.trim()).filter(Boolean);
  if (labels.length === 0) return { status: 'blocked', reason: '菜单路径为空' };
  for (const label of labels) {
    if (!isSafeMenuSegment(label)) {
      return { status: 'blocked', reason: `菜单段命中写操作/危险语义，拒绝点击: ${label}` };
    }
    const marked = await engine.evaluate((text: string): string | undefined => {
      const g = globalThis as any;
      const doc = g.document;
      if (!doc) return undefined;
      const norm = (s: string): string => (s || '').replace(/\s+/g, '');
      const want = norm(text);
      if (!want) return undefined;
      const candidates = Array.prototype.slice.call(doc.querySelectorAll('a, [role="menuitem"]')) as any[];
      let visible: any = undefined;
      let any: any = undefined;
      for (const el of candidates) {
        if (norm(el.textContent) !== want) continue;
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        const isVis = !!rect && rect.width > 0 && rect.height > 0;
        if (isVis && !visible) visible = el;
        if (!any) any = el;
      }
      const target = visible ?? any;
      if (!target) return undefined;
      const mark = `m${g.Date.now().toString(36)}${g.Math.floor(g.Math.random() * 1e6).toString(36)}`;
      target.setAttribute('data-explore-target', mark);
      return `[data-explore-target="${mark}"]`;
    }, label);
    if (!marked) return { status: 'blocked', reason: `菜单段未找到: ${label}` };
    const doClick = engine.runReadOnlyClick?.bind(engine);
    if (!doClick) return { status: 'blocked', reason: '引擎未提供只读点击能力' };
    // 快照行不含 data 属性（真实事故：打标 selector 在快照中永远找不到）——
    // 回读打标元素的可见文本，用 text= 让快照按文本定位（快照只含可见元素，等价命中）
    const segText = await engine.evaluate((sel: string): string => {
      const doc = (globalThis as any).document;
      if (!doc) return '';
      const el = doc.querySelector(sel) as any;
      if (!el) return '';
      return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    }, marked);
    const clickTarget = segText && segText.length >= 1 && segText.length <= 40 ? `text=${segText}` : marked;
    const result = await doClick(clickTarget, 'action');
    if (result.status !== 'performed') {
      return { status: 'blocked', reason: `菜单段点击未执行: ${label} — ${result.reason ?? result.status}` };
    }
    // 等待下级菜单展开/页面响应（逐级点击的中间态）
    await engine.waitForTimeout(900);
  }
  return { status: 'performed' };
}

async function findMenuEntrySelector(
  engine: McpEngine,
  targetUrl: string,
  label: string | undefined,
): Promise<string | undefined> {
  try {
    return await engine.evaluate(
      (args: { targetUrl: string; label?: string }): string | undefined => {
        const g = globalThis as any;
        const doc = g.document;
        if (!doc) return undefined;
        const normalize = (raw: string): string => {
          try {
            const url = new g.URL(raw, doc.location.href);
            return url.hash ? `${url.origin}${url.pathname}${url.hash}` : `${url.origin}${url.pathname}${url.search}`;
          } catch {
            return raw;
          }
        };
        const target = normalize(args.targetUrl);
        // 目标路径信号（通用数据属性判据，非框架类名）：href / data-id / data-url / data-href。
        // 大量后台菜单（JS handler 驱动）无 href，路径只存在于 data-* 属性中。
        const anchors = Array.prototype.slice.call(doc.querySelectorAll('a')) as any[];
        const pathSignal = (anchor: any): string => {
          for (const attr of ['href', 'data-id', 'data-url', 'data-href']) {
            const v = (anchor.getAttribute(attr) || '').trim();
            if (v && !/^(javascript|mailto|tel|data|about):/i.test(v) && v !== '#') return v;
          }
          return '';
        };
        // ① 路径匹配（href 或 data-* 值与目标 URL 的路径一致）
        for (const anchor of anchors) {
          const signal = pathSignal(anchor);
          if (!signal) continue;
          if (normalize(new g.URL(signal, doc.location.href).href) === target) {
            const mark = `m${g.Date.now().toString(36)}${g.Math.floor(g.Math.random() * 1e6).toString(36)}`;
            anchor.setAttribute('data-explore-target', mark);
            return `[data-explore-target="${mark}"]`;
          }
        }
        // ② 可见文本精确匹配（不限 href —— 纯 JS handler 菜单的唯一信号是文本）
        if (args.label) {
          const norm = (value: string): string => value.replace(/\s+/g, '');
          const expected = norm(args.label);
          if (expected) {
            for (const anchor of anchors) {
              if (norm(anchor.textContent || '') !== expected) continue;
              const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
              if (rect && rect.width <= 0 && rect.height <= 0) continue; // 隐藏副本跳过
              const mark = `m${g.Date.now().toString(36)}${g.Math.floor(g.Math.random() * 1e6).toString(36)}`;
              anchor.setAttribute('data-explore-target', mark);
              return `[data-explore-target="${mark}"]`;
            }
          }
        }
        return undefined;
      },
      { targetUrl, label },
    );
  } catch {
    return undefined;
  }
}

/** fail-safe：任何异常都返回 needsReview 证据，绝不抛出、绝不伪装覆盖 */
function needsReviewEvidence(
  opts: FeatureEvidenceOptions,
  reason: string,
  partial?: Partial<FeatureEvidence>,
): FeatureEvidenceResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
  } catch { /* ignore */ }
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
  let actionKind = opts.actionKind ?? 'other';
  try {
    // ① 进入目标页（只读进入，不写）
    // **进入优先级：菜单路径点击 > 页内入口点击 > URL（且 entryClick 下禁用 URL）**。
    // 旧顺序把 opts.url 放在链首 → menu: 分支永不可达，二次探索恒退化为「直接打开功能页地址」
    // （真实事故：用户看到地址栏反复跳转、实际未探索）。菜单路径必须优先判定。
    if (opts.clickSelector?.startsWith('menu:')) {
      // 菜单路径进入（数据层 menu: 语义）：按文本逐级点击，天然免疫 URL 脏数据
      const menuSpec = opts.clickSelector.slice('menu:'.length);
      if (!engine.runReadOnlyClick) return needsReviewEvidence(opts, '引擎未提供只读点击能力，MCP/未知引擎不会执行点击');
      const mr = await clickMenuByPath(engine, menuSpec.split('>'));
      if (mr.status !== 'performed') return needsReviewEvidence(opts, `菜单路径点击未完成: ${mr.reason ?? mr.status}`);
      // iframe 形态：菜单点击后内容页在 iframe 加载需 3-5s（300ms/1200ms 会采到空 iframe）
      await timed(engine.waitForTimeout(4000));
    } else if (opts.clickSelector) {
      const currentElements = await timed(engine.extractPageElements());
      // 打开只读表单/详情页（create/detail）属于只读进入：即便 selector 不匹配 SAFE_READ_ONLY_OPENER，
      // 也允许走节点级 isSafeCurrentNode 的 openerIntent 放行（新增/详情/查看…）。实际写操作（提交/保存/删除…）
      // 由 isSafeCurrentNode 的硬危险词拦截，绝不误触。
      const allowOpen = opts.entryClick === true || actionKind === 'create' || actionKind === 'detail' || isSafeReadOnlyOpener(opts.clickSelector);
      const entryNode = findCurrentElement(currentElements, opts.clickSelector, opts.actionText);
      // 页面进入型菜单点击（entryClick）：按基础安全判定（无写操作词、非表单控件、可见）。
      // 菜单常无 href 且无 opener 动词（如「角色管理」），动作级 openerIntent 校验必然误拒 ——
      // 但页面进入本身不是动作打开，只受基础安全 + 引擎只读点击硬约束（写请求/写入守卫）保护。
      const entrySafe = opts.entryClick === true ? isBasicSafeNode(entryNode) : isSafeCurrentNode(entryNode, 'action');
      if (!allowOpen || !entrySafe) {
        try {
          const fs = await import('node:fs');
        } catch { /* ignore */ }
        return needsReviewEvidence(opts, `clickSelector 未匹配当前安全语义节点，跳过点击以防误触: ${opts.clickSelector}`);
      }
      if (!engine.runReadOnlyClick) return needsReviewEvidence(opts, '引擎未提供只读点击能力，MCP/未知引擎不会执行点击');
      const result = await timed(engine.runReadOnlyClick(opts.clickSelector, 'action'));
      if (result.status !== 'performed') return needsReviewEvidence(opts, `只读点击未执行: ${result.reason ?? result.status}`);
      await timed(engine.waitForTimeout(600));
    } else if (opts.entryClick === true) {
      // entryClick（菜单点击进入）模式：**禁止 URL 兜底**。菜单/入口点击定位失败即诚实记录，
      // 绝不改为直接打开功能页地址 —— 那是用户明确禁止的「按地址跳转」（评审文档 §6.3 末句）。
      return needsReviewEvidence(opts, `点击进入失败且 entryClick 模式不按地址兜底（保持只点不跳）: ${opts.clickSelector ?? '(无入口选择器)'}`);
    } else if (opts.url) {
      // URL 兜底（仅非 entryClick 场景允许）：仍走安全导航校验与登录页校验
      if (!isSafeNavigationUrl(opts.url)) {
        return needsReviewEvidence(opts, `危险导航 URL，跳过访问以防触发写操作: ${opts.url}`);
      }
      await timed(engine.navigate(opts.url));
      await timed(engine.waitForTimeout(3000));
      const afterNav = await currentUrl(engine);
      if (afterNav && isLoginPageUrl(afterNav) && !isLoginPageUrl(opts.url)) {
        return needsReviewEvidence(opts, `登录会话失效（${opts.url} 导航后落在登录页 ${afterNav}），请重新登录/人工接管后重试；未反复自动登录`);
      }
    }

    // ② 有界状态采集：base + 一个安全动作状态 + 至多两个 Tab/折叠状态。
    const fields: FieldSemantic[] = [];
    const tables: TableSemantic[] = [];
    const containers = [] as FeatureEvidence['containers'];
    const uncovered: UncoveredItem[] = [];
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
      lastSnapshotElements = elements;
      const snapshot = elements.slice(0, remainingNodes);
      raw.push(...snapshot);
      states.push(state);
      if (snapshot.length < elements.length) addUncovered(uncovered, { kind: 'budget_exceeded', reason: `语义节点采集达到上限 ${budget.maxSemanticNodes}` });
      for (const element of snapshot) {
        containers.push(...(element.containers ?? []));
        for (const item of element.uncovered ?? []) addUncovered(uncovered, item);
        if (element.isFormControl) {
          const fieldLabel = element.label ?? element.text ?? '';
          // 防止 DOM token（theSelect/btSelectItem/userName）泄漏为查询字段名：控件缺可读中文标签时跳过，
          // 不写入 fields（避免 theSelect 类合成名进入用例）。属诚实降级，不伪装覆盖。
          if (isLeakedToken(fieldLabel)) continue;
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
    // 最近一次快照的元素：关闭浮层时据此定位关闭控件（零额外采集）
    let lastSnapshotElements: readonly ExploredElement[] = baseElements;
    appendSnapshot(opts.initialState ?? 'base', baseElements);
    const baseUrl = opts.url ?? await currentUrl(engine);
    // 目标页绝对 URL：漂移判定基准（点击后导航离开此页 = 菜单行为而非页面功能）

    // 页面反推 actionKind：profile 未分类（other/undefined）时，依据打开页内容保守推断，
    // 纠正"功能点全 other"塌缩（问题④根因之一）。仅升级 other→list/query，二者覆盖键所需的
    // 表格/字段在只读 base 快照中即可观测，不会引入伪造或额外 needs_review（见 deriveCoverageKeys）。
    if (!actionKind || actionKind === 'other') {
      const hasTable = baseElements.some((e) => e.tableInfo && (e.tableInfo.columns?.length ?? 0) > 0);
      const hasForm = baseElements.some((e) => e.isFormControl);
      if (hasTable) actionKind = 'list';
      else if (hasForm) actionKind = 'query';
    }
    const clickAndCheck = async (selector: string, purpose: 'action' | 'sample' | 'container', currentElements: ExploredElement[], allowSafePathChange = false, fallbackText?: string): Promise<boolean> => {
      const node = purpose === 'action'
        ? findCurrentElement(currentElements, selector, opts.actionText)
        : findCurrentElement(currentElements, selector);
      // 动作点击 = 基础安全 ∪ 动作级安全的并集：引擎层 runReadOnlyClick（写操作词 + 写请求拦截）
      // 才是安全守门员；动作级 openerIntent 白名单单独会误拒「查询」等普通按钮（真实事故），
      // 而基础安全会误拒「新增/详情」等只读打开器 —— 二者取并集，硬危险词在两路中都被拦截。
      const safe = purpose === 'action'
        ? (isBasicSafeNode(node) || isSafeCurrentNode(node, 'action'))
        : isSafeCurrentNode(node, purpose);
      if (!safe) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: `selector 未匹配当前 ${purpose} 安全语义节点，未点击: ${selector}` });
        return false;
      }
      if (!engine.runReadOnlyClick) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: '引擎未提供可拦截网络和下载的只读点击能力，未点击' });
        return false;
      }
      const effectiveSelector = node?.selector || node?.ref || selector;
      const before = await currentUrl(engine);
      // 单次点击的独立超时护栏：元素不可见/被遮挡时引擎会等满点击超时（实测 15s），
      // 多个候选叠加会吃光功能点预算 → 整个功能点崩溃、证据全空（真实事故）。
      // 超时按「未执行」处理（记 uncovered 并继续下一个候选），不拖垮整体。
      const clickFn = engine.runReadOnlyClick?.bind(engine);
      const clickOnce = async (sel: string): Promise<ReadOnlyClickResult> => {
        if (!clickFn) return { status: 'unsupported', beforeUrl: before, reason: '引擎未提供只读点击能力' };
        const budgetMs = Math.min(8000, Math.max(1500, deadline - Date.now() - 2000));
        try {
          return await withTimeout(clickFn(sel, purpose) as Promise<ReadOnlyClickResult>, budgetMs);
        } catch {
          return { status: 'blocked', beforeUrl: before, reason: `只读点击超时（${budgetMs}ms），按未执行处理` };
        }
      };
      // selector 可能不精确（匹配多个节点）导致 runReadOnlyClick 拒绝：先试节点 selector，
      // 失败时用 Playwright 原生 `tag:has-text("动作文本")` 精确定位重试（allow_all 策略下按钮可点）。
      let result = await clickOnce(effectiveSelector);
      const retryText = fallbackText ?? opts.actionText;
      if (result.status !== 'performed' && purpose === 'action' && retryText?.trim() && node?.tag) {
        const escaped = retryText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        result = await clickOnce(`${node.tag}:has-text("${escaped}")`);
      }
      if (result.status !== 'performed') {
        // 通用归因：点击失败且「刚才还能点的节点现在不可见」= 已离开当前功能页
        // （误点导航链接/菜单导致 section 切换或 iframe 重载，真实事故：此后所有按钮点击
        // 都会 15s 超时 → 功能点证据全空）。此时立即恢复基页，让后续候选重新在正确页面上执行。
        const stillVisible = node ? await isNodeStillVisible(engine, node) : true;
        addUncovered(uncovered, {
          kind: 'write_required_state',
          reason: stillVisible
            ? `只读点击被阻止或不支持: ${result.reason ?? result.status}`
            : `点击失败且目标节点已不可见（疑似已离开当前功能页），已恢复基页: ${result.reason ?? result.status}`,
        });
        await resetToBase();
        return false;
      }
      // iframe 形态：点击菜单后内容在 iframe 里加载需 3-5s，300ms 即采集
      // 会拿到空 iframe（真实事故：fields/tables 全空 → 大量「缺少可生成场景」）
      await timed(engine.waitForTimeout(3000));
      const after = await currentUrl(engine);
      if (!after) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: '点击后的 URL/下载/网络副作用观察能力不可用' });
        await resetToBase();
        return false;
      }
      if (!isExpectedPostClickUrl(before ?? baseUrl, after, allowSafePathChange)) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: `安全点击后出现危险或非预期 URL，已停止采集: ${after}` });
        await resetToBase();
        return false;
      }
      return true;
    };

    // 恢复「干净的目标基页」：点击打开的浮层（弹窗/抽屉/遮罩）不会随 URL 恢复自动关闭，
    // 会拦截下一次点击（真实系统同理，仅恢复 URL 不够）。entry_click 模式重放菜单点击
    // （保持「点击进入」语义，不直接 navigate 深链）；navigate 模式重新导航目标页。
    const menuSegments = opts.clickSelector?.startsWith('menu:')
      ? opts.clickSelector.slice('menu:'.length).split('>').map((seg) => seg.trim()).filter(Boolean)
      : undefined;
    const resetToBase = async (): Promise<void> => {
      try {
        // ① 优先「点关闭控件」：浮层由本次点击打开，其关闭控件就在该次快照里（零额外采集）
        if (await closeOverlayFromSnapshot(engine, lastSnapshotElements)) return;
        // ② 无浮层或关不掉 → 重放菜单点击重新进入目标页（点击语义，非地址导航）
        if (menuSegments?.length && engine.runReadOnlyClick) {
          const mr = await clickMenuByPath(engine, menuSegments);
          if (mr.status === 'performed') {
            await timed(engine.waitForTimeout(4000));  // iframe 内容页加载需 3-5s
            return;
          }
          addUncovered(uncovered, { kind: 'no_safe_sample', reason: `浮层关闭后重放菜单点击未完成: ${mr.reason ?? mr.status}` });
          return;
        }
        // ③ 两者皆不可 → 诚实记录，不按地址恢复（保持「只点不跳」红线）
        addUncovered(uncovered, { kind: 'no_safe_sample', reason: '浮层无法关闭且本功能点无菜单路径可重放（不按地址恢复）' });
      } catch (e) {
        addUncovered(uncovered, { kind: 'no_safe_sample', reason: `重建基页失败: ${e instanceof Error ? e.message : String(e)}` });
      }
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
        addUncovered(uncovered, { kind: 'no_safe_sample', reason: '修改入口未找到可安全前置的样例行（无 data-safe-sample 属性且表格行操作属高风险，未点击任意行）' });
      } else if (state) {
        addUncovered(uncovered, { kind: 'write_required_state', reason: observed ? `${state} 入口不是允许的只读打开入口` : `${state} 入口 selector 未匹配当前页面节点，未采集状态` });
      }
    }

    // ②-extra-b 有界全按钮遍历（用户要求：点击里面所有按钮查看功能）：页面上全部可见、
    // 非写操作按钮逐个点击 + 快照（指纹去重、菜单漂移自动识别并恢复、查询等普通按钮全部覆盖）。
    // 写操作词（提交/保存/删除/导入/导出/发布/审核/修改/编辑）一律不碰 —— 安全红线；
    // 引擎层 runReadOnlyClick（写请求拦截 + 下载/弹窗拦截）兜底。
    if (states.length < budget.maxStates) {
      const createIntent = /新增|添加|创建|新建|录入|登记/i;
      const updateIntent = /修改|编辑|变更/i;
      const detailIntent = /详情|查看|明细|预览|查阅|打开/i;
      // **提交类**写操作词：点了就会写数据，红线不碰。新增/修改/详情等「打开类」不在此列
      //（打开表单≠提交，引擎层写请求拦截兜底）—— 否则这些按钮永远进不了候选。
      const writeWords = /提交|保存|删除|移除|导入|导出|发布|审核|清空|重置|登录|退出|send|submit|save|delete|logout/i;
      const candidates = baseElements.filter((element) => {
        const text = `${element.text ?? ''} ${element.label ?? ''}`.trim();
        if (!element.interactive || element.isFormControl || element.disabled) return false;
        // 排除 Tab/折叠等容器节点（由下方容器循环单独处理，避免重复点击同一节点）
        if ((element.containers ?? []).some((container) => container.kind === 'tab' || container.kind === 'collapse')) return false;
        if (!text || writeWords.test(text)) return false;
        // 排除导航/结构标签：链接与列表项是「进入另一个页面」的入口，不是本页功能按钮。
        // 误点会离开当前功能页（真实事故：点侧栏菜单 li → 内容整页被换 → 后续按钮全部
        // 点不到 / 15s 超时 → 功能点证据只剩 base）。判据是 HTML 标签语义
        // （a/link=链接、li/ul/ol/dl/dd/dt/nav=导航列表结构、table 系=数据容器），
        // 与任何具体系统无关，非写死。动作控件一律是 button/input/[role=button]/span/div 等。
        if (isNavigationElement(element)) return false;
        // 语义层已判定为「导航/填写」的元素一律不作为功能按钮遍历：a→navigate、
        // input/select/textarea→fill。命令式菜单（`<a href="javascript:;" onclick="goMenu()">`
        // 「在线/注销/系统管理」等）也属此类 —— 只看 href 会把它们误当动作按钮反复点空
        //（真实事故：候选里塞满顶栏部件与菜单，点不动 → 反复重放菜单 → 预算耗尽）。
        if (element.suggestedAction && element.suggestedAction !== 'click') return false;
        return true;
      });
      const seenSelector = new Set<string>();
      for (const candidate of candidates) {
        if (states.length >= budget.maxStates) break;
        const selector = candidate.selector || candidate.ref;
        if (!selector || seenSelector.has(selector)) continue;
        const text = `${candidate.text ?? ''} ${candidate.label ?? ''}`.trim();
        // 新增/修改/详情入口按动作类型专项采集；普通按钮（查询等）按 views 采集 —— 全部覆盖。
        // 「修改」与「新增」同性质（只打开编辑表单），必须同样纳入遍历，否则修改态字段采不到。
        const discoveredKind: ActionKind | undefined = createIntent.test(text)
          ? 'create'
          : updateIntent.test(text)
            ? 'update'
            : detailIntent.test(text)
              ? 'detail'
              : undefined;
        // 同一动作类型仅采集一个入口（避免重复采集同一模态/详情）
        if (discoveredKind && states.includes(discoveredKind)) continue;
        seenSelector.add(selector);
        // 漂移判定基准 = **点击前实际所在的主文档 URL**，不是功能页地址。
        // 原因（真实事故）：iframe 形态下主文档恒为系统入口 /index，功能页地址（/system/user）
        // 永远与它不相等 → 每点一次页内按钮都被判「漂移」→ 证据里只剩 base
        // （点新增 performed、11 个字段已采到，却一行没进）。
        const urlBeforeAction = await currentUrl(engine);
        if (!(await clickAndCheck(selector, 'action', baseElements, true, text))) continue;
        // 点击导致主文档导航离开 = 「切换到另一个页面」而非「页面内功能」（侧栏菜单等），
        // 不采集（防止串页污染）、立即恢复基页。SPA hash 路由的换页由下面的身份判定兜底。
        const curAfterClick = await currentUrl(engine);
        if (urlBeforeAction && curAfterClick && /^https?:/i.test(curAfterClick) && !sameDocUrl(urlBeforeAction, curAfterClick)) {
          await resetToBase();
          continue;
        }
        const state2: FeatureEvidence['states'][number] = discoveredKind ?? 'views';
        // 指纹变化才采集：弹窗打开/Tab 切换/表格刷新都会产生新状态
        const afterElements = await timed(engine.extractPageElements());
        const identityKept = isSamePageIdentity(pageIdentity(baseElements), pageIdentity(afterElements));
        if (!identityKept) {
          // 点击把内容整个换掉了 = 这是「切换到另一个页面」而非「页面内功能」
          // （侧栏菜单项、面包屑、树节点等）。不采集串页内容，立即恢复基页。
          await resetToBase();
          continue;
        }
        if (appendSnapshot(state2, afterElements)) {
          actionEntries.push({ actionKind: discoveredKind ?? 'other', ref: selector, selector, text, triggerable: true, observed: true });
          // 反推：原 other/undefined 且发现新增入口时，升级为 create 以便覆盖键正确生成
          if ((!actionKind || actionKind === 'other') && discoveredKind === 'create') actionKind = 'create';
          await resetToBase();
        }
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
    // needs_review 判定：仅当「无可观测证据」或存在非点击类缺口时阻断 ——
    // 已观测到表格/字段/容器、且全部缺口只是可选点击未执行（如全局部件快照定位失败、
    // 写操作入口按红线拒绝）时，证据足以生成覆盖键：失败项保留在 uncovered 诚实展示，
    // 不阻断用例生成（真实事故：topbar 部件点击失败把整份含真实表格列的证据拉成 needs_review）。
    // 安全红线类停止（危险/非预期 URL、跨源跳转）不属于可选缺口 —— 必须阻断
    const isOptionalGap = (item: { kind: string; reason: string }): boolean =>
      item.kind === 'write_required_state'
      && /^只读点击被阻止或不支持/.test(item.reason)   // 遍历中的可选点击失败（快照定位/引擎拒绝）
      && !/危险|非预期|跨源/.test(item.reason);        // 安全红线类停止必须阻断
    const onlyOptionalClickGaps = observed && uniqueUncovered.every(isOptionalGap);
    const needsReview = uniqueUncovered.length > 0 && !onlyOptionalClickGaps;

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

  /**
   * 保证「可从入口开始点菜单」，但**不无条件整页 reload**。
   *
   * 真实事故（用户可见症状：每采一个功能点地址栏就跳回首页）：
   *   旧实现在每个功能点前后都 `engine.navigate(baseUrl)`。在 iframe/多标签形态下，
   *   整页 reload 会连带重建菜单 iframe 与页签容器 —— 已展开的父菜单被收起、
   *   浮层状态丢失，下一段菜单点击找不到目标，只能再次 reload，形成
   *   「回首页 → 菜单点不动 → 再回首页」的循环；同时每次 reload 吃掉数秒预算，
   *   后面按钮的点击预算被压缩甚至超时（证据里表现为按钮没点上）。
   *
   * 正确做法（通用判据，无系统指纹）：
   *   - 当前仍在入口同文档（同 origin+path）→ 不动它，直接点菜单；
   *   - 仅当确实离开了入口文档（如被重定向到登录页/错误页/别的路径）才导航回入口；
   *   - 浮层残留由调用方的 closeOverlayFromSnapshot / 菜单重放通道处理，不靠整页刷新。
   * 返回 true 表示确实执行了导航（调用方据此更新 lastPageUrl）。
   */
  const ensureEntryReachable = async (): Promise<boolean> => {
    if (!baseUrl || !isSafeNavigationUrl(baseUrl)) return false;
    const cur = await currentUrl(engine);
    // 已在入口同文档：菜单常驻可点，无需任何导航
    if (cur && isSameDocUrl(baseUrl, cur)) return false;
    // 落在登录页：整页导航回不去，交给上层的登录态处理，不做无效 reload
    if (cur && isLoginPageUrl(cur)) return false;
    try {
      await engine.navigate(baseUrl);
      return true;
    } catch (e) {
      log.warn('orchestrator', `回到系统入口失败: ${e instanceof Error ? e.message : String(e)}`);
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
      // 不再无条件 reload：已在入口同文档时保持现状（菜单常驻可点）
      await ensureEntryReachable();
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
      // 相对路径（/system/user、logout 等）基于系统入口解析为绝对 URL —— 旧逻辑在此
      // 静默 continue，整批功能点零导航零采集（真实事故：23/23 全灭且无任何日志）
      if (nu && !/^https?:\/\//i.test(nu) && baseUrl && isSafeNavigationUrl(baseUrl)) {
        try { nu = norm(new URL(nu, baseUrl).href); } catch { /* 保持原值，走下方校验 */ }
      }
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

    // entry_only：跨路径时优先经系统菜单「点击进入」目标页（复用登录会话、避免直接深链落到登录页），
    // 满足用户要求"在项目基础上点击而非直接打开地址"。命中顺序：显式 clickSelector → 按目标 URL/菜单文本定位菜单链接。
    const entryOnly = crossPathNavigation === 'entry_only';
    const clickSel = profile?.sourceSelector ?? profile?.clickSelector;
    // 菜单路径优先（数据层 menu: 语义）：与 URL 无关、天然免疫路径退化脏数据；
    // 回到系统入口（菜单常驻可点）后按文本逐级点击进入
    const menuSel = clickSel?.startsWith('menu:') ? clickSel : undefined;
    const crossPath = !loc.startsWith('click:') && !!nu && !!baseUrl && !sameDocUrl(baseUrl, nu);
    let menuEntrySelector: string | undefined;
    let useClickEntry = entryOnly && (!!menuSel || (crossPath && !!clickSel));
    if (entryOnly && crossPath && !clickSel && !!nu && !!baseUrl && isSafeNavigationUrl(baseUrl)) {
      // 无显式点击选择器时：确保处于系统入口（菜单常驻可点），再按目标 URL/菜单文本定位进入链接
      try {
        if (await ensureEntryReachable()) lastPageUrl = baseUrl;
        menuEntrySelector = await findMenuEntrySelector(engine, nu, profile?.sourceLabel);
        useClickEntry = !!menuEntrySelector;
      } catch {
        menuEntrySelector = undefined;
        useClickEntry = false;
      }
    }

    // 同页面（同 origin+path，仅 hash 可能不同）复用当前页，不重复导航；不同页才导航（含跨路径）
    const reusePage = !loc.startsWith('click:') && !useClickEntry && lastPageUrl !== '' && sameDocUrl(lastPageUrl, nu);
    if (!reusePage && !loc.startsWith('click:') && !useClickEntry && nu) {
      lastPageUrl = nu;
    }

    try {
      let navUrl: string | undefined;
      let clickSelector: string | undefined;
      if (loc.startsWith('click:')) {
        clickSelector = loc.slice('click:'.length);
      } else if (useClickEntry) {
        // entry_only：确保处于系统入口（菜单常驻可点）再点击进入（只读打开目标页）。
        // 关键：只在确实不在入口同文档时才导航 —— 旧实现无条件 navigate(baseUrl)，
        // 导致每个功能点前都整页 reload 回首页（iframe 形态下连带重建菜单与页签），
        // 用户可见症状就是「每次第一跳都回首页」，且菜单被重置后点不动。
        if (baseUrl && lastPageUrl !== baseUrl) {
          if (await ensureEntryReachable()) lastPageUrl = baseUrl;
        }
        clickSelector = menuSel ?? clickSel ?? menuEntrySelector;
      } else {
        navUrl = reusePage ? undefined : nu;
      }
      const res = await exploreFeatureEvidence(engine, {
        featureId: id,
        systemId,
        featureRevision,
        actionKind: profile?.actionKind,
        // 同页复用：不传 url（不重复导航，exploreFeatureEvidence 在当前页采集并恢复）；不同页：传 url 导航
        url: navUrl,
        clickSelector,
        actionSelector: clickSel?.startsWith('menu:') ? undefined : clickSel,
        actionText: profile?.sourceLabel,
        pageUrl: loc.startsWith('click:') ? baseUrl : nu,
        pageEntry: loc,
        timeoutMs,
        budget,
        entryClick: useClickEntry,
        entryUrl: baseUrl,
      });
      // entry_only：进入下一个功能点前**不整页 reload**。
      // 旧实现在此无条件 navigate(baseUrl) 复位，是「每采一个功能点就跳回首页」的直接原因：
      //   ① iframe/多标签形态下整页刷新会重建菜单 iframe 与页签容器，父菜单重新收起，
      //      下一段菜单点击找不到目标；  ② 每次 reload 吃掉数秒预算，后续按钮点击被压缩甚至超时。
      // 改为「只有真的离开入口文档才导航」；浮层残留由 resetToBase 的关闭控件/菜单重放通道处理。
      if (useClickEntry && baseUrl) {
        try { if (await ensureEntryReachable()) lastPageUrl = baseUrl; } catch { /* 复位失败忽略 */ }
      }
      evidence[id] = res.evidence;
      elements.push(...res.raw);
    } catch (e) {
      log.warn('orchestrator', `feature ${id} 证据采集失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  log.info('orchestrator', `T4 按功能点隔离证据采集完成: ${Object.keys(evidence).length} 个功能点, ${elements.length} 个元素`);
  return { evidence, elements };
}
