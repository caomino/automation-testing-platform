/**
 * @file isolation.test.ts
 * @description computeIsolationVerified 纯函数单测（数据隔离红线规则）
 */
import { describe, it, expect } from 'vitest';
import type { DataSnapshot } from '@test-platform/contracts';
import { computeIsolationVerified, createEmptySnapshot } from '../isolation';

function snap(rowHashes: Record<string, string[]>, ownerTaskId: string): DataSnapshot {
  return { capturedAt: 1, rowHashes, ownerTaskId };
}

describe('computeIsolationVerified', () => {
  it('历史数据完全一致 → true', () => {
    const before = snap({ t: ['a', 'b'] }, 'task');
    const after = snap({ t: ['a', 'b'] }, 'task');
    expect(computeIsolationVerified(before, after, 'task')).toBe(true);
  });

  it('历史数据被修改（哈希变化）→ false', () => {
    const before = snap({ t: ['a', 'b'] }, 'task');
    const after = snap({ t: ['a', 'c'] }, 'task'); // b 被改
    expect(computeIsolationVerified(before, after, 'task')).toBe(false);
  });

  it('历史数据被删除 → false', () => {
    const before = snap({ t: ['a', 'b'] }, 'task');
    const after = snap({ t: ['a'] }, 'task'); // b 被删
    expect(computeIsolationVerified(before, after, 'task')).toBe(false);
  });

  it('新增数据归属本任务 → true', () => {
    const before = snap({ t: ['a'] }, 'task');
    const after = snap({ t: ['a', 'new'] }, 'task');
    expect(computeIsolationVerified(before, after, 'task')).toBe(true);
  });

  it('新增数据归属错误 → false', () => {
    const before = snap({ t: ['a'] }, 'task');
    const after = snap({ t: ['a', 'new'] }, 'OTHER'); // 新数据非本任务
    expect(computeIsolationVerified(before, after, 'task')).toBe(false);
  });

  it('多表：仅某表历史被改 → false', () => {
    const before = snap({ t1: ['a'], t2: ['x'] }, 'task');
    const after = snap({ t1: ['a'], t2: ['y'] }, 'task');
    expect(computeIsolationVerified(before, after, 'task')).toBe(false);
  });

  it('空快照默认构造一致 → true', () => {
    const empty = createEmptySnapshot('task');
    expect(computeIsolationVerified(empty, empty, 'task')).toBe(true);
  });
});
