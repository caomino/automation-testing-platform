/**
 * @file evidenceGate.test.ts
 * @description 验证证据门对「DOM token 泄漏」脏证据的判定：含 btSelectAll / theSelect 等不可读字段名的旧证据
 *              必须判为不一致 → collectMissingFeatureIds 将其标记为缺失 → 强制二次探索重采，
 *              终结"改了采集代码却毫无变化"的脏证据无限复用。
 */
import { describe, expect, it } from 'vitest';
import type { FeatureEvidence } from '@test-platform/contracts';
import { gateFeatureEvidence } from '../evidenceGate.js';

function makeEvidence(overrides: Partial<FeatureEvidence> = {}): FeatureEvidence {
  return {
    featureId: 'F_01',
    actionKind: 'list',
    states: ['base', 'views'],
    fields: [],
    tables: [],
    actionEntries: [],
    containers: [],
    evidenceLevel: 'observed',
    coverageKeys: ['list.display'],
    needsReview: false,
    uncovered: [],
    ...overrides,
  };
}

describe('gateFeatureEvidence — DOM token 泄漏脏证据必须判为不一致', () => {
  it('含 btSelectAll 字段名的旧证据：判定不一致（触发重采）', () => {
    const dirty: FeatureEvidence = makeEvidence({
      fields: [
        { ref: 'btSelectAll', selector: '#btSelectAll', name: 'btSelectAll' } as any,
        { ref: 'x', selector: '#x', name: '用户名称' } as any,
      ],
    });
    const result = gateFeatureEvidence('F_01', undefined, dirty, 'https://x.com/users');
    expect(result.hasEvidence).toBe(true);
    expect(result.consistent).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('token 泄漏') || reason.includes('btSelectAll'))).toBe(true);
  });

  it('含 theSelect / userName 等纯英文标识符字段名：判定不一致', () => {
    const dirty: FeatureEvidence = makeEvidence({
      fields: [{ ref: 'theSelect', selector: '#theSelect', name: 'theSelect' } as any],
    });
    const result = gateFeatureEvidence('F_01', undefined, dirty, 'https://x.com/users');
    expect(result.consistent).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('token'))).toBe(true);
  });

  it('字段名为中文（用户名称/手机号）：不触发泄漏判定', () => {
    const clean: FeatureEvidence = makeEvidence({
      fields: [
        { ref: 'name', selector: '#name', name: '用户名称' } as any,
        { ref: 'phone', selector: '#phone', name: '手机号' } as any,
      ],
    });
    const result = gateFeatureEvidence('F_01', undefined, clean, 'https://x.com/users');
    expect(result.reasons.some((reason) => reason.includes('token'))).toBe(false);
  });

  it('无任何字段但证据合规：一致性由 hasContent 其它维度（表格/入口）决定，不被误判为 token 泄漏', () => {
    const clean: FeatureEvidence = makeEvidence({
      tables: [{ ref: 't', selector: '#t', columns: ['ID', '名称'], rowCount: 3, hasPagination: true } as any],
      coverageKeys: ['list.display', 'list.headers', 'list.pagination'],
    });
    const result = gateFeatureEvidence('F_01', undefined, clean, 'https://x.com/users');
    expect(result.reasons.some((reason) => reason.includes('token'))).toBe(false);
  });
});

describe('gateFeatureEvidence — 入口一致性用同文档判定（hash 差异不算不一致）', () => {
  it('pageUrl/pageEntry 与功能点路径仅差 hash：不判入口不一致', () => {
    const ev = makeEvidence({ pageUrl: 'https://demo.ruoyi.vip/index#/system/user', pageEntry: 'https://demo.ruoyi.vip/index#/system/user' });
    const out = gateFeatureEvidence('F_01', { featureId: 'F_01', testPoint: '用户管理', actionKind: 'list', pageUrl: 'https://demo.ruoyi.vip/index' } as any, ev, 'https://demo.ruoyi.vip/index');
    expect(out.reasons.some((r) => r.includes('入口不一致'))).toBe(false);
  });

  it('不同 origin（外链证据）：仍判入口不一致', () => {
    const ev = makeEvidence({ pageUrl: 'http://www.ruoyi.vip', pageEntry: 'http://www.ruoyi.vip' });
    const out = gateFeatureEvidence('F_02', { featureId: 'F_02', testPoint: '官网', actionKind: 'other', pageUrl: 'https://demo.ruoyi.vip/index' } as any, ev, 'https://demo.ruoyi.vip/index');
    expect(out.reasons.some((r) => r.includes('入口不一致'))).toBe(true);
  });

  it('query/path 不同但同 origin：判一致（AdminLTE iframe 形态主文档 URL 恒为入口页，path 级会误判）', () => {
    const ev = makeEvidence({ pageUrl: 'https://demo.ruoyi.vip/index', pageEntry: 'https://demo.ruoyi.vip/index' });
    const out = gateFeatureEvidence('F_03', { featureId: 'F_03', testPoint: '列表', actionKind: 'list', pageUrl: 'https://demo.ruoyi.vip/system/user' } as any, ev, 'https://demo.ruoyi.vip/system/user');
    expect(out.reasons.some((r) => r.includes('入口不一致'))).toBe(false);
  });
});

describe('二次探索菜单路径语义（menu: 前缀是页面进入方式，不是动作入口）', () => {
  const pageUrl = 'https://demo.example/index';
  it('sourceSelector 为 menu:路径时，不要求 actionEntries 含该路径（否则全量误判缺动作入口）', () => {
    const ev = makeEvidence({ featureId: 'F_10', pageUrl, pageEntry: pageUrl });
    ev.tables = [{ columns: ['用户ID', '登录名称'], rowCount: 3 } as any];
    const profile = { featureId: 'F_10', testPoint: '用户管理', actionKind: 'list', source: 'web', sourceSelector: 'menu:系统管理>用户管理' } as any;
    const out = gateFeatureEvidence('F_10', profile, ev, pageUrl, { systemId: 'sys1', featureRevision: 'rev1' });
    expect(out.reasons.some((r) => r.includes('动作入口'))).toBe(false);
    expect(out.hasEvidence).toBe(true);
  });

  it('真实动作入口（无 menu: 前缀）仍要求与 actionEntries 匹配', () => {
    const ev = makeEvidence({ featureId: 'F_11', pageUrl, pageEntry: pageUrl });
    ev.tables = [{ columns: ['用户ID'], rowCount: 1 } as any];
    const profile = { featureId: 'F_11', testPoint: '用户管理', actionKind: 'list', source: 'web', clickSelector: '#add-user' } as any;
    const out = gateFeatureEvidence('F_11', profile, ev, pageUrl, { systemId: 'sys1', featureRevision: 'rev1' });
    expect(out.reasons.some((r) => r.includes('动作入口'))).toBe(true);
  });
});
