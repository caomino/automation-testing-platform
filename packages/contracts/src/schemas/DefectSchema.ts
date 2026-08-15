/**
 * @file DefectSchema.ts
 * @description DefectInput/Output 的 zod schema（六列 + 截图）
 * @frozen v1.0
 */
import { z } from 'zod';
import type { DefectInput, DefectOutput } from '../stages/DefectContract';
import type { DefectRow, ScreenshotRef } from '../types/shared';
import { ExecutionResultSchema } from './ExecuteSchema';

export const DefectRowSchema: z.ZodType<DefectRow> = z.object({
  sequence: z.number(),
  description: z.string(),
  screenshotRef: z.string().optional(),
  level: z.enum(['高', '中', '低']),
  qualityAttribute: z.string(),
  environment: z.string(),
}) as unknown as z.ZodType<DefectRow>;

export const ScreenshotRefSchema: z.ZodType<ScreenshotRef> = z.object({
  id: z.string(),
  fileName: z.string(),
  caseNo: z.string().optional(),
  path: z.string(),
}) as unknown as z.ZodType<ScreenshotRef>;

export const DefectInputSchema = z.object({
  executionReport: z.array(ExecutionResultSchema),
  moduleFilter: z.string().optional(),
});

export const DefectOutputSchema = z.object({
  defectTable: z.array(z.array(DefectRowSchema)),
  screenshots: z.array(ScreenshotRefSchema),
});

export function validateDefectInput(v: unknown): DefectInput {
  return DefectInputSchema.parse(v);
}
export function validateDefectOutput(v: unknown): DefectOutput {
  return DefectOutputSchema.parse(v);
}
