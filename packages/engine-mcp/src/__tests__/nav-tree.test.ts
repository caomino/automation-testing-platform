/**
 * nav-tree 纯函数单测（无浏览器依赖）
 */
import { describe, it, expect } from 'vitest';
import type { AIClient } from '@test-platform/infra-ai';
import {
  buildNavHierarchy,
  toModuleNodes,
  dedupModuleTree,
  extractPageActions,
  aiFallback,
  type RawNavItem,
  type PageControl,
} from '../nav-tree.js';

const navItems: RawNavItem[] = [
  { selector: '#m-system', text: '系统管理', href: undefined, expandable: true, parentSelector: null },
  { selector: '#m-user', text: '用户管理', href: undefined, expandable: false, parentSelector: '#m-system' },
  { selector: '#m-role', text: '角色管理', href: undefined, expandable: false, parentSelector: '#m-system' },
  { selector: '#m-report', text: '报表', href: undefined, expandable: false, parentSelector: null },
];

describe('buildNavHierarchy', () => {
  it('按 parentSelector 重建父子关系', () => {
    const nav = buildNavHierarchy(navItems);
    expect(nav).toHaveLength(2); // 系统管理、报表
    const sys = nav.find((n) => n.key === '#m-system')!;
    expect(sys.children.map((c) => c.key)).toEqual(['#m-user', '#m-role']);
  });
});

describe('toModuleNodes', () => {
  it('顶层=模块、parentId/depth/subsystemId 正确（不包 system 根）', () => {
    const nav = buildNavHierarchy(navItems);
    const tree = toModuleNodes(nav, { subsystemId: 'sys1', systemId: 'SYS' });
    expect(tree).toHaveLength(2); // 系统管理、报表（顶层不再包 system 根）
    const sysMod = tree.find((c) => c.label === '系统管理')!;
    expect(sysMod.parentId).toBeNull();
    expect(sysMod.subsystemId).toBe('sys1');
    expect(sysMod.depth).toBe(0);
    expect(sysMod.type).toBe('module');
    const userLeaf = sysMod.children.find((c) => c.label === '用户管理')!;
    expect(userLeaf.parentId).toBe(sysMod.id);
    expect(userLeaf.type).toBe('page');
    expect(userLeaf.subsystemId).toBe('sys1');
  });

  it('叶子页：菜单 href 为空时，用 urlByKey 捕获的真实跳转 URL 回填 url', () => {
    const nav = buildNavHierarchy(navItems); // 全部 href=undefined（SPA 菜单无 <a href>）
    const urlByKey = new Map<string, string>([
      ['#m-user', 'https://app.example.com/sys/user'],
      ['#m-role', 'https://app.example.com/sys/role'],
    ]);
    const tree = toModuleNodes(nav, { subsystemId: 'sys1' }, undefined, urlByKey);
    const sysMod = tree.find((c) => c.label === '系统管理')!;
    const userLeaf = sysMod.children.find((c) => c.label === '用户管理')!;
    const roleLeaf = sysMod.children.find((c) => c.label === '角色管理')!;
    // 关键：叶子 page.url 来自点击后真实跳转的 URL，而非空 href
    expect(userLeaf.url).toBe('https://app.example.com/sys/user');
    expect(roleLeaf.url).toBe('https://app.example.com/sys/role');
    // 未捕获的叶子（报表）回退到 href（undefined）
    const reportLeaf = tree.find((c) => c.label === '报表')!;
    expect(reportLeaf.url).toBeUndefined();
    // 容器模块节点不应被 urlByKey 误填
    expect(sysMod.url).toBeUndefined();
  });

  it('叶子页挂载功能点 action 子节点', () => {
    const nav = buildNavHierarchy(navItems);
    const actions = new Map<string, ReturnType<typeof extractPageActions>>();
    actions.set('#m-user', [
      { label: '新增', kind: 'create', selector: '#btn-add' },
      { label: '删除', kind: 'delete', selector: '#btn-del' },
    ]);
    const tree = toModuleNodes(nav, { subsystemId: 'sys1' }, actions);
    const userLeaf = tree
      .find((c) => c.label === '系统管理')!
      .children.find((c) => c.label === '用户管理')!;
    expect(userLeaf.children.map((c) => c.label)).toEqual(['新增', '删除']);
    expect(userLeaf.children.every((c) => c.type === 'action' && c.parentId === userLeaf.id)).toBe(true);
  });
});

describe('dedupModuleTree', () => {
  it('按 (type|label|href|parentId) 指纹去重', () => {
    const nav = buildNavHierarchy(navItems);
    const tree = toModuleNodes(nav, { subsystemId: 'sys1' });
    // 人为复制一个同名同父的子节点
    const sysMod = tree.find((c) => c.label === '系统管理')!;
    sysMod.children.push({ ...sysMod.children[0], id: 'dup1' });
    const deduped = dedupModuleTree(tree);
    const sysMod2 = deduped.find((c) => c.label === '系统管理')!;
    expect(sysMod2.children).toHaveLength(2);
  });
});

describe('extractPageActions', () => {
  it('枚举全部功能点（增删改查导出 + 列表）', () => {
    const controls: PageControl[] = [
      { selector: '#b1', tag: 'button', text: '新增用户' },
      { selector: '#b2', tag: 'button', text: '修改' },
      { selector: '#b3', tag: 'button', text: '删除' },
      { selector: '#b4', tag: 'button', text: '查询' },
      { selector: '#b5', tag: 'button', text: '导出' },
      { selector: '#b6', tag: 'a', text: '返回' },
    ];
    const actions = extractPageActions(controls, { hasDataGrid: true });
    const labels = actions.map((a) => a.label);
    expect(labels).toContain('列表');
    expect(labels).toContain('新增');
    expect(labels).toContain('修改');
    expect(labels).toContain('删除');
    expect(labels).toContain('查询');
    expect(labels).toContain('导出');
  });
});

describe('aiFallback', () => {
  const ctx = { subsystemId: 'sys1', systemId: 'SYS', structuredCount: 0, pageSummary: '导航：系统管理 / 用户管理' };

  it('AI 返回合法 JSON → 归一化为 ModuleNode 树', async () => {
    const ai: AIClient = {
      complete: async () => ({
        text: '[{"label":"系统管理","type":"module","children":[{"label":"用户管理","type":"page"}]}]',
      }),
    };
    const tree = await aiFallback(ai, ctx);
    expect(tree).not.toBeNull();
    expect(tree![0].type).toBe('module');
    expect(tree![0].parentId).toBeNull();
    expect(tree![0].label).toBe('系统管理');
    expect(tree![0].children[0].label).toBe('用户管理');
  });

  it('AI 返回非法内容 → 返回 null（回退结构化）', async () => {
    const ai: AIClient = { complete: async () => ({ text: '我无法识别' }) };
    const tree = await aiFallback(ai, ctx);
    expect(tree).toBeNull();
  });
});
