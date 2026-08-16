/**
 * @file featureTable.ts
 * @description 由模块树生成九列功能点表（含测试点标识 base_NN、溯源、confirmedOnly 过滤）
 *
 * 九列：序号/测试类型/需求章节/系统名称/主模块/子模块/功能点/测试点/测试点标识
 * 测试点标识 = base_NN，base = 系统缩写_父目录缩写_子系统缩写（严格 3 段），
 * NN 按子系统维度从 01 递增。整张功能点表每个测试点标识行内全局唯一
 * （跨分组 base 碰撞时追加去重后缀），它是用例编号绑定键（见 docs §5.4）。
 */
import type { ModuleNode, FeatureRow, FeatureProvenance } from '@test-platform/contracts';
import { toAbbrToken, systemAbbrFromSubsystemId } from './abbreviation';
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
 * 由节点向上收集 module/system/subsystem 类型祖先（最近祖先在前）。
 * - 最近 module 祖先 = 子系统（subModule）
 * - 其上一层 module 祖先 = 主模块（mainModule）
 */
function moduleAncestors(node: ModuleNode, parentOf: Map<string, ModuleNode | null>): ModuleNode[] {
  const result: ModuleNode[] = [];
  let cur = parentOf.get(node.id) ?? null;
  while (cur) {
    if (cur.type === 'module' || cur.type === 'system') {
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
    prov: ReturnType<typeof deriveProvenance>;
  }

  const resolved: Resolved[] = leaves.map((node) => {
    const ancestors = moduleAncestors(node, parentOf);
    const subModuleNode = ancestors[0] ?? null;
    const mainModuleNode = ancestors[1] ?? ancestors[0] ?? null;
    return { node, mainModuleNode, subModuleNode, prov: deriveProvenance(node) };
  });

  // confirmedOnly：丢弃未确认（ai_generated）行，合并后过滤
  const kept = confirmedOnly ? resolved.filter((r) => r.prov.confirmed) : resolved;

  // 按子系统分组（保持 DFS 顺序）
  const groupOrder: string[] = [];
  const groups = new Map<string, Resolved[]>();
  for (const r of kept) {
    const key = r.subModuleNode?.id ?? `__root_${systemName}`;
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
  const usedTestPointIds = new Set<string>();
  let collisionSeq = 0;
  let globalIndex = 0;

  groupOrder.forEach((key, groupIdx) => {
    const group = groups.get(key)!;
    const rep = group[0];
    const systemAbbr = systemAbbrFromSubsystemId(rep.node.subsystemId, systemName);
    const mainAbbr = rep.mainModuleNode ? toAbbrToken(rep.mainModuleNode.id) : toAbbrToken(systemName);
    const subAbbr = rep.subModuleNode ? toAbbrToken(rep.subModuleNode.id) : toAbbrToken(rep.node.id);
    const base = `${systemAbbr}_${mainAbbr}_${subAbbr}`;
    // 需求章节：优先使用真实数据（requirementSections 映射），否则采用 X.0.0 分组占位
    const realSection = requirementSections?.get(key);
    const requirementSection = realSection ?? `${groupIdx + 1}.0.0`;

    const rows: FeatureRow[] = [];
    group.forEach((r, localIdx) => {
      let testPointId = `${base}_${pad2(localIdx + 1)}`;
      // 跨分组 base 碰撞时追加去重后缀，保证整表行内全局唯一（用例编号绑定键）
      if (usedTestPointIds.has(testPointId)) {
        do {
          collisionSeq += 1;
          testPointId = `${base}_${pad2(localIdx + 1)}_C${pad2(collisionSeq)}`;
        } while (usedTestPointIds.has(testPointId));
      }
      usedTestPointIds.add(testPointId);

      // 功能点 = 父模块标签 + 当前节点标签（描述功能）
      const featureName = r.mainModuleNode
        ? `${r.mainModuleNode.label}-${r.node.label}`
        : r.node.label;
      // 测试点 = 当前节点标签（具体测试动作）
      const testPoint = r.node.label;

      const row: FeatureRow = [
        String(localIdx + 1),          // 序号
        TEST_TYPE_DEFAULT,             // 测试类型
        requirementSection,            // 需求章节（X.Y.Z 占位）
        systemName,                    // 系统名称
        r.mainModuleNode?.label ?? '', // 主模块（=父目录）
        r.subModuleNode?.label ?? r.node.label, // 子模块（=子系统）
        featureName,                   // 功能点（父模块-节点）
        testPoint,                     // 测试点（节点标签）
        testPointId,                   // 测试点标识（base_NN，行内全局唯一）
      ];
      rows.push(row);
      featureIds.push(testPointId);
      // 根因解法：把模块树叶子节点的真实页面 URL 带出，供用例阶段按所选模块精准探索
      if (r.node.url) featurePaths[testPointId] = r.node.url;

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
  return { featureTable, featureIds: dedupedFeatureIds, provenance, featurePaths };
}
