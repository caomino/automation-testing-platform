/**
 * @file provenance.ts
 * @description 功能点溯源派生（exploration / ai_generated / manual）
 * @contract FeatureProvenance 溯源类型定义
 * @frozen v1.0
 */
import type { ModuleNode, FeatureProvenance } from '@test-platform/contracts';
import { createHash } from 'node:crypto';

export type ProvenanceSource = FeatureProvenance['source'];

export interface DerivedProvenance {
  source: ProvenanceSource;
  confirmed: boolean;
  evidenceId?: string;
}

/**
 * 由模块树节点派生溯源来源与确认状态：
 * - manuallyAdded  → manual（已确认，人工补录）
 * - evidenceId 存在 → exploration（已确认，探索证据）
 * - 其余            → ai_generated（待人工确认）
 */
export function deriveProvenance(node: ModuleNode): DerivedProvenance {
  if (node.manuallyAdded) {
    return { source: 'manual', confirmed: true };
  }
  if (node.evidenceId) {
    return { source: 'exploration', confirmed: true, evidenceId: node.evidenceId };
  }
  return { source: 'ai_generated', confirmed: false };
}

/** 生成稳定 provenanceId（FP-<sha256 前 12 位>），保证 round-trip 一致 */
export function makeProvenanceId(rowContent: string): string {
  const digest = createHash('sha256').update(rowContent, 'utf8').digest('hex');
  return `FP-${digest.slice(0, 12).toUpperCase()}`;
}
