/**
 * @file ExecuteContract.ts
 * @description 执行 stage 的 I/O 契约（Playwright 直连 + 浏览器×OS 矩阵 + 数据隔离）
 * @input ExecuteInput @output ExecuteOutput
 * @frozen v1.0
 */
import type { CaseSheet } from '../types/CaseSheet';
import type { BrowserOS, DataSnapshot, ExecutionResult } from '../types/shared';

/** 输入（冻结） */
export interface ExecuteInput {
  /** 用例工作簿 */
  caseWorkbook: CaseSheet[];
  /** 执行范围 */
  scope: 'selected_modules' | 'all';
  /** 选中模块 ID */
  selectedModuleIds?: string[];
  /** 浏览器×OS 矩阵 */
  browserOSMatrix: BrowserOS[];
}

/** 输出（冻结） */
export interface ExecuteOutput {
  /** 执行结果 */
  executionReport: ExecutionResult[];
  /** 执行前数据快照 */
  dataSnapshotBefore: DataSnapshot;
  /** 执行后数据快照 */
  dataSnapshotAfter: DataSnapshot;
  /** 数据隔离验证结果 */
  isolationVerified: boolean;
}

/** run 函数签名（冻结） */
export type ExecuteRun = (input: ExecuteInput) => Promise<ExecuteOutput>;
