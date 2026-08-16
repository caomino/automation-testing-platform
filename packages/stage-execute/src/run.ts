/**
 * @file run.ts
 * @description 执行 stage 主入口：Playwright 直连 + 浏览器×OS 矩阵 + 数据隔离
 * @contract ExecuteInput → ExecuteOutput
 * @frozen v1.0 — run 输入输出契约不可改；仅新增可选 deps 参数用于解耦测试/真实引擎
 */
import type {
  BrowserOS,
  DataSnapshot,
  ExecuteInput,
  ExecuteOutput,
  ExecutionResult,
} from '@test-platform/contracts';
import { validateExecuteInput, validateExecuteOutput } from '@test-platform/contracts';
import { createEngine } from '@test-platform/engine-mcp';
import type { EngineConfig, McpEngine } from '@test-platform/engine-mcp';
import type { ExecuteDeps } from './types';
import { filterByScope } from './scope';
import { computeIsolationVerified, emptySnapshotProvider } from './isolation';
import { executeCaseInEnv, buildEngineFailureResult } from './executeCase';
import { DEFAULT_CASE_TIMEOUT_MS, DEFAULT_OWNER_TASK_PREFIX } from './constants';

/** 默认引擎配置（真实多浏览器由 app 经 engineFactory 注入） */
const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  headless: false,
  timeoutMs: DEFAULT_CASE_TIMEOUT_MS,
};

/**
 * 解析本环境使用的引擎（env 级隔离原则：每个 env 获得独立引擎实例）：
 * 1) deps.engineFactory 按 env 创建独立实例（真实浏览器矩阵，首选，保证 env 间不串味）
 * 2) deps.engine 单引擎共享模式（测试 / 单环境注入）
 * 3) 兜底：createEngine 默认配置（每次调用新建，天然 env 隔离）
 */
async function resolveEngine(deps: ExecuteDeps, env: BrowserOS): Promise<McpEngine> {
  if (deps.engineFactory) return deps.engineFactory(env);
  if (deps.engine) return deps.engine;
  return createEngine(DEFAULT_ENGINE_CONFIG);
}

/**
 * 执行 stage 主函数。
 *
 * 流程：scope 过滤 → 执行前快照 → 浏览器×OS 矩阵执行（env×用例，单用例超时不影响整体）
 * → 执行后快照 → 数据隔离校验（违反仅记录不崩溃）。
 *
 * @param input - 冻结执行输入
 * @param deps - 可选依赖（测试注入 mock 引擎 / 真实环境注入引擎工厂与快照提供者）
 * @returns 冻结执行输出
 */
export async function run(input: ExecuteInput, deps: ExecuteDeps = {}): Promise<ExecuteOutput> {
  const validated = validateExecuteInput(input);

  const ownerTaskId = deps.ownerTaskId ?? `${DEFAULT_OWNER_TASK_PREFIX}-${Date.now()}`;
  const caseTimeoutMs = deps.caseTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS;
  const snapshotProvider = deps.snapshotProvider ?? emptySnapshotProvider;

  // 1. 按 scope 过滤用例表
  const sheets = filterByScope(validated);

  // 2. 执行前数据快照（数据隔离红线基准）
  const dataSnapshotBefore: DataSnapshot = await snapshotProvider.capture(ownerTaskId);

  // 3. 浏览器×OS 矩阵执行：env × 用例，单用例超时/异常不影响整体
  const tasks: Promise<ExecutionResult>[] = [];
  for (const env of validated.browserOSMatrix) {
    // 每个 env 独立解析引擎；引擎创建失败（如 BROWSER_LAUNCH_FAILED）记为该环境 failed，
    // 不崩溃、不影响其它环境。
    let engine: McpEngine;
    try {
      engine = await resolveEngine(deps, env);
    } catch (err) {
      for (const sheet of sheets) {
        for (const row of sheet.rows) {
          tasks.push(Promise.resolve(buildEngineFailureResult(row, env, err)));
        }
      }
      continue;
    }
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        tasks.push(executeCaseInEnv(engine, row, env, caseTimeoutMs));
      }
    }
  }
  const executionReport = await Promise.all(tasks);

  // 4. 执行后快照 + 数据隔离校验（违反只记录不崩溃）
  const dataSnapshotAfter: DataSnapshot = await snapshotProvider.capture(ownerTaskId);
  const isolationVerified = computeIsolationVerified(dataSnapshotBefore, dataSnapshotAfter, ownerTaskId);

  const output: ExecuteOutput = {
    executionReport,
    dataSnapshotBefore,
    dataSnapshotAfter,
    isolationVerified,
  };
  return validateExecuteOutput(output);
}
