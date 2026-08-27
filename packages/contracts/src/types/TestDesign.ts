/**
 * @file TestDesign.ts
 * @description 业务动作颗粒度测试用例生成的「单一事实来源」类型。
 * 本文件仅追加可选/附加类型，不改动任何冻结 v1.0 契约；旧 artifact 与旧输入仍可读取。
 *
 * 冲突处置（与 user-§四.2 / design-spec-§3 不一致）：
 *  - ActionKind 以 user-§四.2 为权威集合，并保留 design-spec-§3 的 `reset`/`permission` 作为兼容成员。
 *  - `auth` 与 `permission` 语义等价；以 `auth` 为首选 token，`permission` 仅用于向后兼容映射。
 */

import type { FeatureProvenance, FeatureRow } from './FeatureRow';

/** 业务动作类型（单一分类来源；stage-explore / engine-mcp 统一映射到此） */
export type ActionKind =
  | 'list'
  | 'query'
  | 'reset'
  | 'create'
  | 'update'
  | 'delete'
  | 'batch_delete'
  | 'detail'
  | 'import'
  | 'export'
  | 'auth'
  | 'permission'
  | 'workflow'
  | 'other';

/** ActionKind 全量列表（用于校验与矩阵遍历） */
export const ACTION_KINDS: ActionKind[] = [
  'list',
  'query',
  'reset',
  'create',
  'update',
  'delete',
  'batch_delete',
  'detail',
  'import',
  'export',
  'auth',
  'permission',
  'workflow',
  'other',
];

/** 功能/证据来源。缺省值代表旧 Web 输入，保持旧数据兼容。 */
export type FeatureSource = 'web' | 'openapi' | 'workflow' | 'manual';

/** 供用例渲染的结构化 schema 摘要，不保存任意 OpenAPI 原文。 */
export interface SchemaSummary {
  type?: string;
  format?: string;
  required?: string[];
  properties?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  enum?: string[];
}

export interface ApiParameterDetail {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | 'body' | 'formData';
  required: boolean;
  description?: string;
  schema?: SchemaSummary;
}

export interface ApiResponseDetail {
  status: string;
  description: string;
  schema?: SchemaSummary;
}

export interface ApiDesignDetail {
  method: string;
  path: string;
  parameters: ApiParameterDetail[];
  requestBody?: { required: boolean; contentType?: string; description?: string; schema?: SchemaSummary };
  responses: ApiResponseDetail[];
  security: string[];
}

export interface WorkflowTransitionDetail {
  id: string;
  action: string;
  from: string;
  to: string;
  actorRoles: string[];
  preconditions: string[];
  postconditions: string[];
}

export interface WorkflowDesignDetail {
  roles: string[];
  transitions: WorkflowTransitionDetail[];
}

/** API / 工作流可验证输入的保留细节；旧 Web 证据可省略。 */
export interface StructuredDesignDetail {
  source: 'openapi' | 'workflow';
  api?: ApiDesignDetail;
  workflow?: WorkflowDesignDetail;
}

/** 字段及约束语义 */
export interface FieldSemantic {
  /** 元素 ref */
  ref: string;
  /** CSS selector */
  selector: string;
  /** 字段名/标签 */
  name: string;
  /** 控件类型: text/number/select/date/textarea/checkbox/radio... */
  inputType?: string;
  /** 是否必填 */
  required?: boolean;
  /** 是否只读 */
  readonly?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 最小长度 */
  minLength?: number;
  /** 最大长度 */
  maxLength?: number;
  /** 数值最小值 */
  minimum?: number;
  /** 数值最大值 */
  maximum?: number;
  /** 格式正则（如手机号） */
  pattern?: string;
  /** 枚举可选项（select/radio/checkbox-group） */
  options?: string[];
  /** 是否多选 */
  multiple?: boolean;
  /** 默认值 */
  defaultValue?: string;
  /** placeholder */
  placeholder?: string;
}

/** 表格/分页/排序/筛选语义 */
export interface TableSemantic {
  /** 元素 ref */
  ref: string;
  /** CSS selector */
  selector: string;
  /** 列头 */
  columns: string[];
  /** 当前页可见行数 */
  rowCount: number;
  /** 是否有分页 */
  hasPagination: boolean;
  /** 分页信息文本（如 "第 1/10 页"） */
  paginationInfo?: string;
  /** 是否可排序 */
  hasSorting: boolean;
  /** 可排序列 */
  sortableColumns?: string[];
  /** 是否有筛选 */
  hasFilter: boolean;
  /** 筛选字段名 */
  filterFields?: string[];
  /** 是否有空状态 */
  hasEmptyState: boolean;
  /** 空状态文本 */
  emptyStateText?: string;
  /** 是否为虚拟列表 */
  isVirtualList?: boolean;
}

/** 只读探索下可达的页面状态 */
export type PageState = 'base' | 'create' | 'detail' | 'update' | 'views';

/** 动作入口（只读探索下是否可安全触发） */
export interface ActionEntry {
  actionKind: ActionKind;
  ref: string;
  selector: string;
  text?: string;
  /** 只读探索下是否允许安全触发（如只读详情入口、Tab 切换） */
  triggerable: boolean;
  /** 安全触发规则描述 */
  triggerRule?: string;
  /** selector 在当前安全快照中精确匹配到时才为 true；旧数据省略时不可作为 observed 依据。 */
  observed?: boolean;
}

/** 容器/嵌套结构（Tab/弹窗/抽屉/折叠/iframe） */
export interface ContainerState {
  kind: 'tab' | 'dialog' | 'drawer' | 'collapse' | 'iframe' | 'shadow' | 'virtual_list';
  ref: string;
  selector: string;
  label?: string;
  /** 当前是否展开/激活 */
  expanded?: boolean;
  /** iframe 是否跨域（跨域不可读） */
  crossOrigin?: boolean;
  /** Shadow DOM 模式；closed 不可读 */
  shadowDom?: 'open' | 'closed';
}

/** 不可安全读取的项类型 */
export type UncoveredKind =
  | 'cross_origin_iframe'
  | 'closed_shadow_dom'
  | 'canvas'
  | 'write_required_state'
  | 'no_safe_sample'
  | 'budget_exceeded'
  | 'hardware_control'
  | 'timeout';

/** 无法安全读取的原因记录（必须显式声明，不得伪装覆盖） */
export interface UncoveredItem {
  kind: UncoveredKind;
  reason: string;
}

/** 覆盖清单：业务要求必须覆盖的键 vs 实际观测键 vs 需人工复核键 */
export interface CoverageManifest {
  actionKind: ActionKind;
  /** 业务要求必须覆盖的 coverageKey */
  requiredKeys: string[];
  /** 实际观测到的 coverageKey */
  observedKeys: string[];
  /** 业务要求但无法安全验证、需人工复核的 coverageKey */
  needsReviewKeys: string[];
  /** requiredKeys 中尚未被 observed 覆盖的键 */
  missingKeys?: string[];
}

/** 功能点档案：由 stage-explore 明确语义透传（stage-feature 不重新分类） */
export interface FeatureProfile {
  /** 测试点标识（base_NN） */
  featureId: string;
  /** 测试点名称（如"新增"） */
  testPoint: string;
  /** 动作身份 */
  actionKind: ActionKind;
  /** 来源页面 URL */
  pageUrl?: string;
  /** SPA 定位符（click: selector），用于 orchestrator 进入菜单常驻页 */
  clickSelector?: string;
  /** 父模块名 */
  parentModule?: string;
  /** 子系统 ID */
  subsystemId?: string;
  /** 原始动作文本（探索阶段识别到的 label） */
  sourceLabel?: string;
  /** 原始动作 selector */
  sourceSelector?: string;
  /** 明确来源；省略时按既有 Web 输入处理。 */
  source?: FeatureSource;
}

/** 按 featureId 隔离的页面证据（禁止全局数组合并） */
export interface FeatureEvidence {
  featureId: string;
  actionKind: ActionKind;
  /** 证据采集时绑定的系统身份（旧证据可省略） */
  systemId?: string;
  /** 证据采集时绑定的功能点修订（旧证据可省略） */
  featureRevision?: string;
  /** 证据采集时命中的功能入口 selector/ref（旧证据可省略） */
  pageEntry?: string;
  pageUrl?: string;
  /** 已达页面状态 */
  states: PageState[];
  /** 字段及约束 */
  fields: FieldSemantic[];
  /** 表格/分页/筛选 */
  tables: TableSemantic[];
  /** 动作入口 */
  actionEntries: ActionEntry[];
  /** 容器（Tab/弹窗/抽屉/折叠/iframe） */
  containers: ContainerState[];
  /** 证据级别 */
  evidenceLevel: 'observed' | 'derived' | 'needs_review';
  /** 实际观测覆盖键 */
  coverageKeys: string[];
  /** 是否需人工复核 */
  needsReview: boolean;
  /** 复核原因 */
  reviewReason?: string;
  /** 覆盖清单 */
  coverageManifest?: CoverageManifest;
  /** 不可安全读取项 */
  uncovered: UncoveredItem[];
  /** OpenAPI / workflow 的可渲染结构化细节；旧证据不要求携带。 */
  structuredDesign?: StructuredDesignDetail;
}

/** 可验证的结构化设计源；自由文本不属于该契约。 */
export interface DesignSource {
  kind: 'openapi' | 'workflow';
  content: string;
  name?: string;
}

/** 确定性场景候选（AI 仅润色 operation/expected，不得增删/改编号/改 evidenceLevel） */
export interface ScenarioCandidate {
  /** 稳定场景 ID（动作矩阵确定性生成，如 QYYX_PZ_JCX_01_CREATE_001） */
  scenarioId: string;
  featureId: string;
  actionKind: ActionKind;
  /** 测试内容（列1） */
  scenarioName: string;
  /** 本场景覆盖的 coverageKey */
  coverageKey: string;
  /** 优先级 */
  priority: 'P0' | 'P1' | 'P2';
  /** 初步用例编号（与 featureId 同前缀） */
  caseNo: string;
  /** 步骤（Step1, Step2...） */
  step: string;
  /** 输入及操作说明 */
  operation: string;
  /** 预期结果 */
  expected: string;
  /** 证据级别 */
  evidenceLevel: 'observed' | 'derived' | 'needs_review';
  /** 是否需人工复核 */
  needsReview: boolean;
  /** 复核原因（业务要求但页面无法安全验证时写明） */
  reviewReason?: string;
}

/** v2 功能点 artifact（含档案与证据溯源）；旧格式为 FeatureRow[][] 二维数组 */
export interface FeatureArtifactV2 {
  version: 2;
  table: FeatureRow[][];
  featurePaths?: Record<string, string>;
  featureProfiles?: FeatureProfile[];
  featureEvidence?: Record<string, FeatureEvidence>;
  provenance?: FeatureProvenance[];
  designSources?: string[];
}

/** 功能点 artifact：旧版二维数组 或 新版 v2 对象 */
export type FeatureArtifact = FeatureRow[][] | FeatureArtifactV2;

/** 类型守卫：是否为 v2 artifact */
export function isFeatureArtifactV2(v: FeatureArtifact): v is FeatureArtifactV2 {
  return !Array.isArray(v) && (v as FeatureArtifactV2).version === 2;
}
