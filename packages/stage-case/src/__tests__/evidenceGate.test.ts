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
    states: ['base', 'list'],
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
