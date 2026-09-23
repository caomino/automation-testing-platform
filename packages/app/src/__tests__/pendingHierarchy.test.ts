/**
 * @file pendingHierarchy.test.ts
 * @description 待入树层级推导测试 —— 重点复现"同级 tab 被误串成深链"的回归
 */
import { describe, it, expect } from 'vitest';
import { derivePendingHierarchy, normUrlForHierarchy, orderForPromote, type ClickStepInput } from '../services/pendingHierarchy';

const S = (o: Partial<ClickStepInput>): ClickStepInput => ({ kind: 'menu', domLevel: 1, ...o });

describe('层级推导：点击顺序 ≠ 层级（回归 ruoyi 实测问题）', () => {
  it('依次点 4 个同级 tab（同 domLevel、URL 无关）→ 全部顶层，不串成深链', () => {
    // 复现用户截图：首页 / 用户管理 / 角色管理 / 菜单管理 依次点击
    const steps: ClickStepInput[] = [
      S({ text: '首页', url: 'https://demo.ruoyi.vip/index', domLevel: 1 }),
      S({ text: '用户管理', url: 'https://demo.ruoyi.vip/system/user', domLevel: 1 }),
      S({ text: '角色管理', url: 'https://demo.ruoyi.vip/system/role', domLevel: 1 }),
      S({ text: '菜单管理', url: 'https://demo.ruoyi.vip/system/menu', domLevel: 1 }),
    ];
    const items = derivePendingHierarchy(steps, 0, '若依');
    expect(items.map((i) => i.depth)).toEqual([0, 0, 0, 0]);
    expect(items.map((i) => i.parentSeq)).toEqual([null, null, null, null]);
    expect(items.map((i) => i.label)).toEqual(['首页', '用户管理', '角色管理', '菜单管理']);
  });

  it('DOM 层级更深 → 判为子级', () => {
    const steps: ClickStepInput[] = [
      S({ text: '系统管理', url: 'https://x/#/a', domLevel: 1 }),
      S({ text: '用户管理', url: 'https://x/#/b', domLevel: 2 }), // 更深 ⇒ 子级
    ];
    const items = derivePendingHierarchy(steps, 0, 'M');
    expect(items[1].parentSeq).toBe(items[0].seq);
    expect(items[1].depth).toBe(1);
  });

  it('URL 是严格子路径 → 判为子级（fantastic 多级导航场景）', () => {
    const steps: ClickStepInput[] = [
      S({ text: '多级导航', url: 'https://f/basic-example/#/multilevel_menu_example', domLevel: 1 }),
      S({ text: '导航1', url: 'https://f/basic-example/#/multilevel_menu_example/page', domLevel: 1 }),
    ];
    const items = derivePendingHierarchy(steps, 0, 'F');
    expect(items[1].parentSeq).toBe(items[0].seq);
    expect(items[1].depth).toBe(1);
  });

  it('URL 相同（tab 复用换内容）→ 同级，不造层级', () => {
    const steps: ClickStepInput[] = [
      S({ text: 'A', url: 'https://x/#/same', domLevel: 1 }),
      S({ text: 'B', url: 'https://x/#/same', domLevel: 1 }),
    ];
    const items = derivePendingHierarchy(steps, 0, 'M');
    expect(items[1].depth).toBe(0);
  });

  it('页面按钮归属最近点过的菜单（语义归属，不是层级推断）', () => {
    const steps: ClickStepInput[] = [
      S({ text: '用户管理', url: 'https://x/system/user', domLevel: 1 }),
      { kind: 'action', text: '新增', url: 'https://x/system/user', parentMenu: '用户管理', actionKind: 'create', domLevel: 1 },
      { kind: 'action', text: '导出', url: 'https://x/system/user', parentMenu: '用户管理', actionKind: 'export', domLevel: 1 },
    ];
    const items = derivePendingHierarchy(steps, 0, 'M');
    expect(items[1].parentSeq).toBe(items[0].seq);
    expect(items[2].parentSeq).toBe(items[0].seq); // 两个按钮都挂同一个菜单，不互相嵌套
    expect(items[1].depth).toBe(1);
    expect(items[2].depth).toBe(1);
    expect(items[1].actionKind).toBe('create');
    expect(items[2].module).toBe('用户管理');
  });

  it('未点过菜单直接点按钮 → 顶层（不编造父级）', () => {
    const steps: ClickStepInput[] = [{ kind: 'action', text: '新增', url: 'https://x/a' }];
    const items = derivePendingHierarchy(steps, 0, 'M');
    expect(items[0].parentSeq).toBeNull();
    expect(items[0].depth).toBe(0);
  });

  it('seq 基于 baseSeq 连续递增', () => {
    const steps = [S({ text: 'A' }), S({ text: 'B' })];
    const items = derivePendingHierarchy(steps, 10, 'M');
    expect(items.map((i) => i.seq)).toEqual([11, 12]);
  });

  it('无文本步骤用 selector 或占位名，不留空', () => {
    const items = derivePendingHierarchy([S({ text: '', selector: '#x' }), S({})], 0, 'M');
    expect(items[0].label).toBe('#x');
    expect(items[1].label).toBe('步骤 2');
  });
});

describe('normUrlForHierarchy', () => {
  it('保留 hash、去掉 query 与末尾斜杠', () => {
    expect(normUrlForHierarchy('https://x/app/#/a/b/?k=1')).toBe('https://x/app/#/a/b');
    expect(normUrlForHierarchy('https://x/app/')).toBe('https://x/app');
  });
});

describe('orderForPromote —— 全部入树时「父必须先于子」', () => {
  it('浅层排在前（父先入树，子才能挂到父的真实 id 下）', () => {
    const items = [
      { seq: 3, depth: 2 },
      { seq: 1, depth: 0 },
      { seq: 2, depth: 1 },
    ];
    expect(orderForPromote(items).map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it('同 depth 保持原 seq 顺序（稳定，不打乱用户看到的列表顺序）', () => {
    const items = [
      { seq: 5, depth: 0 },
      { seq: 2, depth: 0 },
      { seq: 9, depth: 0 },
    ];
    expect(orderForPromote(items).map((i) => i.seq)).toEqual([2, 5, 9]);
  });

  it('缺失 depth 视为 0（旧数据兼容）', () => {
    const items = [{ seq: 2, depth: undefined }, { seq: 1, depth: 0 }, { seq: 3, depth: 1 }];
    expect(orderForPromote(items).map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it('不修改入参', () => {
    const items = [{ seq: 2, depth: 1 }, { seq: 1, depth: 0 }];
    const snapshot = JSON.stringify(items);
    orderForPromote(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe('menuPath —— 层级以 DOM 祖先链为准（与点击顺序无关）', () => {
  it('用户真实场景：跳跃点击侧栏菜单，按钮/栅格同属「表单」，功能扩展属「实例演示」', () => {
    const steps = [
      S({ text: '首页', url: 'u/home', menuPath: [] }),
      S({ text: 'AI对话', url: 'u/ai', menuPath: [] }),
      S({ text: '按钮', url: 'u/btn', menuPath: ['实例演示', '表单'] }),
      S({ text: '栅格', url: 'u/grid', menuPath: ['实例演示', '表单'] }),
      S({ text: '功能扩展', url: 'u/ext', menuPath: ['实例演示'] }),
    ];
    const items = derivePendingHierarchy(steps, 0, '若依');
    const byLabel = (n: string) => items.filter((i) => i.label === n);
    // 缺失的祖先自动补全，且只建一次
    expect(byLabel('实例演示')).toHaveLength(1);
    expect(byLabel('表单')).toHaveLength(1);
    const shili = byLabel('实例演示')[0];
    const biaodan = byLabel('表单')[0];
    const anniu = byLabel('按钮')[0];
    const gezi = byLabel('栅格')[0];
    const gongneng = byLabel('功能扩展')[0];
    expect(shili.depth).toBe(0);
    expect(biaodan.parentSeq).toBe(shili.seq);
    expect(biaodan.depth).toBe(1);
    expect(anniu.parentSeq).toBe(biaodan.seq);
    expect(anniu.depth).toBe(2);
    expect(gezi.parentSeq).toBe(biaodan.seq);
    expect(gezi.depth).toBe(2);
    expect(gongneng.parentSeq).toBe(shili.seq);
    expect(gongneng.depth).toBe(1);
    // 无祖先的菜单仍为顶层
    expect(byLabel('首页')[0].depth).toBe(0);
    expect(byLabel('AI对话')[0].depth).toBe(0);
    // 用户真点过的叶子带 URL；合成的祖先没有独立落地 URL
    expect(anniu.url).toBe('u/btn');
    expect(shili.url).toBeUndefined();
  });

  it('重复点击同一菜单 → 复用同一条目，不产生重复', () => {
    const steps = [
      S({ text: '系统管理', url: 'u/s1', menuPath: [] }),
      S({ text: '用户管理', url: 'u/u1', menuPath: ['系统管理'] }),
      S({ text: '系统管理', url: 'u/s2', menuPath: [] }),
      S({ text: '用户管理', url: 'u/u2', menuPath: ['系统管理'] }),
    ];
    const items = derivePendingHierarchy(steps, 0, 'm');
    expect(items.filter((i) => i.label === '系统管理')).toHaveLength(1);
    expect(items.filter((i) => i.label === '用户管理')).toHaveLength(1);
  });

  it('action（页面按钮）仍归属最近点过的菜单叶子', () => {
    const steps = [
      S({ text: '用户管理', url: 'u/u1', menuPath: ['系统管理'] }),
      S({ text: '新增', kind: 'action', url: 'u/u1', parentMenu: '用户管理', actionKind: 'create' }),
    ];
    const items = derivePendingHierarchy(steps, 0, 'm');
    const add = items.find((i) => i.label === '新增');
    const u = items.find((i) => i.label === '用户管理');
    expect(add?.parentSeq).toBe(u?.seq);
    expect(add?.kind).toBe('action');
  });

  it('旧数据（无 menuPath 字段）→ 走原 domLevel/URL 启发式，不受影响', () => {
    const steps = [
      S({ text: 'A', url: 'x/#/a', domLevel: 1 }),
      S({ text: 'B', url: 'x/#/a/b', domLevel: 2 }), // URL 子路径 ⇒ A 的子
    ];
    const items = derivePendingHierarchy(steps, 0, 'm');
    const b = items.find((i) => i.label === 'B');
    const a = items.find((i) => i.label === 'A');
    expect(b?.parentSeq).toBe(a?.seq);
  });
});
