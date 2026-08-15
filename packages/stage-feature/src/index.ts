/**
 * @file index.ts
 * @description 功能点审核 stage — 九列 + 合并 + 增删 + 整体确认
 * @input FeatureInput @output FeatureOutput
 * @frozen v1.0
 */
import type { FeatureInput, FeatureOutput } from '@test-platform/contracts';
import { validateFeatureInput } from '@test-platform/contracts';
import { buildFeatureTable } from './featureTable';

/**
 * 功能点审核入口（冻结签名）。
 * 由模块树生成九列功能点表，合并人工补充（manuallyAdded 节点）、标记溯源、
 * 按 confirmedOnly 过滤；边界（空树/空数组）安全返回空结果。
 */
export async function run(input: FeatureInput): Promise<FeatureOutput> {
  const validated = validateFeatureInput(input);
  const { featureTable, featureIds, provenance } = buildFeatureTable(
    validated.moduleTree,
    validated.systemName,
    validated.confirmedOnly,
  );
  return { featureTable, featureIds, provenance };
}

export { buildFeatureTable } from './featureTable';
export { toAbbrToken, systemAbbrFromSubsystemId, shortHash } from './abbreviation';
export { deriveProvenance, makeProvenanceId } from './provenance';
