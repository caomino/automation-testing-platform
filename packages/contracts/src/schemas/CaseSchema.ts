/**
 * @file CaseSchema.ts
 * @description CaseInput/Output 的 zod schema（meta + 八列 + 金标准对齐）
 * @frozen v1.0
 */
import { z } from 'zod';
import type { CaseInput, CaseOutput } from '../stages/CaseContract';
import type { CaseRow } from '../types/CaseRow';
import type { CaseSheet, MetaHeader } from '../types/CaseSheet';

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
  targetTestPoint: z.string(),
  scenarioId: z.string().optional(),
  evidenceId: z.string().optional(),
  evidenceLevel: z.enum(['observed', 'derived', 'needs_review']).optional(),
  origin: z.enum(['system_generated', 'user_edited', 'user_added', 'confirmed', 'imported']).optional(),
  quality: z.enum(['high', 'low', 'conflict']).optional(),
  needsReview: z.boolean().optional(),
  reviewReason: z.string().optional(),
  confidence: z.number().optional(),
  manualEdited: z.boolean().optional(),
  qualityGateStatus: z.string().optional(),
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

export const AIConfigRefSchema = z.object({
  configId: z.string(),
  enabled: z.boolean(),
});

export const CaseInputSchema = z.object({
  featureTable: z.array(z.array(z.array(z.string()).length(9))),
  scope: z.enum(['selected_modules', 'all']),
  selectedModuleIds: z.array(z.string()).optional(),
  metaConfig: MetaHeaderSchema,
  aiConfig: AIConfigRefSchema.optional(),
});

export const CaseOutputSchema = z.object({
  caseWorkbook: z.array(CaseSheetSchema),
  caseRows: z.array(z.array(CaseRowSchema)),
  metaHeader: MetaHeaderSchema,
  qualityGateIssues: z.array(QualityGateIssueSchema),
  complexLogicDetected: z.boolean(),
});

export function validateCaseInput(v: unknown): CaseInput {
  return CaseInputSchema.parse(v);
}
export function validateCaseOutput(v: unknown): CaseOutput {
  return CaseOutputSchema.parse(v);
}
