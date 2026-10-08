/**
 * @file actionKind.ts
 * @description 功能点「动作语义」分类兜底（通用，非系统指纹）。
 *
 * 背景（问题④根因）：模块树里 action 节点的 `actionKind` 常由探索阶段写入；当树来自
 * AI 补全 / 人工补录 / 旧版本探索产物时，该字段缺失（实测某系统 105 个节点 actionKind 全空），
 * 于是功能点表 `?? 'other'` 全量塌缩为 other —— 覆盖键退化为 `other.entry`，
 * 证据门报「未观察到 other.entry 所需的安全页面或设计证据」，用例退化为
 * 「查看入口及其影响范围，不执行写入操作」占位。
 *
 * 本模块在「功能点表构建」处按**节点标签的通用动词语义**补出动作类型，
 * 使下游（证据采集 / 用例生成）能拿到正确的 list/query/create/detail/... 语义。
 *
 * ⚠ 合规边界（AGENTS.md HARD RULE #0）：
 *   这里只使用**跨系统普适的动词语义**（新增/修改/删除/查询…），
 *   不使用任何系统名、域名、框架类名、组件 ID 作为判据；
 *   与 engine-mcp `nav-tree.ts` 的 OPERATION_KEYWORDS 同源语义（同一套通用动词），
 *   因此对任意管理系统成立。
 */
import type { ActionKind } from '@test-platform/contracts';

/**
 * 通用动作关键词 → ActionKind。
 * 顺序敏感：更具体的规则必须排在更宽泛的规则前面（如「批量删除」先于「删除」、
 * 「查询X列表」先于泛化的「列表」）。
 */
const ACTION_RULES: ReadonlyArray<{ re: RegExp; kind: ActionKind }> = [
  // 批量类写操作：必须先于单个 delete 判定
  { re: /批量\s*(删除|移除|作废|操作)|批删/, kind: 'batch_delete' },
  // 打开「只读录入界面」类入口（点击安全：不提交即无写入）
  { re: /新增|新建|添加|创建|录入|登记/, kind: 'create' },
  { re: /修改|编辑|更新|变更/, kind: 'update' },
  { re: /删除|移除|作废/, kind: 'delete' },
  // 只读查看类入口
  { re: /详情|查看|明细|预览|查阅/, kind: 'detail' },
  // 查询/检索：先于泛化的「列表」
  { re: /查询|搜索|筛选|查找|检索/, kind: 'query' },
  { re: /导出|下载/, kind: 'export' },
  { re: /导入|上传/, kind: 'import' },
  { re: /审核|审批|复核|授权|权限|分配|指派/, kind: 'permission' },
  { re: /流程|流转|工单|审批流/, kind: 'workflow' },
  { re: /登录|注销|退出|登出/, kind: 'auth' },
  // 泛化列表：放在最后，避免抢走「查询X列表」等更具体的判定
  { re: /列表|清单|台账|报表|汇总/, kind: 'list' },
];

/**
 * 依据动作标签文本推断 ActionKind。
 * 未命中任何通用动词时返回 undefined（调用方决定是否回退 'other'），
 * 绝不猜测——「重置密码 / 清空日志 / 解锁账号」这类无通用动词的写操作会保持 other，
 * 从而不会被误判为可点开的只读入口。
 */
export function classifyActionLabel(label?: string): ActionKind | undefined {
  const text = (label ?? '').replace(/\s+/g, '');
  if (!text) return undefined;
  for (const rule of ACTION_RULES) {
    if (rule.re.test(text)) return rule.kind;
  }
  return undefined;
}
