/**
 * @file isolation.ts
 * @description 数据隔离红线：执行前后快照比对（纯函数，可独立单测）
 * @contract ExecuteOutput.isolationVerified / dataSnapshotBefore / dataSnapshotAfter
 * @frozen v1.0 — 规则见 design.md §7.2
 */
import type { DataSnapshot } from '@test-platform/contracts';
import type { SnapshotProvider } from './types';
import { SNAPSHOT_EMPTY_ROW_HASHES } from './constants';

/** 创建空快照（默认 provider，无 DB reader 接入时） */
export function createEmptySnapshot(ownerTaskId: string, capturedAt: number = Date.now()): DataSnapshot {
  return {
    capturedAt,
    rowHashes: { ...SNAPSHOT_EMPTY_ROW_HASHES },
    ownerTaskId,
  };
}

/**
 * 数据隔离红线校验（纯函数）。
 *
 * 规则：
 *  1) 历史数据完整性：before 中存在的行哈希，在 after 中必须原样存在（未被修改/删除）；
 *  2) 新增数据归属：after 中多出的行（本任务新增）必须归属本任务 —— after.ownerTaskId === ownerTaskId。
 *
 * 违反返回 false（调用方据此记录 EXEC_ISOLATION_VIOLATION，但不崩溃）。
 *
 * @param before - 执行前快照
 * @param after - 执行后快照
 * @param ownerTaskId - 本任务归属 ID
 * @returns 是否通过数据隔离校验
 */
export function computeIsolationVerified(before: DataSnapshot, after: DataSnapshot, ownerTaskId: string): boolean {
  // 规则 1：历史数据未被修改/删除
  for (const [table, hashes] of Object.entries(before.rowHashes)) {
    const afterHashes = after.rowHashes[table] ?? [];
    for (const h of hashes) {
      if (!afterHashes.includes(h)) return false;
    }
  }

  // 规则 2：若有新增行，必须归属本任务
  const hasNewRow = Object.entries(after.rowHashes).some(([table, hashes]) => {
    const beforeHashes = before.rowHashes[table] ?? [];
    return hashes.some(h => !beforeHashes.includes(h));
  });
  if (hasNewRow && after.ownerTaskId !== ownerTaskId) return false;

  return true;
}

/** 默认快照提供者：返回空快照（无 DB reader）。真实环境由 app 注入。 */
export const emptySnapshotProvider: SnapshotProvider = {
  capture(ownerTaskId: string): Promise<DataSnapshot> {
    return Promise.resolve(createEmptySnapshot(ownerTaskId));
  },
};
