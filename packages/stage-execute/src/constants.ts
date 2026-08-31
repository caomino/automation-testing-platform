/**
 * @file constants.ts
 * @description stage-execute 模块常量
 * @contract 执行阶段常量定义（超时、前缀等）
 * @frozen v1.0
 */

/** 单条用例默认执行超时（ms）。超出转为 failed 记录，不崩溃。 */
export const DEFAULT_CASE_TIMEOUT_MS = 30_000;

/** owner 任务 ID 默认前缀（真实环境由 app 注入确定的 taskId） */
export const DEFAULT_OWNER_TASK_PREFIX = 'exec-task';

/** 快照 rowHashes 空表（无 DB reader 接入时的默认值） */
export const SNAPSHOT_EMPTY_ROW_HASHES: Record<string, string[]> = {};

/**
 * 缺陷引用前缀。
 * 注：须与 stage-defect 消费侧保持一致。
 * stage-defect 当前未从 index.ts 导出该常量（仅 execute 生成 defectRef 引用字符串，
 * 不创建缺陷对象），故在 execute 内保留本地常量。遵守 docs §4.2「模块间不 import 内部函数」
 * 且 ExecutionResult.defectRef 已冻结为 string —— 不为此外改 contracts / 跨包 import。
 */
export const DEFECT_REF_PREFIX = 'DEF';
