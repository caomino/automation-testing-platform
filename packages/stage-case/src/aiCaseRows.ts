/**
 * @file aiCaseRows.ts
 * @description AI 生成分支（启用 AI 时）：调用 AIClient 生成更丰富的用例步骤/预期。
 *  - 与 infra-ai 的 AIClient 结构兼容（不新增依赖）；
 *  - 绑定断言：用例编号必须以功能点标识为前缀；
 *  - 证据门：AI 生成结果标记 needs_review，需人工复核；调用失败/无内容 → 返回 null 由调用方回退模板。
 */
import type { CaseRow } from '@test-platform/contracts';
import { SCENARIO_SUFFIX, SCENARIO_LABEL, type ScenarioKey, type ScenarioContext } from './templateScenarioEngine';

/** 与 infra-ai 的 AIClient 结构兼容（complete 返回 {text, usage?}） */
export interface CaseAIClient {
  complete(req: { prompt: string; system?: string; temperature?: number }): Promise<{ text: string; usage?: unknown }>;
}

/** 各场景给 AI 的设计要点 */
const SCENARIO_GUIDANCE: Record<ScenarioKey, string> = {
  normal: '正常流程：在已登录且前置条件满足时，完成主流程操作并验证成功。',
  boundary: '边界值：在输入框/表单填写边界值（空值、最大、最小、超长），验证系统处理正确。',
  exception: '异常输入：填写非法/格式错误数据，验证系统给出明确错误提示且不崩溃。',
  process: '跨页面流程：涉及前置页面数据准备与本功能点主流程的串联，验证流程闭环。',
  permission: '权限校验：以无权限账号尝试操作，验证系统拦截/无权限提示。',
};

/** 解析 AI 文本为操作步骤 + 预期结果（兼容【操作步骤】/【预期结果】分段） */
function parseAiText(text: string, ctx: ScenarioContext): { operation: string; expected: string } {
  const opMatch = text.match(/【操作步骤】([\s\S]*?)(?:【预期结果】|$)/);
  const expMatch = text.match(/【预期结果】([\s\S]*?)$/);
  const operation =
    (opMatch?.[1] ?? text).trim() ||
    `1. 访问 [${ctx.subModule}] 页面\n2. 执行 [${ctx.featureName}] 操作`;
  const expected =
    (expMatch?.[1] ?? '').trim() ||
    `系统正常响应，"${ctx.testPoint}"操作成功。`;
  return { operation, expected };
}

/**
 * 用 AI 生成单条候选用例行。
 * @returns 成功返回 CaseRow；失败/无内容/绑定失败返回 null（调用方回退模板）。
 */
export async function buildAiCandidateCaseRows(
  featureId: string,
  ctx: ScenarioContext,
  key: ScenarioKey,
  aiClient: CaseAIClient,
): Promise<CaseRow | null> {
  const caseNo = `${featureId}${SCENARIO_SUFFIX[key]}`;
  const system = '你是测试用例设计专家，基于功能点生成高质量、可执行的中文测试用例。';
  const prompt =
    `功能点：模块=${ctx.subModule}、功能=${ctx.featureName}、测试点=${ctx.testPoint}。\n` +
    `场景类型：${SCENARIO_LABEL[key]}（${SCENARIO_GUIDANCE[key]}）\n` +
    `前置条件：${ctx.precondition}\n` +
    `请输出该场景的测试用例，严格按以下格式：\n` +
    `【操作步骤】\n（分步骤，每步一行，使用"点击[按钮名]/在[输入框名]录入xxx/访问[页面]"自然语言）\n` +
    `【预期结果】\n（一句话描述预期）`;

  try {
    const res = await aiClient.complete({ prompt, system, temperature: 0.3 });
    const text = (res?.text ?? '').trim();
    if (!text) return null;
    const { operation, expected } = parseAiText(text, ctx);
    // 绑定断言：编号必须以功能点标识为前缀
    if (!caseNo.startsWith(featureId)) return null;
    return {
      caseNo,
      content: ctx.testPoint,
      step: `Step_${key}`,
      operation,
      expected,
      firstResult: '\\',
      regressionResult: '\\',
      conclusion: '\\',
      id: `${featureId}__${key}`,
      featureId,
      targetTestPoint: ctx.testPoint,
      scenarioId: key,
      origin: 'system_generated',
      evidenceLevel: 'needs_review', // 证据门：AI 生成需人工复核
      needsReview: true,
      confidence: 0.6,
    } satisfies CaseRow;
  } catch {
    return null; // 调用失败 → 调用方回退模板
  }
}
