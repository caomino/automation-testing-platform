---
intent: 打通 PipelineOrchestrator 数据流，集成真实 Playwright 引擎，使 App 前端通过进程内直接调用对接后端模块
success_criteria:
  - PipelineOrchestrator.run() 使用真实 Playwright 引擎可完整执行 6 个 stage 并返回 PipelineResult
  - App Workbench 屏幕的登录→探索→功能点→用例→执行→缺陷按钮均可触发真实后端+Playwright 调用
  - 所有现有 verify 测试 + 新增集成测试通过
  - TypeScript 类型检查无新增错误
  - Playwright 浏览器可正常启动、导航、执行用例步骤
risk_level: medium
auto_approve: false
---

## Steps

- [ ] **Step 1: 安装 Playwright chromium 浏览器**
action: 执行 npx playwright install chromium 确保 Playwright 浏览器二进制已下载。在 Windows PowerShell 中使用 npx.cmd 避免执行策略限制。
loop: false
max_iterations: 3
verify:
  type: shell
  command: npx.cmd playwright install chromium
gate: human

- [ ] **Step 2: 增强 playwright-engine.ts 的 runCase() 支持多步执行**
action: 编辑 packages/engine-mcp/src/playwright-engine.ts，重写 runCase(row: CaseRow) 方法：(a) 解析 row.operation 文本为 BrowserCommand 数组——识别"点击"/"选择"→click，"录入"/"输入"→fill，"访问"/"跳转"→navigate，"等待"→wait，"按下"→press；(b) 先 flatten 当前语义节点树用于 selector 匹配；(c) 对每个解析出的命令调用 runStep()；(d) 返回 ExecutionStepResult[]。同时新增 parseOperation(row: CaseRow): BrowserCommand[] 静态方法供测试。
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter engine-mcp test
gate: auto

- [ ] **Step 3: 为 runCase 多步执行编写测试**
action: 在 packages/engine-mcp/src/__tests__/ 中新增 runCase.test.ts：(a) 测试 parseOperation 能正确解析"点击【查询】"→ click 命令；(b) 测试 parseOperation 能正确解析"在编码框录入ABC"→ fill 命令；(c) 测试 parseOperation 能正确解析多步骤 operation（如"点击新增→录入名称→点击保存"）；(d) 测试 runCase 对简单用例的端到端执行（使用 mock page）。
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter engine-mcp test
gate: auto

- [ ] **Step 4: 为 orchestrator 新增 runStage() 单阶段执行方法**
action: 编辑 packages/orchestrator/src/index.ts：(a) 新增 runStage(stageName: 'login'|'explore'|'feature'|'case'|'execute'|'defect', input: Record<string, any>) 方法；(b) 内部 switch 路由到对应 stage 的 run() 调用；(c) 每个 stage 正确构建输入映射（如 explore 需要 sessionHandle，case 需要 featureTable）；(d) 返回对应 Output 类型。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter orchestrator test
gate: auto

- [ ] **Step 5: 为 orchestrator runStage 编写测试**
action: 在 packages/orchestrator/src/__tests__/orchestrator.test.ts 中新增：(a) runStage('login') 返回 LoginOutput；(b) runStage('feature', { moduleTree: [...] }) 返回 FeatureOutput；(c) runStage('defect', { executionReport: [...] }) 返回 DefectOutput。使用 mock engine 和 mock stage 数据。
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter orchestrator test
gate: auto

- [ ] **Step 6: 创建 PipelineService 适配层**
action: 新建 packages/app/src/services/pipeline.ts：(a) 导出 createPipelineService(options?: { mockMode?: boolean }) 工厂函数；(b) 内部创建 PipelineOrchestrator 实例（mock 模式用 MockEngine，真实模式用 PlaywrightEngine）；(c) 暴露 runFullPipeline(input)、runStageLogin(input)、runStageExplore(input)、runStageFeature(input)、runStageCase(input)、runStageExecute(input)、runStageDefect(input) 方法；(d) 暴露 launchEngine() 和 closeEngine() 管理引擎生命周期。
loop: false
max_iterations: 3
verify:
  type: artifact
  path: packages/app/src/services
  assert:
    kind: exists
gate: auto

- [ ] **Step 7: 实现 contracts→View 类型转换函数**
action: 在 packages/app/src/services/pipeline.ts 中实现：(a) toFeatureView(rows: FeatureRow[][]): FeatureRowView[] — 九列二维数组转为 FeatureRowView 数组，seq 行号，testPointId 取第 3 列（index 3），needsReview 根据第 4 列判断，merge 根据第 5 列判断；(b) toCaseView(sheets: CaseSheet[]): CaseRowView[] — 各 sheet 的 rows 合并扁平化；(c) toExecView(report: ExecutionResult[], browsers: string[]): ExecMatrixRow[] — 按 caseNo 分组，每个浏览器一个 cell；(d) toDefectView(defectOutput): DefectRowView[]；(e) toModuleView(nodes: ModuleNode[]): ModuleNodeView[]。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 8: 为 PipelineService 编写单元测试**
action: 新建 packages/app/src/services/__tests__/pipeline.test.ts，测试：(a) createPipelineService(mock=true) 返回有效服务；(b) createPipelineService(mock=true).runStageFeature() 调用 orchestrator 并返回 FeatureOutput；(c) toFeatureView 正确转换九列数组；(d) toCaseView 正确合并多 sheet；(e) toExecView 正确生成矩阵；(f) toDefectView 正确转换。
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app test
gate: auto

- [ ] **Step 9: AppState 新增 pipeline 状态 + reducer actions**
action: 编辑 packages/app/src/context.tsx：(a) AppState 接口新增 pipelineStatus: 'idle'|'launching'|'running'|'success'|'failed'，pipelineStep: number，pipelineMessage: string，engineLaunched: boolean；(b) Action 联合类型新增 PIPELINE_LAUNCH, PIPELINE_START, PIPELINE_STEP_UPDATE, PIPELINE_STAGE_DONE, PIPELINE_COMPLETE, PIPELINE_FAILED, ENGINE_LAUNCHED, ENGINE_CLOSED；(c) reducer 中处理每个 action 更新 pipeline 状态，同时将后端返回数据写入对应字段（featureRows/caseRows/execMatrix/defectRows/moduleTree/systems）。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 10: useApp() 暴露 pipeline 方法**
action: 在 context.tsx 的 useApp() 返回值中新增：launchEngine()、closeEngine()、runPipeline(input)、runSingleStage(stageName, input)。这些方法内部调用 PipelineService 对应方法，dispatch pipeline actions，并将结果写入 state。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 11: Workbench 屏幕对接真实 pipeline**
action: 编辑 packages/app/src/screens/Workbench.tsx：(a) 新增"🚀 启动引擎"按钮 → 调用 launchEngine()；(b) 登录按钮 → runSingleStage('login', { systemId, systemUrl, mode })；(c) 阶段进度条由 pipelineStep 驱动（6 步）；(d) 统计卡片从 state.featureRows/caseRows/execMatrix 读取。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 12: Explore 屏幕对接真实 pipeline**
action: 编辑 packages/app/src/screens/Explore.tsx：(a) "开始探索"按钮 → runSingleStage('explore', { sessionHandle, subsystemId })；(b) moduleTree 和 pendingTree 从 explore 返回值获取；(c) 选中/勾选操作保留本地 dispatch。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 13: Feature 屏幕对接真实 pipeline**
action: 编辑 packages/app/src/screens/Feature.tsx：(a) "生成功能点"按钮 → runSingleStage('feature', { moduleTree, systemName })；(b) featureRows 由 featureTable 经 toFeatureView() 转换而来；(c) 审核/确认操作保留本地 dispatch。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 14: Case 屏幕对接真实 pipeline**
action: 编辑 packages/app/src/screens/Case.tsx：(a) "生成用例"按钮 → runSingleStage('case', { featureTable, scope, metaConfig })；(b) caseRows 和 metaHeader 由 caseOutput 经转换函数得到。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 15: Execute 屏幕对接真实 pipeline**
action: 编辑 packages/app/src/screens/Execute.tsx：(a) "开始执行"按钮 → runSingleStage('execute', { caseWorkbook, browserOSMatrix })，引擎需已启动；(b) execMatrix 由 executionReport 经 toExecView() 转换而来；(c) 隔离验证按钮保留本地 dispatch。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 16: Defect 屏幕对接真实 pipeline**
action: 编辑 packages/app/src/screens/Defect.tsx：(a) "分析缺陷"按钮 → runSingleStage('defect', { executionReport })；(b) defectRows 由 defectTable 经 toDefectView() 转换而来；(c) 筛选操作保留本地 dispatch。
loop: false
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app typecheck
gate: auto

- [ ] **Step 17: 全项目类型检查**
action: 运行 pnpm -r typecheck 检查所有包的 TypeScript 类型，修复任何因本次修改引入的类型错误。
loop: true
max_iterations: 5
verify:
  type: shell
  command: pnpm -r typecheck
gate: auto

- [ ] **Step 18: 全项目测试运行**
action: 运行 pnpm -r test 执行所有包的测试，确保现有测试和新增测试全部通过。
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm -r test
gate: auto

- [ ] **Step 19: App 构建验证**
action: 运行 pnpm --filter app build 验证 app 能正确构建，无编译错误。
loop: true
max_iterations: 3
verify:
  type: shell
  command: pnpm --filter app build
gate: auto

- [ ] **Step 20: 浏览器内端到端验证**
action: 启动 pnpm --filter app dev，在浏览器中打开应用：(a) 点击"启动引擎"→ 验证 Playwright 浏览器已启动；(b) 点击"登录系统"→ 验证登录成功；(c) 依次点击探索→功能点→用例→执行→缺陷；(d) 每步验证屏幕数据从空变为真实后端返回值；(e) 验证执行阶段确实使用 Playwright 操作了浏览器。
loop: false
max_iterations: 1
verify:
  type: browser
  url: http://localhost:5173
  check: 完整流水线数据流通 + Playwright 浏览器可操作
gate: human