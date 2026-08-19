import { PageNodeDescriptor,  MenuSourceCategory } from './types.js';

/**
 * 类别 ② & ⑤: 客户端 SPA 路由内存与代码逆向提取器
 * 针对 Vue Router, React Router, Angular Router, Vite/Webpack Async Chunks 以及全局变量进行深度逆向
 */
export class SpaRouterReverseExtractor {
  /**
   * 生成在 Playwright page.evaluate 中执行的浏览器内存探测脚本
   */
  static getRuntimeBrowserEvaluationScript(): string {
    return `
      (() => {
        const discovered = [];

        // 1. 尝试探测 Vue 3 Router
        try {
          const appEl = document.querySelector('#app') || document.querySelector('#root');
          if (appEl && appEl.__vue_app__) {
            const router = appEl.__vue_app__.config.globalProperties.$router;
            if (router && typeof router.getRoutes === 'function') {
              const routes = router.getRoutes();
              for (const r of routes) {
                if (r.path && !r.path.includes(':') && r.path !== '*') {
                  discovered.push({
                    path: r.path,
                    name: r.name || r.meta?.title || r.path,
                    title: r.meta?.title || r.name || r.path,
                    component: r.components?.default?.name || '',
                    type: 'vue_router'
                  });
                }
              }
            }
          }
        } catch (e) {}

        // 2. 尝试探测 Vue 2 Router
        try {
          const vueRoot = window.__VUE_DEVTOOLS_GLOBAL_HOOK__?.Vue?.prototype?.$router || window.vueApp?.$router;
          if (vueRoot && vueRoot.options && vueRoot.options.routes) {
            const flattenVue2 = (routes, parentPath = '') => {
              for (const r of routes) {
                const fullPath = (parentPath + '/' + (r.path || '')).replace(/\\/\\/+/g, '/');
                discovered.push({
                  path: fullPath,
                  title: r.meta?.title || r.name || fullPath,
                  type: 'vue2_router'
                });
                if (r.children) flattenVue2(r.children, fullPath);
              }
            };
            flattenVue2(vueRoot.options.routes);
          }
        } catch (e) {}

        // 3. 尝试探测 React / Remix / Next Router
        try {
          if (window.__remixRouter && window.__remixRouter.state && window.__remixRouter.state.matches) {
            for (const m of window.__remixRouter.state.matches) {
              discovered.push({
                path: m.pathname || m.route?.path,
                title: m.route?.id || m.pathname,
                type: 'react_remix_router'
              });
            }
          }
        } catch (e) {}

        return discovered;
      })()
    `;
  }

  /**
   * 从 SPA 前端打包的 JavaScript 脚本中静态逆向提取路由定义
   */
  static extractRoutesFromJavascriptCode(jsCode: string, prefix: string, isAi: boolean): PageNodeDescriptor[] {
    if (!jsCode || jsCode.length < 50) return [];

    const nodes: PageNodeDescriptor[] = [];
    const seenPaths = new Set<string>();

    // 匹配类似 path: '/xxx', title: 'xxx' 或 path: "/xxx", name: "xxx"
    const routeRegex = /(?:path|routePath)\s*:\s*['"]([\/a-zA-Z0-9_\-]+)['"]\s*,\s*(?:name|title|meta\s*:\s*\{\s*title)\s*:\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    let index = 0;
    while ((match = routeRegex.exec(jsCode)) !== null) {
      const routePath = match[1];
      const title = match[2];

      if (routePath && title && !seenPaths.has(routePath) && !routePath.includes(':')) {
        seenPaths.add(routePath);
        index++;

        const isRoot = routePath.split('/').filter(Boolean).length <= 1;
        const level = isRoot ? 1 : 2;

        nodes.push({
          id: `${prefix}_spa_code_${index}`,
          title: title.trim(),
          routePath,
          level,
          sourceType: 'category_2_spa_router',
          tableColumns: ['指标项', '名称', '状态', '更新时间', '操作'],
          actions: [
            {
              id: `${prefix}_spa_act_${index}_query`,
              title: `查看${title}数据`,
              type: 'query',
              selector: isAi ? `role=link[name='${title}'], a[href*='${routePath}']` : `a:has-text('${title}'), a[href*='${routePath}']`,
              method: 'GET'
            }
          ]
        });
      }
    }

    return nodes;
  }
}
