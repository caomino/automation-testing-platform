/**
 * @file index.ts
 * @description 测试用例生成 stage（feature-driven 重写，spec §6）：
 *   功能点快照 → 证据门 → (可选二次探索由编排器负责) → 五类覆盖 → 无AI/有AI生成 → 公司风格强校验 → scope 合并 → 有序产物。
 *   硬契约：一个功能点 = 一个用例编号(=testPointId) = 一组连续 Step；五类是覆盖维度不是五条；证据按 featureId 隔离；
 *           AI 客户端任务级注入，不得进程级共享；scope 与模式正交。
 * @frozen v1.0 签名延伸（可选 opts 注入任务级 AI 客户端，向后兼容）
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  CASE_COLUMN_WIDTHS,
  type CaseInput,
  type CaseOutput,
  type CaseRow,
  type CaseFeatureResult,
  type CaseGenerationContext,
  type CaseGenerationMode,
  type CoverageCategory,
  type FeatureProfile,
  type MetaHeader,
  type QualityGateIssue,
} from '@test-platform/contracts';
import {
  buildFeatureSnapshot,
  inferActionKind,
  type FeatureSnapshotItem,
} from './featureSnapshot';
import { gateFeatureEvidence } from './evidenceGate';
import { generateActionScenarios } from './actionScenarioEngine';
import type { ScenarioContext } from './templateScenarioEngine';
import { planCoverage } from './coveragePlanner';
import { polishCandidates } from './aiGenerator';
import { mergeCaseProducts, extractCaseRows } from './merge';
import { strongValidate } from './strongValidation';
import type { CaseAIClient } from './aiCaseRows';
import { createEvidenceDigest } from './evidenceDigest';

export { gateFeatureEvidence } from './evidenceGate';

/** AI 模式已启用但缺少有效客户端时的阻断错误（spec §10） */
export class CaseGenerationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseGenerationBlockedError';
  }
}

/** 任务级运行选项：AI 客户端随本次 run 注入，不共享进程级全局状态 */
export interface CaseRunOptions {
  aiClient?: CaseAIClient;
  logger?: { warn: (m: string) => void; info?: (m: string) => void };
}

const STYLE_VERSION = 'v1';

function createFeatureRevision(fingerprints: string[]): string {
  return `rev_sha256:${createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex')}`;
}

function cloneMeta(meta: MetaHeader): MetaHeader {
  return structuredClone(meta);
}

function emptyDecision(): Record<CoverageCategory, 'covered' | 'not_applicable' | 'needs_review'> {
  return { normal: 'not_applicable', boundary: 'not_applicable', exception: 'not_applicable', process: 'not_applicable', permission: 'not_applicable' };
}

function makeResult(
  item: FeatureSnapshotItem,
  inputIndex: number,
  status: CaseFeatureResult['status'],
  reasons: string[],
  coverageDecisions: Record<CoverageCategory, 'covered' | 'not_applicable' | 'needs_review'>,
): CaseFeatureResult {
  const base = {
    featureId: item.featureId,
    inputIndex,
    featureFingerprint: item.fingerprint,
    coverageDecisions,
    reasons,
  };
  if (status === 'generated') return { ...base, status, generatedCaseGroup: true };
  return { ...base, status, generatedCaseGroup: false };
}

/** 将确定性候选组装为同一 caseNo 下连续 Step 的 CaseRow 组（spec §5.2 / §5.3） */
function assembleFeatureRows(
  item: FeatureSnapshotItem,
  profile: FeatureProfile,
  candidates: ReturnType<typeof generateActionScenarios>,
  mode: CaseGenerationMode,
  polished: Map<string, { operation: string; expected: string }> | null,
  batchId: string,
): CaseRow[] {
  return candidates.map((c) => {
    const refined = polished?.get(c.scenarioId);
    const operation = refined?.operation ?? c.operation;
    const expected = refined?.expected ?? c.expected;
    return {
      caseNo: item.featureId,
      content: item.featureName || item.testPoint, // 功能点作为用例表的测试点
      step: c.step,
      operation,
      expected,
      firstResult: '\\',
      regressionResult: '\\',
      conclusion: '\\',
      id: `${item.featureId}__${c.coverageKey}`,
      featureId: item.featureId,
      targetTestPoint: item.testPoint,
      scenarioId: c.scenarioId,
      scenarioName: c.scenarioName,
      priority: c.priority,
      coverageKeys: [c.coverageKey],
      evidenceLevel: c.evidenceLevel,
      needsReview: c.needsReview,
      ...(c.needsReview ? { reviewReason: c.reviewReason } : {}),
      origin: 'system_generated',
      confidence: c.evidenceLevel === 'observed' ? 1 : (mode === 'ai' ? 0.6 : 0.5),
      batchId,
    } satisfies CaseRow;
  });
}

function detectComplexity(featureTable: CaseInput['featureTable']): { detected: boolean; issues: QualityGateIssue[] } {
  const flat = featureTable.flat();
  const issues: QualityGateIssue[] = [];
  if (flat.length >= 5) {
    issues.push({ caseRowId: 'complexity_1', type: '泛化', message: `功能点数量较多（${flat.length} 个）`, blocking: false });
  }
  return { detected: issues.length > 0, issues };
}

/**
 * 生成测试用例（feature-driven 内核）。
 * @param input  CaseInput
 * @param opts   任务级选项：aiClient 随本次调用注入（无 AI 模式不构造/不调用 AI）
 */
export const run = async (input: CaseInput, opts?: CaseRunOptions): Promise<CaseOutput> => {
  const logger = opts?.logger;
  const meta = input.metaConfig;
  const stableSystemId = input.systemId?.trim() || meta.systemName;
  const inputFeatureRevision = input.featureRevision?.trim();
  const stableStyleVersion = input.styleVersion ?? STYLE_VERSION;
  const stableEvidenceDigest = createEvidenceDigest(input.featureEvidence, input.featureProfiles);
  const scope = input.scope;
  const regenerateSelected = input.regenerateSelected === true;
  const mode: CaseGenerationMode = input.aiConfig?.enabled === true ? 'ai' : 'no_ai';
  const aiConfigId = input.aiConfig?.enabled ? input.aiConfig.configId : undefined;

  // 本批生成批次 ID（spec §6.5 / §17.8：每组用例可追溯其生成来源 batchId/mode/aiConfigId）
  const batchId = `batch_${randomUUID()}`;

  // 阻断：AI 模式但无有效客户端（spec §10：不静默回退无 AI）
  if (mode === 'ai' && (!opts?.aiClient || !aiConfigId)) {
    throw new CaseGenerationBlockedError('AI 模式已启用但缺少有效 AI 配置/客户端，生成前阻断');
  }

  // 1. 功能点快照（冻结顺序、拒绝缺失/重复、scope 过滤、普通选中跳过已存在）
  const currentFeatureIds = new Set(extractCaseRows(input.currentCaseWorkbook).map((r) => r.featureId));
  const snapshot = buildFeatureSnapshot(input.featureTable, {
    scope,
    systemId: stableSystemId,
    selectedModuleIds: input.selectedModuleIds,
    existingFeatureIds: currentFeatureIds,
    regenerateSelected,
    featureProfiles: input.featureProfiles,
    featurePaths: input.featurePaths,
  });

  // Keep result indexes tied to the original frozen input positions, while the
  // generation ID list remains limited to the scope-filtered snapshot.
  const inputFeatureOrder = input.featureTable.flat().map((row) => row[8] ?? '');
  const inputOrder = new Map(inputFeatureOrder.map((featureId, index) => [featureId, index]));
  const orderedSnapshotItems = [...snapshot.toGenerate, ...snapshot.skippedExisting].sort(
    (a, b) => (inputOrder.get(a.featureId) ?? 0) - (inputOrder.get(b.featureId) ?? 0),
  );
  const orderedFeatureIds = orderedSnapshotItems.map((item) => item.featureId);
  const snapshotIndex = inputOrder;
  const stableFeatureRevision = inputFeatureRevision
    || createFeatureRevision(orderedSnapshotItems.map((item) => item.fingerprint));

  const featureIdModuleMap: Record<string, string> = {};
  const batchRows: CaseRow[] = [];
  const featureResults: CaseFeatureResult[] = [];

  for (let idx = 0; idx < snapshot.toGenerate.length; idx++) {
    const item = snapshot.toGenerate[idx];
    const resultIndex = snapshotIndex.get(item.featureId) ?? idx;
    featureIdModuleMap[item.featureId] = item.featureName || item.subModule || item.mainModule || 'DEFAULT';
    const evidence = input.featureEvidence?.[item.featureId];
    const ctx: ScenarioContext = {
      subModule: item.subModule,
      featureName: item.featureName,
      testPoint: item.testPoint,
      precondition: input.metaConfig.precondition ?? '',
    };

    // 2. 功能点证据门
    const gate = gateFeatureEvidence(
      item.featureId,
      item.profile,
      evidence,
      input.featurePaths?.[item.featureId],
      { systemId: input.systemId, featureRevision: inputFeatureRevision },
    );
    if (!gate.hasEvidence) {
      featureResults.push(makeResult(item, resultIndex, 'evidence_missing', gate.reasons, emptyDecision()));
      logger?.warn?.(`case: 功能点 ${item.featureId} 证据缺失，标记 evidence_missing`);
      continue;
    }
    const hardConflictReasons = gate.reasons.filter((reason) =>
      reason.includes('版本')
      || reason.includes('系统')
      || reason.includes('证据 featureId 与当前功能点不一致')
      || reason.includes('缺少功能点页面入口身份')
      || reason.includes('入口不一致')
      || reason.includes('路径不一致'),
    );
    if (!gate.consistent && hardConflictReasons.length > 0) {
      const status: CaseFeatureResult['status'] = hardConflictReasons.some((reason) => reason.includes('版本'))
        ? 'revision_conflict'
        : 'evidence_missing';
      featureResults.push(makeResult(item, resultIndex, status, gate.reasons, emptyDecision()));
      logger?.warn?.(`case: 功能点 ${item.featureId} 证据身份冲突，标记 ${status}`);
      continue;
    }

    // 动作档案：缺失时关键词兜底（仅在无明确动作语义时）
    const profile: FeatureProfile = item.profile
      ?? { featureId: item.featureId, testPoint: item.testPoint, actionKind: inferActionKind(item.testPoint, item.featureName) };

    // 3/4/5. 五类覆盖 + 确定性候选（无 AI 基础）
    const candidates = generateActionScenarios(profile, evidence, ctx);
    const unsafeEvidence = evidence?.needsReview === true
      || evidence?.evidenceLevel === 'needs_review'
      || (evidence?.reviewReason?.includes('写入风险') === true
        || evidence?.uncovered?.some((item) => item.kind === 'write_required_state' || item.kind === 'no_safe_sample' || item.kind === 'cross_origin_iframe' || item.kind === 'closed_shadow_dom'));
    const visibleCandidates = unsafeEvidence
      ? []
      : candidates.filter((candidate) => candidate.evidenceLevel === 'observed' && !candidate.needsReview);
    if (visibleCandidates.length === 0) {
      featureResults.push(makeResult(
        item,
        resultIndex,
        'needs_review',
        [
          ...gate.reasons,
          ...(evidence?.reviewReason ? [evidence.reviewReason] : []),
          ...candidates.flatMap((candidate) => candidate.needsReview && candidate.reviewReason ? [candidate.reviewReason] : []),
          '无可生成的覆盖场景',
        ],
        emptyDecision(),
      ));
      continue;
    }

    const coverage = planCoverage(profile.actionKind, evidence);
    const extraReasons = gate.consistent ? [] : [`证据一致性待复核：${gate.reasons.join('；')}`];
    const coverageReasons = [...coverage.reasons, ...extraReasons];

    // 6. 有 AI 模式：任务级润色（失败则整体 ai_failed，不静默降级）
    let polished: Map<string, { operation: string; expected: string }> | null = null;
    if (mode === 'ai' && opts?.aiClient) {
      try {
        polished = await polishCandidates(visibleCandidates, ctx, evidence, opts.aiClient);
      } catch (e) {
        featureResults.push(makeResult(item, resultIndex, 'ai_failed', [`AI 调用失败：${e instanceof Error ? e.message : e}`], emptyDecision()));
        logger?.warn?.(`case: 功能点 ${item.featureId} AI 调用失败`);
        continue;
      }
    }

    const rows = assembleFeatureRows(item, profile, visibleCandidates, mode, polished, batchId);
    for (const row of rows) {
      row.featureFingerprint = item.fingerprint;
      row.generationMode = mode;
      if (aiConfigId) row.aiConfigId = aiConfigId;
    }
    batchRows.push(...rows);

    featureResults.push(makeResult(item, resultIndex, 'generated', coverageReasons, coverage.decisions));
  }

  // 普通选中生成跳过的已存在功能点 → skipped_existing（不覆盖、不重复）
  snapshot.skippedExisting.forEach((item) => {
    featureResults.push(makeResult(item, snapshotIndex.get(item.featureId) ?? 0, 'skipped_existing', ['已存在，普通选中生成跳过'], emptyDecision()));
  });
  featureResults.sort((a, b) => a.inputIndex - b.inputIndex);

  // 7. scope 合并
  const mergedWorkbook = mergeCaseProducts({
    current: input.currentCaseWorkbook ?? [],
    batchGenerated: batchRows,
    scope,
    regenerateSelected,
    featureIdModuleMap,
    meta,
    colWidths: CASE_COLUMN_WIDTHS,
    allowedFeatureIds: new Set(input.featureTable.flat().map((row) => row[8] ?? '').filter(Boolean)),
  });

  const generationBase = {
    batchId,
    systemId: stableSystemId,
    featureRevision: stableFeatureRevision,
    orderedFeatureIds,
    evidenceDigest: stableEvidenceDigest,
    styleVersion: stableStyleVersion,
    taskId: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
  const generation: CaseGenerationContext = mode === 'ai'
    ? (() => {
      if (!aiConfigId) throw new CaseGenerationBlockedError('AI 模式缺少冻结的 AI 配置 ID');
      return scope === 'all'
        ? { ...generationBase, mode: 'ai', aiConfigId, scope: 'all', regenerateSelected: false }
        : { ...generationBase, mode: 'ai', aiConfigId, scope: 'selected_modules', regenerateSelected };
    })()
    : scope === 'all'
      ? { ...generationBase, mode: 'no_ai', scope: 'all', regenerateSelected: false }
      : { ...generationBase, mode: 'no_ai', scope: 'selected_modules', regenerateSelected };

  const outputBase: CaseOutput = {
    caseWorkbook: mergedWorkbook,
    caseRows: mergedWorkbook.map((s) => s.rows),
    metaHeader: cloneMeta(meta),
    qualityGateIssues: [],
    complexLogicDetected: false,
    featureResults,
    generation,
  };

  // 强校验
  const strongIssues = strongValidate(outputBase);
  const { detected: complexLogicDetected, issues: complexityIssues } = detectComplexity(input.featureTable);
  outputBase.qualityGateIssues = [...complexityIssues, ...strongIssues.map((i) => ({
    caseRowId: i.featureId ?? 'unknown',
    type: (i.code === 'COMPANY_STYLE' ? '泛化' : '缺证据') as QualityGateIssue['type'],
    message: i.message,
    blocking: i.blocking,
  }))];
  outputBase.complexLogicDetected = complexLogicDetected;

  // 全量生成若强校验存在阻断问题 → 不替换当前完整产物（spec §12）。
  // 但若当前无产物且本批存在成功组，返回成功组作为本次可见成果（失败明细仍在 featureResults/qualityGateIssues 展示），
  // 避免用户看到「空结果」而误以为功能无效。
  const allFeaturesGenerated = featureResults.every((result) => result.status === 'generated');
  if (scope === 'all' && (!allFeaturesGenerated || strongIssues.some((i) => i.blocking))) {
    const preserved = input.currentCaseWorkbook ?? [];
    const hasPreserved = preserved.some((sheet) => sheet.rows.length > 0);
    const visible = hasPreserved
      ? preserved
      : mergedWorkbook.filter((sheet) => sheet.rows.length > 0);
    logger?.warn?.(`case: 全量生成强校验未通过，保留当前完整产物（${hasPreserved ? '有历史产物' : '无历史产物，返回本批成功组 ' + visible.length + ' 个 sheet'}）`);
    return {
      caseWorkbook: visible,
      caseRows: visible.map((s) => s.rows),
      metaHeader: cloneMeta(meta),
      qualityGateIssues: outputBase.qualityGateIssues,
      complexLogicDetected,
      featureResults,
      generation: outputBase.generation,
    };
  }

  return outputBase;
};

export default run;
