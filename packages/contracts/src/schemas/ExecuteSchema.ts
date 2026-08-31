/**
 * @file ExecuteSchema.ts
 * @description ExecuteInput/Output 的 zod schema（Playwright 直连 + 隔离）
 * @frozen v1.0
 */
import { z } from 'zod';
import type { ExecuteInput, ExecuteOutput } from '../stages/ExecuteContract';
import { CaseSheetSchema } from './CaseSchema';

export const BrowserOSSchema = z.object({
  browser: z.string(),
  os: z.string(),
  version: z.string().optional(),
});

export const DataSnapshotSchema = z.object({
  capturedAt: z.number(),
  rowHashes: z.record(z.string(), z.array(z.string())),
  ownerTaskId: z.string(),
});

export const ExecutionStepResultSchema = z.object({
  step: z.string(),
  operation: z.string(),
  expected: z.string(),
  actual: z.string(),
  result: z.enum(['passed', 'failed', 'skipped']),
});

export const ExecutionResultSchema = z.object({
  caseNo: z.string(),
  caseRowId: z.string(),
  env: BrowserOSSchema,
  status: z.enum(['passed', 'failed', 'skipped', 'running']),
  steps: z.array(ExecutionStepResultSchema),
  defectRef: z.string().optional(),
});

export const ExecuteInputSchema = z.object({
  caseWorkbook: z.array(CaseSheetSchema),
  scope: z.enum(['selected_modules', 'all']),
  selectedModuleIds: z.array(z.string()).optional(),
  browserOSMatrix: z.array(BrowserOSSchema).min(1, 'browserOSMatrix 至少 1 项'),
});

export const ExecuteOutputSchema = z.object({
  executionReport: z.array(ExecutionResultSchema),
  dataSnapshotBefore: DataSnapshotSchema,
  dataSnapshotAfter: DataSnapshotSchema,
  isolationVerified: z.boolean(),
});

export function validateExecuteInput(v: unknown): ExecuteInput {
  return ExecuteInputSchema.parse(v) as ExecuteInput;
}
export function validateExecuteOutput(v: unknown): ExecuteOutput {
  return ExecuteOutputSchema.parse(v) as ExecuteOutput;
}
