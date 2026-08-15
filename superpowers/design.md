# 自动化测试平台 · 设计文档（design.md · v2 设计验证后）

> Superpowers Phase 1/2 产出（Brainstorming + Design Validation）
> 依据：docs/ 主规格 v1.5 + 可执行PRD v1.3 + 模块接口契约 v1.2 + 问题分析 v1.0 + 原型 10 屏 v1.5

---

## 0. 决策记录（已确认 + 本轮新增）

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | **交付标准** | **测试工程师视角浏览器自测**（正常+异常场景），不满足于"跑通" |
| D2 | 子 agent 模型分配 | 默认层级：Orchestrator/Reviewer=reasoning，Builder/Ops=lite，复杂 Builder=reasoning |
| D3 | 测试闭环落点 | 两者都要：平台 UI 端到端 + 引擎浏览器控制 |
| D4 | 被测环境 | 真实系统 5 个（§1.1）；先 D 盘临时项目冒烟 → 通过后真实系统 |
| D5 | 浏览器能力 | 浏览器自动化 CLI 自行安装 |
| **D6** | **适配目标** | **适配市面上 95%+ 的标准 Web 管理系统**：DOM 语义抽象不依赖框架，70 项兼容矩阵量化验证（§6） |
| **D7** | **探索安全** | **只读探索模式**：可看结构/点菜单，默认不操作数据（陕西人大系统硬约束） |
| **D8** | **AI 纠偏** | **知识库指令配置**：AI 输出不符合要求时，通过屏⑩知识库 prompt 兜底约束 |

---

## 1. 产品定位与范围

**商业自动化测试平台**：用 Playwright 控制浏览器探索被测 Web 系统 → 生成功能点表(九列) → 生成测试用例表(八列) → 执行 → 产出缺陷表。人在环接管验证码/MFA。

**Out-of-Scope（UI 显式标"不支持"）**：closed Shadow DOM / 纯 Canvas·WebGL / 远程桌面 / 原生应用 / 强反自动化 / 无人值守 CAPTCHA-MFA。

### 1.1 真实被测系统清单（D4）

| # | 系统 | 登录 | 技术栈 | 优先级 | 约束 |
|---|------|------|--------|--------|------|
| S1 | Fantastic-admin | 无密码 | Vue3 后台 | 常规 | 免登录 |
| S2 | RuoYi（demo.ruoyi.vip） | admin/admin123 | Vue 后台 | 常规 | 账号密码 |
| S3 | Gin-Vue-Admin | admin/123456 | Go+Vue | 常规 | 账号密码 |
| S4 | mall（macrozheng） | admin/macro123 | 学习教程子项目 | 常规 | 账号密码 |
| **S5** | **陕西人大统一平台**（**门户 + 配置的多个子系统**，创建项目时选父门户+浏览器捕获 URL） | **admin/Sxrd@2025** | **政府系统（待浏览器确认）** | **⭐ 完全适配（验收放最后，设计提前兼容）** | **只读结构 + 菜单可操作 + 数据不可操作** |

> S5 是验收硬指标：`https://typt.sxrd.gov.cn:8099/typtnew/`，只读探索、点菜单导航，禁止增删改数据。密码仅存加密存储（infra-cred）。

**S5 实测结构（2026-08-15 浏览器探测确认）**：
- 技术栈：Vue + Element UI + hash 路由，**无 iframe、无验证码**（admin/Sxrd@2025 直接登录）。
- 门户顶层 6 模块：首页 / 办理中心 / 功能中心 / 联络中心 / 数据中心 / 个人中心。
- 功能中心下 **13 个子系统**：协同办公系统、履职平台、电子阅文、备案审查系统、目标责任考评、统一平台、党建管理系统、信访管理系统、预算联网监督、发文管理、签报管理、会议管理、办公辅助。
- 印证主规格 §18 门户+多子系统模型，是"完全适配"的核心靶场。

---

## 2. 架构总览（pnpm monorepo，11 package + app）

```
test-platform/
├── docs/            # 全局唯一文档（5 份）
├── prototype/       # 10 屏原型
├── superpowers/     # 开发过程文档（design/plan/review/final_report）
├── config/default.yaml
└── packages/
    ├── contracts/       # ① 唯一契约（0 依赖）
    ├── infra-logger/    # 外部日志
    ├── infra-ai/        # AI 模型配置
    ├── infra-cred/      # 凭证抽象（Web 用本地加密文件，后期可换 safeStorage）
    ├── engine-mcp/      # Playwright 单例可见浏览器 + MCP 适配器 + DOM 抽象
    ├── stage-login/     # 三模式登录
    ├── stage-explore/   # MCP 遍历 + 模块树 CRUD + 人工补录
    ├── stage-feature/   # 九列功能点 + 测试点标识
    ├── stage-case/      # 八列用例 + 编号绑定 + 模板引擎 + round-trip
    ├── stage-execute/   # Playwright 直连 + 数据隔离
    ├── stage-defect/    # 六列缺陷 + 截图
    └── app/             # React+Vite UI 10 屏 + 编排 + Node 后端（Web 外壳，可插拔换 Electron）
```

**依赖拓扑**：contracts(0依赖) → infra-*/engine-mcp → stage-* → app。**隔离铁律**：每 stage 仅暴露 `run(input): Promise<Output>`，类型全在 contracts，zod 校验。

---

## 3. 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 应用形态 | **Web 应用（React + Vite + Node 后端）+ 集中部署** | 多人浏览器访问，零安装零更新，对小白最友好；外壳可插拔，后期可换 Electron（stage-* 纯逻辑不受影响） |
| 探索/登录 | Playwright MCP | AI 驱动探索 |
| 执行 | Playwright 直连 | 确定性免 LLM |
| 凭证 | **infra-cred 抽象接口**（Web 阶段用本地加密文件，后期 Electron 可换 safeStorage） | 外壳无关 |
| AI 模型 | 独立配置页 | 不写死 |
| 代码 | strict TS + ESLint + vitest + zod | §13 规范 |
| 浏览器自测 | Playwright / browser-use CLI | 测试工程师视角自测 |

---

## 4. 五阶段流水线

| 阶段 | 一句话 | 输出 |
|------|--------|------|
| ① 登录跨域 | 三模式（免登录/账号密码/人工接管） | SessionHandle |
| ② 探索 | MCP 遍历 + 模块树 CRUD + 人工补录 | ModuleTree |
| ③ 功能点审核 | 九列 + 合并 + 增删 + 整体确认 | FeatureTable |
| ④ 测试用例 | 八列 + meta + 选中模块/全部 + 分 sheet | CaseTable |
| ⑤ 执行/缺陷 | 独立两阶段 + 数据隔离红线 | ExecutionReport / DefectTable |

---

## 5. 核心数据模型（冻结契约关键点）

**测试点标识（两级口径）**：
- **base（3段）** = `系统缩写_父目录缩写_子系统缩写`，如 `QYYX_PZ_JCX`，存 meta 头。
- **功能点表"测试点标识"列（base_NN，4段）** = base + `_NN`，NN **按子系统维度从 01 递增**，行级唯一主键。
- **用例编号** = 所绑定功能点的完整 4 段值（即 base_NN）。

**绑定链（硬断言）**：`用例编号 === 功能点测试点标识列(4段)`；`测试内容 === 功能点.测试点`。

**九列**：序号/测试类型/需求章节/系统名称/主模块/子模块/功能点/测试点/测试点标识
**八列**：用例编号/测试内容/步骤/输入及操作说明/预期结果/初次测试结果/回归测试结果/测试结论（列宽 `[18,16,8,34,34,14,14,12]`）

---

## 6. 适配大部分系统（D6 · 本轮审核补入，核心）

> 目标：探索/执行引擎**不依赖任何前端框架**，适配 jQuery/Vue2/Vue3/React/Angular/老政府系统。

**6.1 DOM 语义抽象层（engine-mcp 核心）**
- 只读 **标准 HTML 语义**识别可交互元素：`button/a/input/select/textarea/table/ul/li/form`，不依赖框架组件名。
- 元素定位用 **role/text/label/位置** 而非框架类名（如不用 `.ant-btn`、`.el-button`）。
- 处理 iframe（同源可读、跨域标 FRAME_ACCESS_DENIED）、open Shadow DOM 可读、closed 标 Out-of-Scope。
- 路由变化检测（hash/history/MPA）+ 动态加载等待（AJAX 完成）+ 分页/虚拟滚动适配。

**6.2 适配目标与验证（95% 覆盖）**
- 目标：适配**市面上 95%+ 的标准 Web 管理系统**（jQuery/Vue2/Vue3/React/Angular/老政府系统/门户多子系统）。
- 70 项兼容矩阵（框架 20 + 路由 15 + 容器 20 + 恢复 15）逐项映射到 DOM 抽象层能力点，作为 95% 覆盖的量化验证。
- 度量脚本（100 分制）对真实系统跑分，**S5 陕西人大（含全部子系统）≥85 分**才算"完全适配"达标。

**6.3 子系统接入（配置驱动 · 经父门户浏览器捕获，以原型屏⑨ + 主规格 §18 为准）**
- 子系统**不是自动发现**，是**创建项目时配置**：选"子系统"类型 → 选父门户（跨项目）→ 打开浏览器 → **人工进入子系统** → 点[从浏览器捕获] → 捕获 URL + 页面标题 + 会话状态 + 导航路径（§18.5 系统注册增强）。
- URL 来源差异：门户/单系统 = 手动输入；**仅子系统 = 经父门户浏览器会话捕获**。
- 每个子系统底层都是单系统（§18.1），独立走"探索→功能点→用例→执行→缺陷"流水线。

**6.4 特殊结构覆盖（2026-08-15 调研扩充，对齐 95% 目标）**
- **需专项处理**：微前端(qiankun/micro-app)、iframe 嵌套、低代码(amis/jeecg)、老技术栈(JSP/ASP.NET)、复杂表格(vxe-table 虚拟滚动)、动态表单(Formily)、复杂树(zTree)、自定义下拉(select2)、富文本(wangEditor/TinyMCE)、SSO/MFA(MaxKey)、多 Tab、路由守卫。
- **Out-of-Scope（UI 标"不支持"）**：Canvas/WebGL 后台、closed Shadow DOM。
- **人在环处理**：验证码/短信/扫码/MFA（三模式已覆盖）。
- 完整清单见 `D:\test-platform-smoke\research\特殊结构测试项目清单.md`，作为扩展测试靶场。

---

## 7. 只读探索模式 + 数据隔离红线（D7 · 本轮审核补入）

**7.1 只读探索模式（S5 硬约束）**
- 探索阶段把可交互元素分两类：
  - **导航类**（菜单/链接/tab/面包屑/分页）→ 可点击遍历结构。
  - **数据类**（新增/编辑/删除/提交按钮、表单输入框）→ **默认不操作**，标记 `needs_review` 供人工确认。
- 系统级开关 `readonlyExplore`：S5 强制 ON；对 S5 任何数据类操作一律阻断并提示"只读系统，禁止操作数据"。

**7.2 数据隔离红线（对齐 PRD P5-T03）**
- 仅新增 `owner=本任务` 数据；读历史/他人数据只读；回滚只删本任务新增行；执行前后快照比对断言无历史变更。

---

## 8. 知识库指令配置闭环（D8 · 本轮审核补入）

> 用户要求：AI 不按要求输出时，可在屏⑩知识库配置指令兜底纠偏。

- 知识库 `KnowledgeBase { globalPrompt, systemPrompts }`（主规格 §18.8、契约 §九）。
- 任何 AI 调用（功能点生成/用例生成/AI 辅助执行）注入：**系统提示词（高优先）+ 通用提示词（低优先）**，冲突时系统覆盖通用。
- 可配置的**适配规则兜底**（示例，用户可在知识库改）：
  - "探索只读，不操作数据；菜单可点击遍历"
  - "用例编号 = 测试点标识_两位序号"
  - "每个功能点至少覆盖：正常路径 + 边界值 + 异常输入"
- 验收：验证知识库指令确实影响 AI 输出（配置一条约束 → AI 输出遵循）。

---

## 9. 测试策略（测试工程师视角，正反向闭环）

三层校验 + 两阶段自测：

| 层 | 手段 | 覆盖 |
|----|------|------|
| 单测 + 契约 | vitest `*.test.ts` + `*.verify.ts`（TDD 先红后绿） | 函数级 + I/O 契约 |
| 数据保真 | 金标准 round-trip diff=空 | 九列/八列/meta/合并/截图行 |
| 浏览器自测 | 冒烟 → 真实系统（下） | 引擎真实控制浏览器 |

```
阶段 A · 冒烟（D:\test-platform-smoke\ 临时项目）
  └─ 自造 2~3 个本地管理系统页（CRUD + 必填校验 + 异常提示）
  └─ 正反向：正常通过 + 异常（必填缺失/不存在数据/错误输入）正确报错

阶段 B · 真实系统（5 个）
  └─ S1~S4 常规：登录 + 正常场景 + 异常场景（错误密码/空查询/越权）
  └─ S5 陕西人大：只读探索 + 菜单遍历 + 结构识别，禁数据操作
  └─ 产出：执行报告 + 缺陷表 + 截图证据
```

---

## 10. 模型分配（Agent Team，D2）

| 角色 | 模型 | 承担 |
|------|------|------|
| Orchestrator（我） | reasoning | 路由/优先级/contracts 冻结把关 |
| Reviewer | reasoning | spec 合规 + 代码质量两关 |
| Builder（简单：infra-logger/ai/cred） | lite | 机械实现 |
| Builder（复杂：stage-feature/case/explore/execute、app） | reasoning | 核心业务 + 浏览器控制 + UI |
| Builder（中等：stage-login/defect、engine-mcp） | default | 常规逻辑 |
| Ops | lite | 构建/测试/CI |

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 绑定歧义 | caseNo 主键 + (测试点+内容) 兜底 + verify |
| 探索不全 | 人工补录 + 模块树 CRUD + needs_review |
| 复杂逻辑生成质量 | 5 层机制 + 证据门 + 人工纠错 + qualityGate |
| 数据隔离违反 | 只读探索模式 + 快照比对 |
| 政府系统老技术栈/iframe | DOM 语义抽象 + 70 项矩阵 + 只读模式 |
| 真实系统不可达/改版 | 冒烟先行 + 5 系统冗余 + 失败不阻断 |
| **返工** | **Contract-first + TDD + 每 P 签字 + 知识库纠偏** |

---

## 12. 待确认（签字门）

1. **D6 适配大部分系统**（DOM 语义抽象 + 70 项矩阵）是否认可？
2. **D7 只读探索模式**（S5 可看结构/点菜单/禁数据操作）是否认可？
3. **D8 知识库指令配置闭环**（AI 输出兜底纠偏）是否认可？
4. **S5 陕西人大 = 最高优先级完全适配**，验收标准（只读探索 + 结构识别 + 菜单遍历）是否认可？

**签字方式**：回复"确认设计"或逐条指出修改点。

---

## 13. 新增需求增补：前后端分离 + 多窗口（一窗一模块）· 2026-08-15 补充

> 本节为**新增用户需求**，对 §3「应用形态」做**修订**：原 §3 定为"Web 应用优先、Electron 后期可插拔"；现用户要求**现在即以 Electron 多窗口为交付形态**，且"一个 OS 窗口承载一个模块"。本节取代 §3 应用形态决策，其余架构（monorepo / contracts 边界 / 五阶段流水线 / DOM 抽象）不变。

### 13.1 真实需求（非表面）
- **前后端分离**：前端 UI 与后端逻辑经 `contracts` 解耦，各自可并行开发（呼应 §2 依赖拓扑：contracts → infra*/engine → stage* → app）。
- **多窗口**：运行态多个 OS 窗口，**一个窗口承载一个模块（一屏）**。
- **分模块开发**：每模块独立可建、可并行（子 agent 各负责一个）。
- **加速**：此前子 agent 并行跑 `pnpm verify` 抢同一 node_modules 卡死一天一夜；执行方式必须换。

### 13.2 文档核查（回应"是不是后端整体"）
- 非后端整体：PRD `P6 应用外壳+Electron` 已规划前端（P6-T01 React+Vite 10 屏、P6-T03 Electron 封装、P0-T05 Electron safeStorage）。
- 缺口：P6-T01 是**单窗口 10 屏切换**，与"多窗口一窗一模块"不同 → 需把 P6 扩展为 Electron 多窗口模型。

### 13.3 目标架构（增补）
- **分离边界**（沿用 §2）：唯一边界 = `@test-platform/contracts` 类型；渲染层不直接 import stage-* 内部，经主进程 API（Electron IPC 或 mock provider）调用，入参出参均为 contracts 类型。先 mock provider 让前端独立可跑，后接真实后端（main 加载 stage-* + engine-mcp，IPC 暴露）。
- **多窗口·一窗一模块**：Electron 主进程 `WindowManager`；模块清单（10）= 工作台/探索/功能点/用例/执行/缺陷/AI配置/日志/项目管理/知识库，每模块 = 一个 `BrowserWindow`。每窗口独立 state；跨窗口共享态（当前系统/项目/会话）经 main store 经 IPC 广播同步；引擎/会话（engine-mcp）在 main 按 system 隔离，供各窗口调用。
- **开发单元**：每个（前端 module + 对应后端 stage 包）配对，由一个 CODE-ONLY 子 agent 负责，互不依赖、可真并行。

### 13.4 防卡死执行模型（核心，回应卡死）
- 子 agent = **仅改码（CODE-ONLY）**：禁 `pnpm`/`install`/`verify`/`typecheck`/`lint`、禁碰 `node_modules`、禁碰 `packages/contracts/**`。
- 门禁**集中、串行、前台**跑：所有 agent 返回后主 agent 一次性 `timeout 300 pnpm -r verify`（脚本已带 `--no-cache`）；绝不并行抢 node_modules。
- 前台 agent（不用 `run_in_background`），输出可见；命令强制 `timeout`；contracts 冻结硬护栏。

### 13.5 待裁定（sign-off）
1. 多窗口 = Electron 原生多窗口（推荐，PRD 已含 Electron）确认？
2. "一窗一模块"按产品形态（每屏独立 OS 窗口）设计同意？
3. 是否将"多窗口一窗一模块"补入 `docs/主规格`（超出 P6 单窗口定义，改 docs 需用户同意）？
4. 11 个未批准 `packages/app` 草稿文件：保留完善 / 删除重建（开工前定）？
