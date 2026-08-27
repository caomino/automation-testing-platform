/**
 * @file CaseSchema.ts
 * @description CaseInput/Output 的 zod schema（meta + 八列 + 金标准对齐）
 * @frozen v1.0
 */
import { z } from 'zod';
import type {
  CaseFeatureResult,
  CaseGenerationContext,
  CaseInput,
  CaseOutput,
  CoverageDecision,
} from '../stages/CaseContract';
import type { CaseRow } from '../types/CaseRow';
import type { CaseSheet, MetaHeader } from '../types/CaseSheet';
import { FeatureEvidenceSchema, FeatureProfileSchema } from './TestDesignSchema';

export const MetaHeaderSchema: z.ZodType<MetaHeader> = z.object({
  systemName: z.string(),
  testPointId: z.string(),
  testPoint: z.string(),
  testers: z.string(),
  clientStaff: z.string(),
  developerStaff: z.string(),
  firstTestDate: z.string(),
  regressionDate: z.string(),
  conclusionRule: z.string(),
  precondition: z.string(),
});

export const CaseRowSchema: z.ZodType<CaseRow> = z.object({
  // === 八列可见数据 ===
  caseNo: z.string(),
  content: z.string(),
  step: z.string(),
  operation: z.string(),
  expected: z.string(),
  firstResult: z.string(),
  regressionResult: z.string(),
  conclusion: z.string(),
  // === 绑定元数据（隐藏，不写入 Excel） ===
  id: z.string(),
  featureId: z.string(),
  batchId: z.string().optional(),
  featureFingerprint: z.string().optional(),
  generationMode: z.enum(['no_ai', 'ai']).optional(),
  aiConfigId: z.string().optional(),
  targetTestPoint: z.string(),
  scenarioId: z.string().optional(),
  evidenceId: z.string().optional(),
  evidenceLevel: z.enum(['observed', 'derived', 'needs_review']).optional(),
  scenarioName: z.string().optional(),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  coverageKeys: z.array(z.string()).optional(),
  origin: z.enum(['system_generated', 'user_edited', 'user_added', 'confirmed', 'imported']).optional(),
  quality: z.enum(['high', 'low', 'conflict']).optional(),
  needsReview: z.boolean().optional(),
  reviewReason: z.string().optional(),
  confidence: z.number().optional(),
  manualEdited: z.boolean().optional(),
  qualityGateStatus: z.string().optional(),
}).refine((row) => row.caseNo === row.featureId, {
  message: 'CaseRow.caseNo 必须等于 featureId',
  path: ['caseNo'],
}) as unknown as z.ZodType<CaseRow>;

export const CaseSheetSchema: z.ZodType<CaseSheet> = z.object({
  sheetName: z.string(),
  meta: MetaHeaderSchema,
  rows: z.array(CaseRowSchema),
  screenshotRef: z.string().optional(),
  colWidths: z.array(z.number()).optional(),
  remarkRow: z.string().optional(),
}) as unknown as z.ZodType<CaseSheet>;

export const QualityGateIssueSchema = z.object({
  caseRowId: z.string(),
  type: z.enum(['泛化', '缺证据', '越权']),
  message: z.string(),
  blocking: z.boolean(),
});

export const AIConfigRefSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(true), configId: z.string().min(1) }),
  z.object({ enabled: z.literal(false), configId: z.string().min(1).optional() }),
]);

const CoverageDecisionSchema = z.enum(['covered', 'not_applicable', 'needs_review']) as z.ZodType<CoverageDecision>;
const GenericCoverageReasons = new Set(['待确认', '信息不足', '证据不足']);
const CoverageCategories = '(?:normal|boundary|exception|process|permission)';

function isGenericCoverageReason(reason: string): boolean {
  let normalized = reason
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .trim();
  normalized = normalized.replace(/^[\s\p{P}]+/gu, '').trim();
  normalized = normalized.replace(/[\s\p{P}]+$/gu, '').trim();
  if (!normalized) return true;

  // Category labels are metadata, not a reason. Accept their common bracket,
  // delimiter, and whitespace forms before checking the generic placeholder.
  normalized = normalized.replace(
    new RegExp(`^(?:${CoverageCategories})(?:\\s*(?:[:：,，;；|/\\\\\\-–—]|\\s)+|\\s*)`, 'iu'),
    '',
  );
  normalized = normalized.replace(
    new RegExp(`^(?:\\[\\s*${CoverageCategories}\\s*\\]|【\\s*${CoverageCategories}\\s*】|\\(\\s*${CoverageCategories}\\s*\\))\\s*(?:[:：,，;；|/\\\\\\-–—]\\s*)?`, 'iu'),
    '',
  );
  normalized = normalized.replace(new RegExp(`^(?:${CoverageCategories})[\\s\\p{P}]*`, 'iu'), '');
  normalized = normalized.replace(/^[\s\p{P}]+/gu, '').trim();
  normalized = normalized.replace(/[\s\p{P}]+$/gu, '').trim();
  if (!normalized) return true;
  return GenericCoverageReasons.has(normalized);
}

const CaseFeatureResultBaseSchema = z.object({
  featureId: z.string().min(1),
  inputIndex: z.number().int().nonnegative(),
  featureFingerprint: z.string().min(1),
  coverageDecisions: z.object({
    normal: CoverageDecisionSchema,
    boundary: CoverageDecisionSchema,
    exception: CoverageDecisionSchema,
    process: CoverageDecisionSchema,
    permission: CoverageDecisionSchema,
  }),
  reasons: z.array(z.string().trim().min(1).refine((reason) => !isGenericCoverageReason(reason), {
    message: 'reasons 必须说明具体原因',
  })),
});

const CaseFeatureResultStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('generated'), generatedCaseGroup: z.literal(true) }),
  z.object({
    status: z.enum([
      'skipped_existing',
      'needs_review',
      'evidence_missing',
      'unsafe_to_explore',
      'unsupported_surface',
      'ai_failed',
      'revision_conflict',
    ]),
    generatedCaseGroup: z.literal(false),
  }),
]);

export const CaseFeatureResultSchema = z.intersection(
  CaseFeatureResultBaseSchema,
  CaseFeatureResultStatusSchema,
).superRefine((result, ctx) => {
  if (result.status !== 'generated' && result.reasons.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '非 generated 状态必须提供具体 reasons', path: ['reasons'] });
  }
  const needsReason = Object.values(result.coverageDecisions).some(
    (decision) => decision === 'not_applicable' || decision === 'needs_review',
  );
  if (needsReason && result.reasons.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reasons 必须说明非 covered 覆盖结论的具体原因', path: ['reasons'] });
  }
}) satisfies z.ZodType<CaseFeatureResult>;

const CaseGenerationContextBaseSchema = z.object({
  batchId: z.string().min(1),
  systemId: z.string().min(1),
  featureRevision: z.string().min(1),
  orderedFeatureIds: z.array(z.string().min(1)),
  styleVersion: z.string().min(1),
  taskId: z.string().min(1),
});

const CaseGenerationEvidenceSchema = z.union([
  z.object({
    evidenceVersion: z.string().min(1),
    evidenceDigest: z.string().min(1).optional(),
  }),
  z.object({
    evidenceVersion: z.string().min(1).optional(),
    evidenceDigest: z.string().min(1),
  }),
]);

const CaseGenerationModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ai'), aiConfigId: z.string().min(1) }),
  z.object({ mode: z.literal('no_ai'), aiConfigId: z.never().optional() }),
]);

const CaseGenerationScopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all'), regenerateSelected: z.literal(false) }),
  z.object({ scope: z.literal('selected_modules'), regenerateSelected: z.boolean() }),
]);

export const CaseGenerationContextSchema = z.intersection(
  z.intersection(
    z.intersection(CaseGenerationContextBaseSchema, CaseGenerationEvidenceSchema),
    CaseGenerationModeSchema,
  ),
  CaseGenerationScopeSchema,
).superRefine((context, ctx) => {
  if (new Set(context.orderedFeatureIds).size !== context.orderedFeatureIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'orderedFeatureIds 不能重复', path: ['orderedFeatureIds'] });
  }
}) satisfies z.ZodType<CaseGenerationContext>;

const CaseInputBaseSchema = z.object({
  featureTable: z.array(z.array(z.array(z.string()).length(9))),
  systemId: z.string().min(1).optional(),
  featureRevision: z.string().min(1).optional(),
  metaConfig: MetaHeaderSchema,
  aiConfig: AIConfigRefSchema.optional(),
  exploredElements: z.array(z.any()).optional(),
  featurePaths: z.record(z.string(), z.string()).optional(),
  featureProfiles: z.array(FeatureProfileSchema).optional(),
  featureEvidence: z.record(z.string(), FeatureEvidenceSchema).optional(),
  currentCaseWorkbook: z.array(CaseSheetSchema).optional(),
  styleVersion: z.string().min(1).optional(),
  readOnlyClickPolicy: z.enum(['strict', 'allow_all']).optional(),
});

const CaseInputScopeSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('all'),
    selectedModuleIds: z.array(z.string()).optional(),
    regenerateSelected: z.literal(false).optional(),
  }),
  z.object({
    scope: z.literal('selected_modules'),
    selectedModuleIds: z.array(z.string()).optional(),
    regenerateSelected: z.boolean().optional(),
  }),
]);

export const CaseInputSchema = z.intersection(
  CaseInputBaseSchema,
  CaseInputScopeSchema,
).superRefine((input, ctx) => {
  const testPointIds = input.featureTable.flat().map((row) => row[8] ?? '');
  for (const [index, testPointId] of testPointIds.entries()) {
    if (!testPointId.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '功能点必须包含 testPointId', path: ['featureTable', index] });
    }
  }
  if (new Set(testPointIds).size !== testPointIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '功能点 testPointId 不能重复', path: ['featureTable'] });
  }
}) satisfies z.ZodType<CaseInput>;

export const CaseOutputSchema = z.object({
  caseWorkbook: z.array(CaseSheetSchema),
  caseRows: z.array(z.array(CaseRowSchema)),
  metaHeader: MetaHeaderSchema,
  qualityGateIssues: z.array(QualityGateIssueSchema),
  complexLogicDetected: z.boolean(),
  featureResults: z.array(CaseFeatureResultSchema).optional(),
  generation: CaseGenerationContextSchema.optional(),
});

export function validateCaseInput(v: unknown): CaseInput {
  return CaseInputSchema.parse(v);
}
export function validateCaseOutput(v: unknown): CaseOutput {
  return CaseOutputSchema.parse(v);
}
