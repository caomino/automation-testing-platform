import type { ActionKind, CoverageManifest, FeatureEvidence, FeatureProfile, ScenarioCandidate } from '@test-platform/contracts';

export interface ActionScenarioContext {
  featureName: string;
  subModule: string;
  testPoint: string;
}

type ScenarioDraft = Pick<ScenarioCandidate, 'coverageKey' | 'scenarioName' | 'priority' | 'operation' | 'expected'> & {
  observed: boolean;
  reason: string;
};

function unique(keys: string[]): string[] {
  return [...new Set(keys)];
}

function reviewReason(evidence: FeatureEvidence | undefined, fallback: string): string {
  return evidence?.reviewReason || fallback;
}

function sourceOf(profile: FeatureProfile, evidence: FeatureEvidence | undefined): 'web' | 'openapi' | 'workflow' | 'manual' {
  return profile.source ?? evidence?.structuredDesign?.source ?? 'web';
}

function observedCoverageKeys(evidence: FeatureEvidence | undefined): Set<string> {
  if (!evidence) return new Set();
  const needsReview = new Set(canonicalCoverageKeys([...(evidence.coverageManifest?.needsReviewKeys ?? []), ...(evidence.coverageManifest?.missingKeys ?? [])]));
  return new Set(canonicalCoverageKeys([...evidence.coverageKeys, ...(evidence.coverageManifest?.observedKeys ?? [])]).filter((key) => !needsReview.has(key)));
}

function fieldKeys(kind: ActionKind, evidence: FeatureEvidence | undefined): string[] {
  const fields = evidence?.fields ?? [];
  if (kind === 'query' || kind === 'reset') return fields.map((field) => `query.field.${field.name}`);
  if (kind !== 'create' && kind !== 'update') return [];
  const keys: string[] = [];
  for (const field of fields) {
    if (field.required) keys.push(`${kind}.required.${field.name}`);
    if (field.pattern) keys.push(`${kind}.pattern.${field.name}`);
    if (field.minLength !== undefined || field.maxLength !== undefined) keys.push(`${kind}.length.${field.name}`);
    if (field.minimum !== undefined || field.maximum !== undefined) keys.push(`${kind}.range.${field.name}`);
    if (field.options?.length) keys.push(`${kind}.enum.${field.name}`);
    if (kind === 'update' && field.readonly) keys.push(`update.readonly.${field.name}`);
  }
  return keys;
}

function structuredObservedKeys(profile: FeatureProfile, evidence: FeatureEvidence | undefined): string[] {
  const source = sourceOf(profile, evidence);
  if (source === 'openapi') {
    const api = evidence?.structuredDesign?.api;
    return unique([
      'api.request',
      ...(api?.parameters.map((parameter) => `api.parameter.${parameter.in}.${parameter.name}`) ?? []),
      ...(api?.requestBody ? ['api.body'] : []),
      ...(evidence?.fields.filter((field) => !api?.parameters.some((parameter) => parameter.name === field.name)).map((field) => `api.body.field.${field.name}`) ?? []),
      ...(api?.responses.map((response) => `api.response.${response.status}`) ?? []),
      ...(api?.security.map((name) => `api.security.${name}`) ?? []),
    ]);
  }
  if (source === 'workflow') {
    const workflow = evidence?.structuredDesign?.workflow;
    return unique([
      ...(workflow?.transitions.flatMap((transition) => [
        `workflow.transition.${transition.id}`,
        ...workflow.roles.map((role) => `workflow.role.${transition.id}.${role}`),
        ...transition.preconditions.map((_, index) => `workflow.precondition.${transition.id}.${index}`),
        ...transition.postconditions.map((_, index) => `workflow.postcondition.${transition.id}.${index}`),
      ]) ?? []),
    ]);
  }
  return [];
}

function tableObservedKeys(evidence: FeatureEvidence | undefined): string[] {
  const table = evidence?.tables[0];
  if (!table) return [];
  return unique([
    'list.display',
    ...(table.columns.length > 0 ? ['list.headers'] : []),
    ...(table.hasEmptyState ? ['list.empty'] : []),
    ...(table.hasPagination ? ['list.pagination'] : []),
    ...(table.hasSorting || (table.sortableColumns?.length ?? 0) > 0 ? ['list.sort'] : []),
    ...table.columns.map((column) => `list.column.${column}`),
    ...(table.sortableColumns ?? []).map((column) => `list.sort.${column}`),
    ...(table.filterFields ?? []).map((field) => `list.search.${field}`),
  ]);
}

/** Candidate keys are evidence-derived; no fixed action matrix is used. */
function observedScenarioKeys(profile: FeatureProfile, evidence: FeatureEvidence | undefined): string[] {
  if (!evidence) return [];
  const explicit = canonicalCoverageKeys([
    ...evidence.coverageKeys,
    ...(evidence.coverageManifest?.observedKeys ?? []),
  ]).filter((key) => key !== 'update.echo').filter((key) => !(key.startsWith('update.echo.')
    && !evidence.fields.some((field) => field.name === key.slice('update.echo.'.length) && field.defaultValue !== undefined))).filter((key) => !new Set(canonicalCoverageKeys([
    ...(evidence.coverageManifest?.needsReviewKeys ?? []),
    ...(evidence.coverageManifest?.missingKeys ?? []),
  ])).has(key));
  // A collector-provided coverage list is authoritative. Do not silently add
  // unrelated table/field-derived keys to a feature-bound evidence package;
  // derive supplemental keys only for legacy packages that have no explicit
  // observed coverage list.
  if (explicit.length > 0) {
    return unique([
      ...structuredObservedKeys(profile, evidence),
      ...explicit,
      ...(profile.actionKind === 'create' || profile.actionKind === 'update' ? fieldKeys(profile.actionKind, evidence) : []),
      ...(profile.actionKind === 'create' && evidence.states.includes('create') ? ['create.ready'] : []),
      ...(profile.actionKind === 'update' && evidence.states.includes('update') ? ['update.ready'] : []),
    ]);
  }
  const supplemental = [
    ...evidence.actionEntries
      .filter((entry) => entry.observed && !explicit.some((key) => key.startsWith(`${entry.actionKind}.`)))
      .map((entry) => `${entry.actionKind}.entry`),
    ...(profile.actionKind === 'create' && evidence.states.includes('create') ? ['create.ready'] : []),
    ...(profile.actionKind === 'update' && evidence.states.includes('update') ? ['update.ready'] : []),
    ...(profile.actionKind === 'detail' && evidence.states.includes('detail') ? ['detail.view'] : []),
    ...fieldKeys(profile.actionKind, evidence),
    ...(profile.actionKind === 'update'
      ? evidence.fields.filter((field) => field.defaultValue !== undefined).map((field) => `update.echo.${field.name}`)
      : []),
    ...(profile.actionKind === 'list' ? tableObservedKeys(evidence) : []),
  ];
  return unique([
    ...structuredObservedKeys(profile, evidence),
    ...explicit,
    ...supplemental,
  ]);
}

function invalidUpdateEchoKeys(evidence: FeatureEvidence | undefined): string[] {
  if (!evidence) return [];
  return canonicalCoverageKeys([
    ...evidence.coverageKeys,
    ...(evidence.coverageManifest?.observedKeys ?? []),
  ]).filter((key) => key.startsWith('update.echo.') && !evidence.fields.some((field) =>
    field.name === key.slice('update.echo.'.length) && field.defaultValue !== undefined));
}

/** 适配旧 collector key，避免同一结构化规则生成两条候选。 */
function canonicalCoverageKeys(keys: string[]): string[] {
  return keys.map((key) => key.startsWith('api.field.') ? `api.body.field.${key.slice('api.field.'.length)}` : key)
    .filter((key) => !/^api\.(get|post|put|patch|delete)\./.test(key));
}

function actionEntryObserved(kind: ActionKind, evidence: FeatureEvidence | undefined): boolean {
  return evidence?.coverageManifest?.observedKeys.includes(`${kind}.entry`) === true
    || !!evidence?.actionEntries.some((entry) => entry.actionKind === kind && entry.observed === true);
}

function isObserved(coverageKey: string, profile: FeatureProfile, evidence: FeatureEvidence | undefined): boolean {
  if (!evidence) return false;
  if (coverageKey === 'update.echo' || coverageKey.startsWith('update.echo.')) {
    const fieldName = coverageKey.slice('update.echo.'.length);
    return fieldName.length > 0 && evidence.fields.some((field) => field.name === fieldName && field.defaultValue !== undefined);
  }
  if (coverageKey === 'delete.entry') return actionEntryObserved('delete', evidence);
  if (coverageKey === 'batch_delete.entry') return actionEntryObserved('batch_delete', evidence);
  if (coverageKey === 'import.entry') return actionEntryObserved('import', evidence);
  if (coverageKey === 'export.entry') return actionEntryObserved('export', evidence);
  if (coverageKey.endsWith('.entry')) {
    return evidence.actionEntries.some((entry) => `${entry.actionKind}.entry` === coverageKey && entry.observed);
  }
  if (coverageKey === 'delete.confirm' || coverageKey === 'delete.cancel' || coverageKey === 'batch_delete.confirm' || coverageKey === 'batch_delete.cancel') {
    return evidence.coverageManifest?.observedKeys.includes(coverageKey) === true;
  }
  if (observedCoverageKeys(evidence).has(coverageKey)) return true;

  const source = sourceOf(profile, evidence);
  if (source === 'openapi') {
    const api = evidence.structuredDesign?.api;
    if (!api) return false;
    if (coverageKey === 'api.request') return true;
    if (coverageKey === 'api.body') return !!api.requestBody;
    if (coverageKey.startsWith('api.parameter.')) return api.parameters.some((parameter) => coverageKey === `api.parameter.${parameter.in}.${parameter.name}`);
    if (coverageKey.startsWith('api.body.field.')) return evidence.fields.some((field) => field.name === coverageKey.slice('api.body.field.'.length));
    if (coverageKey.startsWith('api.response.')) return api.responses.some((response) => coverageKey === `api.response.${response.status}`);
    if (coverageKey.startsWith('api.security.')) return api.security.some((security) => coverageKey === `api.security.${security}`);
    return false;
  }
  if (source === 'workflow') {
    const workflow = evidence.structuredDesign?.workflow;
    if (!workflow) return false;
    if (coverageKey.startsWith('workflow.transition.')) return workflow.transitions.some((transition) => coverageKey === `workflow.transition.${transition.id}`);
    if (coverageKey.startsWith('workflow.role.')) {
      const [, , transitionId, role] = coverageKey.split('.');
      return !!role && workflow.roles.includes(role) && workflow.transitions.some((transition) => transition.id === transitionId);
    }
    if (coverageKey.startsWith('workflow.precondition.') || coverageKey.startsWith('workflow.postcondition.')) {
      const [, kind, transitionId, indexText] = coverageKey.split('.');
      const conditions = workflow.transitions.find((transition) => transition.id === transitionId)?.[kind === 'precondition' ? 'preconditions' : 'postconditions'];
      return Number.isInteger(Number(indexText)) && !!conditions?.[Number(indexText)];
    }
    return false;
  }

  const table = evidence.tables[0];
  if (coverageKey === 'list.display') return !!table;
  if (coverageKey === 'list.headers') return !!table?.columns.length;
  if (coverageKey === 'list.empty') return table?.hasEmptyState === true;
  if (coverageKey === 'list.pagination') return table?.hasPagination === true;
  if (coverageKey === 'list.sort') return table?.hasSorting === true || !!table?.sortableColumns?.length;
  if (coverageKey.startsWith('list.column.')) return table?.columns.includes(coverageKey.slice('list.column.'.length)) === true;
  if (coverageKey.startsWith('list.sort.')) return table?.sortableColumns?.includes(coverageKey.slice('list.sort.'.length)) === true;

  const fields = evidence.fields;
  if (coverageKey.startsWith('query.field.')) return fields.some((field) => field.name === coverageKey.slice('query.field.'.length));
  if (coverageKey === 'query.clear' || coverageKey === 'query.empty') return fields.length > 0;
  if (coverageKey === 'query.combination') return fields.length > 1;
  if (coverageKey === 'query.date_range') return fields.some((field) => field.inputType === 'date' || field.inputType === 'datetime');
  if (coverageKey === 'query.fuzzy') return fields.some((field) => field.inputType === 'text' || !field.inputType);

  const state = profile.actionKind === 'create' ? 'create' : profile.actionKind === 'update' ? 'update' : 'detail';
  const stateObserved = evidence.states.includes(state);
  if (coverageKey === 'create.ready') return stateObserved;
  if (coverageKey === 'update.ready' || coverageKey === 'update.echo') return stateObserved;
  if (coverageKey === 'detail.view' || coverageKey === 'detail.back') return profile.actionKind === 'detail' && stateObserved;
  if (coverageKey === 'detail.readonly') return profile.actionKind === 'detail' && fields.some((field) => field.readonly);
  if (coverageKey === 'update.readonly') return stateObserved && fields.some((field) => field.readonly);
  if (coverageKey === 'create.required' || coverageKey === 'update.required') return stateObserved && fields.some((field) => field.required);
  if (coverageKey === 'create.format') return stateObserved && fields.some((field) => !!field.pattern);
  if (coverageKey === 'create.length') return stateObserved && fields.some((field) => field.minLength !== undefined || field.maxLength !== undefined);
  if (coverageKey === 'create.range') return stateObserved && fields.some((field) => field.minimum !== undefined || field.maximum !== undefined);
  if (coverageKey === 'create.enum') return stateObserved && fields.some((field) => !!field.options?.length);
  if (coverageKey === 'update.constraints') return stateObserved && fields.some((field) => !!field.pattern || field.minLength !== undefined || field.maxLength !== undefined || field.minimum !== undefined || field.maximum !== undefined || !!field.options?.length);
  if (coverageKey.startsWith('create.') || coverageKey.startsWith('update.')) {
    const fieldName = coverageKey.split('.').slice(2).join('.');
    return stateObserved && fields.some((field) => field.name === fieldName);
  }

  if (coverageKey === 'delete.entry') return actionEntryObserved('delete', evidence);
  if (coverageKey === 'batch_delete.entry') return actionEntryObserved('batch_delete', evidence);
  if (coverageKey === 'import.entry') return actionEntryObserved('import', evidence);
  if (coverageKey === 'import.file_type') return fields.some((field) => field.inputType === 'file');
  if (coverageKey === 'export.entry') return actionEntryObserved('export', evidence);
  if (coverageKey === 'workflow.entry') return actionEntryObserved('workflow', evidence);
  if (coverageKey === 'workflow.transition') return [...observedCoverageKeys(evidence)].some((key) => key.startsWith('workflow.transition.'));
  return false;
}

type RenderedScenario = Pick<ScenarioDraft, 'scenarioName' | 'priority' | 'operation' | 'expected'>;

function fieldForKey(coverageKey: string, evidence: FeatureEvidence | undefined): FeatureEvidence['fields'][number] | undefined {
  const parts = coverageKey.split('.');
  const fieldName = parts.length > 2 ? parts.slice(2).join('.') : '';
  return evidence?.fields.find((field) => field.name === fieldName);
}

function fieldConstraint(field: FeatureEvidence['fields'][number] | undefined): string {
  if (!field) return '页面已采集的字段约束';
  if (field.pattern) return `格式规则 ${field.pattern}`;
  if (field.minLength !== undefined || field.maxLength !== undefined) return `长度范围 ${field.minLength ?? '未采集'}-${field.maxLength ?? '未采集'}`;
  if (field.minimum !== undefined || field.maximum !== undefined) return `数值范围 ${field.minimum ?? '未采集'}-${field.maximum ?? '未采集'}`;
  if (field.options?.length) return `可选项 ${field.options.join('、')}`;
  return '页面已采集的字段约束';
}

function styleText(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, '【$1】');
}

function actionText(evidence: FeatureEvidence | undefined, kind: ActionKind, fallback: string): string {
  return evidence?.actionEntries.find((entry) => entry.actionKind === kind && entry.observed)?.text || fallback;
}

function reviewScenarioKeys(profile: FeatureProfile, evidence: FeatureEvidence | undefined, observedKeys: string[]): string[] {
  const reviewOnlyKeys = [
    ...(evidence?.actionEntries.filter((entry) => !entry.observed).map((entry) => `${entry.actionKind}.entry`) ?? []),
    ...(evidence?.containers.some((container) => container.kind === 'dialog')
      && (profile.actionKind === 'delete' || profile.actionKind === 'batch_delete')
      ? [`${profile.actionKind}.confirm`, `${profile.actionKind}.cancel`]
      : []),
    ...invalidUpdateEchoKeys(evidence),
    ...(evidence?.coverageManifest?.needsReviewKeys ?? []),
    ...(evidence?.coverageManifest?.missingKeys ?? []),
  ];
  return unique(reviewOnlyKeys.flatMap((key) => canonicalCoverageKeys([key]))).filter((key) => !observedKeys.includes(key));
}

function schemaConstraint(schema: { type?: string; format?: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; pattern?: string; enum?: string[] } | undefined): string {
  if (!schema) return '设计文档未声明额外约束';
  const parts = [
    schema.type ? `类型 ${schema.type}` : '', schema.format ? `格式 ${schema.format}` : '', schema.pattern ? `格式规则 ${schema.pattern}` : '',
    schema.minLength !== undefined || schema.maxLength !== undefined ? `长度 ${schema.minLength ?? '未声明'}-${schema.maxLength ?? '未声明'}` : '',
    schema.minimum !== undefined || schema.maximum !== undefined ? `范围 ${schema.minimum ?? '未声明'}-${schema.maximum ?? '未声明'}` : '',
    schema.enum?.length ? `枚举 ${schema.enum.join('、')}` : '',
  ].filter(Boolean);
  return parts.join('；') || '设计文档未声明额外约束';
}

/** Pure coverage-key renderer: produces visible, executable text without changing candidate metadata. */
function renderScenarioText(coverageKey: string, ctx: ActionScenarioContext, evidence: FeatureEvidence | undefined): RenderedScenario {
  const page = `进入[${ctx.subModule}]的[${ctx.testPoint}]页面`;
  const field = fieldForKey(coverageKey, evidence);
  const fieldName = field?.name ?? '页面字段';
  const listColumn = coverageKey.startsWith('list.column.') ? coverageKey.slice('list.column.'.length) : '';
  const sortColumn = coverageKey.startsWith('list.sort.') ? coverageKey.slice('list.sort.'.length) : '';
  const simple = (scenarioName: string, action: string, observation: string, priority: ScenarioCandidate['priority'] = 'P1'): RenderedScenario => ({
    scenarioName,
    priority,
    operation: styleText(`1. ${page}\n2. ${action}`),
    expected: styleText(observation),
  });

  const api = evidence?.structuredDesign?.api;
  if (api && coverageKey === 'api.request') return simple('接口正常请求', `按 OpenAPI 调用 [${api.method} ${api.path}]，使用设计文档允许的请求数据，不增加页面表单步骤`, `接口按 ${api.method} ${api.path} 的设计处理请求并返回已声明响应。`, 'P0');
  if (api && coverageKey.startsWith('api.parameter.')) {
    const [, , parameterIn, ...nameParts] = coverageKey.split('.');
    const name = nameParts.join('.');
    const parameter = api.parameters.find((item) => item.in === parameterIn && item.name === name);
    return simple(`接口参数-${name}`, `在 ${parameterIn} 位置提供参数 [${name}]${parameter?.description ? `（${parameter.description}）` : ''}，分别验证必填与 ${schemaConstraint(parameter?.schema)} 的边界输入`, `${parameterIn} 参数 [${name}] 的必填要求为 ${parameter?.required ? '是' : '否'}，并按 ${schemaConstraint(parameter?.schema)} 校验。`);
  }
  if (api && coverageKey === 'api.body') return simple('接口请求体', `按 ${api.requestBody?.contentType ?? '声明的内容类型'} 构造请求体${api.requestBody?.description ? `（${api.requestBody.description}）` : ''}，覆盖必填属性 ${api.requestBody?.schema?.required?.map((name) => `[${name}]`).join('、') || '（未声明）'}`, `请求体结构符合 ${schemaConstraint(api.requestBody?.schema)}，服务端按设计文档校验。`);
  if (api && coverageKey.startsWith('api.body.field.')) {
    const name = coverageKey.slice('api.body.field.'.length);
    const bodyField = evidence?.fields.find((item) => item.name === name);
    return simple(`请求体字段-${name}`, `在请求体中设置 [${name}]，验证 ${fieldConstraint(bodyField)} 对应的边界或非法输入`, `请求体字段 [${name}] 按 ${fieldConstraint(bodyField)} 得到明确校验结果。`);
  }
  if (api && coverageKey.startsWith('api.response.')) {
    const status = coverageKey.slice('api.response.'.length);
    const response = api.responses.find((item) => item.status === status);
    return simple(`接口响应-${status}`, `调用 [${api.method} ${api.path}] 并检查响应码 ${status}、描述和响应体结构`, `返回 ${status}${response?.description ? `（${response.description}）` : ''}，响应结构包含 ${response?.schema?.properties?.map((name) => `[${name}]`).join('、') || '设计文档声明的字段'}。`);
  }
  if (api && coverageKey.startsWith('api.security.')) {
    const security = coverageKey.slice('api.security.'.length);
    return simple('接口鉴权', `使用与缺失 [${security}] 鉴权凭据分别调用 [${api.method} ${api.path}]`, `接口按 ${security} 鉴权方案处理已授权和未授权请求。`);
  }
  if (api && (coverageKey === 'api.idempotency' || coverageKey === 'api.rate_limit' || coverageKey === 'api.concurrency')) return simple(`接口-${coverageKey.slice('api.'.length)}`, `核对 [${api.method} ${api.path}] 的 ${coverageKey.slice('api.'.length)} 规则说明，不臆测未声明的行为`, '设计源未提供该规则，保留待复核并记录补充依据。');

  const workflow = evidence?.structuredDesign?.workflow;
  const transitionId = coverageKey.split('.')[2];
  const transition = workflow?.transitions.find((item) => item.id === transitionId);
  if (workflow && coverageKey.startsWith('workflow.transition.') && transition) return simple(`流程转换-${transition.action}`, `由 [${transition.from}] 状态执行 [${transition.action}]，不实际提交状态变更，核对目标状态 [${transition.to}]`, `转换 [${transition.action}] 的来源状态为 [${transition.from}]，目标状态为 [${transition.to}]。`, 'P0');
  if (workflow && coverageKey.startsWith('workflow.role.') && transition) {
    const role = coverageKey.split('.')[3];
    const allowed = transition.actorRoles.includes(role);
    return simple(`流程角色-${role}`, `以 [${role}] 角色在 [${transition.from}] 状态查看 [${transition.action}] 入口`, allowed ? `[${role}] 属于允许角色，可执行 [${transition.action}] 并迁移到 [${transition.to}]。` : `[${role}] 不属于允许角色，系统应拒绝 [${transition.action}]，状态保持 [${transition.from}]。`);
  }
  if (workflow && coverageKey.startsWith('workflow.precondition.') && transition) {
    const index = Number(coverageKey.split('.')[3]);
    const condition = transition.preconditions[index];
    return simple('流程前置条件', `在 [${transition.from}] 状态核对执行 [${transition.action}] 前置条件：${condition ?? '未声明'}`, `仅满足“${condition ?? '未声明'}”时允许执行 [${transition.action}]。`);
  }
  if (workflow && coverageKey.startsWith('workflow.postcondition.') && transition) {
    const index = Number(coverageKey.split('.')[3]);
    const condition = transition.postconditions[index];
    return simple('流程后置条件', `查看 [${transition.action}] 从 [${transition.from}] 到 [${transition.to}] 后的后置条件：${condition ?? '未声明'}`, `转换完成后满足“${condition ?? '未声明'}”，状态为 [${transition.to}]。`);
  }

  if (coverageKey === 'list.display') return simple('列表默认展示', '查看列表区域的默认数据、加载状态和提示信息', '列表区域可读取，页面无异常。', 'P0');
  if (coverageKey === 'list.headers') return simple('列表表头展示', '查看表格表头及列标题', '表头结构清晰，列标题与页面展示一致。');
  if (coverageKey === 'list.empty') return simple('列表空态展示', '在无数据或空查询结果条件下查看列表空态', '列表展示明确的空态提示，不显示错误内容。');
  if (coverageKey === 'list.pagination') return simple('列表分页', '查看分页控件并切换到相邻页（不修改数据）', '分页控件可用，列表按页展示数据。');
  if (coverageKey === 'list.page_size') return simple('列表页大小', '查看分页区域提供的每页条数选择控件', '页大小控件的可选范围和当前选择状态可读取。');
  if (coverageKey === 'list.page_jump') return simple('列表跳页', '查看分页区域的页码跳转控件及输入限制', '跳页控件存在，页码校验提示清晰。');
  if (coverageKey === 'list.sort') return simple('列表排序', '查看可排序列表头并触发只读排序展示', '排序状态和排序结果在列表头或列表内容中可观察。');
  if (coverageKey === 'list.selection') return simple('列表选择', '查看列表行选择控件及已选数量提示，不执行批量操作', '选择控件状态和批量操作前置条件清晰可见。');
  if (coverageKey === 'list.large_data') return simple('列表大数据量', '查看列表在较多数据或虚拟滚动状态下的加载与定位提示', '列表加载状态可观察，页面保持可用。');
  if (coverageKey === 'list.refresh') return simple('列表刷新', '查看列表刷新入口及刷新前后的加载提示，不提交业务数据', '刷新过程和结果提示清晰，列表结构保持完整。');
  if (coverageKey === 'list.permission') return simple('列表访问权限', '以无列表访问权限的角色进入页面', '系统限制访问或展示明确的权限提示。');
  if (listColumn) return simple(`列表列展示-${listColumn}`, `查看表格列 [${listColumn}] 的列标题和单元格内容`, `列表展示 [${listColumn}] 列，内容可读取。`);
  if (sortColumn) return simple(`列表列排序-${sortColumn}`, `查看 [${sortColumn}] 列的排序控件并触发排序展示`, `[${sortColumn}] 列的排序状态和结果可观察。`);
  if (coverageKey.startsWith('list.search.')) {
    const searchField = coverageKey.slice('list.search.'.length);
    return simple(`列表筛选-${searchField}`, `在 [${searchField}] 筛选控件输入页面允许的查询条件并查看列表`, `[${searchField}] 筛选条件被应用，列表结果可读取。`);
  }

  if (coverageKey.startsWith('query.field.')) return simple(`查询条件-${coverageKey.slice('query.field.'.length)}`, `在 [${coverageKey.slice('query.field.'.length)}] 输入页面允许的有效查询条件并执行查询`, '查询结果与该查询条件匹配。');
  if (coverageKey === 'query.clear') {
    const queryField = evidence?.fields[0]?.name;
    const clearControl = actionText(evidence, 'query', '清空');
    return simple('清空查询条件', `清空${queryField ? `[${queryField}]查询条件` : '查询条件'}并点击[${clearControl}]控件执行查询`, '查询条件被清空，列表恢复默认展示。');
  }
  if (coverageKey === 'query.empty') return simple('查询无结果', '输入页面允许但无匹配结果的查询条件并执行查询', '系统展示明确的无结果状态。');
  if (coverageKey === 'query.combination') return simple('组合查询', '填写两个已采集查询字段并执行查询', '查询结果同时满足已填写条件。');
  if (coverageKey === 'query.date_range') return simple('日期范围查询', '使用页面已采集的日期控件设置合法日期范围并执行查询', '日期范围条件被正确应用到查询结果。');
  if (coverageKey === 'query.fuzzy') return simple('模糊查询', '在文本查询控件输入部分关键字并执行查询', '系统按页面支持的模糊匹配规则展示结果。');
  if (coverageKey === 'query.performance') return simple('查询性能', '执行页面允许的查询并观察加载状态和结果返回', '查询过程有明确反馈，页面不异常。');
  if (coverageKey === 'query.permission') return simple('查询权限', '以无查询权限角色执行查询', '系统限制查询或展示明确权限提示。');

  if (coverageKey === 'create.ready') return simple('新增表单准备', '打开新增视图并查看表单字段和操作控件', '新增表单结构可读取，字段状态符合页面定义。', 'P0');
  if (coverageKey === 'update.ready') return simple('修改表单准备', '在安全样例条件下打开修改视图并查看表单字段', '修改表单结构可读取，未执行保存。', 'P0');
  if (coverageKey === 'update.echo') return simple('修改数据回显', '打开修改视图并查看已采集字段的回显值', `[${ctx.testPoint}] 字段回显与当前记录展示一致。`, 'P0');
  if (coverageKey.startsWith('update.echo.')) {
    const echoField = coverageKey.slice('update.echo.'.length);
    const value = fieldForKey(coverageKey, evidence)?.defaultValue ?? '未采集';
    return simple(`修改回显-${echoField}`, `打开修改视图并核对[${echoField}]的回显值[${value}]`, `[${echoField}]回显值为[${value}]，与当前记录展示一致。`, 'P0');
  }
  if (coverageKey === 'update.no_safe_sample') return simple('修改安全样例前置', '确认是否存在只读安全样例及独立修改入口，不点击任意行内操作', '缺少安全样例时保留待复核原因，不执行修改。');
  if (coverageKey === 'create.cancel' || coverageKey === 'update.cancel') return simple(`${coverageKey.startsWith('create') ? '新增' : '修改'}取消`, '打开表单后使用取消或关闭控件，不执行保存', '表单关闭后不产生业务数据变更。');
  if (coverageKey === 'create.uniqueness') return simple('新增唯一性', '使用页面已采集字段准备可能重复的输入条件，不提交数据', '系统对重复数据的规则或提示可观察。');
  if (coverageKey === 'create.permission' || coverageKey === 'update.permission') return simple('表单操作权限', '以无操作权限角色查看对应表单入口', '系统限制操作或展示明确权限提示。');
  if (coverageKey === 'create.server_rule') return simple('服务端规则', '查看表单提交前可见的规则提示和校验信息，不执行提交', '已采集的服务端或业务规则提示可追溯。');
  if (coverageKey === 'update.concurrency') return simple('修改并发控制', '查看页面展示的版本、锁定或并发提示信息，不提交修改', '并发控制条件或待复核原因清晰可见。');
  if (coverageKey === 'update.constraints') return simple('修改字段约束', '查看修改表单中已采集字段的格式、范围或枚举约束', '字段约束与页面采集结果一致。');
  if (coverageKey === 'update.readonly') return simple('修改只读字段', '查看修改表单中不可编辑字段的控件状态', '只读字段不可编辑或有明确提示。');
  if (coverageKey === 'create.required' || coverageKey === 'update.required') {
    const kind = coverageKey.startsWith('create') ? 'create' : 'update';
    const submit = actionText(evidence, kind, '保存');
    return simple('表单必填校验', `保持[${fieldName}]为空并点击[${submit}]控件提交`, '必填字段展示明确校验提示。');
  }
  if (coverageKey === 'create.format') return simple('表单格式校验', '对页面带格式约束的字段输入不符合约束的值', '字段展示格式校验提示。');
  if (coverageKey === 'create.length') return simple('表单长度校验', '对页面带长度约束的字段输入边界长度值', '字段长度限制按页面定义生效。');
  if (coverageKey === 'create.range') return simple('表单数值范围', '对页面带数值范围的字段输入边界值', '字段数值范围按页面定义生效。');
  if (coverageKey === 'create.enum') return simple('表单枚举选项', '查看枚举字段的已采集可选项', '枚举字段仅展示页面定义的可选项。');
  if (coverageKey.startsWith('create.') || coverageKey.startsWith('update.')) {
    const [kind, rule] = coverageKey.split('.');
    const action = kind === 'create' ? '新增' : '修改';
    if (rule === 'required') {
      const submit = actionText(evidence, kind === 'create' ? 'create' : 'update', '保存');
      return simple(`${action}必填-${fieldName}`, `保持[${fieldName}]为空并点击[${submit}]控件提交`, `[${fieldName}] 展示必填校验提示。`, 'P0');
    }
    if (rule === 'pattern') return simple(`${action}格式-${fieldName}`, `在 [${fieldName}] 输入不符合 ${fieldConstraint(field)} 的值并查看校验提示`, `[${fieldName}] 按 ${fieldConstraint(field)} 展示校验提示。`);
    if (rule === 'length' || rule === 'range') return simple(`${action}${rule === 'length' ? '长度' : '范围'}-${fieldName}`, `在 [${fieldName}] 输入 ${fieldConstraint(field)} 的边界值并查看校验提示`, `[${fieldName}] 的 ${fieldConstraint(field)} 生效。`);
    if (rule === 'enum') return simple(`${action}枚举-${fieldName}`, `查看 [${fieldName}] 的 ${fieldConstraint(field)}`, `[${fieldName}] 仅展示已采集的可选项。`);
    if (rule === 'readonly') return simple(`修改只读-${fieldName}`, `查看 [${fieldName}] 的只读或禁用状态`, `[${fieldName}] 不允许编辑或有明确说明。`);
  }

  if (coverageKey === 'delete.entry' || coverageKey === 'batch_delete.entry') return simple(coverageKey.startsWith('batch') ? '批量删除入口' : '删除入口', '查看删除入口、影响范围和风险提示，不执行删除', '删除入口和风险提示可读取。', 'P0');
  if (coverageKey.endsWith('.confirm') && (coverageKey.startsWith('delete') || coverageKey.startsWith('batch_delete'))) return simple('删除确认提示', '在不执行删除的前提下，查看删除确认弹窗和确认控件', '确认弹窗展示影响范围，且本次不执行确认。');
  if (coverageKey.endsWith('.cancel') && (coverageKey.startsWith('delete') || coverageKey.startsWith('batch_delete'))) return simple('删除取消', '在不执行删除的前提下，查看删除确认弹窗的取消控件', '取消控件可见，取消后不产生数据变更。');
  if (coverageKey.includes('.relation')) return simple('删除关联限制', '查看删除前的关联数据提示或限制说明，不执行删除', '关联限制和待复核条件清晰可见。');
  if (coverageKey.includes('.soft_delete')) return simple('删除保留策略', '查看页面或结构化证据中的软删除/保留说明，不执行删除', '删除后的保留策略或待复核原因可追溯。');
  if (coverageKey.endsWith('.permission') && (coverageKey.startsWith('delete') || coverageKey.startsWith('batch_delete'))) return simple('删除权限', '以无删除权限角色查看删除入口', '系统限制删除操作或展示明确权限提示。');

  if (coverageKey.endsWith('.entry')) {
    const kind = coverageKey.slice(0, -'.entry'.length);
    const entry = evidence?.actionEntries.find((item) => item.observed && item.actionKind === kind)?.text;
    if (entry) return simple(`${entry}入口`, `查看[${entry}]入口及其影响范围，不执行写入操作`, `[${entry}]入口可见，操作范围与当前功能证据一致。`, 'P0');
  }

  if (coverageKey === 'detail.view') return simple('详情展示', '打开只读详情视图并查看字段展示', '详情字段和页面展示一致。', 'P0');
  if (coverageKey === 'detail.readonly') return simple('详情只读', '查看详情视图字段的只读状态', '详情字段不可编辑或有明确只读提示。');
  if (coverageKey === 'detail.back') return simple('详情返回', '关闭详情视图或返回列表页面', '返回后列表页面结构保持完整。');
  if (coverageKey === 'detail.related') return simple('详情关联信息', '查看详情中的关联区域或页签，不修改关联数据', '关联信息结构可读取或保留待复核原因。');
  if (coverageKey === 'detail.permission') return simple('详情权限', '以无详情权限角色进入详情入口', '系统限制访问或展示明确权限提示。');
  if (coverageKey === 'detail.missing_data') return simple('详情缺失数据', '查看缺失或空字段在详情中的展示方式', '页面展示明确的缺失数据提示。');

  if (coverageKey.startsWith('import.')) return simple(`导入-${coverageKey.slice('import.'.length)}`, '查看导入入口、文件说明或校验提示，不上传文件', '导入限制、模板或待复核原因清晰可见。', coverageKey === 'import.entry' ? 'P0' : 'P1');
  if (coverageKey.startsWith('export.')) return simple(`导出-${coverageKey.slice('export.'.length)}`, '查看导出入口、格式或范围说明，不执行导出', '导出格式、范围或待复核原因清晰可见。', coverageKey === 'export.entry' ? 'P0' : 'P1');
  if (coverageKey === 'auth.allow' || coverageKey === 'permission.allow') return simple('角色许可', '以已授权角色查看操作入口和可见范围', '授权角色可见的操作范围与页面证据一致。');
  if (coverageKey === 'auth.deny' || coverageKey === 'permission.deny') return simple('角色拒绝', '以无权限角色访问对应入口', '系统拒绝访问或展示明确权限提示。');
  if (coverageKey === 'workflow.entry') return simple('流程入口', '查看流程状态和可执行转换入口，不执行状态变更', '流程入口和当前状态可读取。', 'P0');
  if (coverageKey === 'workflow.transition') return simple('流程状态转换', '查看流程转换入口及前后置条件说明，不执行转换', '转换条件和结果可追溯。');
  if (coverageKey.startsWith('workflow.transition.')) return simple(`流程转换-${coverageKey.slice('workflow.transition.'.length)}`, `查看状态转换 [${coverageKey.slice('workflow.transition.'.length)}] 的角色、前后置条件和入口`, `状态转换 ${coverageKey.slice('workflow.transition.'.length)} 的状态条件可追溯。`);
  if (coverageKey.startsWith('workflow.role.')) return simple(`流程角色-${coverageKey.slice('workflow.role.'.length)}`, `查看角色 [${coverageKey.slice('workflow.role.'.length)}] 对流程操作的许可范围`, '角色许可或拒绝规则可追溯。');
  if (coverageKey.startsWith('workflow.precondition.') || coverageKey.startsWith('workflow.postcondition.')) return simple('流程前后置条件', `查看流程转换的${coverageKey.includes('.precondition.') ? '前置' : '后置'}条件证据`, '流程条件与结构化工作流证据一致。');

  if (coverageKey.startsWith('api.response.')) return simple(`接口响应-${coverageKey.slice('api.response.'.length)}`, `查看结构化 API 证据中的响应码 ${coverageKey.slice('api.response.'.length)} 和响应结构`, `接口响应码 ${coverageKey.slice('api.response.'.length)} 的响应结构可追溯。`);
  if (coverageKey.startsWith('api.security.')) return simple('接口鉴权', `查看结构化 API 证据中的鉴权方案 ${coverageKey.slice('api.security.'.length)}`, '鉴权要求和无权限响应规则可追溯。');
  if (coverageKey.startsWith('api.field.')) return simple('接口参数约束', `查看接口参数 [${coverageKey.slice('api.field.'.length)}] 的结构化约束`, '参数约束与 API 设计证据一致。');
  return simple('结构化证据覆盖', `查看 [${ctx.testPoint}] 的结构化设计证据（${coverageKey}）及关联对象`, `该结构化证据与 [${ctx.testPoint}] 的观察点可追溯。`);
}

function draftFor(coverageKey: string, profile: FeatureProfile, evidence: FeatureEvidence | undefined, ctx: ActionScenarioContext): ScenarioDraft {
  const observed = isObserved(coverageKey, profile, evidence);
  const dialogReview = (coverageKey === 'delete.confirm' || coverageKey === 'delete.cancel')
    && evidence?.containers.some((container) => container.kind === 'dialog')
    && !observed;
  const updateEchoReview = coverageKey.startsWith('update.echo.')
    && !isObserved(coverageKey, profile, evidence);
  const reason = dialogReview
    ? `已观察到删除弹窗，但未观察到${coverageKey.endsWith('.confirm') ? '确认' : '取消'}控件`
    : updateEchoReview
      ? `未观察到字段【${coverageKey.slice('update.echo.'.length)}】的具体回显值`
    : reviewReason(evidence, `未观察到 ${coverageKey} 所需的安全页面或设计证据`);
  return {
    coverageKey,
    ...renderScenarioText(coverageKey, ctx, evidence),
    observed,
    reason,
  };
}

/** 根据独立 required matrix 和同 featureId 证据生成确定性候选。
 * 契约修正（feature-driven §5.2 / §5.3）：一个功能点只有一个用例编号 = featureId，
 * 所有场景作为同一 caseNo 下的连续 Step 1..N；scenarioId/coverageKey 仅作隐藏身份，不进入 caseNo。 */
export function generateActionScenarios(
  profile: FeatureProfile,
  evidence: FeatureEvidence | undefined,
  ctx: ActionScenarioContext,
): ScenarioCandidate[] {
  const observedKeys = observedScenarioKeys(profile, evidence);
  const reviewKeys = reviewScenarioKeys(profile, evidence, observedKeys);
  return [...observedKeys, ...reviewKeys].map((coverageKey, index) => {
    const draft = draftFor(coverageKey, profile, evidence, ctx);
    const needsReview = !draft.observed;
    const stepIndex = index + 1;
    return {
      scenarioId: `${profile.featureId}__${coverageKey}`,
      featureId: profile.featureId,
      actionKind: profile.actionKind,
      scenarioName: draft.scenarioName,
      coverageKey,
      priority: draft.priority,
      caseNo: profile.featureId,
      step: `Step ${stepIndex}`,
      operation: draft.operation,
      expected: draft.expected,
      evidenceLevel: draft.observed ? 'observed' : 'needs_review',
      needsReview,
      ...(needsReview ? { reviewReason: draft.reason } : {}),
    };
  });
}

/** Build a manifest from the same observed evidence keys used for visible candidates. */
export function buildCoverageManifest(
  profile: FeatureProfile,
  evidence: FeatureEvidence | undefined,
  _ctx: ActionScenarioContext,
): CoverageManifest {
  const observedKeys = observedScenarioKeys(profile, evidence);
  const reviewKeys = reviewScenarioKeys(profile, evidence, observedKeys);
  const requiredKeys = unique([...observedKeys, ...reviewKeys]);
  return { actionKind: profile.actionKind, requiredKeys, observedKeys, needsReviewKeys: reviewKeys, missingKeys: reviewKeys };
}
