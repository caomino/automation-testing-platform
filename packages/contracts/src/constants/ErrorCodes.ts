/**
 * @file ErrorCodes.ts
 * @description 全平台统一错误码常量（冻结）
 * @frozen v1.0 — 错误码语义不可改，只能新增
 */

export const ERROR_CODES = {
  // 登录
  LOGIN_BARRIER_DETECTED: 'LOGIN_BARRIER_DETECTED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SUBSYSTEM_URL_INVALID: 'SUBSYSTEM_URL_INVALID',
  // 探索
  EXPLORE_INCOMPLETE: 'EXPLORE_INCOMPLETE',
  FRAME_ACCESS_DENIED: 'FRAME_ACCESS_DENIED',
  DOM_TIMEOUT: 'DOM_TIMEOUT',
  // 功能点
  FEATURE_ID_COLLISION: 'FEATURE_ID_COLLISION',
  MERGE_CONFLICT: 'MERGE_CONFLICT',
  // 用例
  CASE_BINDING_OUT_OF_SCOPE: 'CASE_BINDING_OUT_OF_SCOPE',
  CASE_NO_FEATURE_MISMATCH: 'CASE_NO_FEATURE_MISMATCH',
  CASE_DELIVERY_NARRATIVE_REQUIRED: 'CASE_DELIVERY_NARRATIVE_REQUIRED',
  // 执行
  EXEC_ISOLATION_VIOLATION: 'EXEC_ISOLATION_VIOLATION',
  EXEC_TIMEOUT: 'EXEC_TIMEOUT',
  BROWSER_LAUNCH_FAILED: 'BROWSER_LAUNCH_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** 平台错误类 — 携带统一错误码 */
export class PlatformError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
  }
}
