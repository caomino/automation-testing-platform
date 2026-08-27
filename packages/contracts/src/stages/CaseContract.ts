/**
 * @file CaseContract.ts
 * @description 测试用例生成 stage 的 I/O 契约（八列 + meta + 选中模块/全部 + 复杂逻辑分层）
 * @input CaseInput @output CaseOutput
 * @frozen v1.0 — 下述新增为 additive 扩展（feature-driven 方案 §6.6 / §5.4 / §15），不改变八列/九列可见结构。
 */
import type { CaseRow } from '../types/CaseRow';
import type { CaseSheet, MetaHeader } from '../types/CaseSheet';
import type { FeatureRow } from '../types/FeatureRow';
import type { AIConfigRef, QualityGateIssue, ExploredElement } from '../types/shared';
import type { FeatureProfile, FeatureEvidence } from '../types/TestDesign';

/** 功能点级生成结果状态（spec §6.6 / §13） */
export type CaseFeatureStatus =
  | 'generated'
  | 'skipped_existing'
  | 'needs_review'
  | 'evidence_missing'
  | 'unsafe_to_explore'
  | 'unsupported_surface'
  | 'ai_failed'
  | 'revision_conflict';

/** 五类覆盖维度（spec §8，覆盖维度不是五条用例） */
export type CoverageCategory = 'normal' | 'boundary' | 'exception' | 'process' | 'permission';
/** 五类覆盖结论 */
export type CoverageDecision = 'covered' | 'not_applicable' | 'needs_review';

interface CaseFeatureResultBase {
  featureId: string;
  inputIndex: number;
  featureFingerprint: string;
  coverageDecisions: Record<CoverageCategory, CoverageDecision>;
  reasons: string[];
}

/** 单个功能点的有序生成结果（spec §6.6） */
export type CaseFeatureResult = CaseFeatureResultBase & (
  | { status: 'generated'; generatedCaseGroup: true }
  | { status: Exclude<CaseFeatureStatus, 'generated'>; generatedCaseGroup: false }
);

/** 生成模式（spec §6.5：只来自用例页 AI 辅助按钮冻结的 aiConfig.enabled） */
export type CaseGenerationMode = 'no_ai' | 'ai';

/** 任务级冻结上下文（spec §5.4 / §6.5：随本次 run 传入，禁止进程级全局变量） */
interface CaseGenerationContextBase {
  batchId: string;
  systemId: string;
  featureRevision: string;
  orderedFeatureIds: string[];
  styleVersion: string;
  taskId: string;
}

type CaseGenerationEvidenceVersion = {
  evidenceVersion: string;
  evidenceDigest?: string;
};

type CaseGenerationEvidenceDigest = {
  evidenceVersion?: string;
  evidenceDigest: string;
};

type CaseGenerationModeContext =
  | { mode: 'ai'; aiConfigId: string }
  | { mode: 'no_ai'; aiConfigId?: never };

type CaseGenerationScopeContext =
  | { scope: 'all'; regenerateSelected: false }
  | { scope: 'selected_modules'; regenerateSelected: boolean };

export type CaseGenerationContext = CaseGenerationContextBase
  & (CaseGenerationEvidenceVersion | CaseGenerationEvidenceDigest)
  & CaseGenerationModeContext
  & CaseGenerationScopeContext;

/** 输入（冻结） */
interface CaseInputBase {
  /** 已确认功能点表 */
  featureTable: FeatureRow[][];
  /** 当前系统稳定身份（由编排器任务上下文透传） */
  systemId?: string;
  /** 当前功能点表的冻结修订标识（由编排器任务上下文透传） */
  featureRevision?: string;
  /** meta 头配置 */
  metaConfig: MetaHeader;
  /** AI 配置引用（可选） */
  aiConfig?: AIConfigRef;
  /** Playwright MCP 二次探索提取的页面元素（供生成真实操作步骤） */
  exploredElements?: ExploredElement[];
  /** 功能点测试点标识 → 来源页面 URL（由功能点阶段带出，用于按所选模块精准探索，根因解法） */
  featurePaths?: Record<string, string>;
  /** @新增 功能点动作档案（由功能点阶段透传，不重新分类） */
  featureProfiles?: FeatureProfile[];
  /** @新增 按 featureId 隔离的页面证据（替代全局 exploredElements，杜绝跨功能点串用） */
  featureEvidence?: Record<string, FeatureEvidence>;

  // === feature-driven additive 扩展（spec §5.1 / §12 / §15） ===
  /** @新增 当前已保存用例产物（用于 scope 合并：选中追加 / 全部替换 / 重生成定点替换） */
  currentCaseWorkbook?: CaseSheet[];
  /** @新增 公司风格版本标识（默认 v1） */
  styleVersion?: string;
  /** @新增 只读点击安全策略：strict=仅放行 a[href]/dialog/safe-opener（默认）；allow_all=放行所有非写操作按钮（新增/详情/查询等），仍拦截提交/保存/删除/导出/导入/审核等写操作与危险导航 */
  readOnlyClickPolicy?: 'strict' | 'allow_all';
}

/** Scope/mode are orthogonal at the task boundary; runtime zod validation still
 * enforces the allowed scope values. Keeping this additive type non-discriminated
 * lets UI request builders freeze a boolean independently of scope. */
export type CaseInput = CaseInputBase & {
  scope: 'all' | 'selected_modules';
  selectedModuleIds?: string[];
  regenerateSelected?: boolean;
};

/** 输出（冻结） */
export interface CaseOutput {
  /** 用例工作簿（一子系统一 sheet） */
  caseWorkbook: CaseSheet[];
  /** 八列用例数据 */
  caseRows: CaseRow[][];
  /** 可编辑 meta 头 */
  metaHeader: MetaHeader;
  /** 质量门问题 */
  qualityGateIssues: QualityGateIssue[];
  /** 是否检测到复杂逻辑 */
  complexLogicDetected: boolean;

  // === feature-driven additive 扩展 ===
  /** @新增 每个输入功能点恰好一项的有序生成结果（spec §6.6） */
  featureResults?: CaseFeatureResult[];
  /** @新增 本批冻结的任务级上下文与版本元数据（spec §5.4 / §6.5） */
  generation?: CaseGenerationContext;
}

/** run 函数签名（冻结） */
export type CaseRun = (input: CaseInput) => Promise<CaseOutput>;
