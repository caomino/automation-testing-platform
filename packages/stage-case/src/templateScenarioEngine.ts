/**
 * @file templateScenarioEngine.ts
 * @description 模板场景引擎（P1）：覆盖 正常/异常/边界/流程/权限 五类场景。
 *  - 有探索元素时用真实页面元素（按钮/输入框/导航）生成可执行步骤；
 *  - 无探索元素时回退模板步骤（仍按文档结构描述）。
 * 场景后缀与文档《测试点标识_NN》（NN 为场景序号 1..5）严格对应。
 */
import type { ExploredElement, FeatureRow } from '@test-platform/contracts';
import { DEFAULT_FEATURE_COLUMNS } from '@test-platform/contracts';

const FC = DEFAULT_FEATURE_COLUMNS;

/** 五类场景（顺序即编号后缀 _N1.._N5） */
export type ScenarioKey = 'normal' | 'boundary' | 'exception' | 'process' | 'permission';

export const SCENARIO_ORDER: ScenarioKey[] = ['normal', 'boundary', 'exception', 'process', 'permission'];

/** 场景后缀（绑定功能点 4 段值后追加，保证 sheet 内用例编号唯一且仍绑定功能点标识） */
export const SCENARIO_SUFFIX: Record<ScenarioKey, string> = {
  normal: '_N1',
  boundary: '_N2',
  exception: '_N3',
  process: '_N4',
  permission: '_N5',
};

/** 场景中文标签 */
export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  normal: '正常',
  boundary: '边界',
  exception: '异常',
  process: '流程',
  permission: '权限',
};

/** 场景生成上下文 */
export interface ScenarioContext {
  subModule: string;
  featureName: string;
  testPoint: string;
  precondition: string;
}

const isSubmitText = (t: string): boolean => /提交|保存|确定|确认|查询|搜索|新增|删除|submit|save|confirm|search|add|delete/i.test(t);

/**
 * 用真实探索元素生成场景步骤（正常/边界/异常）。
 * 元素动作映射：navigate→进入；click→点击；fill→录入；select→选择。
 */
function realSteps(
  key: ScenarioKey,
  ctx: ScenarioContext,
  elements: ExploredElement[],
): { operation: string; expected: string } {
  const interactive = elements.filter((e) => e.interactive);
  const clickEls = interactive.filter((e) => e.suggestedAction === 'click');
  const fillEls = interactive.filter((e) => e.suggestedAction === 'fill');
  const navEls = interactive.filter((e) => e.suggestedAction === 'navigate');

  const steps: string[] = [`1. 访问 [${ctx.subModule}] 页面`];
  let n = 2;

  if (navEls.length > 0) {
    steps.push(`${n++}. 点击 [${navEls[0].text || navEls[0].label || navEls[0].ref}] 进入`);
  }
  if (clickEls.length > 0) {
    const btn = clickEls.find((e) => isSubmitText(e.text || ''));
    steps.push(`${n++}. 点击 [${btn ? btn.text || btn.ref : clickEls[0].text || clickEls[0].ref}] 按钮`);
  }
  if (fillEls.length > 0) {
    const verb = key === 'boundary' ? '边界值' : key === 'exception' ? '非法数据' : '有效测试数据';
    fillEls.forEach((e) => {
      steps.push(`${n++}. 在 [${e.label || e.text || e.ref}] 输入${verb}`);
    });
  }
  if (key !== 'normal') {
    steps.push(`${n++}. 观察系统${key === 'boundary' ? '边界处理' : '错误提示'}`);
  }

  const expected =
    key === 'boundary'
      ? `系统在边界条件下处理正确，无溢出或异常，边界值提示符合业务规则。`
      : key === 'exception'
        ? `系统给出明确错误提示，拒绝非法输入并保持原状态，页面不崩溃。`
        : `页面跳转/响应正常，"${ctx.featureName}"功能执行成功，结果与预期一致。`;

  return { operation: steps.join('\n'), expected };
}

/** 模板兜底（无探索元素或真实步骤不足时） */
function templateSteps(key: ScenarioKey, ctx: ScenarioContext): { operation: string; expected: string } {
  switch (key) {
    case 'normal':
      return {
        operation: `1. 访问 [${ctx.subModule}] 页面\n2. 点击 [${ctx.featureName}] 功能按钮\n3. 录入 [${ctx.testPoint}] 测试数据\n4. 提交并确认`,
        expected: `系统正常响应，"${ctx.testPoint}"操作成功，返回/显示结果与预期一致。`,
      };
    case 'boundary':
      return {
        operation: `1. 访问 [${ctx.subModule}] 页面\n2. 录入 [${ctx.testPoint}] 边界值（空值/最大值/最小值）\n3. 点击 [提交] 按钮\n4. 等待响应完成`,
        expected: `系统在边界条件下处理正确，无溢出或异常，结果符合业务规则。`,
      };
    case 'exception':
      return {
        operation: `1. 访问 [${ctx.subModule}] 页面\n2. 录入 [${ctx.testPoint}] 非法数据\n3. 选择非法数据选项\n4. 点击 [提交] 按钮\n5. 观察错误提示`,
        expected: `系统给出明确错误提示，拒绝非法输入并保持原状态，不崩溃。`,
      };
    case 'process':
      return {
        operation: `1. 访问 [${ctx.subModule}] 页面\n2. 进入前置关联页面，完成前置数据准备\n3. 返回本功能点页面\n4. 执行 [${ctx.featureName}] 主流程操作\n5. 提交并确认\n6. 校验跨页面数据一致性`,
        expected: `跨页面流程执行成功，前置数据与本功能点结果一致，流程闭环无断点。`,
      };
    case 'permission':
      return {
        operation: `1. 使用无权限账号登录系统\n2. 访问 [${ctx.subModule}] 页面\n3. 尝试执行 [${ctx.featureName}] 操作\n4. 观察系统权限校验`,
        expected: `系统对越权操作给出明确拦截/无权限提示，未执行越权动作，符合权限策略。`,
      };
  }
}

/**
 * 生成单场景步骤：优先真实元素，缺失或异常时模板兜底。
 * @returns 操作说明 + 预期结果
 */
export function scenarioContent(
  key: ScenarioKey,
  ctx: ScenarioContext,
  elements?: ExploredElement[],
): { operation: string; expected: string } {
  if (elements && elements.length > 0) {
    try {
      const real = realSteps(key, ctx, elements);
      // 正常/边界/异常 用真实元素；流程/权限 以模板为主（跨页面/越权语义强）
      if (key === 'normal' || key === 'boundary' || key === 'exception') {
        return real;
      }
    } catch {
      /* 落到模板 */
    }
  }
  return templateSteps(key, ctx);
}

/** 仅从功能点行取测试点标识（供其他模块复用） */
export const featureIdFromRow = (r: FeatureRow): string => r[FC.testPointId] ?? '';
