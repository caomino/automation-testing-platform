import {
  HierarchyTreeDescriptor,
  PageNodeDescriptor,
  ActionDescriptor
} from './types.js';

/**
 * 0 重复保障与树形拓扑结构格式化器
 * 对模块 ID、页面路由、细颗粒度操作选择器执行严格去重，确保 0 虚构与 0 冗余
 */
export class HierarchyTreeFormatter {
  /**
   * 去重并统计全树指标
   */
  static formatAndDeduplicate(
    tree: Partial<HierarchyTreeDescriptor>,
    mode: 'non_ai' | 'ai_mcp' = 'non_ai'
  ): HierarchyTreeDescriptor {
    const seenModuleIds = new Set<string>();
    const seenModuleRoutes = new Set<string>();
    const seenPageIds = new Set<string>();
    const seenPageRoutes = new Set<string>();
    const seenActionKeys = new Set<string>();

    let duplicatesRemoved = 0;
    let totalPages = 0;
    let totalActions = 0;

    const cleanModules: PageNodeDescriptor[] = [];

    for (const node of tree.rootNodes || []) {
      const modRoute = (node.routePath || '').toLowerCase().trim();
      const _modKey = `${node.id}_${modRoute}_${node.title}`;
      if (seenModuleIds.has(node.id) || (modRoute && seenModuleRoutes.has(modRoute))) {
        duplicatesRemoved++;
        continue;
      }
      seenModuleIds.add(node.id);
      if (modRoute) seenModuleRoutes.add(modRoute);

      const isSinglePage = (!node.children || node.children.length === 0) && node.actions && node.actions.length > 0;

      if (isSinglePage) {
        totalPages++;
        const cleanActions = this.filterActions(node.id, node.actions, seenActionKeys);
        duplicatesRemoved += (node.actions.length - cleanActions.length);
        totalActions += cleanActions.length;

        cleanModules.push({
          ...node,
          actions: cleanActions
        });
      } else {
        const cleanChildren: PageNodeDescriptor[] = [];
        for (const child of node.children || []) {
          const pageRoute = (child.routePath || '').toLowerCase().trim();
          if (seenPageIds.has(child.id) || (pageRoute && seenPageRoutes.has(pageRoute))) {
            duplicatesRemoved++;
            continue;
          }
          seenPageIds.add(child.id);
          if (pageRoute) seenPageRoutes.add(pageRoute);

          totalPages++;
          const cleanChildActions = this.filterActions(child.id, child.actions, seenActionKeys);
          duplicatesRemoved += ((child.actions?.length || 0) - cleanChildActions.length);
          totalActions += cleanChildActions.length;

          cleanChildren.push({
            ...child,
            actions: cleanChildActions
          });
        }

        cleanModules.push({
          ...node,
          children: cleanChildren
        });
      }
    }

    return {
      systemId: tree.systemId || 'sys_default',
      systemName: tree.systemName || '系统管理后台',
      url: tree.url || '',
      frameworkType: tree.frameworkType || 'generic',
      scannedAt: tree.scannedAt || new Date().toISOString(),
      traversalMode: mode,
      isRealTimeScanned: tree.isRealTimeScanned ?? true,
      isDeduplicated: true,
      duplicateCountRemoved: duplicatesRemoved,
      totalModules: cleanModules.length,
      totalPages,
      totalActions,
      rootNodes: cleanModules
    };
  }

  /**
   * 动作选择器去重与规范化
   */
  private static filterActions(
    pageId: string,
    actions: ActionDescriptor[] = [],
    seenActionKeys: Set<string>
  ): ActionDescriptor[] {
    const result: ActionDescriptor[] = [];
    for (const act of actions) {
      const normSelector = (act.selector || '').replace(/\s+/g, ' ').trim();
      const actionKey = `${pageId}::${act.type}::${act.title}::${normSelector}`;
      const actionIdKey = `${pageId}::${act.id}`;

      if (seenActionKeys.has(actionKey) || seenActionKeys.has(actionIdKey)) {
        continue;
      }
      seenActionKeys.add(actionKey);
      seenActionKeys.add(actionIdKey);

      result.push({
        ...act,
        selector: normSelector
      });
    }
    return result;
  }
}
