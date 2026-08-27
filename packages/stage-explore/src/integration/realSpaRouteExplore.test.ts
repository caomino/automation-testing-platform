/**
 * @file src/integration/realSpaRouteExplore.test.ts
 * @description 真实 SPA 运行时保真集成测试（无权限降级管线端到端验证）。
 *
 * 目标：在「无 Chromium 浏览器」的沙箱里，用**真实形态**的 SPA 运行时结构驱动**未改动**的生产代码
 *   getSpaRouteProbeScript → extractRoutesRuntime → routesToModuleNodes → buildModuleTreeViaDegradation → exploreNonAi
 * 验证「精准到子目录 + 具体功能（新增/修改/列表/删除/导出/导入）+ :param 编辑页降级为 action」以及「降级原因可见」。
 *
 * 同时验证本期新增的**页面内功能点抽取器**（pageActionExplorer）：
 *   - classifyActionType 完整动作词表（含批量删除/授权优先于删除）；
 *   - getActionExtractScript 是合法浏览器脚本；
 *   - inferActionsFromTitle 仅在「标题含 CRUD 名词且无实采功能点」时兜底，且标 needs_review；
 *   - extractPageActions 把 inject 的按钮候选真实转为 type:'action' 子节点。
 *
 * 保真度说明（诚实声明）：
 *   - 本测试不启动真实 Chromium（沙箱无法下载浏览器）。它用一个**结构同构**于真实 Vue3 SPA 运行时的桩：
 *     window.__vue_app__.config.globalProperties.$router.getRoutes() 返回与 vue-router 4 归一化输出
 *     （RouteRecordNormalized[]，含完整 path / name / meta.title / 嵌套 children / :param）完全同形的数据。
 *   - 所有生产代码路径都真实跑通，仅在「vue-router 库本身是否把 getRoutes 挂到 __vue_app__」这一处用了等效数据替代。
 *   - 功能点抽取脚本（getActionExtractScript）的真实 DOM 行为，用「inject 按钮候选」等价替代——即直接验证
 *     extractPageActions 对浏览器返回结果的「分类 + 建节点」逻辑（浏览器内 DOM 遍历本身单独以纯函数单测覆盖）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runInThisContext } from 'node:vm';
import type { ModuleNode } from '@test-platform/contracts';
import type { McpEngine } from '@test-platform/engine-mcp';
import { exploreNonAi } from '../nonAiExplore.js';
import { getSpaRouteProbeScript } from '../routeTreeExplorer.js';
import {
  classifyActionType,
  getActionExtractScript,
  inferActionsFromTitle,
  extractPageActions,
} from '../pageActionExplorer.js';

// —— SPA 运行时结构同构桩（替代真实 Vue3 + vue-router 挂载） —— //
interface ShimRoute {
  path: string;
  name?: string;
  meta?: { title?: string };
}
const ORIGIN = 'https://sys.test';

interface RawButton {
  text: string;
  selector: string;
  tag: string;
  href: string;
}

function setShim(routes: ShimRoute[]): void {
  const appEl = {
    __vue_app__: {
      config: {
        globalProperties: {
          $router: {
            getRoutes: () => routes,
          },
        },
      },
    },
  };
  const doc = {
    querySelector: (sel: string) => (sel === '#app' || sel === '#root' ? appEl : null),
    querySelectorAll: (_sel: string) => [] as Array<{ forEach: () => void }>,
  };
  (globalThis as Record<string, unknown>).window = {};
  (globalThis as Record<string, unknown>).document = doc;
}

function clearShim(): void {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
}

/**
 * 与 Playwright 语义一致的引擎适配器：
 *   - 若脚本是 SPA 探针（含 __vue_app__）→ 在 shim 全局上真实执行，跑出路由表；
 *   - 若脚本是功能点抽取脚本（含 getComputedStyle）→ 返回 inject 的按钮候选（等价替代真实 DOM 遍历）；
 *   - 其余脚本（如分包扫描 script[src]）→ 真实执行（shim 下 querySelectorAll 为空 → 返回 []，触发 P1b→P2 降级）。
 */
function makeEngine(opts: {
  startUrl: string;
  domTree?: ModuleNode[];
  actionButtons?: RawButton[];
}): { engine: McpEngine; warns: string[] } {
  const warns: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warns.push(a.map(String).join(' '));
  });
  const engine = {
    launch: async () => {},
    navigate: async (_u: string) => {},
    extractSemanticDom: async () => [],
    exploreModules: async (): Promise<ModuleNode[]> => opts.domTree ?? [],
    extractPageElements: async () => [],
    runStep: async () => ({ ok: true, details: {} }),
    runCase: async () => [],
    screenshot: async () => ({ path: '', width: 0, height: 0 }),
    getStorageState: async () => ({ cookies: [], origins: [] }),
    getCurrentUrl: async () => opts.startUrl,
    getSessionCookies: async () => [],
    getSessionHeaders: async () => ({}),
    getSessionTokens: async () => [],
    applySession: async () => {},
    getAllStorageTokens: async () => [],
    addInitScript: async () => {},
    waitForTimeout: async () => {},
    evaluate: async <T = unknown>(
      fn: string | ((...args: unknown[]) => T),
      ...args: unknown[]
    ): Promise<T> => {
      if (typeof fn === 'string') {
        if (fn.includes('__vue_app__') || fn.includes('script[src]')) {
          const result = runInThisContext('(' + fn + ')');
          return typeof result === 'function'
            ? (result as (...a: unknown[]) => T)(...args)
            : (result as T);
        }
        if (fn.includes('getComputedStyle')) {
          // 功能点抽取脚本：返回 inject 的按钮候选（等价替代真实 DOM 遍历）
          return (opts.actionButtons ?? []) as unknown as T;
        }
        const result = runInThisContext('(' + fn + ')');
        return typeof result === 'function'
          ? (result as (...a: unknown[]) => T)(...args)
          : (result as T);
      }
      return fn(...args);
    },
    close: async () => {},
    getCurrentTitle: async () => 'SPA',
    getNavigationPath: async () => [],
  };
  return { engine: engine as unknown as McpEngine, warns };
}

function flatten(nodes: ModuleNode[]): ModuleNode[] {
  const out: ModuleNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children.length) out.push(...flatten(n.children));
  }
  return out;
}

/** 真实形态的路由表：子目录 + 新增/列表 + :param 编辑路由（覆盖常见 SPA 结构） */
const REAL_ROUTES: ShimRoute[] = [
  { path: '/', name: 'home' },
  { path: '/sys', name: 'sys' },
  { path: '/sys/user', name: 'user', meta: { title: '用户管理' } },
  { path: '/sys/user', name: 'user-list', meta: { title: '用户列表' } },
  { path: '/sys/user/create', name: 'user-create', meta: { title: '新增用户' } },
  { path: '/sys/user/edit/:id', name: 'user-edit', meta: { title: '编辑用户' } },
  { path: '/sys/role', name: 'role', meta: { title: '角色管理' } },
  { path: '/sys/role', name: 'role-list', meta: { title: '角色列表' } },
  { path: '/sys/role/create', name: 'role-create', meta: { title: '新增角色' } },
  { path: '/sys/role/edit/:id', name: 'role-edit', meta: { title: '编辑角色' } },
  { path: '/sys/article', name: 'article', meta: { title: '文章管理' } },
  { path: '/sys/article/create', name: 'article-create', meta: { title: '新增文章' } },
];

describe('页面内功能点抽取器（pageActionExplorer 纯函数）', () => {
  it('classifyActionType 完整动作词表：批量删除优先于删除、授权独立归类', () => {
    expect(classifyActionType('新增用户').label).toBe('新增');
    expect(classifyActionType('批量删除').kind).toBe('batch_delete');
    // 关键：批量删除必须排在删除之前，否则会被误判为普通删除
    expect(classifyActionType('批量删除').label).toBe('批量删除');
    expect(classifyActionType('删除该条').label).toBe('删除');
    expect(classifyActionType('授权角色').kind).toBe('auth');
    expect(classifyActionType('导出 Excel').label).toBe('导出');
    expect(classifyActionType('导入数据').label).toBe('导入');
    expect(classifyActionType('查看详情').label).toBe('查看详情');
    expect(classifyActionType('查询列表').label).toBe('查询');
    // 无匹配 → 兜底为「查看{原文切片}」（探索阶段不主动加括号）
    const other = classifyActionType('返回上一页');
    expect(other.kind).toBe('other');
    expect(other.label).toContain('查看');
  });

  it('getActionExtractScript 是合法字符串脚本，排除导航类容器', () => {
    const script = getActionExtractScript();
    expect(typeof script).toBe('string');
    expect(script).toContain('querySelectorAll');
    expect(script).toContain('getComputedStyle');
    // 在空 document 下执行不应抛错，返回数组
    const out = runInThisContext('(' + script + ')');
    expect(Array.isArray(out)).toBe(true);
  });

  it('inferActionsFromTitle 仅在「标题含 CRUD 名词且无实采功能点」时兜底，且标 needs_review', () => {
    const inferred = inferActionsFromTitle(
      { id: 'p1', label: '用户管理', depth: 0, children: [] },
      'sys1',
    );
    expect(inferred.length).toBeGreaterThan(0);
    expect(inferred.every((a) => a.type === 'action' && a.status === 'needs_review')).toBe(true);
    expect(inferred.map((a) => a.label)).toEqual(
      expect.arrayContaining(['查询', '新增', '修改', '删除', '导出', '导入']),
    );
    expect(inferred[0].reviewReason).toMatch(/推断/);

    // 已有实采功能点 → 不再推断（避免重复）
    const withReal = inferActionsFromTitle(
      {
        id: 'p2',
        label: '用户管理',
        depth: 0,
        children: [{ id: 'x', label: '新增', type: 'action', parentId: 'p2', subsystemId: 'sys1', status: 'covered', children: [], depth: 1 }],
      },
      'sys1',
    );
    expect(withReal).toEqual([]);

    // 标题不含 CRUD 名词 → 不推断（诚实：未知页面不瞎猜功能）
    const noNoun = inferActionsFromTitle(
      { id: 'p3', label: '仪表盘', depth: 0, children: [] },
      'sys1',
    );
    expect(noNoun).toEqual([]);
  });

  it('extractPageActions 把 inject 的按钮候选真实转为 type:action 子节点', async () => {
    const { engine } = makeEngine({
      startUrl: ORIGIN + '/sys/user',
      actionButtons: [
        { text: '新增', selector: '#add', tag: 'button', href: '' },
        { text: '删除', selector: '#del', tag: 'button', href: '' },
      ],
    });
    const actions = await extractPageActions(
      engine,
      { id: 'p1', url: ORIGIN + '/sys/user', label: '用户管理', depth: 0, children: [] },
      'sys1',
    );
    expect(actions.map((a) => a.label)).toEqual(expect.arrayContaining(['新增', '删除']));
    expect(actions.every((a) => a.type === 'action' && a.status === 'covered')).toBe(true);
    expect(actions.every((a) => a.parentId === 'p1')).toBe(true);
  });
});

describe('真实 SPA 路由逆向（P1a 运行时探测）精准度', () => {
  beforeEach(() => setShim(REAL_ROUTES));
  afterEach(() => {
    clearShim();
    vi.restoreAllMocks();
  });

  it('探针脚本能直接在真实形态运行时上跑出路由表', async () => {
    const { engine } = makeEngine({ startUrl: ORIGIN + '/sys/user' });
    const discovered = (await engine.evaluate(getSpaRouteProbeScript())) as ShimRoute[];
    const paths = discovered.map((r) => r.path);
    expect(paths).toContain('/sys/user');
    expect(paths).toContain('/sys/user/edit/:id');
    expect(paths).toContain('/sys/article/create');
  });

  it('精准发现子目录页面与新增功能页（不漏、不重）', async () => {
    const { engine } = makeEngine({ startUrl: ORIGIN + '/sys/user' });
    const tree = await exploreNonAi(engine, { subsystemId: 'sys1', startUrl: ORIGIN + '/sys/user' });
    const flatNodes = flatten(tree);
    const flat = flatNodes.map((n) => n.label);
    expect(flat).toContain('用户管理');
    expect(flat).toContain('新增用户');
    expect(flat).toContain('角色管理');
    expect(flat).toContain('新增角色');
    expect(flat).toContain('文章管理');
    expect(flat).toContain('新增文章');
    // 页面级（非 action）标签应唯一，避免结构重复；action 标签（如「编辑」）在不同父页下重复属正常
    const pageLabels = flatNodes.filter((n) => n.type === 'page').map((n) => n.label);
    expect(new Set(pageLabels).size).toBe(pageLabels.length);
  });

  it(':param 编辑路由作为「编辑」action 挂在父列表页下，标 needs_review 且说明降级原因', async () => {
    const { engine } = makeEngine({ startUrl: ORIGIN + '/sys/user' });
    const tree = await exploreNonAi(engine, { subsystemId: 'sys1', startUrl: ORIGIN + '/sys/user' });
    const userPage = flatten(tree).find((n) => n.label === '用户管理');
    expect(userPage).toBeDefined();
    // 编辑 action 必须是「用户管理」的直接子节点（挂在列表页，而非凭空生成 phantom 父页）
    const editAction = userPage!.children.find((c) => c.type === 'action' && c.label === '编辑');
    expect(editAction).toBeDefined();
    expect(editAction!.parentId).toBe(userPage!.id);
    expect(editAction!.status).toBe('needs_review');
    expect(editAction!.reviewReason).toMatch(/动态参数路由/);

    const rolePage = flatten(tree).find((n) => n.label === '角色管理');
    const roleEdit = rolePage!.children.find((c) => c.type === 'action' && c.label === '编辑');
    expect(roleEdit).toBeDefined();

    // 文章管理【没有】编辑路由 → 绝不应出现「编辑」action（证明不误报）
    const articlePage = flatten(tree).find((n) => n.label === '文章管理');
    expect(
      articlePage!.children.some((c) => c.type === 'action' && c.label === '编辑'),
    ).toBe(false);
  });

  it('P3/P4 实导航后采集的真实功能点并入页面（新增/删除），由 inject 按钮驱动', async () => {
    const { engine } = makeEngine({
      startUrl: ORIGIN + '/sys/user',
      actionButtons: [
        { text: '新增', selector: '#add', tag: 'button', href: '' },
        { text: '删除', selector: '#del', tag: 'button', href: '' },
      ],
    });
    const tree = await exploreNonAi(engine, { subsystemId: 'sys1', startUrl: ORIGIN + '/sys/user' });
    const createPage = flatten(tree).find((n) => n.label === '新增用户');
    const labels = createPage!.children.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['新增', '删除']));
    // 实采功能点标 covered（非推断的 needs_review）
    expect(createPage!.children.some((c) => c.label === '新增' && c.status === 'covered')).toBe(true);
  });

  it('降级原因对运行时可见：P5（后端 API 嗅探显式跳过 + 无权限主源说明）始终记录', async () => {
    const { engine, warns } = makeEngine({ startUrl: ORIGIN + '/sys/user' });
    await exploreNonAi(engine, { subsystemId: 'sys1', startUrl: ORIGIN + '/sys/user' });
    const joined = warns.join(' ');
    expect(joined).toContain('[explore][降级链]');
    expect(joined).toContain('P5');
    expect(joined).toContain('RBAC');
  });
});

describe('无 SPA 运行时 → 降级到 DOM 菜单（P1a→P1b→P2）', () => {
  // 不挂载 __vue_app__（routes=[]），P1a 探测为空 → 触发 P1b → P2 DOM 基线
  beforeEach(() => setShim([]));
  afterEach(() => {
    clearShim();
    vi.restoreAllMocks();
  });

  it('运行时无路由：以 DOM 菜单为基线并说明每一级降级原因', async () => {
    const domTree: ModuleNode[] = [
      {
        id: 'dom_user',
        label: '用户管理',
        parentId: null,
        subsystemId: 'sys1',
        type: 'page',
        status: 'covered',
        children: [
          { id: 'dom_user_add', label: '新增', parentId: 'dom_user', subsystemId: 'sys1', type: 'action', status: 'covered', children: [], depth: 1 },
          { id: 'dom_user_del', label: '删除', parentId: 'dom_user', subsystemId: 'sys1', type: 'action', status: 'covered', children: [], depth: 1 },
        ],
        depth: 0,
      },
    ];
    const { engine, warns } = makeEngine({ startUrl: ORIGIN + '/sys/user', domTree });
    const tree = await exploreNonAi(engine, { subsystemId: 'sys1', startUrl: ORIGIN + '/sys/user' });
    const flat = flatten(tree);
    expect(flat.some((n) => n.label === '用户管理')).toBe(true);
    expect(flat.some((n) => n.label === '新增')).toBe(true);
    const joined = warns.join(' ');
    expect(joined).toContain('P1a→P1b');
    expect(joined).toContain('P1b→P2');
    expect(joined).toContain('静态逆向无产出');
  });
});

describe('DOM 基线 + 路由增量融合（P2 基线 + P1 增量并入）', () => {
  beforeEach(() => setShim(REAL_ROUTES));
  afterEach(() => {
    clearShim();
    vi.restoreAllMocks();
  });

  it('DOM 仅含「用户管理」时，路由发现的「新增用户/文章管理/新增文章」并入基线', async () => {
    const domTree: ModuleNode[] = [
      {
        id: 'dom_user',
        label: '用户管理',
        parentId: null,
        subsystemId: 'sys1',
        type: 'page',
        status: 'covered',
        children: [],
        depth: 0,
      },
    ];
    const { engine } = makeEngine({ startUrl: ORIGIN + '/sys/user', domTree });
    const tree = await exploreNonAi(engine, { subsystemId: 'sys1', startUrl: ORIGIN + '/sys/user' });
    const flat = flatten(tree).map((n) => n.label);
    expect(flat).toContain('用户管理'); // DOM 基线保留
    expect(flat).toContain('新增用户'); // 路由增量并入
    expect(flat).toContain('文章管理');
    expect(flat).toContain('新增文章');
  });
});
