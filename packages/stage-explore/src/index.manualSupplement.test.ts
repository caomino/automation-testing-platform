/**
 * @file index.manualSupplement.test.ts
 * @description T4：人工补录「入树」行为 —— URL 传递 / 类型映射 / 名称取文本 / 质量闸门豁免
 *   设计依据：docs/designs/人工补充-两段式-design.md §3.3 + 用户拍板（默认页面、可手改）
 *   TDD：先红 → 实现 → 绿
 */
import { describe, it, expect } from 'vitest';
import type { ClickPath, ManualSupplement, ModuleNode } from '@test-platform/contracts';
import { mergeManualSupplement, assertActionGranularity } from '../src/index';

function sup(clickPath: ClickPath[], insertPosition: ManualSupplement['insertPosition'], relativeToNodeId: string | null): ManualSupplement {
  return { clickPath, insertPosition, relativeToNodeId };
}

const menuCp: ClickPath = {
  steps: [{ selector: '#m', text: '用户管理', url: 'https://demo.test/system/user', timestamp: 1, kind: 'menu' }],
  inferredModule: '系统管理',
  confidence: 1,
};

const actionCp: ClickPath = {
  steps: [{ selector: '#b', text: '新增', url: 'https://demo.test/system/user', timestamp: 2, kind: 'action', parentMenu: '用户管理' }],
  inferredModule: '系统管理',
  confidence: 1,
};

describe('T4 人工补录入树：名称 / URL / 类型', () => {
  it('label 取「点击文本」，而不是归属模块名', () => {
    const out = mergeManualSupplement([], sup([menuCp], 'end', null), 'sys_1');
    expect(out.map((n) => n.label)).toEqual(['用户管理']);
  });

  it('节点必须带上真实 URL（修「入树丢 URL」）', () => {
    const out = mergeManualSupplement([], sup([menuCp], 'end', null), 'sys_1');
    expect(out[0].url).toBe('https://demo.test/system/user');
  });

  it('kind=menu → type=page；kind=action → type=action', () => {
    const out = mergeManualSupplement([], sup([menuCp, actionCp], 'end', null), 'sys_1');
    expect(out[0].type).toBe('page');
    expect(out[1].type).toBe('action');
  });

  it('无 kind 时默认 page（用户拍板：默认页面、可手改）', () => {
    const cp: ClickPath = {
      steps: [{ selector: '#x', text: 'X', url: 'https://demo.test/x', timestamp: 1 }],
      inferredModule: 'M',
      confidence: 1,
    };
    const out = mergeManualSupplement([], sup([cp], 'end', null), 'sys_1');
    expect(out[0].type).toBe('page');
  });

  it('人工补录节点一律 manuallyAdded=true（供质量闸门豁免）', () => {
    const out = mergeManualSupplement([], sup([menuCp, actionCp], 'end', null), 'sys_1');
    expect(out.every((n) => n.manuallyAdded === true)).toBe(true);
  });
});

describe('验收 7：重复入树必须幂等（不产生同名重复节点）', () => {
  it('同名节点已在树中 → 第二次入树不再新增', () => {
    const base: ModuleNode[] = [
      {
        id: 'm',
        label: '系统管理',
        parentId: null,
        subsystemId: 'sys_1',
        type: 'module',
        status: 'covered',
        depth: 0,
        children: [],
      },
    ];
    const first = mergeManualSupplement(base, sup([menuCp], 'end', null), 'sys_1');
    expect(first.filter((n) => n.label === '用户管理').length).toBe(1);

    const second = mergeManualSupplement(first, sup([menuCp], 'end', null), 'sys_1');
    expect(second.filter((n) => n.label === '用户管理').length).toBe(1); // 仍然只有 1 个

    const third = mergeManualSupplement(second, sup([menuCp], 'end', null), 'sys_1');
    expect(third.filter((n) => n.label === '用户管理').length).toBe(1);
  });

  it('不同名仍可正常入树（幂等不能误伤）', () => {
    const base: ModuleNode[] = [];
    const a = mergeManualSupplement(base, sup([menuCp], 'end', null), 'sys_1'); // 用户管理
    const b = mergeManualSupplement(a, sup([actionCp], 'end', null), 'sys_1'); // 新增
    expect(b.map((n) => n.label).sort()).toEqual(['新增', '用户管理']);
  });
});

describe('T4 质量闸门：人工补录节点不得影响自动探索判定', () => {
  it('manuallyAdded 的 action 节点不计入 actionCount（仍走页面级校验）', () => {
    const tree: ModuleNode[] = [
      {
        id: 'm',
        label: '系统管理',
        parentId: null,
        subsystemId: 'sys_1',
        type: 'module',
        status: 'covered',
        depth: 0,
        children: [
          {
            id: 'p',
            label: '用户管理',
            parentId: 'm',
            subsystemId: 'sys_1',
            type: 'page',
            status: 'covered',
            url: 'https://demo.test/system/user',
            depth: 1,
            children: [
              {
                id: 'a1',
                label: '新增',
                parentId: 'p',
                subsystemId: 'sys_1',
                type: 'action',
                status: 'covered',
                depth: 2,
                manuallyAdded: true,
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const r = assertActionGranularity(tree);
    // 人工补录的 action 不参与闸门：actionCount 仍为 0 → 走页面级 URL 校验，且该页面有 URL 不被标
    expect(r.actionCount).toBe(0);
    expect(r.flagged).toBe(0);
    expect(tree[0].children[0].status).toBe('covered');
  });
});
