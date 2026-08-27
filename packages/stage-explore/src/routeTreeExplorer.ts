/**
 * @file routeTreeExplorer.ts
 * @description 探索降级管线 P1：前端路由逆向提取（无权限主源）。
 *
 * 设计定位（见 docs/explore-precision-redesign.md）：
 *  - 路由定义（Vue/React/Angular Router 配置、JS 分包、低代码 schema）属于**前端打包产物**，
 *    **不受 RBAC 权限裁剪** —— 低权限账号也能完整发现所有子路由与功能页。
 *  - 这正是「无权限方案」的核心：用前端产物作主源，后端 RBAC 菜单只作交叉校验、不作权威。
 *
 * 降级链（每级都带「为什么降级」的原因，见 DegradationNote / reviewReason）：
 *  - P1a 运行时路由内存探测（Vue3 __vue_app__ / Vue2 / React __remixRouter）
 *  - P1b 静态逆向 JS 分包（正则扫打包产物里的 path/title 定义）
 *  两级互补；若都无结果，交由 menuFusion 的 P2 DOM 菜单兜底。
 *
 * 红线：本文件不依赖 engine-mcp 内部实现，只通过 engine.evaluate / fetch；不 import contracts 之外类型。
 */
import type { McpEngine } from '@test-platform/engine-mcp';
import type { ModuleNode } from '@test-platform/contracts';

/** 单条逆向出的原始路由（尚未映射为 ModuleNode） */
export interface RawRoute {
  /** 路由路径，如 /user/edit/:id（含 :param，不再跳过） */
  path: string;
  /** 路由标题（meta.title / name / 末段） */
  title: string;
  /** 来源，用于标注置信度 */
  source: 'runtime_vue' | 'runtime_vue2' | 'runtime_react' | 'static_js';
  /** 是否含动态参数（:id） */
  hasParam: boolean;
}

/** 降级记录：说明「从什么降级到什么、为什么」 */
export interface DegradationNote {
  /** 降级层级，如 P1a / P1b / P2 / P5 */
  level: string;
  /** 尝试的来源 */
  from: string;
  /** 回退到的来源 */
  to: string;
  /** 为什么降级（根因） */
  reason: string;
}

/**
 * 浏览器内存探测脚本（playwright page.evaluate 执行）。
 * 直接读取 SPA 框架运行时路由表；**保留含 :param 的路由**（参考项目原实现会跳过，
 * 那正是「修改/详情」功能被漏掉的根因，本实现修正）。
 */
export function getSpaRouteProbeScript(): string {
  return `
  (() => {
    const discovered = [];
    try {
      const appEl = document.querySelector('#app') || document.querySelector('#root');
      if (appEl && appEl.__vue_app__) {
        const router = appEl.__vue_app__.config.globalProperties.$router;
        if (router && typeof router.getRoutes === 'function') {
          for (const r of router.getRoutes()) {
            if (r.path && r.path !== '*') {
              discovered.push({ path: r.path, title: (r.meta && r.meta.title) || r.name || r.path, type: 'vue_router' });
            }
          }
        }
      }
    } catch (e) {}
    try {
      const hook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
      const vueRoot = (hook && hook.Vue && hook.Vue.prototype && hook.Vue.prototype.$router) || (window.vueApp && window.vueApp.$router);
      if (vueRoot && vueRoot.options && vueRoot.options.routes) {
        const flatten = (routes, parentPath) => {
          for (const r of routes) {
            const full = (parentPath + '/' + (r.path || '')).replace(/\\/\\/+/g, '/');
            if (full && full !== '*') discovered.push({ path: full, title: (r.meta && r.meta.title) || r.name || full, type: 'vue2_router' });
            if (r.children) flatten(r.children, full);
          }
        };
        flatten(vueRoot.options.routes, '');
      }
    } catch (e) {}
    try {
      if (window.__remixRouter && window.__remixRouter.state && window.__remixRouter.state.matches) {
        for (const m of window.__remixRouter.state.matches) {
          if (m.pathname && m.pathname !== '*') discovered.push({ path: m.pathname, title: (m.route && m.route.id) || m.pathname, type: 'react_remix_router' });
        }
      }
    } catch (e) {}
    return discovered;
  })()
  `;
}

/** P1a：运行时 SPA 路由内存探测（无权限主源，置信度最高） */
export async function extractRoutesRuntime(
  engine: McpEngine,
): Promise<{ routes: RawRoute[]; ok: boolean }> {
  try {
    const raw = await engine.evaluate<
      Array<{ path?: string; title?: string; type?: string }>
    >(getSpaRouteProbeScript());
    const arr = Array.isArray(raw) ? raw : [];
    const routes: RawRoute[] = [];
    const seen = new Set<string>();
    for (const r of arr) {
      if (!r || typeof r.path !== 'string' || !r.path || r.path === '*') continue;
      const path = r.path.startsWith('/') ? r.path : '/' + r.path;
      if (seen.has(path)) continue;
      seen.add(path);
      const type = r.type || 'vue_router';
      const source: RawRoute['source'] =
        type === 'vue2_router'
          ? 'runtime_vue2'
          : type === 'react_remix_router'
            ? 'runtime_react'
            : 'runtime_vue';
      routes.push({
        path,
        title: (r.title || path).toString().slice(0, 60),
        source,
        hasParam: path.includes(':'),
      });
    }
    return { routes, ok: true };
  } catch {
    // 引擎不支持 evaluate / 页面未加载框架 → 探测失败，交由 P1b 静态逆向兜底
    return { routes: [], ok: false };
  }
}

/** 从单段 JS 源码静态正则提取路由定义（参考项目 extractRoutesFromJavascriptCode 思路，含 :param） */
function collectJsRoutes(jsCode: string, out: RawRoute[], seen: Set<string>): void {
  if (!jsCode || jsCode.length < 50) return;
  const re =
    /(?:path|routePath)\s*:\s*['"]([^'"]+)['"]\s*,\s*(?:name|title|meta\s*:\s*\{\s*title)\s*:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jsCode)) !== null) {
    const path = m[1];
    const title = m[2];
    if (!path || !title) continue;
    const norm = path.startsWith('/') ? path : '/' + path;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({
      path: norm,
      title: title.trim().slice(0, 60),
      source: 'static_js',
      hasParam: norm.includes(':'),
    });
  }
}

/** P1b：静态逆向 JS 分包（运行时探测失败时的兜底；仍是前端产物，不受 RBAC 裁剪） */
export async function extractRoutesFromChunks(
  engine: McpEngine,
  origin: string,
): Promise<{ routes: RawRoute[]; scanned: number }> {
  let sources: string[] = [];
  try {
    const res = await engine.evaluate<string[]>(
      `(orig) => {
        const out = [];
        document.querySelectorAll('script[src]').forEach((s) => {
          const src = s.src;
          if (!src) return;
          out.push(src.indexOf('http') === 0 ? src : orig + src.replace(/^\\//, ''));
        });
        document.querySelectorAll('script:not([src])').forEach((s) => {
          const t = s.textContent || '';
          if (t.length > 200) out.push('INLINE:' + t);
        });
        return out;
      }` as unknown as (orig: string) => string[],
      origin,
    );
    sources = Array.isArray(res) ? res : [];
  } catch {
    sources = [];
  }

  const routes: RawRoute[] = [];
  const seen = new Set<string>();
  const limit = Math.min(sources.length, 40);
  for (let i = 0; i < limit; i++) {
    const src = sources[i];
    let code = '';
    if (src.startsWith('INLINE:')) {
      code = src.slice(7);
    } else {
      try {
        // 在浏览器上下文内 fetch（同源 JS 分包可跨脚本标签抓取；跨域/失败返回空串），
        // 以字符串函数传入，避免依赖 Node 全局 fetch / DOM 类型，保持与 ES2022 lib 兼容。
        const content = await engine.evaluate<string>(
          `(s) => { return fetch(s).then((r) => r.text()).catch(() => ''); }` as unknown as (
            s: string,
          ) => string,
          src,
        );
        code = content || '';
      } catch {
        // 跨域 / 网络不可达：跳过该分包（不阻断，后续 DOM 菜单兜底）
        continue;
      }
    }
    collectJsRoutes(code, routes, seen);
  }
  return { routes, scanned: sources.length };
}

/** 由动态参数路由推断功能点标签（编辑/详情/查看信息） */
function deriveParamActionLabel(title: string, path: string): string {
  const t = (title || '').toLowerCase();
  const p = path.toLowerCase();
  if (/edit|修改|编辑/.test(t) || /\/edit\//.test(p) || p.endsWith('/edit')) return '编辑';
  if (/detail|详情|view/.test(t) || /\/detail\//.test(p) || p.endsWith('/detail')) return '详情';
  if (/info|信息/.test(t)) return '查看信息';
  const last = path.split('/').filter(Boolean).pop() || '详情';
  const base = last.replace(/:.*$/, '') || '详情';
  // 探索阶段不得主动为 label 追加括号（用户要求：仅 DOM/路由原文自带的括号可保留）。
  // 这里的「:id」是动态路由参数占位（原文没有），用「参数-xxx」形式承载同等信息且无括号。
  if (!base) return '详情';
  return `参数${base}`;
}

const normalizePath = (p: string): string =>
  (p.startsWith('/') ? p : '/' + p).replace(/\/+$/, '');

/**
 * 将逆向出的路由映射为 ModuleNode 树（module → page → action 层级）。
 * - 非参数路由：按路径段构建 module/page 层级，page.url 补全 origin，运行时来源标 covered，
 *   静态来源标 needs_review 并注明「降级自运行时探测」。
 * - 参数路由（/user/edit/:id）：作为父列表页的 action 子节点（needs_review），
 *   说明「动态参数路由无法实导航验证，需人工确认对应编辑/详情功能」。
 */
export function routesToModuleNodes(
  routes: RawRoute[],
  subsystemId: string,
  origin: string,
): ModuleNode[] {
  const nodeByPath = new Map<string, ModuleNode>();
  const rootIds: string[] = [];

  const ensureNode = (path: string, type: 'module' | 'page', depth: number): ModuleNode => {
    const existing = nodeByPath.get(path);
    if (existing) return existing;
    const id = `rt_${subsystemId}_${path}`;
    const node: ModuleNode = {
      id,
      label: '',
      parentId: null,
      subsystemId,
      type,
      status: 'covered',
      children: [],
      depth,
      url: type === 'page' ? origin + path : undefined,
    };
    nodeByPath.set(path, node);
    if (depth === 0) rootIds.push(path);
    return node;
  };

  // 1) 非参数路由 → 构建 module/page 层级
  for (const r of routes.filter((x) => !x.hasParam)) {
    const path = normalizePath(r.path);
    const segs = path.split('/').filter(Boolean);
    let parentPath = '';
    let parentNode: ModuleNode | null = null;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const curPath = parentPath + '/' + seg;
      const isLeaf = i === segs.length - 1;
      const node = ensureNode(curPath, isLeaf ? 'page' : 'module', i);
      // 既设 parentId，也把节点挂入 parent.children —— 否则层级只靠 parentId 单向链接，
      // flatten() 按 children 遍历时会丢失整棵子树（此前潜伏的真实缺陷）。
      if (parentNode) {
        node.parentId = parentNode.id;
        if (!parentNode.children.includes(node)) parentNode.children.push(node);
      } else {
        node.parentId = null;
      }
      if (isLeaf) {
        const title = r.title || segs[segs.length - 1];
        // 同 path 多条路由（如 list / create 共用父 path）只取首个非空标题；
        // 优先采用含中文的标题，避免被裸 name（如 role）覆盖成不统一的展示名。
        if (!node.label || (!/[一-龥]/.test(node.label) && /[一-龥]/.test(title))) {
          node.label = title;
        }
        node.url = origin + path;
        if (r.source === 'static_js') {
          node.status = 'needs_review';
          node.reviewReason =
            '降级来源：运行时路由内存探测无结果（生产构建常剥离 __vue_app__/__remixRouter 等全局变量），' +
            '改用静态逆向 JS 分包所得；前端打包产物不受 RBAC 裁剪（低权限账号亦可发现），但置信度较低，需人工确认页面是否真实可访问';
        }
      } else if (!node.label) {
        node.label = seg;
      }
      parentPath = curPath;
      parentNode = node;
    }
  }

  // 2) 参数路由 → 父列表页的 action 子节点（needs_review）
  for (const r of routes.filter((x) => x.hasParam)) {
    const path = normalizePath(r.path);
    const segs = path.split('/').filter(Boolean);
    let parentPath = '';
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].includes(':')) break;
      parentPath += '/' + segs[i];
    }
    // 断裂点前的最后一个静态段若是动作词（edit/detail/info/view/modify/show），
    // 它属于「动作页」而非列表页，需继续上溯一级到真正的列表页（如 /user/edit/:id → /user）。
    const pSegs = parentPath.split('/').filter(Boolean);
    const lastStatic = pSegs[pSegs.length - 1] ?? '';
    if (/^(edit|detail|info|view|modify|show)$/i.test(lastStatic)) {
      parentPath = '/' + pSegs.slice(0, -1).join('/');
    }
    const parentPage = nodeByPath.get(parentPath);
    const actionLabel = deriveParamActionLabel(r.title, path);
    const actionNode: ModuleNode = {
      id: `rt_act_${subsystemId}_${path}`,
      label: actionLabel,
      parentId: parentPage ? parentPage.id : null,
      subsystemId,
      type: 'action',
      status: 'needs_review',
      children: [],
      depth: parentPage ? parentPage.depth + 1 : 1,
      url: origin + path,
      reviewReason:
        `动态参数路由（${path}）无法实导航验证（缺少具体 id 参数），故作为「${actionLabel}」功能点挂于父页面并标记待确认；` +
        `该路由定义来自前端产物（不受 RBAC 裁剪），低权限账号亦可发现，但需人工确认对应编辑/详情功能`,
    };
    if (parentPage) {
      parentPage.children.push(actionNode);
    } else {
      const parentNode = ensureNode(parentPath || '/', 'page', 0);
      if (!parentNode.label) {
        parentNode.label = segs[segs.length - 1]?.replace(/:.*$/, '') || '未知页面';
      }
      parentNode.status = 'needs_review';
      parentNode.reviewReason = `降级来源：仅发现其子路由（${path}）为动态参数路由，父页面未在路由树/菜单中直接注册，需人工确认`;
      parentNode.children.push(actionNode);
      actionNode.parentId = parentNode.id;
      actionNode.depth = parentNode.depth + 1;
    }
  }

  // 后处理：含「子页面/子模块」的节点应为 module（单段路由既作页又作父容器时修正层级，杜绝层级混乱）
  const fixTypes = (nodes: ModuleNode[]): void => {
    for (const n of nodes) {
      if (
        n.type === 'page' &&
        n.children.some((c) => c.type === 'page' || c.type === 'module')
      ) {
        n.type = 'module';
      }
      if (n.children.length) fixTypes(n.children);
    }
  };

  const roots: ModuleNode[] = [];
  for (const p of rootIds) {
    const n = nodeByPath.get(p);
    if (n) roots.push(n);
  }
  fixTypes(roots);
  return roots;
}
