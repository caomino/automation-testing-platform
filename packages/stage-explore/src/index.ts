/**
 * @file index.ts
 * @description 探索阶段入口：MCP 引擎遍历模块树 + 人工补充合并 + 覆盖率/断点计算
 * @frozen 依赖 contracts 契约（ExploreInput/Output、ModuleNode、ManualSupplement、McpExplorationCheckpoint）
 */

import type { McpEngine, SessionCapableEngine } from '@test-platform/engine-mcp';
import type { AIClient } from '@test-platform/infra-ai';
import { exploreNonAi } from './nonAiExplore.js';
import { exploreWithAi } from './aiExplore.js';
import type {
  ClickPath,
  ExploreInput,
  ExploreOutput,
  ManualSupplement,
  ModuleNode,
} from '@test-platform/contracts';
import {
  validateExploreInput,
  validateExploreOutput,
} from '@test-platform/contracts';

/** 进程级断点存储（断点续跑用）；resumeFrom 命中时可读出该 frontier 继续 */
const checkpointStore = new Map<string, ExploreOutput['checkpoint']>();
let idSeq = 0;

/** 生成人工补充 action 节点 ID（保证唯一） */
function genActionId(suffix: string): string {
  return `manual_${suffix}_${Date.now()}_${(idSeq++).toString(36)}`;
}

/** 深拷贝模块树，避免改动引擎返回的源树 */
function cloneTree(tree: ModuleNode[]): ModuleNode[] {
  return structuredClone(tree);
}

/** 将模块树扁平化为节点列表 */
function flatten(tree: ModuleNode[]): ModuleNode[] {
  const out: ModuleNode[] = [];
  for (const node of tree) {
    out.push(node);
    out.push(...flatten(node.children));
  }
  return out;
}

interface LocatedNode {
  node: ModuleNode;
  siblings: ModuleNode[];
  index: number;
  parent: ModuleNode | null;
}

/**
 * 会话能力：使用 engine-mcp 导出的 SessionCapableEngine 接口
 * （engine-mcp 已冻结接口含 applySession 及会话管理方法）
 */

/** 在树中定位节点，返回其本体、兄弟数组、下标与父节点 */
function locate(tree: ModuleNode[], id: string): LocatedNode | null {
  const walk = (
    nodes: ModuleNode[],
    parent: ModuleNode | null,
  ): LocatedNode | null => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.id === id) {
        return { node, siblings: nodes, index: i, parent };
      }
      const found = walk(node.children, node);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, null);
}

/**
 * 人工补充去重守卫：原型要求「人工补录已去重」，合并前剔除完全重复的 clickPath
 * 重复判定 = inferredModule + 点击步骤序列（selector+url 指纹）一致。
 */
export function dedupeClickPath(paths: ClickPath[]): ClickPath[] {
  const seen = new Set<string>();
  const out: ClickPath[] = [];
  for (const cp of paths) {
    const fingerprint = `${cp.inferredModule}|${cp.steps
      .map((s) => `${s.selector}@${s.url}`)
      .join('>')}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(cp);
  }
  return out;
}

/**
 * 将人工补充合并进模块树：每个 clickPath 生成一枚 action 子节点，
 * 依据 relativeToNodeId / insertPosition 放置：
 *  - relativeToNodeId 为 null / 'end' → 追加到根
 *  - insertPosition 'above' / 'below' → 作为目标节点的兄弟插入其父 children
 *  - insertPosition 'end' → 追加为目标节点的子节点
 * 合并节点标记 manuallyAdded=true、status='covered'。
 *
 * 批量（同 target、多条 clickPath）above/below 插入保持原型「全部入树」顺序：
 * 以上方为例，新节点依次落在 target 之前，顺序与 clickPath 一致；下方同理。
 */
export function mergeManualSupplement(
  tree: ModuleNode[],
  supplement: ManualSupplement,
  subsystemId: string,
): ModuleNode[] {
  const next = cloneTree(tree);
  const { clickPath, insertPosition, relativeToNodeId } = supplement;

  // 去重守卫：原型要求人工补录已去重
  const deduped = dedupeClickPath(clickPath);

  // 整批共用同一目标节点
  const target =
    relativeToNodeId && relativeToNodeId !== 'end'
      ? locate(next, relativeToNodeId)
      : null;

  // 父节点存在性校验：明确指定了 relativeToNodeId 却找不到 → 显式报错，
  // 不再像原实现那样静默回退根级（会导致人工补充被错误放置）。
  if (relativeToNodeId && relativeToNodeId !== 'end' && !target) {
    throw new Error(
      `mergeManualSupplement: relativeToNodeId "${relativeToNodeId}" 不存在于模块树，无法插入人工补充`,
    );
  }

  deduped.forEach((cp, idx) => {
    const actionNode: ModuleNode = {
      id: genActionId(`${relativeToNodeId ?? 'root'}_${idx}`),
      label: cp.inferredModule || `人工补录路径 ${idx + 1}`,
      parentId: null,
      subsystemId,
      type: 'action',
      status: 'covered',
      children: [],
      depth: 0,
      manuallyAdded: true,
    };

    if (!target) {
      // relativeToNodeId 为 null / 'end'（或根级）→ 追加到根
      actionNode.parentId = null;
      actionNode.depth = 0;
      next.push(actionNode);
      return;
    }

    if (insertPosition === 'above' || insertPosition === 'below') {
      // 批量顺序修正：以原始 target.index 为锚，按 idx 递增偏移，
      // 避免每次 splice 后下标位移导致顺序反转。
      const baseIndex = target.index;
      const at = insertPosition === 'above' ? baseIndex + idx : baseIndex + 1 + idx;
      actionNode.parentId = target.parent ? target.parent.id : null;
      actionNode.depth = target.node.depth;
      target.siblings.splice(at, 0, actionNode);
      return;
    }

    // 'end'：作为目标节点的子节点
    actionNode.parentId = target.node.id;
    actionNode.depth = target.node.depth + 1;
    target.node.children.push(actionNode);
  });

  return next;
}

/** 覆盖率：visited=已覆盖节点数，total=总节点数，frontier=待探索（needs_review|unexplored）节点 id */
export function computeCoverage(tree: ModuleNode[]): {
  visited: number;
  total: number;
  frontier: string[];
} {
  const all = flatten(tree);
  const visited = all.filter((n) => n.status === 'covered').length;
  const total = all.length;
  const frontier = all
    .filter((n) => n.status === 'needs_review' || n.status === 'unexplored')
    .map((n) => n.id);
  return { visited, total, frontier };
}

/** needsReview：返回所有 status='needs_review' 节点 id */
export function computeNeedsReview(tree: ModuleNode[]): string[] {
  return flatten(tree)
    .filter((n) => n.status === 'needs_review')
    .map((n) => n.id);
}

/**
 * in-pipeline 粒度闸门（S2 / P-A#4）。
 *
 * 核心断言：探索产出必须包含**操作级功能点**（`type==='action'`，即列表/添加/修改/删除/查询/导出）。
 * 仅当 action 叶子为 0（彻底没抓到任何操作级功能点）时，把目录级叶子整体标 `needs_review` + 原因并告警；
 * 这正是「只抓父集目录」的真凶场景。若已存在 action，则视为部分成功，不全局罢工（混合树靠人工审核补遗漏页）。
 *
 * 设计约束：
 *  - 不新增任何契约字段，完全复用 ModuleNode.status / reviewReason / ExploreOutput.needsReview。
 */
export function assertActionGranularity(
  tree: ModuleNode[],
  _minActionRatio = 0.8,
): { totalLeaves: number; actionCount: number; flagged: number } {
  const all = flatten(tree);
  const leaves = all.filter((n) => n.children.length === 0);
  const actionLeaves = leaves.filter((n) => n.type === 'action');
  const dirLeaves = leaves.filter((n) => n.type !== 'action');
  const actionCount = actionLeaves.length;
  const totalLeaves = leaves.length;
  const flagged = actionCount === 0 ? dirLeaves.length : 0;

  if (actionCount === 0) {
    const reason =
      '未采集到任何操作级功能点（列表/添加/修改/删除/查询/导出），疑似仅探索到目录层';
    for (const n of dirLeaves) {
      n.status = 'needs_review';
      n.reviewReason = reason;
    }
    console.error(
      `[explore][GRANULARITY] 颗粒度不足：${reason}（action=0, 目录级叶子=${flagged}/${totalLeaves}）→ 已标记 needs_review`,
    );
  }
  return { totalLeaves, actionCount, flagged };
}

/** 构造断点：聚集已覆盖节点 id 与 frontier */
export function buildCheckpoint(
  tree: ModuleNode[],
  frontier: string[],
): ExploreOutput['checkpoint'] {
  const visitedNodeIds = flatten(tree)
    .filter((n) => n.status === 'covered')
    .map((n) => n.id);
  return {
    checkpointId: `cp-${Date.now()}-${(idSeq++).toString(36)}`,
    visitedNodeIds,
    frontier,
    savedAt: Date.now(),
  };
}

/**
 * 断点续跑合并：将上一个断点已探索的节点 id 重新标记为 covered，
 * 保证「续跑」时这些节点不会因重新遍历被降级为 needs_review/unexplored，
 * 实现 ①已探索节点合并 ②frontier 在既有基础上继续推进。
 */
function mergeCheckpoint(
  tree: ModuleNode[],
  checkpoint: ExploreOutput['checkpoint'],
): ModuleNode[] {
  const visited = new Set(checkpoint.visitedNodeIds);
  if (visited.size === 0) return tree;
  const walk = (nodes: ModuleNode[]): void => {
    for (const n of nodes) {
      if (visited.has(n.id) && n.status !== 'covered') {
        n.status = 'covered';
      }
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(tree);
  return tree;
}

/** run 的可选运行选项 */
export interface ExploreRunOptions {
  /**
   * 引擎已带活跃登录会话（复用登录浏览器场景）：
   * 跳过 ensureSession/applySession，避免旧会话快照覆盖浏览器内最新会话导致登出。
   */
  engineHasActiveSession?: boolean;
  /**
   * 可选 AI 客户端：仅当调用方显式注入时启用（受应用层 AI 开关门控）。
   * 探索阶段仅在结构化抽取为空时走 AI 兜底；不注入则纯结构化。
   */
  ai?: AIClient;
}

/**
 * 为自建（非活跃）引擎准备会话并导航。
 *
 * 设计要点（防「探索退出登录」）：
 *  - 本函数仅在「未传入 engineHasActiveSession」时调用，即引擎内**没有**有效登录态，
 *    需要把 login 阶段输出的会话快照注入以恢复登录。
 *  - 若引擎已带活跃会话，调用方应传入 engineHasActiveSession=true，run 会改走
 *    prepareActiveSessionEngine（只导航、绝不注入），从而保护浏览器内最新有效会话。
 *  - 有 systemUrl：优先 ensureSession 探测；命中则按结果处理（不重复注入）；
 *    旧引擎回退到 applySession + navigate。
 *  - 无 systemUrl：引擎假定已在目标页面，仅在有会话时注入（不导航，避免覆盖当前页）。
 *
 * @returns 诊断信息列表（非致命警告）
 */
async function prepareFreshEngineSession(
  activeEngine: McpEngine,
  validated: ExploreInput,
): Promise<string[]> {
  const notes: string[] = [];
  const sessionEngine = activeEngine as SessionCapableEngine;
  const handle = validated.sessionHandle;
  const hasSession =
    (handle.cookies?.length ?? 0) > 0 || (handle.tokens?.length ?? 0) > 0;

  const applySessionIfAny = async (): Promise<void> => {
    if (!hasSession) {
      console.warn('[stage-explore] 无有效会话，将以匿名身份继续');
      notes.push('无有效会话，将以匿名身份继续');
      return;
    }
    console.log(`[stage-explore] 正在应用登录会话（${handle.cookies?.length ?? 0} cookies）...`);
    try {
      await sessionEngine.applySession({
        cookies: handle.cookies || [],
        headers: handle.headers || {},
        tokens: handle.tokens || [],
      });
      console.log('[stage-explore] 会话应用成功');
    } catch (e) {
      console.warn('[stage-explore] 会话应用失败（非致命）:', e);
      notes.push(`会话应用失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (validated.systemUrl) {
    const sessionResult = await sessionEngine.ensureSession?.(validated.systemUrl, {
      cookies: handle.cookies || [],
      headers: handle.headers || {},
      tokens: handle.tokens || [],
    });

    if (sessionResult) {
      console.log(`[stage-explore] 会话状态: loggedIn=${sessionResult.loggedIn}, method=${sessionResult.method}`);
      if (!sessionResult.loggedIn) {
        console.warn('[stage-explore] 会话未登录，需要用户手动登录');
        notes.push('会话未登录，需要用户在浏览器中手动登录');
      }
      return notes;
    }

    // 旧版引擎不支持 ensureSession：先注入会话，再导航到目标系统
    await applySessionIfAny();
    try {
      await activeEngine.navigate(validated.systemUrl);
      console.log('[stage-explore] 导航成功');
    } catch (e) {
      notes.push(`导航到 ${validated.systemUrl} 失败: ${e instanceof Error ? e.message : String(e)}`);
      throw new Error(`无法访问系统 URL: ${validated.systemUrl}`);
    }
  } else {
    // 无 systemUrl：假定引擎已在目标页面，仅在有会话时注入（不导航，避免覆盖当前页）
    console.warn('[stage-explore] 未提供 systemUrl，假定引擎已在目标页面');
    notes.push('未提供系统 URL，复用当前页面');
    await applySessionIfAny();
  }
  return notes;
}

/**
 * 登录页 URL 判定（token 级匹配，避免误伤 /authority/ 等含 auth 的业务路径）。
 * 匹配 /login、#/login、login.jsp、signin、sso、logon 等常见登录路由。
 */
function isLoginPageUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const segs = ((url.pathname || '') + '#' + (url.hash || '')).split(/[/#?&._-]+/);
    return segs.some((s) => ['login', 'signin', 'sso', 'logon'].includes(s.toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * 为已带活跃会话的引擎（登录浏览器复用）准备页面：
 * 仅做一次正常导航，绝不注入会话（防止旧 cookie 快照覆盖浏览器内最新有效会话导致登出）。
 */
async function prepareActiveSessionEngine(
  activeEngine: McpEngine,
  systemUrl: string,
): Promise<string[]> {
  try {
    let cur = '';
    try { cur = await activeEngine.getCurrentUrl(); } catch { cur = ''; }
    let skipNav = false;
    try {
      if (cur && systemUrl) {
        const a = new URL(cur);
        const b = new URL(systemUrl);
        const sameDoc = a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
        if (sameDoc) {
          // 同文档（origin/path/search 相同）：hash 相同跳过；hash 不同则导航，纯 SPA 路由切换不重载、会话安全
          skipNav = a.hash === b.hash;
        } else if (a.origin === b.origin) {
          // 跨文档（会全量重载）：
          //  - 目标路径是当前路径的严格前缀（门户根/闸门，如 /typtnew/ → /typtnew/sxrdtypt/）：
          //    重载后必被服务端重定向到登录页（#/login），当前页非登录页时跳过导航，留在已登录页探索
          //  - 目标本身就是登录页：跳过（去哪都是登录页）
          //  - 其余同源不同应用路径（门户→子系统）：导航（cookie 会话随重载保留，不丢登录）
          const ap = (a.pathname || '').replace(/\/+$/, '');
          const bp = (b.pathname || '').replace(/\/+$/, '');
          const targetIsPrefixGate = bp.length > 0 && ap.startsWith(bp + '/');
          skipNav = (!isLoginPageUrl(cur) && targetIsPrefixGate) || isLoginPageUrl(systemUrl);
        } else {
          // 跨源：必须导航（导航前存储预注入保底）
          skipNav = false;
        }
      }
    } catch { skipNav = false; }
    if (skipNav) {
      console.log('[stage-explore] reuse login browser: keep current logged-in page (' + cur + '), skip navigation');
      return [];
    }
    // 路径不同（门户→子系统）需跳转到目标页。完整 reload（page.goto）会冲掉 SPA 内存态；
    // 若登录 token 落在 sessionStorage，重载后必然清空，且 context.storageState 不抓取
    // sessionStorage、applySession 也只回写 localStorage —— 三者叠加正是「探索后退登出」的根因
    // （事后回灌 localStorage 对 sessionStorage token 无效，且存在 SPA 启动先于回灌的竞态）。
    // 正确做法：导航【前】抓取全部 local+session 存储，注册 init script 在重载后、SPA 脚本启动【前】
    // 把 token 原样写回两种存储，从而无失真恢复登录态。注入先于 SPA 启动，彻底消除竞态。
    let entries: Array<{ storage: 'local' | 'session'; name: string; value: string }> = [];
    try { entries = await activeEngine.getAllStorageTokens(); } catch { entries = []; }
    if (entries.length) {
      try {
        // 该回调在浏览器上下文（页面脚本启动前）执行；用本地接口描述存储，避免依赖 DOM lib
        interface WebStorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; }
        await activeEngine.addInitScript(
          (data: unknown) => {
            const list = data as Array<{ storage: 'local' | 'session'; name: string; value: string }>;
            const s = globalThis as unknown as { sessionStorage: WebStorageLike; localStorage: WebStorageLike };
            for (const e of list) {
              try {
                if (e.storage === 'session') {
                  if (!s.sessionStorage.getItem(e.name)) s.sessionStorage.setItem(e.name, e.value);
                } else {
                  if (!s.localStorage.getItem(e.name)) s.localStorage.setItem(e.name, e.value);
                }
              } catch {
                // 忽略无存储权限的页面（如 about:blank）
              }
            }
          },
          entries,
        );
      } catch (e) {
        console.warn('[stage-explore] 注册会话保持 init script 失败（将降级为导航后回灌）:', e instanceof Error ? e.message : e);
      }
    }
    await activeEngine.navigate(systemUrl);
    // 兜底：若目标被服务端重定向到登录页（如门户根路径闸门，302 → #/login），
    // 而导航前页面是已登录的应用页，则回退到导航前页面，避免把接管浏览器丢在登录页上。
    let after = '';
    try { after = await activeEngine.getCurrentUrl(); } catch { after = ''; }
    if (cur && after && isLoginPageUrl(after) && !isLoginPageUrl(systemUrl) && !isLoginPageUrl(cur)) {
      console.warn(`[stage-explore] 目标 ${systemUrl} 被重定向到登录页（${after}），回退到登录前应用页 ${cur}`);
      try { await activeEngine.navigate(cur); } catch { /* 回退失败则保持当前页 */ }
    }
    console.log('[stage-explore] 复用登录浏览器：已跳转到目标路径并保持登录态');
    return [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[stage-explore] 复用登录浏览器导航失败:', e);
    throw new Error(`无法访问系统 URL: ${systemUrl}（${msg}）`);
  }
}

/**
 * 探索阶段主入口。
 * @param input 输入契约（见 ExploreInput）
 * @param engine 可选注入的 MCP 引擎；未注入时惰性创建 headless 引擎（生产环境）
 * @param opts 运行选项（engineHasActiveSession=true 时跳过会话注入，见 ExploreRunOptions）
 *
 * 关键衔接：①登录→②探索 优先复用登录阶段浏览器（opts.engineHasActiveSession），
 * 自建引擎时通过 ensureSession/applySession 注入 login 阶段输出的 sessionHandle；
 * resumeFrom 命中已保存断点时基于其已探索节点集合续跑。
 */
export async function run(
  input: ExploreInput,
  engine?: McpEngine,
  opts?: ExploreRunOptions,
): Promise<ExploreOutput> {
  const validated = validateExploreInput(input);
  console.log(`[stage-explore] 开始探索: subsystemId=${validated.subsystemId}, url=${validated.systemUrl}${opts?.engineHasActiveSession ? '（复用登录浏览器）' : ''}`);

  let activeEngine: McpEngine | undefined = engine;
  let engineSucceeded = false;
  const errorDetails: string[] = [];

  if (!activeEngine) {
    try {
      const mod = await import('@test-platform/engine-mcp');
      activeEngine = mod.createEngine({
        headless: true,
        subsystemId: validated.subsystemId,
        systemId: validated.subsystemId,
        ai: opts?.ai,
      });
      await activeEngine.launch();
      console.log('[stage-explore] 引擎创建并启动成功');
    } catch (e) {
      console.error('[stage-explore] 引擎创建失败:', e);
      errorDetails.push(`引擎创建失败: ${e instanceof Error ? e.message : String(e)}`);
      activeEngine = undefined;
    }
  }

  let moduleTree: ModuleNode[] = [];

  if (activeEngine) {
    try {
      console.log('[stage-explore] 正在启动引擎...');
      console.log(`[stage-explore] 会话诊断: cookies=${validated.sessionHandle.cookies?.length ?? 0}, systemUrl=${validated.systemUrl}`);

      if (opts?.engineHasActiveSession) {
        // 复用登录浏览器：仅导航，不注入会话（防覆盖有效会话导致登出）
        if (validated.systemUrl) {
          errorDetails.push(...(await prepareActiveSessionEngine(activeEngine, validated.systemUrl)));
        }
      } else {
        errorDetails.push(...(await prepareFreshEngineSession(activeEngine, validated)));
      }

      // 执行探索：按 AI 开关二选一（双模式隔离，运行时只走一条路径，绝不互相污染）
      console.log(`[stage-explore] 正在${opts?.ai ? 'AI 辅助' : '结构化'}探索模块树...`);
      moduleTree = opts?.ai
        ? await exploreWithAi(activeEngine, opts.ai, {
            subsystemId: validated.subsystemId,
            systemId: validated.subsystemId,
            startUrl: validated.systemUrl,
          })
        : await exploreNonAi(activeEngine);
      console.log(`[stage-explore] 探索完成，发现 ${moduleTree.length} 个节点`);

      if (moduleTree.length === 0) {
        console.warn('[stage-explore] 探索完成但未发现任何模块节点');
        errorDetails.push('探索未发现可识别的导航菜单或模块');
      }

      engineSucceeded = moduleTree.length > 0;
    } catch (e) {
      console.error('[stage-explore] 引擎执行失败:', e);
      errorDetails.push(`引擎执行失败: ${e instanceof Error ? e.message : String(e)}`);
      engineSucceeded = false;
    }
  } else {
    errorDetails.push('MCP 引擎不可用');
  }

  // Fallback：引擎返回空或失败时，直接报错并提供诊断信息
  if (!engineSucceeded || moduleTree.length === 0) {
    const diagInfo = errorDetails.length > 0 
      ? `诊断信息: ${errorDetails.join('; ')}` 
      : '未获取到任何模块数据，可能页面结构不支持自动识别';
    
    throw new Error(
      `EXPLORE_FAILED: 无法获取真实模块数据。` +
      `子系统 ${validated.subsystemId} 探索失败。${diagInfo}` +
      `。请检查：1) 系统 URL 是否正确且可访问 2) 是否已正确登录 3) 目标页面是否包含导航菜单`
    );
  }

  console.log(`[stage-explore] 探索成功，共 ${moduleTree.length} 个模块`);

  // 断点续跑：若提供 resumeFrom 且命中已保存断点，合并已探索节点继续推进
  if (validated.resumeFrom) {
    const prior = checkpointStore.get(validated.resumeFrom);
    if (prior) {
      moduleTree = mergeCheckpoint(cloneTree(moduleTree), prior);
    }
  }

  if (validated.manualSupplement) {
    moduleTree = mergeManualSupplement(
      moduleTree,
      validated.manualSupplement,
      validated.subsystemId,
    );
  }

  // in-pipeline 粒度闸门：确保产出含操作级功能点（列表/添加/修改/删除等），否则标 needs_review
  assertActionGranularity(moduleTree);

  const coverage = computeCoverage(moduleTree);
  const needsReview = computeNeedsReview(moduleTree);
  const checkpoint = buildCheckpoint(moduleTree, coverage.frontier);

  // 落库断点，供后续 resumeFrom 续跑（无状态运行忽略 resumeFrom）
  checkpointStore.set(checkpoint.checkpointId, checkpoint);

  const output: ExploreOutput = {
    moduleTree,
    coverage,
    needsReview,
    checkpoint,
  };

  return validateExploreOutput(output);
}
