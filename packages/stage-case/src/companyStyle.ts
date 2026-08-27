/**
 * @file companyStyle.ts
 * @description 公司《区域影像测试用例.xls》风格强制规则（spec §4）：
 *              - 操作说明四要素：页面/弹窗 + 真实字段/数据 + 真实按钮/控件 + 明确动作；
 *              - 页面/字段/按钮使用中文方括号；
 *              - 空泛表达（点击相关按钮、功能正常…）零容忍；
 *              - 预期结果必须可观察、可判断。
 */

/** 空泛表达（spec §4.2 明令禁止） */
export const VAGUE_PHRASES = [
  '点击相关按钮',
  '输入相关信息',
  '功能正常',
  '结果正确',
  '页面展示正常',
  '按系统要求填写',
  '使用合法数据进行操作',
  '相关操作',
  '系统正常',
  '按系统要求',
  '填写相关信息',
];

export function isVagueText(text: string): boolean {
  if (!text) return true;
  return VAGUE_PHRASES.some((p) => text.includes(p));
}

export interface CompanyStyleIssue {
  field: 'operation' | 'expected';
  message: string;
}

/** 校验单条 Step 是否符合公司风格；返回问题列表（空表示通过） */
export function assertCompanyStyle(operation: string, expected: string): CompanyStyleIssue[] {
  const issues: CompanyStyleIssue[] = [];
  if (!operation?.trim()) issues.push({ field: 'operation', message: '操作说明为空' });
  if (!expected?.trim()) issues.push({ field: 'expected', message: '预期结果为空' });
  if (isVagueText(operation)) issues.push({ field: 'operation', message: '操作说明含空泛表达' });
  if (isVagueText(expected)) issues.push({ field: 'expected', message: '预期结果含空泛表达' });
  // Accept the current full-width company brackets and legacy ASCII brackets.
  if (operation && !/(?:【[^】]+】|\[[^\]]+\])/.test(operation)) {
    issues.push({ field: 'operation', message: '操作说明未使用方括号引用页面/字段/按钮' });
  }
  // 预期结果必须是可观察判断，禁止"功能正常/结果正确"类空泛
  if (expected && /(正常|正确|成功)$/.test(expected.trim()) && !/[。：，]/.test(expected) && !/展示|显示|提示|返回|关闭|保留|列出|校验|不一致|不存在|可读取|可见/.test(expected)) {
    issues.push({ field: 'expected', message: '预期结果过于空泛，缺少可观察判断' });
  }
  return issues;
}
