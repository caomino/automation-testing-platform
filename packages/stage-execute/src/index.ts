/**
 * @file index.ts
 * @description stage-execute 唯一导出入口（仅暴露 run + 内部纯函数/类型）
 * @contract ExecuteInput → ExecuteOutput
 * @frozen v1.0
 */
export { run } from './run';
export type { ExecuteDeps, SnapshotProvider, EngineFactory } from './types';
export { computeIsolationVerified, createEmptySnapshot, emptySnapshotProvider } from './isolation';
export { filterByScope } from './scope';
export { deriveStatus, executeCaseInEnv, withTimeout } from './executeCase';
export { createMockEngine, createMockSnapshotProvider } from './mock';
export {
  DEFAULT_CASE_TIMEOUT_MS,
  DEFAULT_OWNER_TASK_PREFIX,
  SNAPSHOT_EMPTY_ROW_HASHES,
  DEFECT_REF_PREFIX,
} from './constants';
