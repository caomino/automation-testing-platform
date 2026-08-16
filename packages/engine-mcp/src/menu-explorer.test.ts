/**
 * menu-explorer 集成单测：用假 Page 对象（不启动真实浏览器）验证
 * 结构化遍历、parentId 正确、功能点挂载、回到起点、去重、AI 兜底门控。
 */
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import type { AIClient } from '@test-platform/infra-ai';
import { exploreViaMenus } from './menu-explorer.js';
import type { RawNavItem, PageControl } from './nav-tree.js';

interface FakeState {
  clicks: string[];
  gotos: string[];
}

function makeFakePage(
  nav: RawNavItem[],
  controls: PageControl[],
  hasDataGrid: boolean,
  startUrl: string,
): { page: Page; state: FakeState } {
  const state: FakeState = { clicks: [], gotos: [] };
  const frame = {
    async evaluate(_fn: unknown, arg?: unknown) {
      if (arg && typeof arg === 'object' && 'containerSel' in (arg as object)) return nav;
      return { controls, hasDataGrid };
    },
    async click() {},
    async hover() {},
  };
  const page = {
    url: () => startUrl,
    frames: () => [frame],
    mainFrame: () => frame,
    evaluate: (_fn: unknown, arg?: unknown) => frame.evaluate(_fn, arg),
    click: async (sel: string) => {
      state.clicks.push(sel);
    },
    hover: async () => {},
    goto: async (u: string) => {
      state.gotos.push(u);
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

  it('结构化为空且有 ai → 走 AI 兜底', async () => {
    const ai: AIClient = {
      complete: async () => ({
        text: '[{"label":"系统管理","type":"module","children":[{"label":"用户管理","type":"page"}]}]',
      }),
    };
    const { page } = makeFakePage([], CONTROLS, false, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS', ai });
    expect(tree[0].type).toBe('module');
    expect(tree[0].parentId).toBeNull();
    expect(tree[0].label).toBe('系统管理');
    expect(tree[0].children[0].label).toBe('用户管理');
  });

  it('未注入 ai 且结构化为空 → 返回空（不启用 AI）', async () => {
    const { page } = makeFakePage([], CONTROLS, false, 'https://demo.test/home');
    const tree = await exploreViaMenus(page, { subsystemId: 'sys1', systemId: 'SYS' });
    expect(tree).toEqual([]);
  });
});
