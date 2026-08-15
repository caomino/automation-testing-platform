/**
 * @file mock.ts
 * @description 测试替身：mock 引擎 + 可控快照提供者（解耦并行开发，verify 用）
 * @frozen v1.0
 */
import type {
  CaseRow,
  DataSnapshot,
  ExecutionStepResult,
  ModuleNode,
  ScreenshotRef,
} from '@test-platform/contracts';
import type { BrowserCommand, McpEngine, SemanticNode } from '@test-platform/engine-mcp';
import type { SnapshotProvider } from './types';
import { createEmptySnapshot } from './isolation';

/** 构造一条默认通过的步骤结果 */
function defaultStep(): ExecutionStepResult {
  return {
    step: 'Step1',
    operation: '默认操作',
    expected: '默认预期',
    actual: '默认实际',
    result: 'passed',
  };
}

/**
 * 创建 mock 引擎（不启动真实浏览器）。
 * @param opts.stepFor - 自定义每条用例的步骤结果（用于聚合测试）
 */
export function createMockEngine(opts?: {
  stepFor?: (row: CaseRow) => ExecutionStepResult[];
}): McpEngine {
  const stepFor = opts?.stepFor ?? (() => [defaultStep()]);
  return {
    launch: async () => {},
    navigate: async () => {},
    extractSemanticDom: async (_rootSelector?: string): Promise<SemanticNode[]> => [],
    exploreModules: async (): Promise<ModuleNode[]> => [],
    runStep: async (_cmd: BrowserCommand): Promise<ExecutionStepResult> => defaultStep(),
    runCase: async (row: CaseRow): Promise<ExecutionStepResult[]> => stepFor(row),
    screenshot: async (_path: string): Promise<ScreenshotRef> => ({
      id: 'mock-shot',
      fileName: 'mock.png',
      path: '/tmp/mock.png',
    }),
    close: async () => {},
  };
}

/**
 * 创建可控快照提供者：按调用顺序返回预置快照队列，耗尽后返回末项。
 * @param snapshots - 预置快照（第一次 capture 取 [0]，第二次取 [1]…）
 */
export function createMockSnapshotProvider(snapshots: DataSnapshot[]): SnapshotProvider {
  let index = 0;
  return {
    capture(): Promise<DataSnapshot> {
      const snap = snapshots[index] ?? snapshots[snapshots.length - 1] ?? createEmptySnapshot('');
      index += 1;
      return Promise.resolve(snap);
    },
  };
}
