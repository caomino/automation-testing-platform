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
import { classifyActionLabel } from './actionKind';
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

/**
 * 功能点所在「可导航页面」URL。
 * action 节点的 url 多为动作自身 href（javascript:void(0)），不能用于二次探索；
 * 此时回退到最近的、**可导航**的祖先页面 —— 否则用例阶段拿不到页面地址，
 * 只能退化为按名称点击（多匹配即被只读策略阻断）→ 证据缺失 → 用例 0 行。
 *
 * 可导航 = 绝对 http(s) URL 或站内相对路径（`/system/user`）。
 * 仅排除 javascript:/mailto:/tel:/# 等动作自身伪地址 —— 保留相对路径是必需的：
 * 多数后台模块树的 page.url 就是站内相对路径，此前因只认 http(s) 被整体丢弃，
 * 导致 featurePaths 为空、二次探索主链路 early-return。
 */
function resolvePageUrl(node: ModuleNode, parentOf: Map<string, ModuleNode | null>): string | undefined {
  const usable = (u?: string): boolean => {
    const v = (u ?? '').trim();
    if (!v) return false;
    if (/^(javascript|mailto|tel|data|about):/i.test(v)) return false;
    return /^https?:\/\//i.test(v) || v.startsWith('/');
  };
  if (usable(node.url)) return node.url;
  let cur = parentOf.get(node.id) ?? null;
  while (cur) {
    if (usable(cur.url)) return cur.url;
    cur = parentOf.get(cur.id) ?? null;
  }
  return node.url;
}

/**
 * 推断系统站 origin：树上全部 http(s) URL 的 origin 频次统计，最高者为系统站。
 * 通用判据（HARD RULE #0）：不引用任何系统名/域名 —— 官网/帮助等外链菜单的 URL
 * 属于其它站点，不应作为功能点的可导航路径写入 featurePaths（否则用例阶段会
 * 拿外网地址去导航，探索的是外部系统）。
 */
function inferSiteOrigin(nodes: ModuleNode[]): string | undefined {
  const counts = new Map<string, number>();
  const walk = (list: ModuleNode[]): void => {
    for (const n of list) {
      const m = /^https?:\/\/([^/]+)/i.exec((n.url ?? '').trim());
      if (m) counts.set(m[1].toLowerCase(), (counts.get(m[1].toLowerCase()) ?? 0) + 1);
      walk(n.children);
    }
  };
  walk(nodes);
  let best: string | undefined;
  let bestCount = 0;
  for (const [origin, count] of counts) {
    if (count > bestCount) { best = origin; bestCount = count; }
  }
  return best;
}

/** 站内路径判定：相对路径（/开头）恒站内；绝对 URL 仅当 host 与系统站一致 */
function isSameSiteUrl(url: string, siteHost: string | undefined): boolean {
  const v = url.trim();
  if (v.startsWith('/')) return true;
  const m = /^https?:\/\/([^/]+)/i.exec(v);
  if (!m) return false;
  return siteHost === undefined || m[1].toLowerCase() === siteHost;
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
  const siteHost = inferSiteOrigin(moduleTree);

  interface Resolved {
    node: ModuleNode;
    mainModuleNode: ModuleNode | null;
    subModuleNode: ModuleNode | null;
    prov: ReturnType<typeof deriveProvenance>;
  }

  const resolved: Resolved[] = leaves.map((node) => {
    const ancestors = moduleAncestors(node, parentOf);
    // 业务映射（用户规则 + docs §5.3 + verify 契约树）：
    //   ancestors 按「从叶子向上」收集：ancestors[0]=最近层级祖先(二级目录)，ancestors[1]=次近层级祖先(一级目录)
    //   一级目录永远 = 主模块（ancestors[1]，如 系统管理/检查室管理）
    //   二级目录 = 子模块（ancestors[0]，如 用户管理/检查室）
    //   仅有一级目录时（首页/AI对话 顶层 page 直接挂 action）：主=该层、子=空 → RUOYI_SY_X_01
    const mainModuleNode = ancestors[1] ?? ancestors[0] ?? null;
    const subModuleNode = ancestors.length >= 2 ? ancestors[0] : null;
    return { node, mainModuleNode, subModuleNode, prov: deriveProvenance(node) };
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
    // 主模块缩写 = 一级目录 label；无一级目录（顶层 page 直接挂 action，如 首页/AI对话）时
    // 回退到**节点自身 label**（首页→SY），而不是系统名（否则 systemName 与 systemAbbr 同源，
    // 会产出 `<系统缩写>_<系统缩写>_X_01` 这类双段重复标识）。
    const mainAbbr = rep.mainModuleNode
      ? toAbbrTokenWithLabel(rep.mainModuleNode.id, rep.mainModuleNode.label)
      : toAbbrTokenWithLabel(rep.node.id, rep.node.label);
    const subAbbr = rep.subModuleNode
      ? toAbbrTokenWithLabel(rep.subModuleNode.id, rep.subModuleNode.label)
      : 'X';
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

      // 功能点 = 子模块（二级目录）标签；无子模块时回退为主模块（一级目录）标签。
      // 与前端 moduleTreeToFeatureTable 的 feature=curPage||curModule 保持一致：
      // 功能点==子模块 时，UI 显示层会把功能点列置空（只显示子模块），原始数据仍保留。
      const featureName = r.subModuleNode?.label ?? r.mainModuleNode?.label ?? r.node.label;
      // 测试点 = 当前节点标签（具体测试动作）
      const testPoint = r.node.label;

      const row: FeatureRow = [
        String(localIdx + 1),          // 序号
        TEST_TYPE_DEFAULT,             // 测试类型
        requirementSection,            // 需求章节（X.Y.Z 占位）
        systemName,                    // 系统名称
        r.mainModuleNode?.label ?? '', // 主模块（=一级目录）
        r.subModuleNode?.label ?? '',  // 子模块（=二级目录；无二级时留空）
        featureName,                   // 功能点（子模块名，无则主模块名）
        testPoint,                     // 测试点（节点标签）
        testPointId,                   // 测试点标识（base_NN，行内全局唯一）
      ];
      rows.push(row);
      featureIds.push(testPointId);
      // 根因解法：把功能点所在「真实页面 URL」带出，供用例阶段按所选模块精准探索。
      // action 节点自身 href 常为 javascript:，须回退到祖先页面 URL（见 resolvePageUrl）。
      // 外链（与系统站不同 origin 的官网/帮助菜单）不写入 featurePaths ——
      // 否则用例阶段会拿外网地址去导航；功能点保留，由用例阶段诚实降级标注。
      const pageUrl = resolvePageUrl(r.node, parentOf);
      if (pageUrl && isSameSiteUrl(pageUrl, siteHost)) featurePaths[testPointId] = pageUrl;
      // 动作类型：探索阶段已写入则透传；缺失（AI 补全 / 人工补录 / 旧探索产物）时
      // 按节点标签的**通用动词语义**兜底分类（见 actionKind.ts），避免功能点全量塌成 other。
      const actionText = r.node.actionText ?? r.node.label;
      const actionKind = r.node.actionKind ?? classifyActionLabel(actionText) ?? 'other';
      // 菜单点击路径（评审文档 #1 处方的数据层落地）：沿模块树祖先链生成 'menu:一级>二级'，
      // 供用例阶段二次探索**按菜单文本逐级点击进入**（复用登录会话、不直接打开地址）。
      // 天然免疫 URL 脏数据（路径退化成站点根地址时菜单路径仍精确指向真实菜单）。
      const menuLabels = moduleAncestors(r.node, parentOf)
        .filter((a) => a.type === 'module' || a.type === 'page')
        .map((a) => a.label)
        .filter(Boolean)
        .reverse();
      if (r.node.type !== 'action' && r.node.label) menuLabels.push(r.node.label);
      const menuPath = menuLabels.length > 0 ? menuLabels.join('>') : undefined;
      featureProfiles.push({
        featureId: testPointId,
        testPoint,
        actionKind,
        pageUrl,
        clickSelector: r.node.actionSelector,
        parentModule: r.mainModuleNode?.label,
        subsystemId: r.node.subsystemId,
        // actionText 兜底为节点标签：二次探索需要「入口文本」在页面内按文本定位动作按钮
        // （新增/详情等）。此前 actionText 恒为空 → 即便动作类型正确也无法定位按钮。
        sourceLabel: actionText,
        // 菜单路径优先 —— 二次探索的「点击进入」依据；无菜单路径时回退动作选择器（旧行为）
        sourceSelector: menuPath ? `menu:${menuPath}` : r.node.actionSelector,
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
