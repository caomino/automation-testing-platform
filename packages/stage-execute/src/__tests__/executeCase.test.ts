/**
 * @file executeCase.test.ts
 * @description executeCaseInEnv / deriveStatus / 超时守卫单测
 */
import { describe, it, expect } from 'vitest';
import type { BrowserOS, CaseRow, ExecutionStepResult } from '@test-platform/contracts';
import type { McpEngine } from '@test-platform/engine-mcp';
import { createMockEngine } from '../mock';
import { deriveStatus, executeCaseInEnv, withTimeout } from '../executeCase';

const ENV: BrowserOS = { browser: 'chrome', os: 'win11' };

const ROW: CaseRow = {
  caseNo: 'C_01',
  content: '查询',
  step: 'Step1',
  operation: '点击',
  expected: '列表',
  firstResult: '\\',
  regressionResult: '\\',
  conclusion: '\\',
  id: 'r1',
  featureId: 'C_01',
  targetTestPoint: '查询',
};

describe('deriveStatus', () => {
  it('无步骤 → skipped', () => {
    expect(deriveStatus([])).toBe('skipped');
  });
  it('全 passed → passed', () => {
    const steps: ExecutionStepResult[] = [
      { step: 's', operation: 'o', expected: 'e', actual: 'a', result: 'passed' },
    ];
    expect(deriveStatus(steps)).toBe('passed');
  });
  it('含 failed → failed', () => {
    const steps: ExecutionStepResult[] = [
      { step: 's', operation: 'o', expected: 'e', actual: 'a', result: 'passed' },
      { step: 's', operation: 'o', expected: 'e', actual: 'a', result: 'failed' },
    ];
    expect(deriveStatus(steps)).toBe('failed');
  });
});

describe('executeCaseInEnv', () => {
  it('正常：返回引擎步骤并聚合状态', async () => {
    const engine = createMockEngine();
    const result = await executeCaseInEnv(engine, ROW, ENV, 1000);
    expect(result.caseNo).toBe('C_01');
    expect(result.caseRowId).toBe('r1');
    expect(result.env).toEqual(ENV);
    expect(result.status).toBe('passed');
  });

  it('边界：执行超时转 failed 且不崩溃', async () => {
    const hangingEngine: McpEngine = {
      ...createMockEngine(),
      runCase: () => new Promise<ExecutionStepResult[]>(() => {}), // 永不 resolve
    };
    const result = await executeCaseInEnv(hangingEngine, ROW, ENV, 10);
    expect(result.status).toBe('failed');
    expect(result.steps[0].actual).toContain('EXEC_TIMEOUT');
  });
});

describe('withTimeout', () => {
  it('超时 reject', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'boom')).rejects.toThrow('boom');
  });
  it('按时 resolve', async () => {
    await expect(withTimeout(Promise.resolve(1), 1000, 'boom')).resolves.toBe(1);
  });
});
