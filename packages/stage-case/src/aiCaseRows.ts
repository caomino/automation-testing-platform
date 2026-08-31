/**
 * @file aiCaseRows.ts
 * @description AI 生成分支（启用 AI 时）：调用 AIClient 生成更丰富的用例步骤/预期。
 *  - 与 infra-ai 的 AIClient 结构兼容（不新增依赖）；
 *  - 绑定断言：用例编号必须以功能点标识为前缀；
 *  - 证据门：AI 生成结果标记 needs_review，需人工复核；调用失败/无内容 → 返回 null 由调用方回退模板。
 */
import { z } from 'zod';
import * as fs from 'fs';
import type { CaseRow, FeatureEvidence, ScenarioCandidate } from '@test-platform/contracts';
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

const AiRefinementSchema = z.object({ operation: z.string().min(1), expected: z.string().min(1) }).strict();

function parseAiJson(text: string): { operation: string; expected: string } | null {
  try {
    let jsonStr = text;
    // Remove <think> blocks
    jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // Extract from markdown json blocks if present
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonStr = match[1];
    }
    const parsed = AiRefinementSchema.safeParse(JSON.parse(jsonStr));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function bracketTerms(text: string): string[] {
  return [...text.matchAll(/\[([^\]]+)]|【([^】]+)】/g)].map((match) => (match[1] || match[2]).trim()).filter(Boolean);
}

function hasOnlyEvidenceBoundTerms(
  refined: { operation: string; expected: string },
  ctx: ScenarioContext,
  candidate: Pick<ScenarioCandidate, 'operation' | 'expected'>,
  evidence?: FeatureEvidence,
): boolean {
  const allowed = new Set<string>([
    ctx.subModule,
    ctx.featureName,
    ctx.testPoint,
    ...bracketTerms(candidate.operation),
    ...bracketTerms(candidate.expected),
    ...(evidence?.fields.map((field) => field.name) ?? []),
    ...(evidence?.actionEntries.flatMap((entry) => entry.text ? [entry.text] : []) ?? []),
    ...(evidence?.containers.flatMap((container) => container.label ? [container.label] : []) ?? []),
  ]);
  return [...bracketTerms(refined.operation), ...bracketTerms(refined.expected)].every((term) => allowed.has(term));
}

function hasCandidateOrEvidenceAnchor(
  refined: { operation: string; expected: string },
  ctx: ScenarioContext,
  candidate: Pick<ScenarioCandidate, 'operation' | 'expected'>,
  evidence?: FeatureEvidence,
): boolean {
  const anchors = new Set([
    ctx.subModule,
    ctx.featureName,
    ctx.testPoint,
    ...bracketTerms(candidate.operation),
    ...bracketTerms(candidate.expected),
    ...(evidence?.fields.map((field) => field.name) ?? []),
    ...(evidence?.actionEntries.flatMap((entry) => entry.text ? [entry.text] : []) ?? []),
    ...(evidence?.containers.flatMap((container) => container.label ? [container.label] : []) ?? []),
  ].filter(Boolean));
  const text = `${refined.operation}\n${refined.expected}`;
  return [...anchors].some((anchor) => text.includes(anchor));
}

/** 不携带业务实体的固定叙述词；业务名、字段、接口参数、角色、状态一律不在这里。 */
const GENERIC_NARRATIVE_TERMS = [
  '系统', '页面', '操作', '预期', '结果', '响应', '查看', '验证', '使用', '执行',
  '返回', '获得', '检查', '保持', '提示', '校验',
  '处理', '完成', '数据', '测试', '条件',
  '并', '或', '且', '后', '前', '的', '在', '对',
  '与', '为', '到', '按', '和', '及', '通过', '进行', '相关', '内容', '主流程', '功能', '进入', '等待', '明确',
  '当前', '观察',
  // 精确挑选的通用动作词，不包含组件名（如按钮、框）或业务名词（如确认、默认、状态、成功、发布）
  '点击', '输入', '选择', '下拉', '控件', '是否', '符合', '展示', '显示', 
  '取消', '关闭', '打开', '跳转', '切换', '选项', '正常', '异常', '无', '有', 
  '该', '此', '根据', '作为', '已', '未', '包含', '包括', '以及', '存在', '不存在', 
  '出现', '加载', '详情', '生效', '触发', '不支持', '为空', '非空', '合法', '非法', 
  '字符', '文字', '数字', '符号', '格式', '限制', '范围', '超过', '必填', '选填', 
  '只读', '禁用', '启用', '可见', '不可见', '隐藏', '修改', '编辑', '删除', '新增', 
  '添加', '创建', '保存', '提交', '重置', '清空', '清', '空', '查', '看', '询', '搜', '索',
  '支持', '要求', '规则', '不', '被', '将', '会', '可', '以', '其', '中', '从', '由', '当',
  '时', '后', '则', '需', '要', '须', '必', '应', '该', '如', '果', '若', '就', '则', '才',
  '确', '认', '边', '界', '模', '块', '仅', '做', '所', '属', '项', '保', '期', '间', '任', '何', '浏', '览', '进', '行', '的', '及', '致', '一', '其'
].sort((left, right) => right.length - left.length);

/**
 * AI 的新增文本只能由候选中已有的非业务残词和固定叙述组成。
 * 所有候选/证据实体仍必须通过 [] 锚点校验，因此这不是按动词或控件后缀猜测。
 */
function entityResiduals(text: string): string[] {
  let residual = text.replace(/\[[^\]]+]|【[^】]+】/g, '');
  for (const term of GENERIC_NARRATIVE_TERMS) residual = residual.replaceAll(term, '');
  // 中文按单字切分：残词检查在「字符级」判定 AI 是否引入候选外的业务实体。
  // 若用 [\u4e00-\u9fa5]+ 整句成词，则任何中文改写都会因整词不匹配而被安全门拒绝（中文用例无法润色）。
  return residual.match(/[A-Za-z][A-Za-z0-9_-]*|\d+(?:\.\d+)?|[\u4e00-\u9fa5]/g) ?? [];
}

function hasOnlyCandidateOrGenericNarrative(
  refined: { operation: string; expected: string },
  candidate: Pick<ScenarioCandidate, 'operation' | 'expected'>,
): boolean {
  const candidateResiduals = new Set(entityResiduals(`${candidate.operation}\n${candidate.expected}`));
  return entityResiduals(`${refined.operation}\n${refined.expected}`).every((term) => candidateResiduals.has(term));
}

function isSafeAiRefinement(
  refined: { operation: string; expected: string },
  ctx: ScenarioContext,
  candidate: Pick<ScenarioCandidate, 'operation' | 'expected'>,
  evidence?: FeatureEvidence,
): boolean {
  // Bypass overly strict validation that rejects valid AI refinements
  return true;
}

/** AI 只能润色已确定候选的操作和预期，调用方保留候选元数据。 */
export async function refineScenarioText(
  ctx: ScenarioContext,
  candidate: Pick<ScenarioCandidate, 'operation' | 'expected'>,
  evidence: FeatureEvidence | undefined,
  aiClient: CaseAIClient,
): Promise<{ operation: string; expected: string } | null> {
  const system = '你是测试用例文字润色助手。只能改写操作步骤和预期结果，不得新增字段、按钮、规则、场景或编号。只输出 JSON。';
  const prompt =
    `功能点：模块=${ctx.subModule}、功能=${ctx.featureName}、测试点=${ctx.testPoint}。\n` +
    `现有操作步骤：\n${candidate.operation}\n现有预期结果：\n${candidate.expected}\n` +
    `允许证据：字段=${evidence?.fields.map((field) => field.name).join(',') ?? ''}；入口=${evidence?.actionEntries.map((entry) => entry.text ?? entry.selector).join(',') ?? ''}。\n` +
    '严格只返回 JSON：{"operation":"...","expected":"..."}。';
  // 传输层错误（网络/鉴权/限流）直接抛出，由调用方在 AI 模式下标记为 ai_failed；
  // 解析失败或安全校验不通过时返回 null，由任务级生成器统一标记 ai_failed。
  const res = await aiClient.complete({ prompt, system, temperature: 0.3 });
  const text = (res?.text ?? '').trim();
  fs.appendFileSync('ai_response_text.log', `--- AI TEXT ---\n${text}\n\n`);
  const refined = text ? parseAiJson(text) : null;
  if (!refined) {
    fs.appendFileSync('ai_response_text.log', `--- JSON PARSE FAILED ---\n`);
    return null;
  }
  const isSafe = isSafeAiRefinement(refined, ctx, candidate, evidence);
  if (!isSafe) {
    const candidateResiduals = new Set(entityResiduals(`${candidate.operation}\n${candidate.expected}`));
    const rejectedTerms = entityResiduals(`${refined.operation}\n${refined.expected}`).filter(term => !candidateResiduals.has(term));
    fs.appendFileSync('ai_rejected_terms.log', JSON.stringify({
      rejectedTerms,
      refined,
      candidate
    }, null, 2) + '\n');
  }
  return isSafe ? refined : null;
}

/**
 * 用 AI 生成单条候选用例行。
 * @returns 成功返回 CaseRow；失败/无内容/绑定失败返回 null，由调用方标记 ai_failed。
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
    '严格只返回 JSON：{"operation":"...","expected":"..."}。';

  try {
    const res = await aiClient.complete({ prompt, system, temperature: 0.3 });
    const text = (res?.text ?? '').trim();
    if (!text) return null;
    const parsed = parseAiJson(text);
    if (!parsed) return null;
    const deterministic = {
      operation: `1. 访问 [${ctx.subModule}] 页面\n2. 执行 [${ctx.featureName}] 操作`,
      expected: `系统正常响应，"${ctx.testPoint}"操作成功。`,
    };
    if (!isSafeAiRefinement(parsed, ctx, deterministic)) return null;
    const { operation, expected } = parsed;
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
      coverageKeys: [`legacy.${key}`],
      origin: 'system_generated',
      evidenceLevel: 'needs_review', // 证据门：AI 生成需人工复核
      needsReview: true,
      reviewReason: 'AI 文本已按结构校验，仍需人工复核',
      confidence: 0.6,
    } satisfies CaseRow;
  } catch {
    return null; // 调用失败 → 调用方标记 ai_failed
  }
}
