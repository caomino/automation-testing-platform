/**
 * @file index.ts
 * @description 功能点审核 stage — 九列 + 合并 + 增删 + 整体确认
 * @input FeatureInput @output FeatureOutput
 * @frozen v1.0
 */
import type { FeatureEvidence, FeatureInput, FeatureOutput } from '@test-platform/contracts';
import { validateFeatureInput } from '@test-platform/contracts';
import { buildFeatureTable } from './featureTable';
import { adaptDesignSources } from './designSourceAdapter';

/**
 * 功能点审核入口（冻结签名）。
 * 由模块树生成九列功能点表，合并人工补充（manuallyAdded 节点）、标记溯源、
 * 按 confirmedOnly 过滤；边界（空树/空数组）安全返回空结果。
 */
export async function run(input: FeatureInput): Promise<FeatureOutput> {
  const validated = validateFeatureInput(input);
  const adapted = await adaptDesignSources(validated.designSources);
  const { featureTable, featureIds, provenance, featurePaths, featureProfiles } = buildFeatureTable(
    [...validated.moduleTree, ...adapted.nodes],
    validated.systemName,
    validated.confirmedOnly,
  );
  const featureEvidence: Record<string, FeatureEvidence> = {};
  for (const profile of featureProfiles) {
    const evidence = profile.sourceSelector ? adapted.evidenceBySelector[profile.sourceSelector] : undefined;
    if (evidence) featureEvidence[profile.featureId] = { ...evidence, featureId: profile.featureId };
  }
  return {
    featureTable, featureIds, provenance, featurePaths, featureProfiles,
    ...(Object.keys(featureEvidence).length ? { featureEvidence } : {}),
  };
}

export { buildFeatureTable } from './featureTable';
export { toAbbrToken, toAbbrTokenWithLabel, systemAbbrFromSubsystemId, shortHash } from './abbreviation';
export { deriveProvenance, makeProvenanceId } from './provenance';
export { adaptDesignSources } from './designSourceAdapter';
