# 颗粒度测试用例生成设计

**状态：** 待实施
**范围：** 以现有 `login → explore → feature → case → execute → defect` 管线为基础，升级功能点到测试用例的生成链路；保留当前八列用例格式、模块 scope、人工编辑、工作簿持久化和 AI 开关。

## 1. 事实基线与根因

当前仓库并不是“只有 Prompt”：`packages/stage-explore/src/pageActionExplorer.ts` 已能把页面按钮归为 `create/update/delete/query/export/import/...`，`packages/stage-case/src/templateScenarioEngine.ts` 也已有模板生成器。

问题出在信息断裂与错误聚合：

1. `extractPageActions()` 只把归类后的中文标签写成 `ModuleNode.label`，`ActionKind`、原按钮名与 selector 被丢弃；`stage-feature` 最终只保留九列字符串功能点。
2. `McpEngine.extractPageElements()` 只输出扁平元素；它未传递 required、长度、范围、枚举、表头和分页语义。`PipelineOrchestrator.exploreByFeaturePaths()` 把不同 URL 的元素合并成同一个数组，`stage-case` 对每个功能点都取同一批元素的第一个按钮/输入框。
3. `stage-case` 对每个功能点固定生成 `normal/boundary/exception/process/permission` 五条。新增、修改、删除、列表、查询、导入导出都没有不同的覆盖矩阵；`caseRows.ts` 还把“五条”当成质量门要求。
4. AI 提示只含模块、功能、测试点和泛化场景，不含动作、字段约束或页面证据；AI 输出既不能补全缺失的场景，也不能被逐项核验。

因此必须把“动作 + 证据 + 模板覆盖规则”作为确定性输入，AI 仅负责润色已经确定的步骤与预期。

## 2. 目标和非目标

### 目标

- 对每个已确认的功能点生成与动作匹配的场景集合，不再固定五条。
- 每条场景带功能点绑定、场景标识、来源证据、优先级和复核状态；Excel/CSV 仍保持现有八列。
- Web：自动读取页面、列表、表单和安全打开的新增/修改/详情视图；不提交、不确认删除、不写入数据。
- API：从 OpenAPI 3.x/Swagger 2 JSON 或 YAML 派生功能点、参数约束和用例。
- 复杂业务/HIS：从结构化工作流（状态、角色、前后置条件、转换）派生流程和权限用例，避免从页面按钮臆测业务规则。
- 未观察到或不够确定的规则不伪装为已验证覆盖；生成候选并标记 `needs_review`，同时给出缺失证据原因。

### 非目标

- 不改动八列可见列、用例编号与模块选范围的既有语义。
- 不在本期实现新的执行引擎、自动提交表单、自动删除、自动通过审批或医疗业务状态迁移。
- 不以源码静态分析代替运行页面、OpenAPI 或结构化业务流证据。
- 不新建独立 `stage-explore-api` 或工作流平台；API 与业务流作为 `stage-feature` 的补充证据源，复用现有六阶段顺序。

## 3. 契约与数据模型

在 `packages/contracts/src/types/TestDesign.ts` 新增以下可序列化、可选扩展类型，并从 `index.ts` 导出：

```ts
export type ActionKind =
  | 'list' | 'query' | 'reset' | 'create' | 'update' | 'delete'
  | 'batch_delete' | 'detail' | 'import' | 'export' | 'workflow'
  | 'permission' | 'other';

export interface FieldSemantic {
  id: string;
  label: string;
  selector?: string;
  control: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select'
    | 'radio' | 'checkbox' | 'switch' | 'file' | 'unknown';
  dataType: 'string' | 'integer' | 'number' | 'boolean' | 'email' | 'phone'
    | 'identity' | 'date' | 'datetime' | 'file' | 'unknown';
  required: 'true' | 'false' | 'unknown';
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  options?: string[];
  evidenceLevel: 'observed' | 'derived' | 'needs_review';
}

export interface TableSemantic {
  headers: string[];
  hasPagination: boolean;
  hasPageSize: boolean;
  hasPageJump: boolean;
  sortableHeaders: string[];
  hasMultiSelect: boolean;
  evidenceLevel: 'observed' | 'derived' | 'needs_review';
}

export interface FeatureProfile {
  featureId: string;
  nodeId?: string;
  action: { kind: ActionKind; label: string; selector?: string; pageUrl?: string;
    evidenceLevel: 'observed' | 'derived' | 'needs_review' };
  source: 'web' | 'openapi' | 'workflow' | 'manual';
}

export interface FeatureEvidence {
  featureId: string;
  pageUrl?: string;
  fields: FieldSemantic[];
  table?: TableSemantic;
  visibleActions: Array<{ kind: ActionKind; label: string; selector?: string }>;
  source: 'web' | 'openapi' | 'workflow' | 'manual';
  evidenceLevel: 'observed' | 'derived' | 'needs_review';
  reviewReason?: string;
}
```

`ModuleNode` 只新增可选 `actionKind`、`actionSelector`、`actionText`，保留树和旧调用方。`FeatureOutput` 新增可选 `featureProfiles`；`CaseInput` 新增可选 `featureProfiles` 和按 `featureId` 键控的 `featureEvidence`。`CaseRow` 新增可选 `scenarioName`、`priority`、`coverageKeys`，全部是隐藏元数据。Zod schema 必须与 TypeScript 同步，旧请求省略这些字段仍可通过。

本期不修改既有用例编号语义：`featureId` 继续使用功能点表中的完整 `base_NN`，`caseNo` 继续以该值为前缀；不同场景的稳定身份由隐藏 `scenarioId` 承担，例如 `create.required.userName`、`list.pagination`、`api.required.patientId`、`workflow.charge_to_discharge`。若后续需要统一编号格式，必须单独进行冻结契约迁移和旧数据 round-trip 验证。

## 4. Web 证据采集

`engine-mcp` 的 `SemanticNode` 增加可选 HTML 约束字段（`required`、`minLength`、`maxLength`、`minimum`、`maximum`、`pattern`、`options`、`multiple`、`checked`），direct Playwright 的 `DOM_WALK` 从真实属性提取。MCP snapshot 无法给出的字段留空，不虚构。

`stage-explore` 保留当前页面内动作采集，并将归类结果写入 action 节点。`stage-feature` 为每个功能点生成 `FeatureProfile`，使动作、selector 和 URL 不再被九列表截断。

`orchestrator` 以功能点为单位而不是全局数组采证：

1. 按 `FeatureProfile.action.pageUrl` 导航，抓列表页语义。
2. 建立有限状态采集器：先采基础页，再安全展开 Tab、折叠区和只读下拉；`create/detail` 可打开安全视图，`update` 必须先找到并选择只读样例行后再打开。只有明确导航链接、`aria-haspopup=dialog` 或已知只读 opener 可以点击；icon-only、switch、checkbox 和行内操作默认禁止。每个状态都记录 `stateId`、DOM fingerprint 和覆盖结果。
3. 不点击保存、提交、确认、删除、导入、导出、审批或任何可能写入数据的控件；删除入口只记录存在性，不通过点击验证确认框。页面状态采集后关闭视图或返回原 URL。
4. 同源 iframe、open Shadow DOM、虚拟列表和异步内容在预算内继续采集；跨域 iframe、closed Shadow DOM、Canvas、无安全样例行或达到预算的状态写入 `needs_review` 与停止原因。
5. 每个功能点保存单独 `FeatureEvidence`；打不开时仅该功能点 `needs_review`，绝不把其他页面字段复用给它。

## 5. 场景矩阵

场景由动作矩阵确定，字段约束决定 observed 场景的实例化。主规格要求“全场景、全功能点不剔除”：矩阵要求但无可观察证据的项仍生成候选，并标记 `needs_review` 和缺失原因；不得把候选计入 observed 覆盖，也不得用其他页面证据补齐。

| 动作 | 必生成（证据满足） | 条件生成 | 候选/复核 |
|---|---|---|---|
| list | 默认展示、表头、空态 | 分页、页大小、跳页、每个可排序列、批量选择 | 刷新 |
| query | 每个查询字段有效条件、清空条件、无结果 | 多字段组合、模糊匹配、日期范围 | 性能/权限 |
| create | 正常提交准备、每个必填字段为空、枚举选择 | 每个格式/长度/数值范围、取消、重复数据 | 权限、业务唯一性 |
| update | 正常修改准备、回显、必填/约束 | 取消、不可修改字段 | 权限、并发冲突 |
| delete | 删除入口存在性；已有安全结构证据时生成确认、取消 | 批量删除、关联限制 | 确认行为、权限、软删除（禁止通过点击删除入口采证） |
| import/export | 入口可用、文件类型或导出格式 | 模板、重复数据、错误行反馈 | 权限、容量限制 |
| API | 正常请求、必填参数、状态码/响应结构 | enum、pattern、min/max、鉴权、分页 | 幂等、限流、并发 |
| workflow/HIS | 每个状态转换、前置与后置校验 | 每个角色许可/拒绝、回退、终态 | 跨系统一致性、费用/库存等业务规则 |

`stage-case` 按输入证据创建 `ScenarioCandidate`，再由 `caseBuilder` 渲染为已有 `CaseRow` 八列。确定性模板的操作说明必须写出页面/控件/输入值类型/观察点；AI 只能返回同一个候选的“操作说明、预期结果”改写，不能增删场景、字段、约束或编号。解析失败、字段超出证据或格式不完整时回落确定性文本并标记原因。

## 6. 质量门与界面

质量门从“每功能点恰好五条”改为“已要求 coverageKey 均有一条合格用例”。它检查：

- 用例编号、功能点 ID、场景 ID、八列必填文本和目标测试点一致；
- 每个 `FeatureEvidence` 可观察规则的覆盖键存在且不重复；
- `needs_review` 的原因可追溯到缺失 DOM、未打开的安全视图、OpenAPI 缺段或工作流缺前后置；
- AI 改写后未出现证据之外的字段、按钮、接口参数或业务状态。

`Case.tsx` 不新增导出列：在现有“测试内容”单元格内增加场景/优先级/证据徽章，在表格上方显示覆盖率和待复核计数；展开待复核项显示 `reviewReason`。`toCaseView` 和 context 保留隐藏元数据，避免当前转换层丢失它们。

## 7. API 与复杂业务输入

在功能点页面增加“设计证据”导入：

- OpenAPI/Swagger：接收 `.json/.yaml/.yml` 文本，后端以直接依赖 `yaml` 解析，转换为虚拟 API action 节点与 `FeatureProfile`；HTTP method、parameters、requestBody、response、security 作为 `FeatureEvidence`。
- 工作流：接收受 Zod 约束的 JSON，格式固定为 `id/name/entities/roles/states/transitions`；每条 transition 包含 `action/from/to/actorRoles/preconditions/postconditions`。转换为虚拟 workflow action 节点。自由文本需求文档只可作为知识库提示，不能被当作已观察规则。

这些来源与 Web tree 合并进同一 `FeatureOutput`，随后复用同一 `CaseInput`、编号、质量门、持久化和 UI。API/HIS 的“可执行”只表示用例步骤格式完整；实际接口调用/业务状态迁移仍由后续 execute 能力承担。

## 8. 持久化与兼容

不增加业务表。复用 `feature_tables.data`：新格式为 `{ version: 2, table, featurePaths, featureProfiles, provenance, designSources }`；读取时若 data 是旧二维数组，转换为 `{ version: 1, table: data }`。新增 store/API 方法读写 `FeatureArtifact`，旧 `getFeatureTable()` 继续返回 `artifact.table`。`CaseSheet` 继续原样存放扩展后的 CaseRow。

## 9. 验收标准

1. 给定“用户管理”页证据：列表有分页/排序，新增表单含必填用户名、手机号 pattern、角色 select；生成集合包含列表、查询、新增中与这些证据一一对应的场景，任何删除用例不引用新增表单字段。
2. 给定“删除”按钮与确认弹窗：生成确认和取消；未观察到批量选择时不生成批量删除的已验证用例。
3. 给定 OpenAPI：`POST /patients` 的 required/format/response 场景与 spec 参数对应；`GET` 不被错分为创建。
4. 给定住院工作流 JSON：每个转换和角色限制都生成对应的状态、前后置与权限场景。
5. 无 DOM/约束证据时，生成的候选行带 `needsReview/reviewReason`；质量门显示缺项，不出现“high confidence”伪结论。
6. 当前八列、模块过滤、CSV 导出、旧 feature table/旧 case table 读取、不开 AI 的确定性生成和 AI 失败回退均保持可用。
