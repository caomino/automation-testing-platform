/**
 * @file shared.ts
 * @description 跨 stage 共享的辅助类型
 * @frozen v1.0
 */

/** 浏览器 × OS 环境 */
export interface BrowserOS {
  /** 浏览器名 */
  browser: string;
  /** 操作系统 */
  os: string;
  /** 版本 */
  version?: string;
}

/** 数据快照（数据隔离红线比对用） */
export interface DataSnapshot {
  /** 快照时间戳 */
  capturedAt: number;
  /** 数据行哈希映射（table → 行哈希列表） */
  rowHashes: Record<string, string[]>;
  /** 归属任务 ID（仅新增数据应带 owner=本任务） */
  ownerTaskId: string;
}

/** 单条执行结果 */
export interface ExecutionResult {
  /** 用例编号 */
  caseNo: string;
  /** 用例行 ID */
  caseRowId: string;
  /** 浏览器环境 */
  env: BrowserOS;
  /** 执行状态 */
  status: 'passed' | 'failed' | 'skipped' | 'running';
  /** 每步结果 */
  steps: ExecutionStepResult[];
  /** 缺陷引用（失败时） */
  defectRef?: string;
}

/** 单步执行结果 */
export interface ExecutionStepResult {
  /** 步骤名 */
  step: string;
  /** 操作 */
  operation: string;
  /** 预期 */
  expected: string;
  /** 实际 */
  actual: string;
  /** 结果 */
  result: 'passed' | 'failed' | 'skipped';
}

/** 缺陷行（六列固定） */
export interface DefectRow {
  /** 序号 */
  sequence: number;
  /** 问题描述 */
  description: string;
  /** 问题截图引用 */
  screenshotRef?: string;
  /** 问题级别 */
  level: '高' | '中' | '低';
  /** 质量特性 */
  qualityAttribute: string;
  /** 问题产生环境 */
  environment: string;
}

/** 截图引用 */
export interface ScreenshotRef {
  /** 截图 ID */
  id: string;
  /** 文件名 */
  fileName: string;
  /** 关联用例号 */
  caseNo?: string;
  /** 本地路径 */
  path: string;
}

/** 质量门问题 */
export interface QualityGateIssue {
  /** 用例行 ID */
  caseRowId: string;
  /** 问题类型 */
  type: '泛化' | '缺证据' | '越权';
  /** 问题描述 */
  message: string;
  /** 是否阻断 */
  blocking: boolean;
}

/** AI 配置引用（业务屏只读引用，模型在 §14 统一配） */
export interface AIConfigRef {
  /** 配置 ID */
  configId: string;
  /** 是否启用 */
  enabled: boolean;
}

/** 探索断点（断点续跑） */
export interface McpExplorationCheckpoint {
  /** 断点 ID */
  checkpointId: string;
  /** 已探索节点 ID 列表 */
  visitedNodeIds: string[];
  /** 待探索 frontier */
  frontier: string[];
  /** 时间戳 */
  savedAt: number;
}

/** Playwright MCP 二次探索提取的页面元素（用于生成真实测试用例步骤） */
export interface ExploredElement {
  /** ref 标识（如 e15） */
  ref: string;
  /** 元素类型: button/input/select/link/form/table/textarea 等 */
  tag: string;
  /** 元素可见文本 */
  text?: string;
  /** CSS selector */
  selector: string;
  /** 是否可交互 */
  interactive: boolean;
  /** input placeholder 或 aria-label */
  label?: string;
  /** input 类型: text/email/password/number 等 */
  inputType?: string;
  /** href（链接） */
  href?: string;
  /** 是否为表单控件 */
  isFormControl: boolean;
  /** 建议的操作类型: click/fill/select/navigate */
  suggestedAction: 'click' | 'fill' | 'select' | 'navigate';
}
