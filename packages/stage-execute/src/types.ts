/**
 * @file types.ts
 * @description stage-execute 内部结构类型（不污染 contracts 冻结契约）
 * @frozen v1.0 — 仅新增，不改动 contracts 类型
 */
import type { BrowserOS, DataSnapshot } from '@test-platform/contracts';
import type { McpEngine } from '@test-platform/engine-mcp';

/**
 * 数据快照提供者（数据隔离红线用）。
 * 真实环境由 app 注入读取被测系统表哈希的实现；本包默认返回空快照。
 */
export interface SnapshotProvider {
  /** 捕获当前数据快照，ownerTaskId 标记本任务归属 */
  capture(ownerTaskId: string): Promise<DataSnapshot>;
}

/** 按浏览器×OS 环境创建/复用一个引擎实例 */
export type EngineFactory = (env: BrowserOS) => McpEngine | Promise<McpEngine>;

/**
 * run 的可选依赖。
 * 冻结签名 `run(input)` 不变；仅新增可选 deps 用于解耦（测试注入 mock 引擎 / 真实环境注入引擎工厂与快照提供者）。
 */
export interface ExecuteDeps {
  /** 复用单个已配置引擎（默认所有环境共用） */
  engine?: McpEngine;
  /** 按环境创建引擎（真实多浏览器矩阵用） */
  engineFactory?: EngineFactory;
  /** 数据快照提供者（数据隔离红线比对） */
  snapshotProvider?: SnapshotProvider;
  /** 本任务 ownerTaskId（新增数据归属 + 隔离校验） */
  ownerTaskId?: string;
  /** 单用例执行超时（ms） */
  caseTimeoutMs?: number;
}
