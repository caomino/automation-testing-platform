# 计划：前后端分离 + 分模块 + 平台多窗口/多工作台（前端开发）

> 触发：用户要求"启动前后端分离 + 分模块开发"，并明确"多窗口 多工作台"为平台自身能力。
> 本轮目标：把前端开发计划写清并交用户批准；不写代码（Plan 模式）。
> 铁律（沿用）：① 不通过用户要求不擅自改码；② contracts 冻结（4 处改动保留、今后禁改、要改须写原因+审核）；③ docs 改动需用户同意。

## 0. 已确认决策（本次提问）
- **多窗口含义 = B**：平台自身 OS 级多窗口 + 并发多工作台（新能力，超出冻结文档定义）。
- **11 个未批准前端草稿文件**：先不动，等 plan 批准后定处置。
- 之前误写 11 文件（packages/app/*）未获批准 → 本轮起不再碰，处置待定。

## 1. 架构现状核查（证据，非臆测）
| 项 | 结论 | 证据 |
|----|------|------|
| 后端分模块 | ✅ 已落地 | stage-login/explore/feature/case/execute/defect + engine-mcp + infra-*，各独立、受 contracts 约束 |
| 前后端分离契约 | ✅ 图纸在 | packages/contracts = 共享类型/接口边界（DefectRow/FeatureRow/CaseRow 等） |
| 前端实体 | ⚠️ 原为空 | packages/app 曾为零代码（合规核查/审核报告确认）；本次误写 11 文件未批准 |
| 多窗口/多工作台 | ❌ 文档未定义 | 主规格 §18.3 仅"单窗口内切换系统/项目"；"新窗口/Tab"仅作测试场景 V12(target=_blank)。故 B 为超出冻结文档的新能力 |

## 2. 目标架构
### 2.1 前后端分离
- 边界 = `@test-platform/contracts` 类型。Renderer **不直接 import stage-* 内部函数**；经主进程 API（Electron IPC 或 mock provider）调用，入参/出参均为 contracts 类型。
- 分阶段：先 mock provider（前端独立可跑、不被后端阻塞），后接真实后端（main 进程加载 stage-* + engine-mcp，经 IPC 暴露）。

### 2.2 分模块（前端）
- 10 屏 = 10 个独立 module（主规格/PRD P6-T01）：工作台/探索/功能点/用例/执行/缺陷/AI配置/日志管理/项目管理/知识库。
- 各 module 自包含（组件+状态+路由），可独立挂载到任意窗口。

### 2.3 平台多窗口 + 并发多工作台（新能力 B）
- **推荐技术形态：Electron**（原生 OS 多窗口 + 主进程共享引擎/会话）。
  - 每个"工作台" = 一个 `BrowserWindow`，绑定 `systemId`/`projectId`，独立 state。
  - 多工作台并发 = 多个 `BrowserWindow` 同时存活；main 进程维护 `workbenchRegistry`（id→system→window），保证并发隔离与切换。
  - 引擎/会话（engine-mcp）在 main 进程按 system 隔离，供各窗口经 IPC 调用。
- **备选：Web SPA + 浮出面板**（无原生 OS 窗口，窗口=可拖拽浮层/多标签）。
- ⚠️ **技术形态待用户确认（默认推荐 Electron）**——这是地基分叉，选错返工大。

## 3. 执行 SOP（防卡死，沿用上轮根因结论）
1. 子 agent = **仅改码（CODE-ONLY）**：禁 `pnpm`/`install`/`verify`/`typecheck`/`lint`、禁碰 `node_modules`、禁碰 `packages/contracts/**`。
2. 门禁**集中、串行、前台**跑：所有 agent 返回后，主 agent 一次性 `timeout 300 pnpm -r verify`（脚本已带 `--no-cache`）；绝不 6 路并行抢 node_modules。
3. **前台 agent 取代后台**（`run_in_background=false`），输出流式可见；不用"不轮询"导致静默卡死。
4. 命令强制 `timeout`；contracts 冻结硬护栏（改不动就 STOP 上报，绝不自作主张改）。
5. 每波前后 `git diff packages/contracts/` 比对，发现漂移立即回退。

## 4. 分阶段实施
- **阶段 A 架构骨架**：Electron shell + 多窗口管理器 + 工作台注册表 + contracts 类型复用 + mock provider + 工作台屏(module)。先跑通"多窗口 + 并发多工作台"（mock 数据，可见即可验证架构）。
- **阶段 B 逐屏模块**：按原型 + docs 落地其余 9 屏 module（探索/功能点/用例/执行/缺陷/AI配置/日志/项目管理/知识库）。
- **阶段 C 接真实后端**：main 进程加载 stage-*/engine-mcp，IPC 暴露，替换 mock；并按 review.md 的 Major 项逐包修复（仍走 CODE-ONLY + 集中门禁）。
- **阶段 D 收口**：集中 `typecheck/lint/verify` 全绿；更新 review.md；提交仅经用户授权。

## 5. 待用户确认 / 裁定（plan 批准后）
- [ ] **多窗口技术形态**：Electron（推荐） vs SPA 浮出面板？
- [ ] 是否将"平台多窗口 + 并发多工作台"补入 `docs/主规格` + `可执行PRD`（超出冻结文档，需你同意改 docs）？
- [ ] 11 个未批准草稿文件：保留完善 / 删除重建（plan 批准后定）？
- [ ] 阶段 A 是否现在开工（派 CODE-ONLY agent）？

## 6. 关键文件
- 本计划；上轮冻结根因：`swift-forging-curie.md`
- 契约（冻结，禁改）：`packages/contracts/**`
- 前端（待建）：`packages/app/**`（现有 11 草稿未批准）
- 参考：`docs/可执行PRD.md`(P6-T01)、`docs/自动化测试平台-主规格.md`(§18.3)、`prototype/自动化测试平台-原型.html`
