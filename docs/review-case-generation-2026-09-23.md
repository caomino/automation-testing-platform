# 测试用例生成 · CodeReview 报告

> 评审角色：CodeReviewExpert　|　日期：2026-09-23　|　范围：二次探索（用例生成前的证据准备）与用例生成链路
> 审查依据：权威设计文档 `docs/superpowers/specs/2026-08-21-feature-driven-case-generation-design.md`、补充定义 `docs/问题分析与补充定义.md`、源码、以及 `projects.db` 实查数据。

---

## 0. 总体结论（一句话）

4 个问题其实只来自 **两条根因链**：
- **链 A（导航/探索方式错）**：二次探索既「直接打开地址」又不「盘点页面功能」→ 问题 **#1、#2**。
- **链 B（功能点分类塌缩）**：功能点的 `actionKind` 几乎全部被静默归为 `other` → 用例生成退化为占位文本并误报 → 问题 **#3、#4**。

**实查证据（projects.db）**：demo 系统 `504083d3` 的 28 个功能点、系统 `2071a2da` 的 77 个、系统 `04afc96b` 的 7 个 —— `actionKind` **100% 为 `other`**。这正是 #4「占位用例」与 #3「报错」在当下的真身。

设计文档铁律被违反：**§9 禁止「证据不足时输出看似完整的泛化用例」；§13 要求证据缺失必须输出 `evidence_missing`/`needs_review` + 诚实原因**，而非假完整占位。当前实现反向而行。

---

## 1. 我做了什么（按你的要求「先搞清规则」）

1. 通读权威设计文档（功能驱动用例生成设计，含 §2 全功能探索、§9 假完整用例禁令、§13 证据缺失标注、§21.9.16 `caseNo=testPointId` 等）。
2. 通读 `docs/问题分析与补充定义.md`。
3. 把 4 条报错文案逐一追踪到源码行。
4. 用 SQLite 实查 `projects.db`，确认 `actionKind` 分布与占位用例形态。

**未改动任何代码**（符合你的规则④与「先搞清规则」指令）。

---

## 🔴 问题 #1：二次探索「直接打开地址」，而非「在项目基础上点击」

**现象 / 你的诉求**：二次探索应该复用已登录会话、从项目菜单点击进入目标页；现在却是直接 `navigate(url)` 打开地址。

**根因（代码定位）**：
- `packages/orchestrator/src/featureEvidenceExplorer.ts:635` 解构出 `crossPathNavigation = 'allow'`，但**全文从未使用**（仅第 51-52 行作为类型/注释存在）。
- 导航循环 `:761-773`：
  ```
  const reusePage = !loc.startsWith('click:') && lastPageUrl !== '' && sameDocUrl(...);
  if (!reusePage && !loc.startsWith('click:') && nu) { await engine.navigate(nu); ... }
  ```
  对「不同页面 URL」（`featurePaths` 里的真实地址）永远走 `engine.navigate(nu)` 直接打开。
- 设计文档设想的 `entry_only`（从菜单点击、复用登录、避免直接打开落到登录页）分支**是死代码**：没有任何代码产出 `click:` 前缀的 `featurePath`，所以「从项目菜单点击进入」永远不触发。

**影响**：直接打开地址会（a）丢失登录态/上下文、（b）让 `evidence.pageEntry` 与期望入口不一致（见 #3）、（c）无法触发「点击后内容区/路由变化」这类行为验证。

**修复建议**：
- 真正实现 `entry_only`：当 `featurePath` 是跨路径真实 URL 且 `crossPathNavigation==='entry_only'` 时，**先 `navigate(baseUrl)` 回到项目入口，再沿菜单 DOM 逐级点击**（复用登录会话）到达目标页；仅「同文档 hash 路由」才允许直接 `navigate`。
- 为 `featurePath` 增加 `click:` 前缀语义，或在探索阶段把「菜单点击路径」一并存入 `featurePaths`，供二次探索回放。
- 把 `crossPathNavigation` 从死代码变成真正生效的策略开关（默认建议 `entry_only`）。

---

## 🔴 问题 #2：二次探索未「探索页面所有功能」（查看新增/详情页字段等）

**现象 / 你的诉求**：生成用例前，二次探索应当打开新增页、详情页等，**盘点全部字段/表格/按钮/状态**，拿到系统完整信息再写用例。当前没有实现。

**根因（代码定位）**：
- `featureEvidenceExplorer.ts` 的 `exploreFeatureEvidence`（约 `:497-520`）只在 `actionKind ∈ {create, detail, update}` **且** 存在 `actionSelector` 时才系统采集字段/状态。
- **没有「通用页面功能盘点 pass」**：对每个 `featurePath` 打开页面后，无论 `actionKind` 都去盘点「表单字段 / 表格列 / 容器 / 状态 / 动作入口」。
- 叠加问题 #4（绝大多数 `actionKind` 是 `other`），连 `create/detail/update` 这条窄路径也极少触发 → 字段几乎采不到。

**设计文档要求**：§2 / §21.9.x 明确要求「拿到系统完整信息去写测试用例」，二次探索不得反向修改初次探索结果、且必须覆盖页面所有功能。

**修复建议**：
- 新增**通用页面盘点 pass**：经 #1 的 `entry_only` 点击到达后，对每个功能点都执行：
  - 字段清单（表单 input/select/textarea + 真实中文 label，见 #4 `theSelect` 问题）；
  - 表格列、容器（dialog/panel）、可点击动作入口；
  - 从页面反推 `actionKind`：有表单且能提交 → `create/update` 候选；只读详情面板 → `detail`；删除确认弹窗 → `delete`；列表 → `list`；导出/导入入口 → `export/import`。
- 这样既能补齐字段证据，又能纠正 #4 的 `actionKind=other` 塌缩。

---

## 🔴 问题 #3：依旧报错（证据/入口不一致、缺安全页面或设计证据）

**现象**：报错文案两类——
- 「证据页面入口与功能点入口不一致」
- 「RUOYI_系统管理_用户管理_新增_01 未观察到 新增 所需的安全页面或设计证据」/「未观察到 other.entry 所需的安全页面或设计证据」

**根因（两条来源）**：
1. `packages/stage-case/src/evidenceGate.ts:81/83`：
   ```
   if (expectedPath !== actualPath) reasons.push('证据页面入口与功能点入口不一致');
   ```
   比较 `featurePaths[testPointId]`（**期望入口**）与 `evidence.pageEntry`（**实际观察入口**）。因 #1 直接 `navigate(url)`，观察到的 `pageEntry` 与期望入口不一致 → 报错。
2. `packages/stage-case/src/actionScenarioEngine.ts:489`：
   ```
   reason = reviewReason(evidence, `未观察到 ${coverageKey} 所需的安全页面或设计证据`);
   ```
   当某 `coverageKey` 无法满足时发出。其中：
   - 「**新增**所需…」= `create.required` / `create.entry` 等覆盖键，但 `actionKind` 未识别为 `create`（无 observed 的 create 动作，因 #1/#2 未采到）；
   - 「**other.entry** 所需…」= 覆盖键退化为 `other.entry`（因 `actionKind='other'`，见 #4）。

**修复建议**：
- 随 #1/#2 修复后，`pageEntry` 应等于期望入口、`actionKind` 正确 → 两类报错自然消除。
- `entry_only` 模式下应**以「点击到达后的真实 `pageEntry` 为真值」**，`featurePaths` 仅作索引键；在 `evidenceGate` 中对「入口不一致」在点击到达场景下放宽判定。

---

## 🔴 问题 #4：生成的测试用例与要求严重不符（占位 / 泄漏 token / 命名不一致）

**现象**：
- 你的截图 token：`theSelect`、`10621E_…`、`RUOYI_系统管理_用户管理_新增_01`。
- **当前 `projects.db` 里已无这些 token**，但存在**更严重的同型缺陷**：每个生成用例的操作都是
  `查看 【Y】 的结构化设计证据（other.entry）及关联对象`，期望都是 `该结构化证据与 【Y】 的观察点可追溯` —— **与功能类型（查询/新增/删除/导出）完全无关，全是占位**。
  （源：`actionScenarioEngine.ts:475` 兜底；因 `coverageKey='other.entry'` 且 `evidence.actionEntries` 找不到 `observed && actionKind==='other'` 的记录，落入兜底。）

**根因链（4 个环节叠加）**：
1. `packages/stage-feature/src/featureTable.ts:212`：
   `actionKind: r.node.actionKind ?? 'other'` —— **静默兜底成 `other`**，掩盖了「未分类」这一事实。
2. `packages/engine-mcp/src/nav-tree.ts` 把大量真实操作归为 `other`：
   - `:70-71` `启用/禁用/提交/保存/确定/确认/发布 → 'other'`；
   - `:318` `查看/详情/预览/打印/上传/生成/申请/… → 'other'`（通用 `isActionish` 分支）。
   只有 `:63-69` 的 `OPERATION_KEYWORDS`（新增/修改/删除/查询/导出/导入/审核）能拿到正确 `kind`。
3. 若菜单探索未枚举到该节点，`node.actionKind` 为 `undefined` → 经 #1 直接变成 `other`。
4. `actionKind='other'` → 覆盖规划器只产出 `other.*` 覆盖键 → 无 observed 证据 → `actionScenarioEngine.ts:475` 兜底占位文案（违反设计文档 §9/§13）。

**`theSelect` 来源（泄漏 token）**：字段名提取在 `mcp-adapter.extractLabel` 取 a11y 快照首个引号 token；当 `<select>` 无合理 aria-label 时，会产出 `theSelect` 这类合成名，并被写进用例。属「字段 label 抽取未归一到真实中文文案」的缺陷。

**命名不一致（`10621E_` vs `RUOYI_系统管理_用户管理_新增_01`）**：截图同时出现两种 `caseNo` 格式——`10621E_…` 是 `testPointId` 格式（符合 §21.9.16 `caseNo=testPointId`），`RUOYI_系统管理_用户管理_新增_01` 是模块路径格式。两套命名混用 = 一致性缺陷（截图属于较早一次运行；当前库无此数据，但同型缺陷仍在）。

**修复建议（按优先级）**：
1. **去掉 `featureTable.ts:212` 的静默 `?? 'other'`**：未分类应标记 `needs_review` 并带原因（如「动作类型未在探索中识别」），而非静默兜底污染下游。
2. **扩充 `nav-tree.ts` 的 `OPERATION_KEYWORDS`**：`详情/查看 → 'detail'`、`保存/提交 → 视上下文 create/update`、`启用/禁用 → 'toggle'` 等，减少 `other` 占比。
3. **实现 #2 的页面盘点反推 `actionKind`**，让 `create/detail/update/delete` 真正被识别。
4. **`actionScenarioEngine` 对无证据覆盖键必须输出 `evidence_missing`/`needs_review` + 诚实原因，绝不出「查看结构化证据」占位**（严守 §9/§13）。
5. **字段 label 归一到真实中文文案**：`extractLabel` 优先取元素可见文本 / aria-label / name，避免 `theSelect` 类合成名。
6. **统一 `caseNo` 命名**：按 §21.9.16 = `testPointId`，清理遗留的 `RUOYI_` 模块路径格式。

---

## 2. 跨问题根因图

```
二次探索直接打开地址(#1) ─┐
                          ├─► actionKind 全 other + pageEntry 错位
二次探索不盘点页面功能(#2) ─┘            │
                                         ▼
                          用例退化为占位(#4) + 入口/证据报错(#3)
```

修复顺序建议：**先 #1（entry_only 点击到达）→ 再 #2（页面盘点 + 反推 actionKind）→ #4（去掉静默 other + 占位治理）→ #3 自然消解**。

---

## 3. 我已确认熟悉业务（规则④，动手前声明）

已通读权威设计文档与补充定义，理解并认同以下业务规则：
- 一个功能点 = 一个用例组，按功能表顺序排列；
- 证据缺失须**诚实**标注 `evidence_missing`/`needs_review`，禁止假完整占位；
- 二次探索须**复用登录会话、从菜单点击到达**，不得直接打开地址落到登录页；
- `caseNo = testPointId`；`featurePaths` 必须是可导航真实 URL；
- 写操作在只读探索下必然 `evidence_missing`，属正常诚实标注。

**本次仅产出审查报告，未改动任何代码。** 待你确认是否按上述方案（尤其 #1 实现 `entry_only`、#2 页面盘点、#4 占位治理）动手修复。

---

## 4. 待你拍板的两个前置问题

1. **是否授权按上述方案修复**？其中 #1 的 `entry_only` 实现、#2 的页面盘点 pass 属于「探索_后」链路改动，属于你已解除冻结的改造范围，但仍需你点头。
2. **当前 live demo 库全是 `other.entry` 占位坏数据**：修复前是否需要我先清掉这批坏数据，再跑一遍真实登录管线（demo 或无登录合成系统）做端到端验证？
