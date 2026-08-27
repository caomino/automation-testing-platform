/**
 * @file pageActionExplorer.test.ts
 * @description T2 验证：stage-explore 识别的动作 kind/selector/text 必须写入 ModuleNode，
 * 下游可经 ModuleNode 直接读取动作身份，无需重新猜测（根因#1 修复）。
 */
import { describe, it, expect } from 'vitest';
import type { ModuleNode } from '@test-platform/contracts';
import { extractPageActions, classifyActionType } from './pageActionExplorer.js';

/** 只暴露 evaluate 的极简 stub engine */
function stubEngine(rawActions: Array<{ text: string; selector: string; tag: string; href: string }>) {
  return {
    navigate: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => rawActions,
    getCurrentUrl: async () => '',
  } as any;
}

const basePage = (over: Partial<ModuleNode> = {}): ModuleNode =>
  ({
    id: 'p1',
    label: '用户管理',
    parentId: null,
    subsystemId: 's1',
    type: 'page',
    status: 'covered',
    children: [],
    url: 'https://sys.test/users',
    depth: 1,
    ...over,
  } as ModuleNode);

describe('T2 classifyActionType → contracts.ActionKind', () => {
  it('识别 create/update/delete/query/list/batch_delete/auth 且为合法 ActionKind', () => {
    expect(classifyActionType('新增用户').kind).toBe('create');
    expect(classifyActionType('修改').kind).toBe('update');
    expect(classifyActionType('删除').kind).toBe('delete');
    expect(classifyActionType('查询').kind).toBe('query');
    expect(classifyActionType('批量删除').kind).toBe('batch_delete');
    expect(classifyActionType('授权角色').kind).toBe('auth');
  });
});

describe('T2 extractPageActions 透传动作语义到 ModuleNode（根因#1）', () => {
  it('create/update/query/delete 的 kind+selector+text 经 ModuleNode round-trip 不丢', async () => {
    const engine = stubEngine([
      { text: '新增', selector: '#btn-add', tag: 'button', href: '' },
      { text: '查询', selector: '#btn-search', tag: 'button', href: '' },
      { text: '修改', selector: '#btn-edit', tag: 'button', href: '' },
      { text: '删除', selector: '#btn-del', tag: 'button', href: '' },
    ]);
    const nodes = await extractPageActions(engine, basePage(), 's1');
    const byLabel = Object.fromEntries(nodes.map((n) => [n.label, n]));

    expect(byLabel['新增'].actionKind).toBe('create');
    expect(byLabel['新增'].actionSelector).toBe('#btn-add');
    expect(byLabel['新增'].actionText).toBe('新增');

    expect(byLabel['查询'].actionKind).toBe('query');
    expect(byLabel['查询'].actionSelector).toBe('#btn-search');

    expect(byLabel['修改'].actionKind).toBe('update');
    expect(byLabel['删除'].actionKind).toBe('delete');

    // type 仍为 action，不被替换
    expect(nodes.every((n) => n.type === 'action')).toBe(true);
  });

  it('空实采 + 标题含 CRUD 名词 → 推断节点也带 actionKind（标 needs_review）', async () => {
    const engine = stubEngine([]);
    const page = basePage({ label: '用户管理', url: undefined });
    const nodes = await extractPageActions(engine, page, 's1');
    const create = nodes.find((n) => n.label === '新增');
    expect(create).toBeDefined();
    expect(create!.actionKind).toBe('create');
    expect(create!.status).toBe('needs_review');
  });

  it('不同动作的 selector 互不串用（同页多个动作各自保留原始 selector）', async () => {
    const engine = stubEngine([
      { text: '新增', selector: '#a1', tag: 'button', href: '' },
      { text: '删除', selector: '#d1', tag: 'button', href: '' },
    ]);
    const nodes = await extractPageActions(engine, basePage(), 's1');
    const add = nodes.find((n) => n.label === '新增')!;
    const del = nodes.find((n) => n.label === '删除')!;
    expect(add.actionSelector).toBe('#a1');
    expect(del.actionSelector).toBe('#d1');
    expect(add.actionSelector).not.toBe(del.actionSelector);
  });
});
