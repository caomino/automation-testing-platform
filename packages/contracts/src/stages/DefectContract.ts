/**
 * @file DefectContract.ts
 * @description 缺陷管理 stage 的 I/O 契约（六列 + 截图 + 模块筛选）
 * @input DefectInput @output DefectOutput
 * @frozen v1.0
 */
import type { DefectRow, ExecutionResult, ScreenshotRef } from '../types/shared';

/** 输入（冻结） */
export interface DefectInput {
  /** 执行结果 */
  executionReport: ExecutionResult[];
  /** 模块筛选 */
  moduleFilter?: string;
}

/** 输出（冻结） */
export interface DefectOutput {
  /** 六列缺陷表（按模块分组） */
  defectTable: DefectRow[][];
  /** 截图引用 */
  screenshots: ScreenshotRef[];
}

/** run 函数签名（冻结） */
export type DefectRun = (input: DefectInput) => Promise<DefectOutput>;
