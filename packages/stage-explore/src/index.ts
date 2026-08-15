/**
 * @file index.ts
 * @description 探索阶段入口：MCP 引擎遍历模块树 + 人工补充合并 + 覆盖率/断点计算
 * @frozen 依赖 contracts 契约（ExploreInput/Output、ModuleNode、ManualSupplement、McpExplorationCheckpoint）
 */

import type { McpEngine } from '@test-platform/engine-mcp';
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
 * 引擎「可注入会话」能力结构类型。
 * 注意：engine-mcp 已冻结接口含 applySession，但其 dist 声明偶发滞后、未包含该方法；
 * 此处按冻结契约以结构类型断言（不使用 any）调用，运行时真实引擎与测试假引擎均实现它。
 */
type SessionCapableEngine = McpEngine & {
  applySession(state: {
    cookies: string[];
    headers?: Record<string, string>;
    tokens?: string[];
  }): Promise<void>;
};

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
function dedupeClickPath(paths: ClickPath[]): ClickPath[] {
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

/**
 * 探索阶段主入口。
 * @param input 输入契约（见 ExploreInput）
 * @param engine 可选注入的 MCP 引擎；未注入时惰性创建 headless 引擎（生产环境）
 *
 * 关键衔接：①登录→②探索 的会话衔接通过 engine.applySession 注入 login 阶段输出的
 * sessionHandle（cookies/headers/tokens）实现；resumeFrom 命中已保存断点时基于其
 * 已探索节点集合续跑。
 */
export async function run(
  input: ExploreInput,
  engine?: McpEngine,
): Promise<ExploreOutput> {
  const validated = validateExploreInput(input);

  let activeEngine: McpEngine | undefined = engine;
  if (!activeEngine) {
    const mod = await import('@test-platform/engine-mcp');
    activeEngine = mod.createEngine({ headless: true });
  }

  // ①→② 会话衔接：将登录阶段产出的 sessionHandle 真正注入引擎上下文
  const sessionEngine = activeEngine as unknown as SessionCapableEngine;
  await sessionEngine.applySession({
    cookies: validated.sessionHandle.cookies,
    headers: validated.sessionHandle.headers,
    tokens: validated.sessionHandle.tokens,
  });

  let moduleTree = await activeEngine.exploreModules();

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
