/**
 * @file aiGenerator.ts
 * @description 任务级 AI 润色（spec §6.5 / §10）：AI 只在同快照/证据/风格契约下改写操作与预期，
 *              不新增字段/按钮/编号，不越界。AI 调用失败由调用方转为 ai_failed，不静默降级。
 */
import type { FeatureEvidence, ScenarioCandidate } from '@test-platform/contracts';
import { refineScenarioText, type CaseAIClient } from './aiCaseRows';
import type { ScenarioContext } from './templateScenarioEngine';

export type PolishedMap = Map<string, { operation: string; expected: string }>;

/**
 * 对一组确定性候选调用 AI 润色。任一候选润色抛错即向上抛出，由调用方整体标记 ai_failed。
 * 返回 scenarioId -> 润色后 {operation, expected}。任一 AI 响应无法解析或未通过证据安全门，
 * 整个功能点标记 ai_failed，禁止静默显示为成功的无 AI 结果。
 */
export async function polishCandidates(
  candidates: ScenarioCandidate[],
  ctx: ScenarioContext,
  evidence: FeatureEvidence | undefined,
  aiClient: CaseAIClient,
): Promise<PolishedMap> {
  const map: PolishedMap = new Map();
  for (const candidate of candidates) {
    const refined = await refineScenarioText(ctx, candidate, evidence, aiClient);
    if (!refined) {
      throw new Error(`AI 返回未通过结构或证据校验（${candidate.scenarioId}）`);
    }
    map.set(candidate.scenarioId, refined);
  }
  return map;
}
