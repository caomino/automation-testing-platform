# 自动化测试平台 · 可执行 PRD v1.3

> 主规格（`自动化测试平台-主规格.md`）的可执行分解。每个任务 = 单一交付物 + 可独立验证。AI agent 可按任务依次执行，**每完成一个任务跑通 verification 才进下一个**。
> 落地纪律：**Contract-first → TDD → 增量 → 自验 → checkpoint 签字**。

---

## 0. 文档目的

| 项 | 说明 |
|----|------|
| 用途 | 把"主规格"从"是什么"变成"怎么一步步做出来" |
| 读者 | 实施工程师 + 多个并行 AI agent |
| 颗粒度 | 单任务 ≤ 半天工作量；交付物明确；验收可机检 |
| 执行 | 严格按依赖顺序；P0 checkpoint 通过才进 P1；P1 checkpoint 通过才进 P2；… |
| 自验 | 每任务交付前必须自验（构建/测试/点击），不"toast 说完成"代替真功能 |

---

## 1. 执行原则（Superpowers 工作流）

1. **Contract-first**：每 stage I/O Boundary（zod schema）定稿后才写实现。
2. **TDD**：先写 `*.verify.ts`，跑红，再写实现，跑绿。
3. **增量**：每完成一个任务立即跑 verification；不堆积未验证代码。
4. **Subagent 并行**：同阶段内无依赖任务可并行（如 stage-login 与 stage-execute 独立）。
5. **Human checkpoint**：每个 P（阶段）结束跑全 verify + 冒烟，**你签字才进下一 P**。
6. **自验**：交付前开发者必须自验（构建 + 测试 + 关键路径点击/运行），不自我打钩。

---

## 2. 任务总览（P0~P7）

> **格式**：ID | 标题 | 描述 | 依赖 | 交付物 | 验收 | 验证方法 | 估时

---

### P0 地基（约 1-2 周，**⚠ checkpoint**）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P0-T01** | monorepo + strict TS + ESLint + Prettier | — | 0.5d |
| **P0-T02** | `contracts` 包骨架 + zod schema 工具 | T01 | 0.5d |
| **P0-T03** | §5 各 stage I/O Boundary 表 + frozen fields + 错误码常量 | T02 | 1d |
| **P0-T04** | `infra-logger` 包（外部目录+滚动+保留+UI 配置持久化） | T01 | 1d |
| **P0-T05** | Electron `safeStorage` 凭证封装（`infra-cred`） | T01 | 0.5d |
| **P0-T06** | Playwright 单例 Chromium + MCP 适配器骨架（`engine-mcp`） | T01 | 1d |
| **P0-T07** | 度量脚本（100 分制 + P0 兼容矩阵 70 项 + 样例系统接入） | T02 | 1d |
| **P0-T08** | CI 骨架（lint + typecheck + test + verify.ts + coverage） | T01 | 1d |
| **P0-T09** | 文档：contracts README + I/O Boundary 冻结声明 + 变更流程 ADR | T03 | 0.5d |
| **P0-T10** | 模块接口契约定义（11 模块冻结接口 + zod schema + Mock 数据） | T02,T03 | 2d |

**P0 验收门**：`pnpm build/lint/test/verify` 全绿；I/O Boundary zod schema 全部就位；logger 写/滚/删 verify 通过；度量脚本可运行；模块接口契约文档评审通过。

---

### P1 绑定内核（约 2-3 周，**最易返工，先啃，⚠ checkpoint**）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P1-T01** | 复用 `caseFieldMapping` + `functionPointProvenance` → `stage-feature` 包 | P0 | 1d |
| **P1-T02** | `assignFeatureTestPointIds`（系统缩写_父目录缩写_子系统缩写_NN，子系统维度递增）+ verify | T01 | 0.5d |
| **P1-T03** | `templateScenarioEngine` 全动作 + depth（`stage-case`） | T01 | 1d |
| **P1-T04** | `aiCaseRows.buildAiCandidateCaseRows` 绑定断言 + verify | T03 | 1d |
| **P1-T05** | `caseRows.sanitizeCaseRowsAgainstFeatureRows` 三级对齐兜底 + verify | T04 | 0.5d |
| **P1-T06** | `testProcessWorkbook` meta+8列+列宽+软件截图 + 区域影像.xls round-trip verify | T03 | 1d |
| **P1-T07** | 用例编号 = 测试点标识_NN 绑定 verify（子系统维度递增 + 多场景歧义测试） | T04,T05 | 0.5d |
| **P1-T08** | 手动插入功能点匹配 verify（content 兜底 + 自动测试点标识） | T01,T05 | 0.5d |
| **P1-T09** | 复杂逻辑分层（5 层 + 手动开关默认 OFF + 自动识别弹提示）骨架 | T03 | 1d |
| **P1-T10** | 用例生成 scope 选择（selected_modules \| all + 状态栏显示已选 N/M + 模态勾选 + 按模块分组生成） | T03,T04 | 0.5d |

**P1 验收门**：用区域影像.xls + 至少 2 套其他样例跑全场景生成；100% 出用例；全场景覆盖正常/异常/边界/流程/权限；round-trip diff=空；手动添加匹配 verify 通过；scope 选择 verify（选中模块只生成选中范围）；**P1 checkpoint 签字**。

---

### P2 全场景 + 探索简化（约 2-3 周）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P2-T01** | 模块树 CRUD UI（探索屏） | P1 | 1d |
| **P2-T02** | "人工补充"按钮 → 录制 click path → 去重入树 | T01 | 1d |
| **P2-T03** | 全动作模板覆盖 verify（用 7 套样例跑全场景） | P1 | 1d |
| **P2-T04** | depth standard/deep/risk 叠加边界/权限步骤 | T03 | 1d |
| **P2-T05** | needs_review 高亮 + 模块树可视化 | T01 | 0.5d |
| **P2-T06** | 人工补充自动开浏览器 + 模块树多选 + 默认插入下方 + 记录 URL/标题/路径/会话 | T02 | 1d |
| **P2-T07** | 人工补录两段式：弹窗只录制（URL/标题/操作路径）→ 写入"待入树列表"（探索屏永久区）→ 用户选中模块树某行后对列表项行内操作 [入树(插入下方)]/[修改]/[删除] | T06 | 1d |

**P2 验收门**：7 套样例跑全场景 100% 出用例；needs_review 可视化正确；人工补充去重 verify 通过；自动开浏览器+多选+插入位置 verify 通过；**两段式 verify（录制→待入树列表→选中行插入指定位置）通过**。

---

### P3 登录跨域（约 2 周）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P3-T01** | 三模式登录（no-login 免登录 / credential 账号密码 / manual-takeover 人工接管，所有系统类型一致） | P0 | 1d |
| **P3-T02** | MCP-first 单例可见浏览器 | P0 | 1d |
| **P3-T03** | 凭证自动填 + 验证码/手机号人工接管（保留同可见浏览器同人） | T01,T02 | 1d |
| **P3-T04** | 跨域两阶段复用门户会话（`prepareMcpProjectSession`，新平台规划函数） | T02 | 1d |
| **P3-T05** | 子系统 URL 接入（经父门户浏览器会话捕获 URL+标题；仅子系统用浏览器捕获，门户/单系统 URL 手动输入） | T04 | 0.5d |
| **P3-T06** | 登录前置门：探索前检查当前系统登录状态，未登录弹登录窗；**登录不设独立页面/侧栏入口**，仅弹窗触发；弹窗**带入项目管理中配置的登录方式（只读）**+ 账号自动回填（密码 safeStorage 解密），按配置方式执行登录 | T01,T03 | 0.5d |

**P3 验收门**：三模式跑通（含免登录直进）；跨域复用会话 verify 通过；子系统 URL 经父门户浏览器捕获闭环；**探索前未登录被拦截并弹登录窗 verify 通过**。

---

### P4 探索引擎（约 2-3 周）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P4-T01** | DOM 语义抽象层（read DOM，不依赖框架） | P3 | 1d |
| **P4-T02** | `McpExplorationCheckpoint` 断点续跑 | T01 | 1d |
| **P4-T03** | needs_review 高亮 + 模块树可视化（与 P2-T05 集成） | P2,T01 | 0.5d |
| **P4-T04** | P0 兼容矩阵 70/70 verify（7 套样例跑通，覆盖 5 类框架） | T01,P0-T07 | 2d |
| **P4-T05** | closed Shadow DOM / Canvas 等 Out-of-Scope UI 标注 | T01 | 0.5d |

**P4 验收门**：7 套样例遍历 70/70；断点续跑通过；Out-of-Scope 标注到位。

---

### P5 执行 + 缺陷（约 2-3 周）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P5-T01** | Playwright 直连执行器（确定性，免 LLM 每步） | P1 | 1d |
| **P5-T02** | 浏览器×OS 矩阵 | T01 | 1d |
| **P5-T03** | **数据隔离红线 verify**（owner=本任务 + 前后快照比对） | T01 | 1d |
| **P5-T04** | 缺陷六列 + 截图上传 + lightbox | T01 | 1d |
| **P5-T05** | 执行结果/缺陷 Excel 导入导出 + round-trip 保真 | T01 | 1d |
| **P5-T06** | 执行 scope 选择（selected_modules \| all + 系统→模块树形列表 + 逐行用例状态 ✓/⏳/未执行 + 树形勾选执行） | T01 | 0.5d |

**P5 验收门**：样例用例执行产出缺陷表；隔离 verify 通过；round-trip diff=空；scope 选择 verify（选中模块只执行选中范围）。

---

### P6 应用外壳 + Electron（约 2 周）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P6-T01** | React + Vite 应用骨架（10 屏：工作台/探索/功能点/用例/执行/缺陷/AI配置/日志管理/项目管理/知识库） | P1-P5 | 2d |
| **P6-T02** | 应用→stage-* adapter 编排层 | T01 | 1d |
| **P6-T03** | Electron 封装 + Chromium 共享 + 安装包构建 | T01 | 1d |
| **P6-T04** | 完整链路跑通（登录→探索→功能点→用例→执行→导出 Excel） | T01-T03 | 1d |
| **P6-T05** | 项目管理独立屏⑨（无弹窗：当前项目卡 + 内联编辑 + 内联新建表单[类型三选一：门户/单系统=URL 手动输入；子系统=选父门户+路径显示+URL 经父门户浏览器捕获] + 登录方式三选一[免登录/账号密码/人工接管，所有类型一致] + 账号密码字段（非免登录时）+ 内联删除确认[输入项目名解锁] + **当前项目系统列表（点击行=`setActiveSystem()` 设为当前系统并跳工作台）**） | T01 | 1d |
| **P6-T06** | 工作台改**当前系统视图**（只显示当前系统的登录状态/阶段进度/用例数/执行情况/最近活动；项目名内嵌系统卡；[切换系统 ▾] 下拉=本项目全部系统+进入项目管理入口；快速操作链 [登录系统]（弹窗，带入项目管理配置的登录方式，只读；无侧栏独立入口）→[进入探索]→生成用例→开始执行→缺陷）+ Topbar per-system 登录 pill（`✓ 已登录 · {当前系统名}`，未登录显示 🔐；切换系统入口=工作台下拉+屏⑨，切换项目只在屏⑨） | T01 | 1d |
| **P6-T07** | 用例生成选择面板（默认隐藏，状态栏 `[已选 N/M 模块][选择模块][生成选中][全部生成]`，按钮触发模态勾选） | T01 | 0.5d |
| **P6-T08** | 执行树形列表（系统根节点 → 模块子节点，逐行用例状态 ✓已执行/⏳执行中/未执行，树形勾选 scope） | T01 | 0.5d |
| **P6-T09** | 屏⑩ 知识库（左侧范围列表：🌐 通用+各系统；右侧单文本框编辑；无条目概念；`KnowledgeBase { globalPrompt, systemPrompts }` 持久化） | T01 | 0.5d |
| **P6-T10** | 知识库注入：任何 AI 调用（功能点生成/用例生成/AI 辅助执行）注入 当前系统提示词（高优先）+ 通用提示词（低优先），冲突时系统提示词覆盖 | T09 | 0.5d |
| **P6-T11** | 复制到 Excel：功能点审核表 + 测试用例表各加 [📋 复制到 Excel] 按钮（剪贴板 HTML+TSV 双格式，HTML 含纵向合并 rowspan，粘贴 Excel 保真） | T01 | 0.5d |

**P6 验收门**：`pnpm electron-builder` 出可安装包；装到桌面可启动跑通一条完整链路；项目 CRUD 全流程 verify 通过（三类型创建 + 子系统 URL 浏览器捕获 + 登录三选一 + `setActiveSystem()` 全应用跟随 + 删除需输入项目名）；**工作台 verify：只显示当前系统数据，切换系统（工作台/屏⑨）后 4 状态卡+最近活动+topbar pill 跟随刷新**；**知识库 verify：系统提示词优先级 > 通用（注入冲突用例）**；**复制 Excel verify：粘贴到 Excel 列结构+纵向合并保真**。

---

### P7 商业化（约 2-4 周）

| ID | 标题 | 依赖 | 估时 |
|----|------|------|------|
| **P7-T01** | 许可/激活（在线/离线） | P6 | 1w |
| **P7-T02** | RBAC / 多租户 | P6 | 1w |
| **P7-T03** | 品牌白标（logo/色/标题） | P6 | 0.5w |
| **P7-T04** | 回归历史（多轮执行对比） | P5 | 1w |
| **P7-T05** | 自动更新 | P6 | 0.5w |
| **P7-T06** | 导出汇总（多系统/多轮汇总 Excel） | P1 | 0.5w |

**P7 验收门**：许可激活可用；RBAC/品牌配置可见；回归历史可对比；自动更新可推送。

---

## 3. 任务执行模板

每任务按以下模板执行：

```
[Task ID] 标题
─────────────────
描述：具体做什么（≤3 句）
依赖：[Task IDs]
交付物：files/folder + tests
验收：机检 check 项
验证方法：build/lint/test/runtime check
估时：X d
风险：Y + 缓解
进度：[ ]/[P]
```

执行步骤（每任务）：
1. Read 相关代码/spec/合约
2. 写 verify 测试（先红）
3. 写实现（最小化）
4. 跑 verify（绿）
5. 自验（点击/构建/关键路径）
6. 更新 memory + spec（如有）
7. 通知用户（如 P 结束 = checkpoint 签字）

---

## 4. 总估时与里程碑

| 阶段 | 估时 | 里程碑 |
|------|------|--------|
| P0 地基 | 1-2 周 | 验收门通过 + 你签字 |
| P1 绑定内核 | 2-3 周 | 区域影像.xls 跑通 + 签字 |
| P2 全场景+简化探索 | 2-3 周 | 7 套样例全场景 |
| P3 登录跨域 | 2 周 | 三模式 + 子系统接入 |
| P4 探索引擎 | 2-3 周 | 70/70 兼容矩阵 |
| P5 执行+缺陷 | 2-3 周 | 数据隔离 verify + 安装 |
| P6 应用外壳+Electron | 2 周 | 可安装包 + 完整链路 |
| P7 商业化 | 2-4 周 | 许可/RBAC/品牌 |
| **总计** | **约 4-6 个月** | 数月级产品 |

---

## 5. 验收门（每 P 必须过）

| 检查 | 命令/方法 |
|------|-----------|
| Lint 0 error | `pnpm lint` |
| Typecheck pass | `pnpm typecheck` |
| Unit test 全绿 | `pnpm test` |
| `*.verify.ts` 全绿 | `pnpm verify` |
| Coverage ≥ 80% | `pnpm coverage` |
| 无循环依赖 | `pnpm madge` |
| 构建成功 | `pnpm build` |
| 关键路径自验 | 手动/自动点击 + 截图证据 |

**P 通过** = 上述全过 + 你签字。

---

## 6. 风险登记与缓解

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 绑定歧义（同内容多功能点） | 保留 caseNo 主键 + (测试点+内容) 兜底 + verify 覆盖 |
| R2 | 探索不全 | 人工补充工具 + 模块树 CRUD + needs_review 高亮 |
| R3 | 复杂逻辑生成质量 | 5 层机制 + 证据门 + 人工纠错 + qualityGate |
| R4 | 数据隔离违反 | P5-T03 verify + 执行前后快照比对 + 自动化断言 |
| R5 | 桌面浏览器环境差异 | Electron 自带 Chromium 固定内核 |
| R6 | 强反自动化/CAPTCHA | 显式边界，UI 标注"不支持"，人在环 |
| R7 | 工作量超期 | 数月级预期，按 P 拆分 + checkpoint 控进度 |
| R8 | 7 套样例已定义（补充定义 §七），可访问运行环境待用户提供 | 先在区域影像+妇幼跑通；其余待环境到位后补测 |
| R9 | 我"自验"流于形式 | **每 P checkpoint 强制跑全 verify + 关键路径自验截图** |

---

## 7. 下一步（今日起步）

**P0-T01**：创建 monorepo + strict TS + ESLint + Prettier。

具体动作：
1. `D:\newTest` 现有结构清理（保留 docs/ prototype/ .workbuddy/，其他移到 _archive/）
2. 初始化 pnpm workspace：`pnpm-workspace.yaml` + `package.json`（strict TS + ESLint + Prettier）
3. 创建空 packages/：`contracts/ infra-logger/ infra-cred/ engine-mcp/`
4. `pnpm install` + `pnpm build` + `pnpm lint` 跑通

**验证**：
- `pnpm -r build` 0 error
- `pnpm -r lint` 0 error 0 warning
- `pnpm -r typecheck` pass
- 任一 package 的 hello world 测试通过

**自验**：跑一遍上述命令，截图证据。

---

**版本**：v1.3（2026-08-15）
**v1.3 变更**：v1.5 原型同步——P6-T06 重写为工作台当前系统视图（切换系统下拉+topbar per-system 登录 pill）；P6-T05 重写（子系统 URL 经父门户浏览器捕获+登录三选一+当前项目系统列表 `setActiveSystem()`）；P6-T01 9→10 屏（加知识库）；新增 P6-T09/T10（屏⑩ 知识库+AI 注入优先级）、P6-T11（复制到 Excel）、P2-T07（人工补录两段式）、P3-T06（探索前登录前置门）；P3-T01 登录三模式枚举改 no-login/credential/manual-takeover；P2/P3/P6 验收门同步。
**v1.2 变更**：v1.4 底层单系统原则同步——P6-T05 重写为独立屏⑨ 项目管理（无弹窗 + 三类型项目模型 + `setActiveProject()`）；P6-T06 重写为 Topbar 只读路径 chips（移除切换入口）；新增 P6-T07（用例选择面板默认隐藏+模态触发）、P6-T08（执行树形列表+用例状态）；P6-T01 8 屏→9 屏；P1-T10/P5-T06 scope 选择 UX 描述同步。
**v1.1 变更**：新增 P0-T10（模块接口契约定义）；新增 P1-T10（用例生成 scope 选择）；新增 P2-T06（人工补充自动开浏览器+多选）；新增 P5-T06（执行 scope 选择）；新增 P6-T05（项目 CRUD）+ P6-T06（路径显示+模式切换）。
**配套**：`自动化测试平台-主规格.md`（WHY/WHAT） + `模块接口契约与开发规范.md`（契约+规范+校验） + 本 PRD（HOW 一步步执行）。