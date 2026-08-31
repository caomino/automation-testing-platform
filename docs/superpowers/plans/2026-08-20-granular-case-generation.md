# 粒度化测试用例生成实施计划（审核修订版）

**状态：** 已完成工程审核，待实施  
**目标：** 保持六阶段、九列功能点表、八列用例表和旧数据可读，依据真实页面证据按列表、查询、添加、修改、删除、详情、导入、导出等动作生成不同且可追溯的测试场景。

## 1. 成功标准

1. 同一页面的列表、添加、修改、删除分别绑定自己的证据，字段不得串用。
2. “读取页面所有内容”定义为读取所有在只读约束下可到达、且影响测试设计的页面语义状态：可见文本、动作、字段约束、表格、分页、Tab、弹窗、抽屉、折叠区、同源 iframe、open Shadow DOM、虚拟列表和异步内容。
3. 跨域 iframe、closed Shadow DOM、Canvas、需写数据才能进入的状态、无安全样例数据的修改页必须标记 `needs_review`、原因和未覆盖状态，不能伪装已读取。
4. 每个 observed 约束都有 `coverageKey`，每条用例可追溯到功能点、页面状态和证据。
5. AI 只改写既有候选的操作与预期，不得增加动作、字段、场景或业务规则。
6. 旧 `FeatureRow[][]`、旧 `CaseInput`、旧 CaseSheet、scope、人工编辑和八列导出继续可用。

## 2. 审核裁决

### 保留并复用

- 复用 `stage-explore` 已有路由融合、DOM 菜单、动作采集和 `needs_review` 降级链。
- 复用 `ModuleNode`、`FeatureRow[][]`、`featurePaths`、`CaseSheet` 和现有 store 表。
- 复用 `stage-case` 的八列渲染、AI 开关、scope 和人工编辑能力。
- 复用 `engine-mcp` 的 direct/MCP 双实现；只增加可选兼容字段或方法。

### 必须纠正

- 不在 `stage-feature` 新建第三份动作词典。`ActionKind` 进入 contracts，探索阶段直接保存分类结果；旧节点缺元数据时用 `other + needs_review`，不在下游重新猜。
- 不删除未观察场景。主规格要求“全场景、全功能点不剔除”；动作矩阵要求但未观察到的场景保留为 `needs_review` 候选，不能当作 observed 覆盖。
- 不点击删除、保存、提交、确认、导入、导出、审批、发布、上传等控件。
- 修改证据不能靠一次直接点击。必须支持“找到只读样例行 -> 选中行 -> 打开修改视图”；没有安全样例行时只生成待复核证据。
- 不改变现有 `featureId` 语义。用例编号继续以完整 `featureId` 为前缀；场景唯一性使用隐藏 `scenarioId`。编号格式变更必须另立契约迁移。
- 不以“历史前端失败”为由跳过本计划触碰文件的类型错误和测试失败。

## 3. 数据流

```text
Explore ModuleNode(action metadata)
              |
              v
FeatureRow[9] + FeatureProfile --------------------+
              |                                    |
              v                                    v
     Page Evidence Collector                OpenAPI / Workflow
              |                                    |
              +---------- FeatureEvidence --------+
                                   |
                                   v
                         Scenario Matrix (pure)
                                   |
                         coverage validator
                                   |
                       deterministic CaseRow[8]
                                   |
                      optional constrained AI rewrite
                                   |
                    CaseSheet + qualityGateIssues
```

## 4. 页面语义与采集状态机

`FeatureEvidence` 以 `featureId` 为键，至少包含：

- `pageUrl/stateId/source/evidenceLevel/reviewReason`；
- 去重的业务可见文本及区域；
- actions：kind、原始文字、selector、disabled、所在行/工具栏；
- fields：label、selector、control、required、readonly、disabled、placeholder、min/max、length、pattern、options；
- tables：headers、rowCount、emptyState、selection、sort、pagination、pageSize、pageJump；
- containers：tab/dialog/drawer/accordion/iframe/shadow/virtual-list 状态与可达性；
- coverageManifest：发现、已访问、阻塞状态和停止原因。

```text
BASE_PAGE
  |-- snapshot base/list/query semantics
  |-- safely expand tabs/accordions/dropdowns
  |-- create/detail -> safe opener -> snapshot -> close/back
  |-- update -> locate sample row -> select/open -> snapshot -> close/back
  |-- delete/import/export/submit/approve -> DO NOT CLICK
  `-- unsupported/unreachable -> needs_review + explicit reason
```

预算：单页最多 50 个安全状态、5,000 个语义节点、100 次虚拟滚动步、60 秒；全系统串行复用浏览器，按 `pageUrl + stateId + DOM fingerprint` 去重。达到上限时保存部分证据并标记不完整，不能静默截断。

## 5. 动作场景矩阵

| 动作 | 已观察证据生成 | 必须保留的待复核候选 |
|---|---|---|
| list | 初始展示、表头、空态、分页、页大小、跳页、排序、选择 | 大数据量、刷新、权限 |
| query | 每字段有效查询、清空、无结果、组合、日期范围 | 模糊规则、性能、权限 |
| create | 正常准备、必填、格式、长度、数值边界、枚举、取消 | 唯一性、权限、服务端规则 |
| update | 回显、正常修改准备、必填/约束、只读字段、取消 | 无安全样例行、并发、权限 |
| delete | 入口存在性；仅有安全确认结构证据时生成确认/取消 | 关联限制、软删除、权限；不得点击验证 |
| detail | 字段展示、只读性、返回、关联区域 | 权限、缺失数据 |
| import/export | 入口、文件控件、格式选项 | 模板、容量、错误行、权限；不得触发传输 |
| workflow/API | 仅依据结构化 source 生成 | 无结构化规则的一律待复核 |

候选包含稳定 `scenarioId`、`coverageKeys`、priority、operation、expected、evidenceLevel、needsReview 和 reviewReason。数量由证据和矩阵决定，不固定五条，也不允许缺少矩阵要求而无解释。

## 6. 分阶段实施任务

### Task 0：冻结基线与冲突测试

- 建立 Web fixture：同页包含列表、查询、添加、修改、删除，添加和修改字段不同。
- 先写回归测试证明当前动作语义丢失、跨页面元素串用、固定五场景。
- 固化旧输入、旧 store 数组、八列导出和现有编号前缀。
- 记录 app typecheck 基线；本计划触碰文件必须清零，其他历史错误单列交付阻塞。

### Task 1：建立单一动作与证据契约

**修改：** contracts 的 TestDesign、ModuleNode/CaseRow、Feature/Case contracts、schemas 和 index。  
**验证：** 新字段可省略；非法 enum、坏证据结构、缺 reviewReason 的 needs_review 被 Zod 拒绝。

- 新增 `ActionKind`、`FeatureProfile`、`FeatureEvidence`、`CoverageManifest`、`ScenarioCandidate`、`FeatureArtifact`。
- 保留 `featureId` 与现有 caseNo 前缀语义。

### Task 2：探索阶段直接保留动作语义

**修改：** `stage-explore/pageActionExplorer.ts`、`menuFusion.ts` 及测试。  
**验证：** create/update/list/query/delete 的原始文字、selector、URL 能从 ModuleNode round-trip。

- 将现有分类结果写入节点可选字段。
- `list` 由真实表格/列表证据产生；猜测项必须 needs_review。
- 统一 `pageActionExplorer` 与 `engine-mcp/nav-tree` 的动作映射入口，避免第三份词典。

### Task 3：扩展完整页面语义快照

**修改：** `engine-mcp/types.ts`、direct 引擎、MCP snapshot converter 及测试。  
**验证：** 70 项矩阵中相关的 F09-F20、R04/R09/R12、C07-C20、V01/V02/V08-V13。

- direct 模式读取标准 DOM、同源 frame、open shadow root、表格及组件状态。
- MCP 无法返回的属性保持 unknown，不能伪装 direct 证据。
- 修复现有 `SUMMIT` 拼写并增加 submit 识别回归测试。

### Task 4：按功能点运行只读状态采集器

**新增：** `orchestrator/src/featureEvidenceExplorer.ts` 及 fake-engine 测试。  
**修改：** orchestrator case 路径。

- 单个 profile 输入、单个 evidence 输出，禁止全局元素数组。
- 实现 base/create/detail/update/容器展开、超时、上限、去重和回原页。
- 结构化 allow-list + `isDataControl` + 危险文本 deny-list 三重保护。只有明确导航链接、`aria-haspopup=dialog` 或已知只读 opener 才可点击；icon-only、switch、checkbox 和行内操作默认禁止。
- 点击前后记录 URL、DOM fingerprint、网络/下载副作用；检测到副作用立即停止并报 blocker。
- 回归测试必须证明 icon-only 行内按钮、开关、删除、导入导出和未知按钮的点击次数为零。

### Task 5：功能档案与 v2 artifact 持久化

**修改：** stage-feature、infra-store、server、dataApi。  
**验证：** 旧二维数组读取、v2 round-trip、bootstrap、系统切换。

- profile 只消费明确 ModuleNode 语义；旧/人工节点缺语义时 `other + needs_review`。
- 复用 `feature_tables.data`；旧数组规范化为 `{version:1, table}`，v2 保存 table、paths、profiles、provenance、sources。
- 旧 `getFeatureTable()` 只返回 table，避免破坏调用者。

### Task 6：纯函数场景矩阵与八列渲染

**修改：** stage-case；旧模板先作为 legacy adapter，迁移完成前不删除。  
**验证：** 每个动作 table-driven tests；添加、修改、列表专属字段和 coverageKey 互不串用。

- `generateScenarios(profile, evidence)` 只消费相同 featureId 的 evidence。
- 缺证据场景保留 needs_review，不写成已验证。
- 八列不变，隐藏元数据通过 clone、持久化、视图转换不丢失。

### Task 7：覆盖质量门与受限 AI

**修改：** `caseValidator.ts`、`aiCaseRows.ts`、schemas 和 verify。  
**验证：** 缺 coverage、重复 scenarioId、证据外字段、AI 非 JSON、超时与回退。

- 比较 requiredCoverageKeys 与实际 keys，不再检查固定数量。
- observed 缺失为 blocking；needs_review 有原因则展示但不伪装通过。
- AI 只返回 `{operation, expected}`；失败保留确定性文本。

### Task 8：前端展示与编辑兼容

**修改：** app context、pipeline/dataApi、Feature、Case 及测试。  
**验证：** metadata round-trip、覆盖统计、复核详情、scope、人工编辑、八列 CSV/剪贴板。

- 修复现有 `featurePaths` 未暴露、`toCaseView/fromCaseView` 丢隐藏字段等直接相关类型错误。
- UI 只增加覆盖/待复核状态，不增加导出列。
- 本任务触碰文件 typecheck 必须为零；若全 app 历史错误仍存在，整体交付不得标记 clean。

### Task 9：OpenAPI 与结构化工作流适配器

**前置：** Web Task 1-8 验收完成。

- OpenAPI 3.x/Swagger 2 使用成熟 parser + `yaml`，解析 `$ref`、allOf/oneOf、参数位置、requestBody、responses 和 security，不能只做 method 映射。
- workflow 必须通过 Zod；from/to/action 必填；自由文本不作为 observed 规则。
- 两类 source 转为同一个 profile/evidence，不建立平行管线。

### Task 10：集成与真实浏览器验收

验证顺序：focused unit -> package typecheck/lint/test/verify -> build -> frontend build -> E2E -> `git diff --check`。

E2E 至少覆盖列表、添加、修改、删除零点击、Tab、抽屉、折叠、同源 iframe、open shadow、虚拟列表，以及跨域 iframe/closed shadow/超时的明确未覆盖原因；同时回归旧 artifact、旧 CaseSheet、八列导出和人工编辑。

## 7. 测试覆盖图

```text
ModuleNode metadata
  +-- legacy missing -> needs_review
  +-- observed actions -> round-trip
Page evidence
  +-- base/list/query ........ unit + integration
  +-- create/detail .......... integration
  +-- update with sample ..... integration + E2E
  +-- update without sample .. needs_review
  +-- destructive action ..... E2E: zero clicks
  +-- dynamic containers ..... integration + E2E
  +-- limits/timeouts ........ partial manifest
Scenario generation
  +-- action matrices ........ table-driven unit
  +-- evidence isolation ..... regression
  +-- quality/AI fallback .... unit + verify
Artifact/UI
  +-- v1/v2 round-trip ....... store + app integration
  +-- eight columns/review ... app unit + E2E
```

## 8. 失败模式

| 失败 | 处理 | 用户结果 |
|---|---|---|
| 页面/视图超时 | 保存部分证据，停止该 feature | 显示未访问状态和原因 |
| selector 漂移 | 不做模糊危险点击 | 入口不可重放，待复核 |
| 修改无样例行 | 不造数据、不选随机行 | 修改页未采集说明 |
| DOM/虚拟列表过大 | 达预算即停 | 覆盖清单显示截断 |
| MCP 缺属性 | 属性置 unknown | 对应场景待复核 |
| AI 超时/非法输出 | 回退确定性行 | 质量问题可见 |
| v2 artifact 损坏 | Zod 拒绝且不覆盖旧数据 | 明确加载错误 |

## 9. NOT in scope

- 自动保存、提交、删除、审批、上传、导入或导出。
- closed Shadow DOM、跨域 iframe 内部和 Canvas 像素语义，只标注不可读。
- 自动创建修改样例数据，需要独立隔离数据方案。
- 从自由文本推断 HIS 业务规则。
- 修复与本计划触碰文件无关的全部历史前端问题；其存在会阻止“全仓 clean”结论。

## 10. 实施顺序与交付门

1. Task 0-2：契约和动作 round-trip。
2. Task 3-4：fixture 证明完整语义采集和危险动作零点击。
3. Task 5-8：Web 添加/列表/修改闭环，旧数据与八列回归。
4. Task 9：复用同一证据模型接 OpenAPI/workflow。
5. Task 10：全门禁与真实浏览器证据满足后才完成。

每个任务先写失败测试，再做最小实现；contracts 必须先构建。不得自动提交，除非用户明确要求。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | - | 未运行 |
| Codex Review | outside reviewer | Independent opinion | 1 | absorbed | 4 项发现均已纳入修订计划 |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | issues_open | 已修订架构问题，基线仍有前端阻塞 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | - | 未运行 |
| DX Review | `/plan-devex-review` | Developer experience | 0 | - | 未运行 |

**CROSS-MODEL:** 两次审核一致要求先建立完整证据通道、强化只读点击、保留元数据并消除重复动作词典；相关修改已吸收。

**VERDICT:** ENG REVIEW COMPLETED WITH CONCERN；计划可作为实施依据，但全仓 clean 仍受既有 app 类型错误阻塞。

**UNRESOLVED DECISIONS:**
- app 全局 typecheck 存在与本计划无关的历史错误；实施完成不能宣称全仓 clean，除非先完成独立基线治理。
