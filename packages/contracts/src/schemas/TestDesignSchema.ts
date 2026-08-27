/**
 * @file TestDesignSchema.ts
 * @description TestDesign 新增类型的 zod schema（旧输入可省略可选字段）
 */
import { z } from 'zod';
import type {
  ActionKind,
  ActionEntry,
  ContainerState,
  CoverageManifest,
  FeatureArtifactV2,
  FeatureEvidence,
  FeatureProfile,
  FeatureSource,
  FieldSemantic,
  PageState,
  ScenarioCandidate,
  TableSemantic,
  UncoveredItem,
  UncoveredKind,
  StructuredDesignDetail,
} from '../types/TestDesign';
import { isFeatureArtifactV2 } from '../types/TestDesign';

/** ActionKind enum 校验 */
export const ActionKindSchema = z.enum([
  'list',
  'query',
  'reset',
  'create',
  'update',
  'delete',
  'batch_delete',
  'detail',
  'import',
  'export',
  'auth',
  'permission',
  'workflow',
  'other',
]) as z.ZodType<ActionKind>;

export const FeatureSourceSchema = z.enum(['web', 'openapi', 'workflow', 'manual']) as z.ZodType<FeatureSource>;

const SchemaSummarySchema = z.object({
  type: z.string().optional(), format: z.string().optional(), required: z.array(z.string()).optional(), properties: z.array(z.string()).optional(),
  minLength: z.number().optional(), maxLength: z.number().optional(), minimum: z.number().optional(), maximum: z.number().optional(), pattern: z.string().optional(), enum: z.array(z.string()).optional(),
});
const ApiParameterDetailSchema = z.object({ name: z.string(), in: z.enum(['path', 'query', 'header', 'cookie', 'body', 'formData']), required: z.boolean(), description: z.string().optional(), schema: SchemaSummarySchema.optional() });
const ApiResponseDetailSchema = z.object({ status: z.string(), description: z.string(), schema: SchemaSummarySchema.optional() });
const StructuredDesignDetailSchema: z.ZodType<StructuredDesignDetail> = z.object({
  source: z.enum(['openapi', 'workflow']),
  api: z.object({ method: z.string(), path: z.string(), parameters: z.array(ApiParameterDetailSchema), requestBody: z.object({ required: z.boolean(), contentType: z.string().optional(), description: z.string().optional(), schema: SchemaSummarySchema.optional() }).optional(), responses: z.array(ApiResponseDetailSchema), security: z.array(z.string()) }).optional(),
  workflow: z.object({ roles: z.array(z.string()), transitions: z.array(z.object({ id: z.string(), action: z.string(), from: z.string(), to: z.string(), actorRoles: z.array(z.string()), preconditions: z.array(z.string()), postconditions: z.array(z.string()) })) }).optional(),
}) as unknown as z.ZodType<StructuredDesignDetail>;

export const FieldSemanticSchema: z.ZodType<FieldSemantic> = z.object({
  ref: z.string(),
  selector: z.string(),
  name: z.string(),
  inputType: z.string().optional(),
  required: z.boolean().optional(),
  readonly: z.boolean().optional(),
  disabled: z.boolean().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  pattern: z.string().optional(),
  options: z.array(z.string()).optional(),
  multiple: z.boolean().optional(),
  defaultValue: z.string().optional(),
  placeholder: z.string().optional(),
}) as unknown as z.ZodType<FieldSemantic>;

export const TableSemanticSchema: z.ZodType<TableSemantic> = z.object({
  ref: z.string(),
  selector: z.string(),
  columns: z.array(z.string()),
  rowCount: z.number(),
  hasPagination: z.boolean(),
  paginationInfo: z.string().optional(),
  hasSorting: z.boolean(),
  sortableColumns: z.array(z.string()).optional(),
  hasFilter: z.boolean(),
  filterFields: z.array(z.string()).optional(),
  hasEmptyState: z.boolean(),
  emptyStateText: z.string().optional(),
  isVirtualList: z.boolean().optional(),
}) as unknown as z.ZodType<TableSemantic>;

export const PageStateSchema = z.enum(['base', 'create', 'detail', 'update', 'views']) as z.ZodType<PageState>;

export const ActionEntrySchema: z.ZodType<ActionEntry> = z.object({
  actionKind: ActionKindSchema,
  ref: z.string(),
  selector: z.string(),
  text: z.string().optional(),
  triggerable: z.boolean(),
  triggerRule: z.string().optional(),
  observed: z.boolean().optional(),
}) as unknown as z.ZodType<ActionEntry>;

export const ContainerStateSchema: z.ZodType<ContainerState> = z.object({
  kind: z.enum(['tab', 'dialog', 'drawer', 'collapse', 'iframe', 'shadow', 'virtual_list']),
  ref: z.string(),
  selector: z.string(),
  label: z.string().optional(),
  expanded: z.boolean().optional(),
  crossOrigin: z.boolean().optional(),
  shadowDom: z.enum(['open', 'closed']).optional(),
}) as unknown as z.ZodType<ContainerState>;

export const UncoveredKindSchema = z.enum([
  'cross_origin_iframe',
  'closed_shadow_dom',
  'canvas',
  'write_required_state',
  'no_safe_sample',
  'budget_exceeded',
  'hardware_control',
  'timeout',
]) as z.ZodType<UncoveredKind>;

export const UncoveredItemSchema: z.ZodType<UncoveredItem> = z.object({
  kind: UncoveredKindSchema,
  reason: z.string(),
}) as unknown as z.ZodType<UncoveredItem>;

export const CoverageManifestSchema: z.ZodType<CoverageManifest> = z.object({
  actionKind: ActionKindSchema,
  requiredKeys: z.array(z.string()),
  observedKeys: z.array(z.string()),
  needsReviewKeys: z.array(z.string()),
  missingKeys: z.array(z.string()).optional(),
}) as unknown as z.ZodType<CoverageManifest>;

export const FeatureProfileSchema: z.ZodType<FeatureProfile> = z.object({
  featureId: z.string(),
  testPoint: z.string(),
  actionKind: ActionKindSchema,
  pageUrl: z.string().optional(),
  clickSelector: z.string().optional(),
  parentModule: z.string().optional(),
  subsystemId: z.string().optional(),
  sourceLabel: z.string().optional(),
  sourceSelector: z.string().optional(),
  source: FeatureSourceSchema.optional(),
}) as unknown as z.ZodType<FeatureProfile>;

export const FeatureEvidenceSchema: z.ZodType<FeatureEvidence> = z
  .object({
    featureId: z.string(),
    actionKind: ActionKindSchema,
    systemId: z.string().optional(),
    featureRevision: z.string().optional(),
    pageEntry: z.string().optional(),
    pageUrl: z.string().optional(),
    states: z.array(PageStateSchema),
    fields: z.array(FieldSemanticSchema),
    tables: z.array(TableSemanticSchema),
    actionEntries: z.array(ActionEntrySchema),
    containers: z.array(ContainerStateSchema),
    evidenceLevel: z.enum(['observed', 'derived', 'needs_review']),
    coverageKeys: z.array(z.string()),
    needsReview: z.boolean(),
    reviewReason: z.string().optional(),
    coverageManifest: CoverageManifestSchema.optional(),
    uncovered: z.array(UncoveredItemSchema),
    structuredDesign: StructuredDesignDetailSchema.optional(),
  })
  .refine((d) => !d.needsReview || !!d.reviewReason, {
    message: 'needsReview=true 的 FeatureEvidence 必须提供 reviewReason',
    path: ['reviewReason'],
  }) as unknown as z.ZodType<FeatureEvidence>;

export const ScenarioCandidateSchema: z.ZodType<ScenarioCandidate> = z.object({
  scenarioId: z.string(),
  featureId: z.string(),
  actionKind: ActionKindSchema,
  scenarioName: z.string(),
  coverageKey: z.string(),
  priority: z.enum(['P0', 'P1', 'P2']),
  caseNo: z.string(),
  step: z.string(),
  operation: z.string(),
  expected: z.string(),
  evidenceLevel: z.enum(['observed', 'derived', 'needs_review']),
  needsReview: z.boolean(),
  reviewReason: z.string().optional(),
}).refine((d) => !d.needsReview || !!d.reviewReason, {
  message: 'needsReview=true 的 ScenarioCandidate 必须提供 reviewReason', path: ['reviewReason'],
}).refine((d) => d.caseNo === d.featureId, {
  message: 'ScenarioCandidate.caseNo 必须等于 featureId', path: ['caseNo'],
}) as unknown as z.ZodType<ScenarioCandidate>;

/** FeatureArtifact：旧二维数组 或 v2 对象 */
export const FeatureArtifactSchema = z.union([
  z.array(z.array(z.array(z.string()))),
  z.object({
    version: z.literal(2),
    table: z.array(z.array(z.array(z.string()))),
    featurePaths: z.record(z.string(), z.string()).optional(),
    featureProfiles: z.array(FeatureProfileSchema).optional(),
    featureEvidence: z.record(z.string(), FeatureEvidenceSchema).optional(),
    provenance: z.array(z.any()).optional(),
    designSources: z.array(z.string()).optional(),
  }) as unknown as z.ZodType<FeatureArtifactV2>,
]) as unknown as z.ZodType<FeatureArtifactV2 | string[][][]>;

export function isV2Artifact(v: unknown): v is FeatureArtifactV2 {
  return isFeatureArtifactV2(v as any);
}
