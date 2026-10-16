import { dynamicRealTimeScan } from './dynamicScanner.js';
import type { ModuleNode } from '@test-platform/contracts';

export async function exploreViaAutoHub(
  subsystemId: string,
  url: string,
  mode: 'non_ai' | 'ai_mcp',
  getGenAI: () => any
): Promise<ModuleNode[]> {
  const target = {
    id: subsystemId,
    name: subsystemId,
    url,
    authType: 'guest',
    framework: 'generic'
  };

  const dynamicTree = await dynamicRealTimeScan(
    target,
    mode,
    getGenAI,
    undefined,
    (log) => console.log(`[AutoHub] ${log.level}: ${log.message}`)
  );

  // Convert DynamicSystemTree to ModuleNode[]
  return convertToModuleNodes(dynamicTree.rootNodes, subsystemId);
}

function convertToModuleNodes(nodes: any[], subsystemId: string, parentId: string | null = null, depth = 0): ModuleNode[] {
  const result: ModuleNode[] = [];
  for (const node of nodes) {
    const moduleId = node.id || Math.random().toString(36).substr(2, 9);
    const mNode: ModuleNode = {
      id: moduleId,
      label: node.title,
      parentId,
      subsystemId,
      type: node.level === 1 ? 'module' : 'page',
      status: 'covered',
      depth,
      children: [],
      url: node.routePath
    };
    
    if (node.children && node.children.length > 0) {
      mNode.children = convertToModuleNodes(node.children, subsystemId, moduleId, depth + 1);
    } else if (node.actions && node.actions.length > 0) {
      // leaf page with actions：透传动作语义（type→actionKind、selector→actionSelector、title→actionText），
      // 并让 action 继承页面 URL（routePath），供用例阶段按路径进入页面（参考 D:\Test 探索证据带页面层级）。
      mNode.type = 'page';
      const actionNodes: ModuleNode[] = node.actions.map((act: any) => ({
        id: act.id || Math.random().toString(36).substr(2, 9),
        label: act.title,
        parentId: moduleId,
        subsystemId,
        type: 'action',
        status: 'covered',
        depth: depth + 1,
        children: [],
        url: node.routePath,
        actionKind: act.type,
        actionSelector: act.selector,
        actionText: act.title,
      }));
      mNode.children = actionNodes;
    }
    
    result.push(mNode);
  }
  return result;
}
