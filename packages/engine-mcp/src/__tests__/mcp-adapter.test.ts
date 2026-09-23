/**
 * @file mcp-adapter.test.ts
 * @description Fix-D 回归：extractLabel 真实中文标签提取
 *   之前 Playwright 对无 <label> 的 <select> 取 id/name 作为可访问名，产生 theSelect 类占位；
 *   修复后优先从「中文标签前置」模式提取真实文案，无中文且无引号 token 时如实返回 undefined（不编造）。
 */
import { describe, it, expect } from 'vitest';
import { McpPlaywrightAdapter } from '../mcp-adapter.js';

function adapter(): any {
  // 构造函数仅保存 config，不建立连接，可直接用于调用私有 extractLabel
  return new McpPlaywrightAdapter({} as any);
}

describe('Fix-D extractLabel 真实中文标签提取', () => {
  it('中文标签前置模式 → 提取真实中文标签（不再把 id/name 当标签）', () => {
    const a = adapter();
    expect(a.extractLabel({ description: '用户名 [textbox]' })).toBe('用户名');
    expect(a.extractLabel({ description: '状态：combobox' })).toBe('状态');
    expect(a.extractLabel({ description: '查询条件 [searchbox]' })).toBe('查询条件');
  });

  it('无中文标签且无引号 token → 如实返回 undefined，不编造中文（杜绝 theSelect 类占位）', () => {
    const a = adapter();
    expect(a.extractLabel({ description: 'theSelect [select]' })).toBeUndefined();
    expect(a.extractLabel({ description: 'combobox' })).toBeUndefined();
  });

  it('带引号 token（合成 id/name）→ 返回引号内真实 token，不臆造中文', () => {
    const a = adapter();
    expect(a.extractLabel({ description: '"username" [textbox]' })).toBe('username');
  });
});
