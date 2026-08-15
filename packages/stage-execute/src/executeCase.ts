/**
 * @file executeCase.ts
 * @description 单用例 × 单环境执行 + 步骤结果聚合 + 超时守卫
 * @contract ExecutionResult / ExecutionStepResult
 * @frozen v1.0
 */
import type {
  BrowserOS,
  CaseRow,
  ExecutionResult,
  ExecutionStepResult,
} from '@test-platform/contracts';
import { ERROR_CODES } from '@test-platform/contracts';
import type { McpEngine } from '@test-platform/engine-mcp';
import { DEFAULT_CASE_TIMEOUT_MS, DEFECT_REF_PREFIX } from './constants';

/**
 * 超时错误：由 withTimeout 抛出，区别于用例/引擎自身抛出的非超时异常。
 * 继承 Error，既保持「rejects.toThrow」语义，又能被精确识别为超时。
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * 在单个浏览器×OS 环境执行单条用例。
 * 调用 engine.runCase 产出步骤结果；带超时与异常兜底 —— 超时/异常不崩溃，转 failed 记录。
 *
 * @param engine - 浏览器控制引擎（McpEngine）
 * @param row - 用例行
 * @param env - 浏览器×OS 环境
 * @param caseTimeoutMs - 单用例超时（ms）
 * @returns 该用例在该环境下的执行结果
 */
export async function executeCaseInEnv(
  engine: McpEngine,
  row: CaseRow,
  env: BrowserOS,
  caseTimeoutMs: number = DEFAULT_CASE_TIMEOUT_MS,
): Promise<ExecutionResult> {
  let steps: ExecutionStepResult[];
  try {
    steps = await withTimeout(
      engine.runCase(row),
      caseTimeoutMs,
      `用例 ${row.caseNo} 在 ${env.browser}/${env.os} 执行超时`,
    );
  } catch (err) {
    steps = [buildFailureStep(row, env, err)];
  }
  return buildExecutionResult(row, env, steps);
}

/**
 * 由步骤结果聚合出用例状态。
 * - 无步骤 → skipped
 * - 任一 failed → failed
 * - 全部 passed → passed
 * - 否则（混合 passed/skipped）→ skipped
 */
export function deriveStatus(steps: ExecutionStepResult[]): ExecutionResult['status'] {
  if (steps.length === 0) return 'skipped';
  if (steps.some(s => s.result === 'failed')) return 'failed';
  if (steps.every(s => s.result === 'passed')) return 'passed';
  return 'skipped';
}

/**
 * 为失败用例生成确定性的 defectRef 引用字符串。
 *
 * 设计决策（已确认，见 review.md stage-execute Major）：
 * - execute **不** import stage-defect 的 createDefect 创建缺陷对象 —— 遵守 docs §4.2
 *   「模块间不 import 内部函数」，且 ExecutionResult.defectRef 已冻结为 string。
 *   execute 的职责仅为失败用例生成一个确定性引用，供后续 stage-defect 阶段绑定 /
 *   落库截图，而非在此创建缺陷对象。
 * - 引用前缀 DEFECT_REF_PREFIX 须与 stage-defect 消费侧保持一致（stage-defect 当前
 *   未导出该常量，故在 execute 内保留本地常量；见 constants.ts 注释），不为此外改 contracts。
 * - 格式稳定：`<PREFIX>-<caseNo>@<browser>-<os>`；stage-defect 直接以该字符串作为截图
 *   id / 路径，无格式解析依赖，故本函数即「复用而非重写」的引用语义落点。
 */
export function buildDefectRef(row: CaseRow, env: BrowserOS): string {
  return `${DEFECT_REF_PREFIX}-${row.caseNo}@${env.browser}-${env.os}`;
}

/** 构造单条用例在该环境下的 ExecutionResult */
function buildExecutionResult(
  row: CaseRow,
  env: BrowserOS,
  steps: ExecutionStepResult[],
): ExecutionResult {
  const status = deriveStatus(steps);
  const result: ExecutionResult = {
    caseNo: row.caseNo,
    caseRowId: row.id,
    env,
    status,
    steps,
  };
  if (status === 'failed') {
    result.defectRef = buildDefectRef(row, env);
  }
  return result;
}

/**
 * 用例执行失败（超时或非超时异常）时构造一条失败步骤。
 * 超时用 EXEC_TIMEOUT 错误码；其余异常标注「执行异常」并保留原始信息，不做静默吞没。
 */
function buildFailureStep(row: CaseRow, env: BrowserOS, err: unknown): ExecutionStepResult {
  const message = err instanceof Error ? err.message : String(err);
  const actual = err instanceof TimeoutError
    ? `${ERROR_CODES.EXEC_TIMEOUT}: ${message} (caseNo=${row.caseNo})`
    : `执行异常: ${message} (caseNo=${row.caseNo})`;
  return {
    step: '执行',
    operation: `runCase@${env.browser}/${env.os}`,
    expected: '用例正常完成',
    actual,
    result: 'failed',
  };
}

/**
 * 引擎按环境创建失败（如 BROWSER_LAUNCH_FAILED）时，为该环境下全部用例构造 failed 结果，
 * 不崩溃、不阻断其它环境执行。缺陷引用留空（无截图），供上游识别为引擎级失败。
 */
export function buildEngineFailureResult(
  row: CaseRow,
  env: BrowserOS,
  err: unknown,
): ExecutionResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    caseNo: row.caseNo,
    caseRowId: row.id,
    env,
    status: 'failed',
    steps: [{
      step: '引擎初始化',
      operation: `launch@${env.browser}/${env.os}`,
      expected: '引擎成功启动',
      actual: `${ERROR_CODES.BROWSER_LAUNCH_FAILED}: ${message} (caseNo=${row.caseNo})`,
      result: 'failed',
    }],
  };
}

/** Promise 超时守卫：超时 reject（不静默吞没，交由调用方转 failed） */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
