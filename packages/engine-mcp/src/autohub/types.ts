/**
 * Universal Route & Menu Hierarchy Types
 * 适配 8 大类管理系统菜单来源的核心实体规范
 */

export type MenuSourceCategory =
  | 'category_1_dom'            // ① 直接写死在 HTML / DOM (SSR, PHP, JSP)
  | 'category_2_spa_router'     // ② 前端配置生成 (Vue/React Router, history/hash)
  | 'category_3_backend_api'    // ③ 菜单来自后端 API (/api/menu, /api/getRouters)
  | 'category_4_rbac_dynamic'   // ④ 权限/RBAC 动态过滤
  | 'category_5_async_chunk'    // ⑤ 懒加载/异步组件分包 (Webpack/Vite async chunks)
  | 'category_6_micro_frontend' // ⑥ 微前端/Iframe 容器 (qiankun, wujie, micro-app)
  | 'category_7_state_modal'    // ⑦ 无路由单页状态机/抽屉/Tab
  | 'category_8_lowcode_schema';// ⑧ 低代码/元数据驱动 (AMIS, 宜搭, Formily)

export type ActionType =
  | 'create'
  | 'update'
  | 'delete'
  | 'query'
  | 'export'
  | 'import'
  | 'detail'
  | 'batch_delete'
  | 'auth'
  | 'other';

export interface ActionDescriptor {
  id: string;
  title: string;
  type: ActionType;
  selector: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  apiEndpoint?: string;
  permissionKey?: string;
  formFields?: string[];
  description?: string;
  testScript?: string;
}

export interface PageNodeDescriptor {
  id: string;
  title: string;
  routePath: string;
  level: number;
  componentName?: string;
  sourceType?: MenuSourceCategory;
  tableColumns?: string[];
  actions: ActionDescriptor[];
  children?: PageNodeDescriptor[];
}

export interface HierarchyTreeDescriptor {
  systemId: string;
  systemName: string;
  url: string;
  frameworkType: string;
  scannedAt: string;
  traversalMode: 'non_ai' | 'ai_mcp';
  sourceCategoryMatched?: MenuSourceCategory[];
  totalModules: number;
  totalPages: number;
  totalActions: number;
  isDeduplicated?: boolean;
  duplicateCountRemoved?: number;
  isRealTimeScanned?: boolean;
  rootNodes: PageNodeDescriptor[];
}

export interface NetworkMenuPayload {
  url: string;
  method: string;
  status: number;
  data: any;
}
