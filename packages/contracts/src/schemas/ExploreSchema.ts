/**
 * @file ExploreSchema.ts
 * @description ExploreInput/Output 的 zod schema（ModuleNode 递归）
 * @frozen v1.0
 */
import { z } from 'zod';
import type { ExploreInput, ExploreOutput } from '../stages/ExploreContract';
import type { ModuleNode } from '../types/ModuleNode';
import { SessionHandleSchema } from './LoginSchema';
import { ActionKindSchema } from './TestDesignSchema';

export const ModuleNodeSchema: z.ZodType<ModuleNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    parentId: z.union([z.string(), z.null()]),
    subsystemId: z.string(),
    type: z.enum(['system', 'module', 'page', 'action']),
    status: z.enum(['covered', 'needs_review', 'unexplored']),
    children: z.array(ModuleNodeSchema),
    url: z.string().optional(),
    pageTitle: z.string().optional(),
    evidenceId: z.string().optional(),
    depth: z.number(),
    manuallyAdded: z.boolean().optional(),
    reviewReason: z.string().optional(),
    actionKind: ActionKindSchema.optional(),
    actionSelector: z.string().optional(),
    actionText: z.string().optional(),
  }),
);

export const ClickStepSchema = z.object({
  selector: z.string(),
  text: z.string(),
  url: z.string(),
  timestamp: z.number(),
});

export const ClickPathSchema = z.object({
  steps: z.array(ClickStepSchema),
  inferredModule: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ManualSupplementSchema = z.object({
  clickPath: z.array(ClickPathSchema),
  insertPosition: z.enum(['above', 'below', 'end']),
  relativeToNodeId: z.union([z.string(), z.null()]),
});

export const McpExplorationCheckpointSchema = z.object({
  checkpointId: z.string(),
  visitedNodeIds: z.array(z.string()),
  frontier: z.array(z.string()),
  savedAt: z.number(),
});

export const ExploreInputSchema = z.object({
  sessionHandle: SessionHandleSchema,
  subsystemId: z.string(),
  systemUrl: z.string().optional(),
  resumeFrom: z.string().optional(),
  manualSupplement: ManualSupplementSchema.optional(),
  readOnlyClickPolicy: z.enum(['strict', 'allow_all']).optional(),
});

export const ExploreOutputSchema = z.object({
  moduleTree: z.array(ModuleNodeSchema),
  coverage: z.object({
    visited: z.number(),
    total: z.number(),
    frontier: z.array(z.string()),
  }),
  needsReview: z.array(z.string()),
  checkpoint: McpExplorationCheckpointSchema,
});

export function validateExploreInput(v: unknown): ExploreInput {
  return ExploreInputSchema.parse(v);
}
export function validateExploreOutput(v: unknown): ExploreOutput {
  return ExploreOutputSchema.parse(v);
}
