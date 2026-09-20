# 设计文档 · 验证阶段（explore → feature → case 全量覆盖校验）

> Superpowers 阶段一（Brainstorming）产出 · 待用户签字后进入设计校验/规划/ TDD。
> 前置：stage-login 登录状态机已修复（自动提交 + 验证码→barrier 人工接管），unit 16/16 绿、E2E 登录段已转绿。

## 1. 目标与范围

对流水线三段产出做**自动化校验**，断言其满足主规格/PRD 的覆盖率要求：

- 探索结果（ModuleTree）→ **全量菜单 + 菜单下功能颗粒度**
- 功能点结果（FeatureTable 九列）→ **测试点完整 + 父子关系 + 测试点标识唯一**
- 测试用例结果（CaseTable 八列）→ **按测试点生成全部场景用例**

交付物 = 可重复运行的校验代码（用户已确认）。AI 用例生成串联（用户标注"正在开发，先不管"）**不在本阶段范围**，本阶段只校验 `templateScenarioEngine` 模板化全场景产出的覆盖度。

## 2. 验收基准（取自文档，非自定）

- 探索：`主规格 §5.2` — 模块树可 CRUD；"模块树完整度 + needs_review 可视即可"，输出含 `coverage{visited,total,frontier}`。
- 功能点：`主规格 §5.3` + `模块接口契约` — **九列固定**（序号/测试类型/需求章节/系统名称/主模块/子模块/功能点/测试点/测试点标识）；`测试点标识 = base_NN`（4 段，行级唯一主键）。
- 用例：`主规格 §5.4` — **八列**（用例编号/测试内容/步骤/输入及操作说明/预期结果/初次/回归/结论）；`用例编号 = 绑定功能点测试点标识`；**全场景、全功能点不剔除**（`templateScenarioEngine` 全动作）。
- 场景分类（P1 验收门，`可执行PRD.md:71`）：**正常 / 异常 / 边界 / 流程 / 权限** 五类。

## 3. 三块校验内容

**A. 探索校验（全量菜单 + 颗粒度）**
- `coverage.visited === coverage.total`（探索自报 100% 覆盖）；
- 每个一级菜单在功能点表中均有对应"主模块"条目（无遗漏菜单）；
- 颗粒度：存在"主模块→子模块→功能点"三级链；任一功能点缺失子级结构即记 violation。

**B. 功能点校验（测试点 + 结构）**
- 每行恰好 9 列；`主模块/子模块/功能点/测试点` 均非空；
- `测试点标识` 匹配 `^[\u4e00-\u9fa5A-Z0-9]+_[\u4e00-\u9fa5A-Z0-9]+_[\u4e00-\u9fa5A-Z0-9]+_\d{2}$`（base_NN 4 段）；
- `测试点标识` 全表唯一（无碰撞）；每个功能点都有非空 `测试点`。

**C. 用例校验（全场景）**
- 每行 8 列；`用例编号 === 绑定功能点测试点标识`（caseNo 绑定断言）；
- 五类场景判定**确定性**（Design Validation 修正）：`CaseRow.scenarioId` 生成时写入 `'normal'|'boundary'|'exception'|'process'|'permission'`，`caseNo = testPointId + _N1.._N5`（场景后缀）。校验器以 `scenarioId`（兜底解析 `caseNo` 后缀 `_N1.._N5`）解析，弃用关键词猜测；对功能点表每个 `测试点标识`，其用例集须覆盖 SCENARIO_ORDER 全五类，缺类记 violation；
- 无功能点"裸奔"（每个测试点至少 1 条用例）。

## 4. 数据来源与人机断点

- 数据 = **真实 demo 流水线产出**。登录阶段用 `credential` 模式触发，遇验证码返回 `barrier`（已修复行为）。
- **人机断点**：校验 harness 在 barrier 后轮询会话直至 `ok`（最长 10 分钟人工窗口），期间用户在可见浏览器输入验证码并点击登录/确认。用户已确认"会输入验证码帮助"。
- 断点通过后，harness 依次调 `/api/stage` 跑 explore→feature→case，捕获三段输出喂给校验器。

## 5. 交付物结构（代码）

- `e2e/validators/pipelineValidators.ts`：纯函数 `validateExplore/validateFeature/validateCase(tree, ft, ct)` → `{ pass, violations[], stats }`（可单测、可复用）。
- `e2e/pipeline-validation.spec.ts`：集成校验 spec —— 触发登录→等人工验证码→跑三段→调用校验器→输出覆盖率报告；五类场景用 `scenarioId`/`caseNo` 后缀确定性解析（非关键词猜测）。
- 不新增包、不改 contracts；校验逻辑独立可测。

## 6. 风险与假设

- demo.ruoyi.vip 可用性/网络：外部站，偶发慢或不可达 → harness 对探索/生成步骤设宽松超时并失败可读。
- "全量菜单"无可先验期望集：以探索自报 `coverage` + 功能点表反查菜单完整性为代理，不臆造期望树。
- AI 生成未接入时，用例覆盖度依赖 `templateScenarioEngine` 模板全动作；若某类场景模板未产出，校验如实标记缺失（非误判通过）。

## 7. 验证通过标准（Definition of Done）

- `validateExplore/Feature/Case` 三器各有单测（Red-Green 由 TDD 阶段落）。
- `pipeline-validation.spec.ts` 在用户提供验证码后跑通：三段 `pass=true`、`violations=[]`、五类场景覆盖率 100%、输出覆盖率报告。
- 报告含：菜单总数、功能点数、测试点数、用例总数、五类各计数、缺失项清单（若有）。

## 8. 设计校验补遗（Design Validation · 代码证据）

- **五类场景判定（关键修正）**：原设计假设"关键词分类器"，经核查 `packages/stage-case/src/index.ts:133` 与 `templateScenarioEngine.ts:19` 确认——`CaseRow.scenarioId` 在生成时确定性写入 `'normal'|'boundary'|'exception'|'process'|'permission'`，且 `caseNo = testPointId + _N1.._N5`（场景后缀）。校验器应以 `scenarioId`（兜底解析 `caseNo` 后缀 `_N1.._N5`）做确定性分类，弃用关键词猜测。
- **explore 覆盖度字段（已核实）**：`ExploreContract.ts:31` 确认 `coverage: { visited; total; frontier: string[] }` 与 `needsReview: string[]` 真实存在，Section 3A 的 `coverage.visited===coverage.total` 代理校验可行。
- **功能点→用例绑定（已核实）**：`CaseRow.featureId = testPointId`，`caseNo.startsWith(featureId)` 强绑定（见 `caseRows.ts:34`），Section 3B/3C 绑定断言可行。
- **可行性结论**：三块校验器所需字段均已在 contracts/stage-case 中实证存在，设计技术上可行，无需改动 contracts。`
