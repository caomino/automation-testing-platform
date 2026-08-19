import { PageNodeDescriptor, ActionDescriptor, MenuSourceCategory } from './types.js';

/**
 * 类别 ③: 后端 API / 异步下发路由嗅探器
 * 针对 /api/menu, /api/router, /api/menus, /api/user/menu, /api/permission, /api/asyncRoutes 等接口进行结构化逆向
 */
export class BackendApiMenuSniffer {
  /**
   * 判断一个响应是否为后台菜单路由相关的 Payload
   */
  static isMenuRelatedResponse(url: string, data: any): boolean {
    if (!data) return false;
    const urlLower = url.toLowerCase();
    const isUrlMatch = /(menu|menus|menutree|routes|router|asyncroutes|permission|nav|sidebar|getrouters)/i.test(urlLower);
    if (isUrlMatch) return true;

    // 检查结构特征
    if (Array.isArray(data)) {
      return data.some(item => this.hasMenuNodeCharacteristics(item));
    }
    if (typeof data === 'object') {
      const candidates = data.data || data.result || data.rows || data.routes || data.menus || data.children || data.list;
      if (Array.isArray(candidates)) {
        return candidates.some(item => this.hasMenuNodeCharacteristics(item));
      }
    }
    return false;
  }

  /**
   * 递归将后端返回的 JSON 菜单树转换为通用 PageNodeDescriptor 标准节点
   */
  static parseMenuTreeFromApiResponse(data: any, prefix: string, isAi: boolean): PageNodeDescriptor[] {
    const rawList = this.extractRawList(data);
    if (!rawList || rawList.length === 0) return [];

    return this.convertRawNodesToDescriptors(rawList, prefix, isAi, 1);
  }

  private static extractRawList(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data.data)) return data.data;
      if (Array.isArray(data.result)) return data.result;
      if (Array.isArray(data.routes)) return data.routes;
      if (Array.isArray(data.menus)) return data.menus;
      if (Array.isArray(data.list)) return data.list;
      if (Array.isArray(data.rows)) return data.rows;
    }
    return [];
  }

  private static hasMenuNodeCharacteristics(item: any): boolean {
    if (!item || typeof item !== 'object') return false;
    return !!(
      item.path || item.url || item.route || item.router ||
      item.name || item.title || item.meta?.title || item.menuName ||
      item.children || item.subMenus
    );
  }

  private static convertRawNodesToDescriptors(
    list: any[],
    prefix: string,
    isAi: boolean,
    level: number
  ): PageNodeDescriptor[] {
    const result: PageNodeDescriptor[] = [];

    list.forEach((item, idx) => {
      const title = (
        item.title ||
        item.meta?.title ||
        item.name ||
        item.menuName ||
        item.label ||
        item.text ||
        `菜单节点 ${idx + 1}`
      ).trim();

      const routePath = (
        item.path ||
        item.url ||
        item.route ||
        item.router ||
        item.component ||
        `/${title.toLowerCase().replace(/\s+/g, '_')}`
      ).trim();

      const rawChildren = item.children || item.subMenus || item.list || item.nodes;
      const hasChildren = Array.isArray(rawChildren) && rawChildren.length > 0;

      const nodeId = `${prefix}_api_${level}_${idx}_${Math.random().toString(36).slice(2, 6)}`;

      if (hasChildren) {
        const children = this.convertRawNodesToDescriptors(rawChildren, prefix, isAi, level + 1);
        result.push({
          id: nodeId,
          title,
          routePath,
          level,
          sourceType: 'category_3_backend_api',
          actions: [],
          children
        });
      } else {
        const actions = this.generateDefaultActionsForLeaf(title, routePath, nodeId, isAi);
        result.push({
          id: nodeId,
          title,
          routePath,
          level,
          sourceType: 'category_3_backend_api',
          tableColumns: ['序号', '业务标识', '名称/标题', '状态', '创建时间', '操作'],
          actions
        });
      }
    });

    return result;
  }

  private static generateDefaultActionsForLeaf(
    title: string,
    routePath: string,
    pageId: string,
    isAi: boolean
  ): ActionDescriptor[] {
    const cleanTitle = title.replace(/[\(\)（）\s]/g, '');
    const isUserRole = /用户|管理员|员工|账号|成员/i.test(cleanTitle);

    const baseActions: ActionDescriptor[] = [
      {
        id: `${pageId}_act_query`,
        title: `查询/刷新${cleanTitle}数据`,
        type: 'query',
        selector: isAi ? `role=button[name='查询'], role=button[name='搜索']` : `button:has-text('查询'), .btn-search`,
        method: 'GET',
        apiEndpoint: `${routePath}/list`
      },
      {
        id: `${pageId}_act_create`,
        title: `新增${cleanTitle}`,
        type: 'create',
        selector: isAi ? `role=button[name='新增'], role=button[name='添加']` : `button:has-text('新增'), .btn-add`,
        method: 'POST',
        apiEndpoint: `${routePath}/create`,
        formFields: ['title', 'status', 'remark']
      },
      {
        id: `${pageId}_act_update`,
        title: `编辑修改${cleanTitle}`,
        type: 'update',
        selector: isAi ? `role=button[name='编辑'], role=button[name='修改']` : `a:has-text('编辑'), .btn-edit`,
        method: 'POST',
        apiEndpoint: `${routePath}/update`
      },
      {
        id: `${pageId}_act_delete`,
        title: `删除${cleanTitle}记录`,
        type: 'delete',
        selector: isAi ? `role=button[name='删除']` : `a:has-text('删除'), .btn-del`,
        method: 'POST',
        apiEndpoint: `${routePath}/delete`
      }
    ];

    if (isUserRole) {
      baseActions.push({
        id: `${pageId}_act_auth`,
        title: `分配${cleanTitle}角色权限`,
        type: 'auth',
        selector: isAi ? `role=button[name='分配权限'], role=button[name='授权']` : `button:has-text('权限'), button:has-text('授权')`,
        method: 'PUT',
        apiEndpoint: `${routePath}/auth`,
        formFields: ['userId', 'roleIds']
      });
    }

    return baseActions;
  }
}
