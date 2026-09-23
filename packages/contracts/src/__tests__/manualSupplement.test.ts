/**
 * @file manualSupplement.test.ts
 * @description 人工补录契约 v1.1 新增字段测试（kind / parentMenu / menuUrl）
 *   设计依据：docs/designs/人工补充-两段式-design.md §3.2
 *   TDD：先红（字段不存在）→ 实现 → 绿
 */

import { describe, it, expect } from 'vitest';
import { ClickStepSchema, ClickPathSchema } from '../schemas/ExploreSchema.js';

describe('人工补录契约 v1.1：ClickStep 新增可选字段', () => {
  it('旧形状（无新字段）仍可解析 —— 向后兼容', () => {
    const parsed = ClickStepSchema.parse({
      selector: '#a',
      text: '用户管理',
      url: 'https://demo.test/system/user',
      timestamp: 1,
    });
    expect(parsed.kind).toBeUndefined();
    expect(parsed.parentMenu).toBeUndefined();
  });

  it('新形状：kind=action + parentMenu 被保留（最小颗粒度到按钮/功能）', () => {
    const parsed = ClickStepSchema.parse({
      selector: '#btn-add',
      text: '新增',
      url: 'https://demo.test/system/user',
      timestamp: 2,
      kind: 'action',
      parentMenu: '用户管理',
    });
    expect(parsed.kind).toBe('action');
    expect(parsed.parentMenu).toBe('用户管理');
  });

  it('kind=menu 合法', () => {
    const parsed = ClickStepSchema.parse({
      selector: '#menu-user',
      text: '用户管理',
      url: 'https://demo.test/system/user',
      timestamp: 3,
      kind: 'menu',
    });
    expect(parsed.kind).toBe('menu');
  });

  it('kind 非法值被拒绝', () => {
    expect(() =>
      ClickStepSchema.parse({
        selector: '#x',
        text: 'x',
        url: 'https://demo.test/',
        timestamp: 4,
        kind: 'foo',
      }),
    ).toThrow();
  });
});

describe('人工补录契约 v1.1：ClickPath 新增 menuUrl', () => {
  it('menuUrl 被保留（菜单页自身地址，与按钮 url 区分）', () => {
    const parsed = ClickPathSchema.parse({
      steps: [{ selector: '#a', text: '用户管理', url: 'https://demo.test/system/user', timestamp: 1, kind: 'menu' }],
      inferredModule: '系统管理',
      confidence: 0.95,
      menuUrl: 'https://demo.test/system/user',
    });
    expect(parsed.menuUrl).toBe('https://demo.test/system/user');
  });

  it('缺 menuUrl 仍可解析', () => {
    const parsed = ClickPathSchema.parse({
      steps: [{ selector: '#a', text: 'x', url: 'https://demo.test/', timestamp: 1 }],
      inferredModule: 'm',
      confidence: 0.5,
    });
    expect(parsed.menuUrl).toBeUndefined();
  });
});
