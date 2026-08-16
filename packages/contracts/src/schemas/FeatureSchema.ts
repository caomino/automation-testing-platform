/**
 * @file FeatureSchema.ts
 * @description FeatureInput/Output 的 zod schema（九列功能点）
 * @frozen v1.0
 */
import { z } from 'zod';
import type { FeatureInput, FeatureOutput } from '../stages/FeatureContract';
import { ModuleNodeSchema } from './ExploreSchema';

export const FeatureProvenanceSchema = z.object({
  provenanceId: z.string(),
  featureRowIndex: z.number(),
  source: z.enum(['exploration', 'ai_generated', 'manual']),
  evidenceId: z.string().optional(),
  confirmed: z.boolean(),
});

export const FeatureInputSchema = z.object({
  moduleTree: z.array(ModuleNodeSchema),
  systemName: z.string().min(1, 'systemName 必填'),
  confirmedOnly: z.boolean(),
});

// 功能点表：系统/子系统维度 → 模块分组 → 九列字符串行
export const FeatureTableSchema = z.array(z.array(z.array(z.string()).length(9)));

export const FeatureOutputSchema = z.object({
  featureTable: FeatureTableSchema,
  featureIds: z.array(z.string()),
  provenance: z.array(FeatureProvenanceSchema),
  featurePaths: z.record(z.string(), z.string()).optional(),
});

export function validateFeatureInput(v: unknown): FeatureInput {
  return FeatureInputSchema.parse(v);
}
export function validateFeatureOutput(v: unknown): FeatureOutput {
  return FeatureOutputSchema.parse(v);
}
