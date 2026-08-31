import { parse as parseYaml } from 'yaml';
import SwaggerParser from '@apidevtools/swagger-parser';
import { z } from 'zod';
import type { ActionKind, ApiParameterDetail, ApiResponseDetail, DesignSource, FeatureEvidence, FieldSemantic, ModuleNode, SchemaSummary } from '@test-platform/contracts';

const workflowSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), entities: z.array(z.string()), roles: z.array(z.string()), states: z.array(z.string()),
  transitions: z.array(z.object({ id: z.string().min(1), action: z.string().min(1), from: z.string().min(1), to: z.string().min(1), actorRoles: z.array(z.string()), preconditions: z.array(z.string()), postconditions: z.array(z.string()) })),
});

export interface AdaptedDesignSources { nodes: ModuleNode[]; evidenceBySelector: Record<string, FeatureEvidence>; designSourceNames: string[]; }

function node(id: string, label: string, type: ModuleNode['type'], depth: number, children: ModuleNode[] = []): ModuleNode {
  return { id, label, parentId: null, subsystemId: 'design', type, status: 'covered', children, depth };
}

type JsonObject = Record<string, unknown>;
type ParserDocument = Awaited<ReturnType<typeof SwaggerParser.dereference>>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === 'string');
}

function hasExternalRef(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const current = object(value);
  if (typeof current.$ref === 'string' && !current.$ref.startsWith('#')) return true;
  return Object.values(current).some((child) => hasExternalRef(child, seen));
}

/** Parser 已负责 `$ref` 解引用；这里仅将 allOf/oneOf 的已解析结构展平为字段证据。 */
function fields(schema: unknown): FieldSemantic[] {
  const output = new Map<string, FieldSemantic>();
  const visit = (value: unknown, optionalBranch = false): void => {
    const current = object(value);
    const required = new Set(strings(current.required));
    const properties = object(current.properties);
    for (const [name, property] of Object.entries(properties)) {
      const definition = object(property);
      const previous = output.get(name);
      output.set(name, {
        ref: previous?.ref ?? `field_${output.size}`,
        selector: `[name="${name}"]`,
        name,
        inputType: typeof definition.type === 'string' ? definition.type : undefined,
        required: previous?.required || (!optionalBranch && required.has(name)),
        minLength: typeof definition.minLength === 'number' ? definition.minLength : undefined,
        maxLength: typeof definition.maxLength === 'number' ? definition.maxLength : undefined,
        minimum: typeof definition.minimum === 'number' ? definition.minimum : undefined,
        maximum: typeof definition.maximum === 'number' ? definition.maximum : undefined,
        pattern: typeof definition.pattern === 'string' ? definition.pattern : undefined,
        options: strings(definition.enum),
      });
    }
    for (const part of array(current.allOf)) visit(part, optionalBranch);
    // oneOf 的分支不是同时必填；保留各分支字段但不把它们提升为必填约束。
    for (const part of array(current.oneOf)) visit(part, true);
  };
  visit(schema);
  return [...output.values()];
}

/** 只保留用例生成需要的 schema 属性，避免把原始设计文档塞入 artifact。 */
function schemaSummary(schema: unknown): SchemaSummary | undefined {
  const current = object(schema);
  if (Object.keys(current).length === 0) return undefined;
  const properties = new Set<string>();
  const required = new Set<string>();
  const visit = (value: unknown): void => {
    const part = object(value);
    for (const name of Object.keys(object(part.properties))) properties.add(name);
    for (const name of strings(part.required)) required.add(name);
    for (const child of [...array(part.allOf), ...array(part.oneOf)]) visit(child);
  };
  visit(current);
  return {
    ...(typeof current.type === 'string' ? { type: current.type } : {}),
    ...(typeof current.format === 'string' ? { format: current.format } : {}),
    ...(required.size ? { required: [...required] } : {}),
    ...(properties.size ? { properties: [...properties] } : {}),
    ...(typeof current.minLength === 'number' ? { minLength: current.minLength } : {}),
    ...(typeof current.maxLength === 'number' ? { maxLength: current.maxLength } : {}),
    ...(typeof current.minimum === 'number' ? { minimum: current.minimum } : {}),
    ...(typeof current.maximum === 'number' ? { maximum: current.maximum } : {}),
    ...(typeof current.pattern === 'string' ? { pattern: current.pattern } : {}),
    ...(strings(current.enum).length ? { enum: strings(current.enum) } : {}),
  };
}

function parameterDetail(parameter: JsonObject, parameterIndex: number): ApiParameterDetail {
  const parameterIn = typeof parameter.in === 'string' ? parameter.in : 'query';
  const name = typeof parameter.name === 'string' ? parameter.name : `param_${parameterIndex}`;
  const directSchema = object(parameter.schema);
  const rawSchema = Object.keys(directSchema).length ? directSchema : {
    type: parameter.type, format: parameter.format, minLength: parameter.minLength, maxLength: parameter.maxLength,
    minimum: parameter.minimum, maximum: parameter.maximum, pattern: parameter.pattern, enum: parameter.enum,
  };
  return {
    name,
    in: ['path', 'query', 'header', 'cookie', 'body', 'formData'].includes(parameterIn) ? parameterIn as ApiParameterDetail['in'] : 'query',
    required: parameter.required === true || parameterIn === 'path',
    ...(typeof parameter.description === 'string' ? { description: parameter.description } : {}),
    ...(schemaSummary(rawSchema) ? { schema: schemaSummary(rawSchema) } : {}),
  };
}

/** OpenAPI / Swagger: operation 参数按 (in,name) 覆盖 path 参数。 */
function mergedParameters(pathItem: JsonObject, operation: JsonObject): JsonObject[] {
  const result = new Map<string, JsonObject>();
  for (const parameter of [...array(pathItem.parameters), ...array(operation.parameters)].map(object)) {
    const parameterIn = typeof parameter.in === 'string' ? parameter.in : 'query';
    const name = typeof parameter.name === 'string' ? parameter.name : '';
    result.set(`${parameterIn}:${name}`, parameter);
  }
  return [...result.values()];
}

function methodKind(method: string, path: string): ActionKind {
  if (method === 'get') return path.includes('{') ? 'detail' : 'list';
  if (method === 'post') return 'create';
  if (method === 'put' || method === 'patch') return 'update';
  if (method === 'delete') return 'delete';
  return 'other';
}

async function openApiSource(source: DesignSource, sourceIndex: number): Promise<AdaptedDesignSources> {
  const parsed = source.name?.match(/\.ya?ml$/i) ? parseYaml(source.content) : JSON.parse(source.content);
  const rawDocument = object(parsed);
  if (Object.keys(object(rawDocument.paths)).length === 0) throw new Error('OpenAPI/Swagger 缺少 paths');
  // 输入已限定为内存对象；禁用外部解析，避免用户上传的 $ref 触发网络或文件访问。
  const dereferenced = await SwaggerParser.dereference(rawDocument as ParserDocument, { resolve: { external: false } });
  if (hasExternalRef(dereferenced)) throw new Error('检测到外部 $ref，安全策略禁止解析网络或本地文件引用');
  const document = object(dereferenced);
  const paths = object(document.paths);
  if (Object.keys(paths).length === 0) throw new Error('OpenAPI/Swagger 缺少 paths');
  const actionNodes: ModuleNode[] = [];
  const evidenceBySelector: Record<string, FeatureEvidence> = {};
  let index = 0;
  for (const [path, pathValue] of Object.entries(paths)) {
    const pathItem = object(pathValue);
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = object(pathItem[method]);
      if (Object.keys(operation).length === 0) continue;
      const selector = `design:openapi:${sourceIndex}:${method}:${path}`;
      const kind = methodKind(method, path);
      const parameters = mergedParameters(pathItem, operation);
      const requestBody = object(operation.requestBody);
      const requestContent = object(requestBody.content);
      const contentType = Object.keys(requestContent)[0];
      const requestSchema = object(object(requestContent[contentType ?? 'application/json']).schema);
      const swaggerBody = parameters.find((parameter) => parameter.in === 'body');
      const bodySchema = Object.keys(requestSchema).length ? requestSchema : object(swaggerBody?.schema);
      const hasRequestBody = Object.keys(requestBody).length > 0 || !!swaggerBody;
      const parameterFields = parameters.flatMap((parameter, parameterIndex) => {
        if (parameter.in === 'body') return fields(parameter.schema);
        const schema = object(parameter.schema);
        const name = typeof parameter.name === 'string' ? parameter.name : `param_${parameterIndex}`;
        return [{
          ref: `param_${parameterIndex}`,
          selector: name,
          name,
          inputType: typeof schema.type === 'string' ? schema.type : typeof parameter.type === 'string' ? parameter.type : undefined,
          required: parameter.required === true,
          minimum: typeof schema.minimum === 'number' ? schema.minimum : typeof parameter.minimum === 'number' ? parameter.minimum : undefined,
          maximum: typeof schema.maximum === 'number' ? schema.maximum : typeof parameter.maximum === 'number' ? parameter.maximum : undefined,
          pattern: typeof schema.pattern === 'string' ? schema.pattern : typeof parameter.pattern === 'string' ? parameter.pattern : undefined,
          options: strings(schema.enum ?? parameter.enum),
        }];
      });
      const bodyFields = fields(bodySchema);
      const apiFields = [...parameterFields, ...bodyFields];
      const apiParameters = parameters.filter((parameter) => parameter.in !== 'body').map(parameterDetail);
      const responses = Object.entries(object(operation.responses)).map(([status, value]): ApiResponseDetail => {
        const response = object(value);
        const responseContent = object(response.content);
        const responseType = Object.keys(responseContent)[0];
        const responseSchema = Object.keys(object(response.schema)).length
          ? response.schema
          : object(responseContent[responseType ?? 'application/json']).schema;
        return { status, description: typeof response.description === 'string' ? response.description : '', ...(schemaSummary(responseSchema) ? { schema: schemaSummary(responseSchema) } : {}) };
      });
      const responseKeys = responses.map(({ status }) => `api.response.${status}`);
      // `security: []` 是明确覆盖全局安全要求，不能因数组为空退回 document.security。
      const security = Object.prototype.hasOwnProperty.call(operation, 'security') ? array(operation.security) : array(document.security);
      const securityKeys = security.flatMap((requirement) => Object.keys(object(requirement)).map((name) => `api.security.${name}`));
      evidenceBySelector[selector] = {
        featureId: '', actionKind: kind, states: ['base'], fields: apiFields, tables: [], actionEntries: [{ actionKind: kind, ref: `op_${index}`, selector, text: `${method.toUpperCase()} ${path}`, triggerable: false, observed: true }], containers: [], evidenceLevel: 'observed',
        coverageKeys: [`api.request`, ...apiParameters.map((parameter) => `api.parameter.${parameter.in}.${parameter.name}`), ...(hasRequestBody ? ['api.body', ...bodyFields.map((field) => `api.body.field.${field.name}`)] : []), ...responseKeys, ...securityKeys], needsReview: false, uncovered: [],
        structuredDesign: { source: 'openapi', api: { method: method.toUpperCase(), path, parameters: apiParameters, ...(hasRequestBody ? { requestBody: { required: requestBody.required === true || swaggerBody?.required === true, ...(contentType ? { contentType } : {}), ...(typeof requestBody.description === 'string' ? { description: requestBody.description } : typeof swaggerBody?.description === 'string' ? { description: swaggerBody.description } : {}), ...(schemaSummary(bodySchema) ? { schema: schemaSummary(bodySchema) } : {}) } } : {}), responses, security: uniqueStrings(securityKeys.map((key) => key.slice('api.security.'.length))) } },
      };
      actionNodes.push({ ...node(`api_action_${sourceIndex}_${index++}`, `${method.toUpperCase()} ${path}`, 'action', 3), actionKind: kind, actionText: `${method.toUpperCase()} ${path}`, actionSelector: selector });
    }
  }
  return { nodes: [node(`api_root_${sourceIndex}`, source.name ?? 'OpenAPI', 'system', 0, [node(`api_module_${sourceIndex}`, 'API', 'module', 1, [node(`api_page_${sourceIndex}`, '接口', 'page', 2, actionNodes)])])], evidenceBySelector, designSourceNames: [source.name ?? 'openapi'] };
}

function workflowSource(source: DesignSource, sourceIndex: number): AdaptedDesignSources {
  const data = workflowSchema.parse(JSON.parse(source.content));
  const evidenceBySelector: Record<string, FeatureEvidence> = {};
  const actions = data.transitions.map((transition, index) => {
    const selector = `design:workflow:${sourceIndex}:${transition.id}`;
    const deniedRoles = data.roles.filter((role) => !transition.actorRoles.includes(role));
    evidenceBySelector[selector] = { featureId: '', actionKind: 'workflow', states: ['base'], fields: [], tables: [], actionEntries: [{ actionKind: 'workflow', ref: transition.id, selector, text: transition.action, triggerable: false, observed: true }], containers: [], evidenceLevel: 'observed', coverageKeys: [`workflow.transition.${transition.id}`, ...transition.actorRoles.map((role) => `workflow.role.${transition.id}.${role}`), ...deniedRoles.map((role) => `workflow.role.${transition.id}.${role}`), ...transition.preconditions.map((_, i) => `workflow.precondition.${transition.id}.${i}`), ...transition.postconditions.map((_, i) => `workflow.postcondition.${transition.id}.${i}`)], needsReview: false, uncovered: [], structuredDesign: { source: 'workflow', workflow: { roles: data.roles, transitions: [{ ...transition }] } } };
    return { ...node(`workflow_action_${sourceIndex}_${index}`, transition.action, 'action', 3), actionKind: 'workflow' as const, actionText: transition.action, actionSelector: selector };
  });
  return { nodes: [node(`workflow_root_${sourceIndex}`, data.name, 'system', 0, [node(`workflow_module_${sourceIndex}`, '工作流', 'module', 1, [node(`workflow_page_${sourceIndex}`, data.name, 'page', 2, actions)])])], evidenceBySelector, designSourceNames: [source.name ?? data.name] };
}

function uniqueStrings(values: string[]): string[] { return [...new Set(values)]; }

/** OpenAPI/workflow 仅接受结构化输入；错误转换为可追溯的 needs_review 虚拟动作。 */
export async function adaptDesignSources(sources: DesignSource[] | undefined): Promise<AdaptedDesignSources> {
  const result: AdaptedDesignSources = { nodes: [], evidenceBySelector: {}, designSourceNames: [] };
  for (const [index, source] of (sources ?? []).entries()) {
    try {
      const adapted = source.kind === 'openapi' ? await openApiSource(source, index) : workflowSource(source, index);
      result.nodes.push(...adapted.nodes); Object.assign(result.evidenceBySelector, adapted.evidenceBySelector); result.designSourceNames.push(...adapted.designSourceNames);
    } catch (error) {
      const selector = `design:invalid:${index}`;
      result.nodes.push(node(`invalid_design_${index}`, source.name ?? `${source.kind} 无效输入`, 'action', 0));
      result.nodes[result.nodes.length - 1].actionKind = 'other'; result.nodes[result.nodes.length - 1].actionSelector = selector;
      result.evidenceBySelector[selector] = { featureId: '', actionKind: 'other', states: [], fields: [], tables: [], actionEntries: [], containers: [], evidenceLevel: 'needs_review', coverageKeys: [], needsReview: true, reviewReason: `${source.kind} 结构化输入无效: ${error instanceof Error ? error.message : String(error)}`, uncovered: [] };
      result.designSourceNames.push(source.name ?? source.kind);
    }
  }
  return result;
}
