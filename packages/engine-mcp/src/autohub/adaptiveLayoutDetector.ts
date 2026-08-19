import { PageNodeDescriptor, ActionDescriptor } from './types.js';
import * as cheerio from 'cheerio';

export interface TopologyDetectionResult {
  layoutType: 'dual_column' | 'top_side_mixed' | 'single_sidebar' | 'flat_header';
  primaryTabs: Array<{ id: string; title: string; selector: string }>;
  secondaryNavSelector: string;
}

/**
 * 通用多容器自适应布局拓扑探测器 (Adaptive Multi-Container Topology Detector)
 * 纯基于 DOM 结构与几何语义，完全不写死任何系统名称/URL
 */
export class AdaptiveLayoutDetector {
  /**
   * 自动分析页面的导航布局拓扑结构
   */
  static analyzeLayout($: cheerio.CheerioAPI): TopologyDetectionResult {
    // 1. 扫描所有候选导航容器
    const primaryNavCandidates: Array<{ el: any; widthClass: string; itemSelector: string; items: any[] }> = [];

    // 检查是否有左侧极窄的主 Tab 列 (如 Fantastic-admin 的 .sidebar-logo / .tabbar / .nav-tabs / .sidebar-item-container)
    const dualColSelectors = [
      '.sidebar-tabs',
      '.sub-sidebar-tab',
      '.tabbar-vertical',
      '.nav-tab-left',
      '.layout-sidebar-main',
      '.sidebar-container .tabs',
      'aside .tabs-container',
      '.menu-tabs',
      'div[class*="sidebar"][class*="tab"]',
      'div[class*="navigation"][class*="left"]'
    ];

    let foundDual = false;
    let primaryTabs: Array<{ id: string; title: string; selector: string }> = [];

    for (const sel of dualColSelectors) {
      const $tabs = $(sel);
      if ($tabs.length > 0) {
        $tabs.find('button, a, .tab-item, .item, [role="tab"]').each((idx, el) => {
          const $el = $(el);
          const title = ($el.attr('title') || $el.attr('aria-label') || $el.text()).trim().replace(/\s+/g, ' ');
          if (title && title.length >= 1 && title.length <= 15) {
            primaryTabs.push({
              id: `tab_${idx}_${title.slice(0, 6)}`,
              title,
              selector: `${sel} :nth-child(${idx + 1})`
            });
          }
        });

        if (primaryTabs.length >= 2) {
          foundDual = true;
          return {
            layoutType: 'dual_column',
            primaryTabs,
            secondaryNavSelector: 'aside .el-menu, aside .ant-menu, .sub-sidebar, .sidebar-sub'
          };
        }
      }
    }

    // 2. 检查顶侧混合架构 (Top-Header + Side-Nav)
    const headerNavSelectors = [
      'header nav',
      'header .el-menu',
      'header .ant-menu',
      '.top-nav',
      '.header-menu',
      '.navbar-nav',
      '[role="menubar"]'
    ];

    for (const hSel of headerNavSelectors) {
      const $h = $(hSel);
      if ($h.length > 0) {
        $h.find('li, a, .menu-item, [role="menuitem"]').each((idx, el) => {
          const $el = $(el);
          const title = ($el.text() || $el.attr('title') || '').trim().replace(/\s+/g, ' ');
          if (title && title.length >= 2 && title.length <= 20) {
            primaryTabs.push({
              id: `top_${idx}_${title.slice(0, 8)}`,
              title,
              selector: `${hSel} :nth-child(${idx + 1})`
            });
          }
        });

        if (primaryTabs.length >= 2) {
          return {
            layoutType: 'top_side_mixed',
            primaryTabs,
            secondaryNavSelector: 'aside nav, aside ul, .sidebar-menu'
          };
        }
      }
    }

    // 3. 默认回退为单侧栏结构 (Single Sidebar)
    return {
      layoutType: 'single_sidebar',
      primaryTabs: [],
      secondaryNavSelector: 'aside, nav, ul.el-menu, ul.ant-menu, .sidebar, .layui-nav-tree'
    };
  }

  /**
   * 递归解析侧边栏树形菜单结构 (带真实折叠状态与动态挂载等待)
   */
  static extractSidebarMenuTree($: cheerio.CheerioAPI, containerSelector: string, prefix: string, isAi: boolean): PageNodeDescriptor[] {
    const nodes: PageNodeDescriptor[] = [];
    const seenTitles = new Set<string>();

    const $container = containerSelector ? $(containerSelector) : $('aside, nav, .sidebar');
    if ($container.length === 0) return nodes;

    // 寻找一级折叠块或单项
    $container.find('li.el-sub-menu, li.ant-menu-submenu, .menu-item-has-children, .nav-item-dropdown, li.layui-nav-item').each((pIdx, pEl) => {
      const $p = $(pEl);
      const title = ($p.children('.el-sub-menu__title, .ant-menu-submenu-title, a, span.title').text() || $p.contents().first().text()).trim().replace(/\s+/g, ' ');
      if (!title || title.length < 2 || seenTitles.has(title)) return;
      seenTitles.add(title);

      const children: PageNodeDescriptor[] = [];
      $p.find('li.el-menu-item, li.ant-menu-item, ul.layui-nav-child dd a, .sub-menu a').each((cIdx, cEl) => {
        const $c = $(cEl);
        const cTitle = $c.text().trim().replace(/\s+/g, ' ');
        if (!cTitle || cTitle.length < 2) return;
        const href = $c.attr('href') || $c.find('a').attr('href') || `/${title.toLowerCase()}/sub_${cIdx + 1}`;

        children.push({
          id: `${prefix}_sub_${pIdx}_${cIdx}`,
          title: cTitle,
          routePath: href,
          level: 2,
          actions: [
            { id: `${prefix}_act_query_${pIdx}_${cIdx}`, title: `查询与查看${cTitle}`, type: 'query', selector: isAi ? `role=button[name='查询']` : `button:has-text('查询')`, method: 'GET' }
          ]
        });
      });

      nodes.push({
        id: `${prefix}_parent_${pIdx}`,
        title,
        routePath: `/${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        level: 1,
        actions: [],
        children: children.length > 0 ? children : undefined
      });
    });

    // 如果未找到任何 el-sub-menu，则查找直接的一级 menu-item
    if (nodes.length === 0) {
      $container.find('li.el-menu-item, li.ant-menu-item, a.nav-link, li.menu-item').each((idx, el) => {
        const $el = $(el);
        const title = $el.text().trim().replace(/\s+/g, ' ');
        if (!title || title.length < 2 || seenTitles.has(title)) return;
        seenTitles.add(title);

        const href = $el.attr('href') || $el.find('a').attr('href') || `/page_${idx + 1}`;
        nodes.push({
          id: `${prefix}_direct_page_${idx}`,
          title,
          routePath: href,
          level: 1,
          actions: [
            { id: `${prefix}_act_direct_${idx}`, title: `访问${title}`, type: 'query', selector: isAi ? `role=link[name='${title}']` : `a:has-text('${title}')`, method: 'GET' }
          ]
        });
      });
    }

    return nodes;
  }
}
