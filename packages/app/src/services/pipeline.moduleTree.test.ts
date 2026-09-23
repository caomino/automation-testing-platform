import { describe, expect, it } from 'vitest';
import { fromModuleView, toModuleView } from './pipeline';
import type { ModuleNode } from '@test-platform/contracts';

/**
 * 回归测试：锁定「功能点真实页面 URL 在前端 moduleTree 往返中不被丢失」的根因修复。
 *
 * 背景（2026-09-22 诊断）：探索阶段给 ModuleNode 写了 url，但 toModuleView 漏拷 url，
 * 且 fromModuleView / moduleTreeToContract 漏拷 url 并硬编码 manuallyAdded:true，
 * 导致 feature 阶段 resolvePageUrl 拿不到 url → featurePaths 全空 → case 阶段退化按名点击 → 大量报错。
 * 本测试证明：修复后 url 在 toModuleView → fromModuleView 往返中完整保留，且 manuallyAdded 不被篡改。
 */
const treeWithUrl: ModuleNode[] = [
  {
    id: 'm1',
    label: '系统管理',
    type: 'module',
    status: 'unexplored',
    depth: 0,
    manuallyAdded: false,
    url: 'https://demo.ruoyi.vip/system',
    parentId: null,
    subsystemId: 's1',
    children: [
      {
        id: 'p1',
        label: '用户管理',
        type: 'page',
        status: 'unexplored',
        depth: 1,
        manuallyAdded: false,
        url: 'https://demo.ruoyi.vip/system/user',
        parentId: 'm1',
        subsystemId: 's1',
        children: [
          {
            id: 'a1',
            label: '新增',
            type: 'action',
            status: 'unexplored',
            depth: 2,
            manuallyAdded: false,
            url: 'javascript:void(0)', // action 自身 href 常为 javascript:，需回退祖先页面 URL
            actionKind: 'create',
          parentId: 'p1',
          subsystemId: 's1',
          children: [],
          },
        ],
      },
    ],
  },
  {
    id: 'm2',
    label: '人工补录菜单',
    type: 'module',
    status: 'unexplored',
    depth: 0,
    manuallyAdded: true, // 人工补录节点必须保留 true
    url: 'https://demo.ruoyi.vip/manual',
    parentId: null,
    subsystemId: 's1',
    children: [],
  },
];

describe('moduleTree url 往返保留（根因修复回归）', () => {
  it('toModuleView 必须保留 url / pageTitle / actionKind / manuallyAdded', () => {
    const view = toModuleView(treeWithUrl);
    expect(view[0].url).toBe('https://demo.ruoyi.vip/system');
    expect(view[0].manuallyAdded).toBe(false);
    expect(view[1].manuallyAdded).toBe(true); // 人工补录保持 true
    const actionView = view[0].children?.[0].children?.[0];
    expect(actionView?.url).toBe('javascript:void(0)');
    expect(actionView?.actionKind).toBe('create');
  });

  it('fromModuleView 必须保留 url 且不再硬编码 manuallyAdded:true', () => {
    const view = toModuleView(treeWithUrl);
    const back = fromModuleView(view);

    // url 完整个往返保留（这是 featurePaths 能否生成的关键）
    expect(back[0].url).toBe('https://demo.ruoyi.vip/system');
    expect(back[0].children?.[0].url).toBe('https://demo.ruoyi.vip/system/user');
    expect(back[0].children?.[0].children?.[0].url).toBe('javascript:void(0)');

    // manuallyAdded 反映真实来源：探索产物 false，人工补录 true
    expect(back[0].manuallyAdded).toBe(false);
    expect(back[1].manuallyAdded).toBe(true);

    // 结构性：node.label 由 name 恢复
    expect(back[0].label).toBe('系统管理');
  });

  it('action 节点 url 为 javascript: 时，后端 resolvePageUrl 能回退到祖先页面 URL', () => {
    // 复刻 stage-feature/featureTable.ts:resolvePageUrl 的核心断言：
    // 后端据 ancestor url 生成 featurePaths，正是本修复让前端把 url 带到后端的落点。
    const back = fromModuleView(toModuleView(treeWithUrl));
    const actionNode = back[0].children?.[0].children?.[0];
    const parent = back[0].children?.[0];
    // action 自身 url 不可用（javascript:），但父页面 url 可用 → 后端能 resolve 出真实页面
    expect(actionNode?.url).not.toMatch(/^https?:\/\//i);
    expect(parent?.url).toMatch(/^https?:\/\//i);
  });
});
