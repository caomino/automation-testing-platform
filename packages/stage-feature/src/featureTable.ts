/**
 * @file featureTable.ts
 * @description 由模块树生成九列功能点表（含测试点标识 base_NN、溯源、confirmedOnly 过滤）
 *
 * 九列：序号/测试类型/需求章节/系统名称/主模块/子模块/功能点/测试点/测试点标识
 * 测试点标识 = base_NN，base = 系统缩写_父目录缩写_子系统缩写（严格 3 段），
 * NN 按子系统维度从 01 递增。整张功能点表每个测试点标识行内全局唯一
 * （跨分组 base 碰撞时追加去重后缀），它是用例编号绑定键（见 docs §5.4）。
 */
import type { FeatureProfile, ModuleNode, FeatureRow, FeatureProvenance } from '@test-platform/contracts';
import { toAbbrToken, systemAbbrFromSubsystemId, toAbbrTokenWithLabel } from './abbreviation';
import { deriveProvenance, makeProvenanceId } from './provenance';

/** 默认测试类型（功能性测试；后续可由知识库/配置扩展） */
const TEST_TYPE_DEFAULT = '功能性测试';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface TreeIndex {
  /** 叶子节点（无 children）按 DFS 顺序排列 */
  leaves: ModuleNode[];
  /** 节点 id → 父节点（根节点父为 null） */
  parentOf: Map<string, ModuleNode | null>;
}

/** 遍历模块树，收集叶子节点与父指针索引 */
function buildIndex(nodes: ModuleNode[]): TreeIndex {
  const leaves: ModuleNode[] = [];
  const parentOf = new Map<string, ModuleNode | null>();
  const walk = (list: ModuleNode[], parent: ModuleNode | null): void => {
    for (const n of list) {
      parentOf.set(n.id, parent);
      if (n.children.length === 0) leaves.push(n);
      else walk(n.children, n);
    }
  };
  walk(nodes, null);
  return { leaves, parentOf };
}

/**
 * 由节点向上收集所有「层级祖先」（page/module/system，不含 action），最近祖先在前。
 * 业务映射（与前端 moduleTreeToFeatureTable、docs 主规格 §5.3 一致）：
 * - 最近层级祖先 = 子系统（subModule）
 * - 再上一层层级祖先 = 主模块（mainModule，=父目录）
 * 兼容两种真实树形：
 *   a) system → module(主模块) → page(子模块) → action   （ruoyi 系统管理/用户管理）
 *   b) system → page(子模块) → action                     （ruoyi 首页/AI对话，无 module 层 → mainModule 空）
 * 以及 verify 测试树：system → module(主) → module(子) → page(功能点叶子)。
 */
function moduleAncestors(node: ModuleNode, parentOf: Map<string, ModuleNode | null>): ModuleNode[] {
  const result: ModuleNode[] = [];
  let cur = parentOf.get(node.id) ?? null;
  while (cur) {
    if (cur.type === 'module' || cur.type === 'system' || cur.type === 'page') {
      result.push(cur);
    }
    cur = parentOf.get(cur.id) ?? null;
  }
  return result;
}

export interface BuildResult {
  featureTable: FeatureRow[][];
  featureIds: string[];
  provenance: FeatureProvenance[];
  /** 测试点标识 → 真实页面 URL（探索阶段采集，供用例阶段二次探索定位页面） */
  featurePaths: Record<string, string>;
  /** 功能点动作档案（仅透传探索阶段语义，不在本阶段重新分类） */
  featureProfiles: FeatureProfile[];
}

/**
 * 由模块树生成九列功能点表。
 * 1) 解析每个叶子节点的主模块/子系统上下文与溯源
 * 2) confirmedOnly 过滤（合并后）
 * 3) 按子系统分组（保持 DFS 顺序）
 * 4) 生成九列 + 测试点标识 base_NN + 溯源（NN 每组从 01 递增）
 *
 * @param moduleTree 模块树
 * @param systemName 系统名称
 * @param confirmedOnly 仅返回已确认功能点
 * @param requirementSections 可选的真实需求章节映射（key=子模块id，value=章节号如 "1.2.3"）
 *        未提供时使用分组序号占位（X.0.0），由调用方（如 Excel 解析器）在运行时注入真实数据
 */
export function buildFeatureTable(
  moduleTree: ModuleNode[],
  systemName: string,
  confirmedOnly: boolean,
  requirementSections?: Map<string, string>,
): BuildResult {
  const { leaves, parentOf } = buildIndex(moduleTree);

  interface Resolved {
    node: ModuleNode;
    mainModuleNode: ModuleNode | null;
    subModuleNode: ModuleNode | null;
    featureNode: ModuleNode | null;
    resolvedUrl: string | undefined;
    prov: ReturnType<typeof deriveProvenance>;
  }

  const resolved: Resolved[] = leaves.map((node) => {
    const ancestors = moduleAncestors(node, parentOf);
    // ancestors 从叶子向上收集，因此根节点在末尾 (ancestors.length - 1)
    // 根据业务规则：
    //   主模块永远是根节点 (ancestors[length - 1])
    //   测试点永远是叶子节点 (node)
    //   从底层向上推：离叶子最近的祖先 (ancestors[0]) 是功能点，再往上 (ancestors[1]) 是子模块
    const rootIndex = ancestors.length - 1;
    const mainModuleNode = rootIndex >= 0 ? ancestors[rootIndex] : null;
    
    const featureNode = ancestors.length >= 2 ? ancestors[0] : null;
    const subModuleNode = ancestors.length >= 3 ? ancestors[1] : null;

    let resolvedUrl = node.url;
    if (!resolvedUrl) {
      const urlNode = ancestors.find(a => !!a.url);
      if (urlNode) resolvedUrl = urlNode.url;
    }

    return { node, mainModuleNode, subModuleNode, featureNode, resolvedUrl, prov: deriveProvenance(node) };
  });

  // confirmedOnly：丢弃未确认（ai_generated）行，合并后过滤
  const kept = confirmedOnly ? resolved.filter((r) => r.prov.confirmed) : resolved;

  // 按子系统分组（保持 DFS 顺序）；无子模块时按主模块分组（首页/AI对话 各自独立递增）
  const groupOrder: string[] = [];
  const groups = new Map<string, Resolved[]>();
  for (const r of kept) {
    const key = r.subModuleNode?.id ?? r.mainModuleNode?.id ?? `__root_${systemName}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(r);
  }

  const featureTable: FeatureRow[][] = [];
  const featureIds: string[] = [];
  const provenance: FeatureProvenance[] = [];
  const featurePaths: Record<string, string> = {};
  const featureProfiles: FeatureProfile[] = [];
  const usedTestPointIds = new Set<string>();
  let collisionSeq = 0;
  let globalIndex = 0;

  groupOrder.forEach((key, groupIdx) => {
    const group = groups.get(key)!;
    const rep = group[0];
    // 系统缩写：subsystemId 语义 id 优先；subsystemId 为 system 型时也接受中文 fallback（systemName）
    const systemAbbr = systemAbbrFromSubsystemId(rep.node.subsystemId, systemName);
    // 主模块缩写 = 一级目录 label；子模块缩写 = 二级目录 label（无二级时留空 → X 占位，保证 base 恒 3 段）
    const mainAbbr = rep.mainModuleNode
      ? toAbbrTokenWithLabel(rep.mainModuleNode.id, rep.mainModuleNode.label)
      : toAbbrTokenWithLabel(systemName, systemName);
    const subAbbr = rep.subModuleNode
      ? toAbbrTokenWithLabel(rep.subModuleNode.id, rep.subModuleNode.label)
      : 'X';
    const base = `${systemAbbr}_${mainAbbr}_${subAbbr}`;
    // 需求章节：优先使用真实数据（requirementSections 映射），否则采用 X.0.0 分组占位
    const realSection = requirementSections?.get(key);
    const requirementSection = realSection ?? `${groupIdx + 1}.0.0`;

    const rows: FeatureRow[] = [];
    group.forEach((r, localIdx) => {
      globalIndex += 1;
      let testPointId = `${base}_${pad2(localIdx + 1)}`;
      // 跨分组 base 碰撞时追加去重后缀，保证整表行内全局唯一（用例编号绑定键）
      if (usedTestPointIds.has(testPointId)) {
        do {
          collisionSeq += 1;
          testPointId = `${base}_${pad2(localIdx + 1)}_C${pad2(collisionSeq)}`;
        } while (usedTestPointIds.has(testPointId));
      }
      usedTestPointIds.add(testPointId);

      // 业务规则：三级目录=功能点，无则为空
      const featureName = r.featureNode?.label ?? '';
      // 测试点 = 当前节点标签（具体测试动作）
      const testPoint = r.node.label;

      const row: FeatureRow = [
        String(globalIndex),           // 序号（全局自增）
        TEST_TYPE_DEFAULT,             // 测试类型
        requirementSection,            // 需求章节（X.Y.Z 占位）
        systemName,                    // 系统名称
        r.mainModuleNode?.label ?? '', // 主模块（=一级目录）
        r.subModuleNode?.label ?? '',  // 子模块（=二级目录；无二级时留空）
        featureName,                   // 功能点（=三级目录；无三级时留空）
        testPoint,                     // 测试点（节点标签）
        testPointId,                   // 测试点标识（base_NN，行内全局唯一）
      ];
      rows.push(row);
      featureIds.push(testPointId);
      // 根因解法：把模块树叶子节点的真实页面 URL 带出，供用例阶段按所选模块精准探索
      if (r.resolvedUrl) featurePaths[testPointId] = r.resolvedUrl;
      featureProfiles.push({
        featureId: testPointId,
        testPoint,
        actionKind: r.node.actionKind ?? 'other',
        pageUrl: r.resolvedUrl,
        clickSelector: r.node.actionSelector,
        parentModule: r.mainModuleNode?.label,
        subsystemId: r.node.subsystemId,
        sourceLabel: r.node.actionText,
        sourceSelector: r.node.actionSelector,
        source: r.node.actionSelector?.startsWith('design:openapi:') ? 'openapi' : r.node.actionSelector?.startsWith('design:workflow:') ? 'workflow' : r.node.manuallyAdded ? 'manual' : 'web',
      });

      const rowContent = row.join('|');
      provenance.push({
        provenanceId: makeProvenanceId(rowContent),
        featureRowIndex: globalIndex,
        source: r.prov.source,
        evidenceId: r.prov.evidenceId,
        confirmed: r.prov.confirmed,
      });
      globalIndex++;
    });
    featureTable.push(rows);
  });

  // featureIds 去重（testPointId 已全局唯一，此处仅作显式保底）
  const dedupedFeatureIds = Array.from(new Set(featureIds));
  return { featureTable, featureIds: dedupedFeatureIds, provenance, featurePaths, featureProfiles };
}
