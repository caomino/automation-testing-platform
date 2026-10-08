import { describe, expect, it } from 'vitest';
import { buildFeatureTable } from './featureTable';
import type { ModuleNode } from '@test-platform/contracts';

/**
 * 回归测试：锁定「功能点真实页面 URL → featurePaths 生成」的终点逻辑（2026-09-22 诊断修复）。
 *
 * 根因：前端 toModuleView / fromModuleView / moduleTreeToContract 丢失 url，导致 feature 阶段
 * resolvePageUrl 拿不到 url → featurePaths 全空 → case 阶段退化按名点击 → 大量报错。
 * 本测试在真实后端函数上断言：url 在则 featurePaths 生成、source 判定正确；url 缺失则空（旧 bug 对照）。
 */

function makeTree(withUrl: boolean): ModuleNode[] {
  const pageUrl = withUrl ? 'https://demo.ruoyi.vip/system/user' : undefined;
  const actionUrl = withUrl ? 'javascript:void(0)' : undefined;
  const sys = (id: string, label: string, type: ModuleNode['type'], depth: number, url: string | undefined, manuallyAdded: boolean, children: ModuleNode[]): ModuleNode => ({
    id, label, type, depth, url, manuallyAdded, children,
    parentId: null, subsystemId: 'sys1', status: 'unexplored',
  });
  return [
    sys('m1', '系统管理', 'module', 0, withUrl ? 'https://demo.ruoyi.vip/system' : undefined, false, [
      sys('p1', '用户管理', 'page', 1, pageUrl, false, [
        sys('a1', '新增', 'action', 2, actionUrl, false, []),
        sys('a2', '查询', 'action', 2, actionUrl, false, []),
      ]),
    ]),
    // 人工补录节点：manuallyAdded 必须保持 true → source=manual
    sys('m2', '手工菜单', 'module', 0, withUrl ? 'https://demo.ruoyi.vip/manual' : undefined, true, []),
  ];
}

describe('featurePaths 由功能点 URL 生成（根因修复回归）', () => {
  it('修复后：url 在 → featurePaths 生成，action 节点回退到页面 URL，source 判定正确', () => {
    const res = buildFeatureTable(makeTree(true), 'RuoYi', false);
    const fpKeys = Object.keys(res.featurePaths);
    expect(fpKeys.length).toBeGreaterThan(0);

    // action 节点自身 url 为 javascript:，应回退到祖先页面 URL
    const actionPath = Object.values(res.featurePaths).find((u) => u.includes('/system/user'));
    expect(actionPath).toBe('https://demo.ruoyi.vip/system/user');

    const explored = res.featureProfiles.find((p) => p.testPoint === '新增');
    expect(explored).toBeDefined();
    expect(explored!.source).toBe('web'); // 探索节点不应被误判为 manual

    const manual = res.featureProfiles.find((p) => p.testPoint === '手工菜单');
    expect(manual!.source).toBe('manual');
  });

  it('对照（旧 bug）：url 缺失 → featurePaths 全空（但 source 仍按真实 manuallyAdded 判定，误判只在出前端硬编码）', () => {
    const res = buildFeatureTable(makeTree(false), 'RuoYi', false);
    expect(Object.keys(res.featurePaths).length).toBe(0); // 旧 bug：全空 → case 阶段退化按名点击
    // 说明：featurePaths 全空是 url 缺失的直接后果；而「探索节点被误判 source:manual」是前端
    // fromModuleView 硬编码 manuallyAdded:true 造成的（已在 pipeline.ts 修复），后端本身按真实字段判定。
    const explored = res.featureProfiles.find((p) => p.testPoint === '新增');
    expect(explored!.source).toBe('web'); // 后端用真实 manuallyAdded(false) → web
  });
});
