---
design_type: feature
created_at: 2026-08-15
---

# Orchestrator 打通与 App 前端对接设计（含真实 Playwright）

## Intent Contract

```
intent: 打通 PipelineOrchestrator 数据流，集成真实 Playwright 引擎，使 App 前端通过进程内直接调用对接后端模块
constraints:
  - 不修改 contracts 包的冻结契约（GLOBALS §4）
  - 不修改各 stage 包的 run(input)/output 签名
  - app 保持 React + Vite 架构，不引入 HTTP 服务
  - 适配层必须单向：app → contracts/stage，无反向依赖
success_criteria:
  - PipelineOrchestrator.run() 使用真实 Playwright 引擎可完整执行 6 个 stage 并返回 PipelineResult
  - App Workbench 屏幕的登录→探索→功能点→用例→执行→缺陷按钮均可触发真实后端+Playwright 调用
  - 所有现有 verify 测试 + 新增集成测试通过
  - TypeScript 类型检查无新增错误
risk_level: medium
```

## Verification Contract

```
verify_steps:
  - run tests: pnpm --filter orchestrator test
  - run tests: pnpm --filter engine-mcp test
  - run tests: pnpm --filter app test
  - run tests: pnpm -r typecheck
  - check: app 启动后点击"登录系统"→"进入探索"→"功能点审核"→"生成用例"→"开始执行"→"缺陷"按钮
  - confirm: 每步操作后，对应屏幕的数据从"未执行"变为后端真实返回值
  - confirm: Workbench 统计卡片显示真实数据而非 mock
  - confirm: Playwright 浏览器可正常启动、导航、执行用例步骤
```

## Governance Contract

```
approval_gates:
  - 适配层类型转换逻辑需人工审阅（确保 contracts→view 类型映射正确）
  - Playwright 浏览器安装需人工确认（确保环境正确）
  - 真实浏览器执行的 UI 流程需人工确认
rollback:
  - 每个阶段的对接独立提交，可单独回滚
  - PipelineService 保留 mock 回退模式
ownership: 集成由执行 agent 负责，关键转换逻辑需人工审阅
```

## Scope

### In Scope

| # | 工作项 | 说明 |
|---|--------|------|
| 1 | Playwright 浏览器安装 | 确保 chromium 浏览器可下载和启动 |
| 2 | `runCase()` 多步执行增强 | playwright-engine.ts 中 runCase() 支持多步骤用例执行 |
| 3 | PipelineService 适配层 | app/src/services/pipeline.ts，封装 orchestrator + 各 stage 调用 |
| 4 | 类型转换函数 | contracts 类型 → app View 类型（feature/case/exec/defect） |
| 5 | Orchestrator 单阶段执行 | 新增 runStage() 方法支持单阶段执行 |
| 6 | App context 集成 | reducer 中新增 pipeline 相关 actions，替换 mock 数据 |
| 7 | Workbench 屏幕对接 | 登录/执行按钮触发真实 orchestrator 调用 |
| 8 | 全屏幕对接 | Explore/Feature/Case/Execute/Defect 逐屏幕替换 mock |

### Out of Scope

| # | 不在范围 | 说明 |
|---|----------|------|
| 1 | Electron 封装 | 后续 Phase，当前用 Vite dev server 验证 |
| 2 | HTTP API 层 | 采用进程内直接调用 |
| 3 | contracts 包修改 | 冻结契约，不修改 |
| 4 | 各 stage 内部逻辑修改 | 仅修改 orchestrator、engine-mcp 和 app 层 |
| 5 | 跨浏览器矩阵（Win/Mac/Safari） | 当前仅支持 Chrome，矩阵扩展在后续 |

## Decisions

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 集成方式 | 前端直接调用（进程内） | 桌面测试平台无网络需求，类型安全，零开销 |
| 2 | 适配层位置 | app/src/services/pipeline.ts | app 内聚，不污染后端包 |
| 3 | 引擎策略 | 真实 PlaywrightEngine + 可选 mock | 优先真实浏览器，保留 mock 回退 |
| 4 | runCase 执行 | 基于用例 step/operation 多步执行 | 解析用例步骤中的操作指令（click/fill/navigate） |
| 5 | 渐进式对接 | 按屏幕逐个替换 mock | 降低风险，每步可独立验证 |
| 6 | 状态管理 | 复用现有 useReducer | 不引入新状态管理库 |
| 7 | 数据持久化 | 复用 infra-store（已在 orchestrator 中集成） | 无需额外存储层 |

## Surface

### 新增文件

- **`packages/app/src/services/pipeline.ts`** — PipelineService 适配层
  - `createPipelineService()` — 创建服务实例（可选 mock 模式）
  - `runFullPipeline(input)` — 执行完整流水线
  - `runStageLogin(input)` — 单独执行登录
  - `runStageExplore(input)` — 单独执行探索
  - `runStageFeature(input)` — 单独执行功能点
  - `runStageCase(input)` — 单独执行用例
  - `runStageExecute(input)` — 单独执行执行（Playwright 真实浏览器）
  - `runStageDefect(input)` — 单独执行缺陷
  - `launchEngine()` / `closeEngine()` — 引擎生命周期管理
  - 类型转换：`toFeatureView()`, `toCaseView()`, `toExecView()`, `toDefectView()`, `toModuleView()`

### 修改文件

- **`packages/engine-mcp/src/playwright-engine.ts`** — 增强 runCase()
  - `runCase(row: CaseRow)` 改为解析用例 step/operation 字段
  - 支持操作指令：`click(selector)`, `fill(selector, value)`, `navigate(url)`, `press(key)`, `wait(selector)`
  - 支持链式多步骤执行，返回每步 ExecutionStepResult
  - 操作指令解析：从 `row.operation` 中提取语义动作（如"点击【新增】"→ click，"录入文本"→ fill）

- **`packages/orchestrator/src/index.ts`** — 新增单阶段执行
  - 新增 `runStage(stageName, input)` 方法
  - 优化 engine 生命周期（启动/关闭）
  - 支持可选 `engineFactory` 注入（真实 vs mock）

- **`packages/app/src/context.tsx`** — reducer 集成
  - 新增 Pipeline 相关 actions（`PIPELINE_START`, `PIPELINE_STEP_UPDATE`, `PIPELINE_STAGE_DONE`, `PIPELINE_COMPLETE`, `PIPELINE_FAILED`）
  - 新增 pipeline 状态（`pipelineStatus`, `pipelineStep`, `pipelineMessage`）
  - 替换 mock 初始状态为 orchestrator 默认空状态

- **`packages/app/src/screens/Workbench.tsx`** — 对接真实调用
- **`packages/app/src/screens/Explore.tsx`** — 对接真实调用
- **`packages/app/src/screens/Feature.tsx`** — 对接真实调用
- **`packages/app/src/screens/Case.tsx`** — 对接真实调用
- **`packages/app/src/screens/Execute.tsx`** — 对接真实调用
- **`packages/app/src/screens/Defect.tsx`** — 对接真实调用

### API 映射

| Orchestrator Output | App View Type | 转换函数 |
|---|---|---|
| `FeatureRow[][]` | `FeatureRowView[]` | `toFeatureView()` |
| `CaseSheet[]` | `CaseRowView[]` | `toCaseView()` |
| `ExecutionResult[]` | `ExecMatrixRow[]` | `toExecView()` |
| `DefectOutput` | `DefectRowView[]` | `toDefectView()` |
| `ModuleNode[]` | `ModuleNodeView[]` | `toModuleView()` |
| `LoginOutput` | 更新 `system.loginStatus` | 直接映射 |

### runCase 执行策略

```
CaseRow.operation 示例 → 解析为 BrowserCommand：
  "点击【查询】按钮" → { kind: 'click', selector: 'text=查询' }
  "在【编码】输入框录入'ABC'" → { kind: 'fill', selector: 'input[name=code]', value: 'ABC' }
  "访问 /admin/users" → { kind: 'navigate', url: '/admin/users' }
  "等待列表加载" → { kind: 'wait', selector: 'table' }
  "按下 Enter" → { kind: 'press', selector: 'input', key: 'Enter' }
```

解析逻辑：优先匹配 CSS selector / text 内容，兜底用语义节点匹配。

## Risks & Open Questions

| # | 风险 | 缓解 |
|---|------|------|
| 1 | Windows PowerShell 执行策略阻止 npm/pnpm | 使用 .cmd 入口或 `pnpm.cmd` |
| 2 | Playwright chromium 浏览器未安装 | 提前运行 `npx playwright install chromium` |
| 3 | app 的 Vite 构建可能无法 resolve Node.js 的 workspace 依赖 | 验证 pnpm workspace 配置，必要时调整 vite.config.ts |
| 4 | contracts 类型与 app View 类型字段不完全对应 | 适配层做显式映射，缺失字段用默认值填充 |
| 5 | 用例操作文本到浏览器命令的解析准确率 | 先做启发式匹配，后续可接入 AI 增强 |
| 6 | 真实浏览器执行超时或崩溃 | 增加超时处理 + 引擎自动重启 |
| 7 | app 渲染进程无法直接调用 Node.js Playwright | Electron 环境下使用 preload 桥接，或在 Vite 中配置 ssr/experimental |

| # | Open Question | 影响 |
|---|---------------|------|
| 1 | app 是否运行在 Electron 中？ | 决定 Node 模块的调用方式（进程内 vs IPC） |
| 2 | 是否需要支持"逐阶段执行"（每步确认后再继续）？ | 影响 PipelineService 接口设计 |
| 3 | 执行阶段是否需要进度回调（onProgress）？ | 影响 UI 执行进度条 |