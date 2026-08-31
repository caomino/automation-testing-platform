/**
 * menu-explorer 集成单测：用假 Page 对象（不启动真实浏览器）验证
 * 结构化遍历、parentId 正确、功能点挂载、回到起点、去重、AI 兜底门控。
 */
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { exploreViaMenus } from '../menu-explorer.js';
import type { RawNavItem, PageControl } from '../nav-tree.js';

interface FakeState {
  clicks: string[];
  gotos: string[];
  /** 当前 URL：点击后变化，用于模拟 SPA 路由落地（safeClick 的落地校验依赖此变化） */
  currentUrl: string;
}

function makeFakePage(
  nav: RawNavItem[],
  controls: PageControl[],
  hasDataGrid: boolean,
  startUrl: string,
): { page: Page; state: FakeState } {
  const state: FakeState = { clicks: [], gotos: [], currentUrl: startUrl };
  const frame = {
    async evaluate(_fn: unknown, arg?: unknown) {
      if (arg && typeof arg === 'object' && 'containerSel' in (arg as object)) return nav;
      return { controls, hasDataGrid };
    },
    async click() {},
    async hover() {},
  };
  const page = {
    url: () => state.currentUrl,
    frames: () => [frame],
    mainFrame: () => frame,
    evaluate: (_fn: unknown, arg?: unknown) => frame.evaluate(_fn, arg),
    click: async (sel: string) => {
      state.clicks.push(sel);
      // 模拟 SPA 路由跳转：点击后视图落地到新地址
      state.currentUrl = `${startUrl}#${sel.replace('#', '')}`;
    },
    hover: async () => {},
    goto: async (u: string) => {
      state.gotos.push(u);
      state.currentUrl = u;
    },
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    on: () => {},
    off: () => {},
  };
  return { page: page as unknown as Page, state };
}

const NAV: RawNavItem[] = [
  { selector: '#sys', text: '系统管理', href: undefined, expandable: true, parentSelector: null },
  { selector: '#user', text: '用户管理', href: undefined, expandable: false, parentSelector: '#sys' },
  { selector: '#role', text: '角色管理', href: undefined, expandable: false, parentSelector: '#sys' },
  { selector: '#report', text: '报表', href: undefined, expandable: false, parentSelector: null },
];

const CONTROLS: PageControl[] = [
  { selector: '#add', tag: 'button', text: '新增' },
  { selector: '#edit', tag: 'button', text: '修改' },
  { selector: '#del', tag: 'button', text: '删除' },
  { selector: '#q', tag: 'button', text: '查询' },
];

describe('exploreViaMenus（结构化）', () => {
  it('产出模块树 + 正确父子 + 功能点挂载 + 回到起点（顶层=模块，不包 system 根）', async () => {
    const { page, state } = makeFakePage(NAV, CONTROLS, true, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });

    expect(tree).toHaveLength(2); // 系统管理、报表
    const root = tree[0];
    expect(root.type).toBe('module');
    expect(root.parentId).toBeNull();
    expect(root.subsystemId).toBe('sys1');

    const sysMod = tree.find((c) => c.label === '系统管理')!;
    expect(sysMod.type).toBe('module');
    expect(sysMod.parentId).toBeNull();

    const userLeaf = sysMod.children.find((c) => c.label === '用户管理')!;
    expect(userLeaf.type).toBe('page');
    expect(userLeaf.parentId).toBe(sysMod.id);
    // 功能点已挂载为 action 子节点
    const actionLabels = userLeaf.children.map((c) => c.label);
    expect(actionLabels).toEqual(expect.arrayContaining(['列表', '新增', '修改', '删除', '查询']));
    expect(userLeaf.children.every((c) => c.type === 'action' && c.parentId === userLeaf.id)).toBe(true);

    // 三个叶子均被点击
    expect(state.clicks).toEqual(expect.arrayContaining(['#user', '#role', '#report']));
    // 结束后回到起点页
    expect(state.gotos).toContain('https://demo.test/home');
  });

  it('结构化为空 → 返回空（非 AI 路径不再接受 ai 入参，AI 兜底已独立到 aiExplore）', async () => {
    const { page } = makeFakePage([], CONTROLS, false, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });
    expect(tree).toEqual([]);
  });

  it('AIClient 不入参时编译/类型正确（无 ai 字段）', async () => {
    // 仅校验类型面：传入不含 ai 的 options 不报错
    const { page } = makeFakePage(NAV, CONTROLS, true, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });
    expect(tree.length).toBeGreaterThan(0);
  });
});

describe('危险词黑名单收敛（P-A#3）', () => {
  const NAV_WITH_BIZ: RawNavItem[] = [
    { selector: '#sys', text: '系统管理', href: undefined, expandable: true, parentSelector: null },
    { selector: '#delmgr', text: '删除记录管理', href: undefined, expandable: false, parentSelector: '#sys' },
    { selector: '#disabled', text: '停用用户列表', href: undefined, expandable: false, parentSelector: '#sys' },
    { selector: '#logout', text: '退出登录', href: undefined, expandable: false, parentSelector: '#sys' },
    { selector: '#clear', text: '清空缓存', href: undefined, expandable: false, parentSelector: '#sys' },
  ];

  it('放开业务功能页（删除/停用），仍死守会话终止与不可逆动作（退出/清空）', async () => {
    const { page, state } = makeFakePage(NAV_WITH_BIZ, CONTROLS, true, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });

    // 业务功能页必须被点击并采集到 action 级功能点（这是用户要求的核心颗粒度）
    expect(state.clicks).toEqual(expect.arrayContaining(['#delmgr', '#disabled']));
    // 破坏性入口绝不点击
    expect(state.clicks).not.toContain('#logout');
    expect(state.clicks).not.toContain('#clear');

    const sysMod = tree.find((c) => c.label === '系统管理')!;
    const delPage = sysMod.children.find((c) => c.label === '删除记录管理')!;
    expect(delPage.children.map((c) => c.label)).toEqual(
      expect.arrayContaining(['列表', '新增', '修改', '删除', '查询']),
    );
  });
});

/**
 * 模拟 Element-UI 类动态侧边栏：
 * - 初始只返回顶层菜单；
 * - 点击 expandable 父菜单后，下一次 evaluate 才返回子菜单项；
 * - 子菜单叶子点击后 URL 变化，collectControls 返回页面控件。
 */
function makeExpandableFakePage(
  topNav: RawNavItem[],
  childrenByParent: Record<string, RawNavItem[]>,
  controls: PageControl[],
  hasDataGrid: boolean,
  startUrl: string,
): { page: Page; state: FakeState } {
  const state: FakeState = { clicks: [], gotos: [], currentUrl: startUrl };
  const expanded = new Set<string>();

  const allNav = () => {
    const out = [...topNav];
    for (const parentSel of expanded) {
      out.push(...(childrenByParent[parentSel] || []));
    }
    return out;
  };

  const frame = {
    async evaluate(_fn: unknown, arg?: unknown) {
      if (arg && typeof arg === 'object' && 'containerSel' in (arg as object)) return allNav();
      return { controls, hasDataGrid };
    },
    async click() {},
    async hover() {},
  };

  const page = {
    url: () => state.currentUrl,
    frames: () => [frame],
    mainFrame: () => frame,
    evaluate: (_fn: unknown, arg?: unknown) => frame.evaluate(_fn, arg),
    click: async (sel: string) => {
      state.clicks.push(sel);
      const item = topNav.find((n) => n.selector === sel) || Object.values(childrenByParent).flat().find((n) => n.selector === sel);
      if (item?.expandable) {
        expanded.add(sel);
      } else {
        state.currentUrl = `${startUrl}#${sel.replace('#', '')}`;
      }
    },
    hover: async () => {
      // 本 fake 不模拟 hover 展开，只测 click 展开路径
    },
    goto: async (u: string) => {
      state.gotos.push(u);
      state.currentUrl = u;
    },
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    on: () => {},
    off: () => {},
  };
  return { page: page as unknown as Page, state };
}

describe('递归 DFS 菜单遍历（T1.5）', () => {
  it('父菜单点击展开后才出现子菜单，子菜单叶子被点击进入页面并产出 action', async () => {
    const topNav: RawNavItem[] = [
      { selector: '#sys', text: '系统管理', href: undefined, expandable: true, parentSelector: null },
    ];
    const children: Record<string, RawNavItem[]> = {
      '#sys': [
        { selector: '#user', text: '用户管理', href: undefined, expandable: false, parentSelector: '#sys' },
        { selector: '#role', text: '角色管理', href: undefined, expandable: false, parentSelector: '#sys' },
      ],
    };
    const { page, state } = makeExpandableFakePage(topNav, children, CONTROLS, true, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });

    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe('系统管理');
    expect(tree[0].children.map((c) => c.label)).toEqual(['用户管理', '角色管理']);

    const userLeaf = tree[0].children.find((c) => c.label === '用户管理')!;
    expect(userLeaf.children.map((c) => c.label)).toEqual(expect.arrayContaining(['列表', '新增', '修改', '删除', '查询']));

    // 父菜单被点击展开，子菜单叶子也被点击
    expect(state.clicks).toContain('#sys');
    expect(state.clicks).toContain('#user');
    expect(state.clicks).toContain('#role');
  });

  it('父菜单已展开（子项已可见）时不再重复点击，直接递归子项', async () => {
    // 初始即返回父菜单+子项，模拟页面已展开状态
    const allNav: RawNavItem[] = [
      { selector: '#sys', text: '系统管理', href: undefined, expandable: true, parentSelector: null },
      { selector: '#user', text: '用户管理', href: undefined, expandable: false, parentSelector: '#sys' },
    ];
    const { page, state } = makeFakePage(allNav, CONTROLS, true, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });

    expect(tree[0].children).toHaveLength(1);
    expect(state.clicks).not.toContain('#sys'); // 已展开，不需要再点
    expect(state.clicks).toContain('#user');
  });
});

describe('selector 失效 fallback（T1.6）', () => {
  it('selector 过期但文本匹配 → 仍成功点击并采集 action', async () => {
    const nav: RawNavItem[] = [
      { selector: '#sys', text: '系统管理', href: undefined, expandable: true, parentSelector: null },
      { selector: '#user-stale', text: '用户管理', href: '/system/user', expandable: false, parentSelector: '#sys' },
    ];
    const { page, state } = makeFakePage(nav, CONTROLS, true, 'https://demo.test/home');

    // 让原 selector 点击失败（主 frame + 子 frame 都失败，才会触发 fallback）
    page.click = async () => {
      throw new Error('stale selector');
    };
    (page.frames()[0] as unknown as { click: () => Promise<void> }).click = async () => {
      throw new Error('stale selector in frame');
    };

    // 给 fake page 补 locator / getByText，模拟文本重新定位成功
    (page as unknown as { locator: (sel: string) => { click: (opts?: unknown) => Promise<void> } }).locator =
      () => ({
        click: async () => {
          throw new Error('href locator not found in fake');
        },
      });
    (page as unknown as { getByText: (text: string, opts?: unknown) => { first: () => { click: (opts?: unknown) => Promise<void> } } }).getByText =
      (t: string) => ({
        first: () => ({
          click: async () => {
            if (t === '用户管理') {
              state.clicks.push('fallback-text');
              state.currentUrl = 'https://demo.test/home#/system/user';
            } else {
              throw new Error('text mismatch');
            }
          },
        }),
      });

    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });
    const sysMod = tree.find((c) => c.label === '系统管理')!;
    const userLeaf = sysMod.children.find((c) => c.label === '用户管理')!;
    expect(userLeaf.children.map((c) => c.label)).toEqual(expect.arrayContaining(['列表', '新增', '修改', '删除', '查询']));
    expect(state.clicks).toContain('fallback-text');
  });
});

describe('外链/外部菜单处理（T1.8）', () => {
  it('外部域 href 的叶子菜单不点击，避免跳出目标系统', async () => {
    const nav: RawNavItem[] = [
      { selector: '#sys', text: '系统管理', href: undefined, expandable: true, parentSelector: null },
      { selector: '#user', text: '用户管理', href: undefined, expandable: false, parentSelector: '#sys' },
      { selector: '#external', text: '若依官网', href: 'http://www.ruoyi.vip', expandable: false, parentSelector: '#sys' },
    ];
    const { page, state } = makeFakePage(nav, CONTROLS, true, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });

    const sysMod = tree.find((c) => c.label === '系统管理')!;
    expect(sysMod.children.map((c) => c.label)).toContain('用户管理');
    expect(sysMod.children.map((c) => c.label)).toContain('若依官网');

    // 外部链接不应被点击
    expect(state.clicks).toContain('#user');
    expect(state.clicks).not.toContain('#external');
  });
});

describe('点击落地校验（P-A#2）', () => {
  it('点击后视图未变化 → 跳过控件采集，避免把上一页按钮串到本叶子', async () => {
    const { page } = makeFakePage(NAV, CONTROLS, true, 'https://demo.test/home');
    // 让 click 不改变 URL/内容 → 模拟 selector 过期、点击无效
    (page as unknown as { click: (s: string) => Promise<void> }).click = async () => {};

    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });

    const sysMod = tree.find((c) => c.label === '系统管理')!;
    const userLeaf = sysMod.children.find((c) => c.label === '用户管理')!;
    // 未落地：不得挂任何 action 子节点（宁缺毋滥，交由粒度闸门标 needs_review）
    expect(userLeaf.children).toHaveLength(0);
  });
});
