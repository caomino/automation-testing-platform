# 全链路数据流转修复计划 (Explore -> Feature -> Case -> Execute)

## 1. 目标
确保从“探索”到“Playwright MCP 执行”的完整数据链路通畅，避免因用例格式不兼容导致后续阶段返工。

## 2. 现状分析 (关键发现)

### 2.1 执行引擎 (Stage-Execute + McpEngine)
- **引擎类型**: `McpPlaywrightAdapter` (基于 `@playwright/mcp`)。
- **执行逻辑**: 
  1.  `stage-execute` 调用 `engine.runCase(row)`。
  2.  `McpPlaywrightAdapter.parseCaseSteps()` 解析 `CaseRow.operation` 字段。
  3.  **关键字映射**:
      - `点击` / `click` -> `browser_click`
      - `录入` / `输入` / `fill` -> `browser_type`
      - `访问` / `navigate` -> `browser_navigate`
      - `选择` / `select` -> `browser_select_option`
      - `等待` / `wait` -> `browser_wait_for`
      - `dom` (默认兜底) -> `browser_snapshot`

### 2.2 用例生成 (Stage-Case)
- **当前逻辑**: `scenarioContent()` 生成自然语言描述的操作说明。
- **问题**: 生成的 `operation` 多为描述性文本，如“执行正常操作”、“输入边界值”，**缺乏 Playwright MCP 所需的显式指令关键字**（如“点击”、“访问”）。这将导致执行阶段无法正确触发浏览器操作，退化为只做 DOM 快照。

### 2.3 功能点模块 (Stage-Feature)
- **当前状态**: 前端页面 (`Feature.tsx`) 缺失“生成功能点”的入口，无法将探索产物 (`moduleTree`) 流转为功能点。

## 3. 修复计划 (防返工策略)

### 步骤 1: 修复前端功能点入口 (`Feature.tsx`)
**目标**: 打通 Explore -> Feature 的数据流。
- 在 `Feature.tsx` 页面添加 **“生成功能点”** 按钮。
- 实现逻辑:
  1.  从全局状态获取 `moduleTree`。
  2.  调用 `fromModuleView` 转换为契约格式。
  3.  调用 `runPipelineFeature` 触发生成。
  4.  成功后自动刷新表格。

### 步骤 2: 重构用例生成模板 (`stage-case`)
**目标**: 确保生成的用例包含 Playwright MCP 可识别的指令。
- **修改文件**: `packages/stage-case/src/index.ts`
- **修改函数**: `scenarioContent()`
- **策略**:
  将自然语言模板改为包含显式操作指令的模板，例如:
  - Normal: `访问[目标页面], 点击[功能按钮], 录入[测试数据]`
  - Boundary: `录入[边界值], 点击[提交按钮]`
  - Exception: `录入[非法数据], 点击[提交按钮], 等待[错误提示]`
  
  *注：具体指令需结合业务场景的通用表达方式，确保能被 `McpPlaywrightAdapter` 的正则/关键字匹配命中。*

### 步骤 3: 验证 Execute 兼容性 (无需修改代码)
- **验证 `McpPlaywrightAdapter.parseCaseSteps`**:
  - 检查其 `extractSelector` 逻辑：优先使用 `row.content` 作为 selector。
  - 检查 `operation` 中的 `[...]` 标签解析。
- **结论**: 只要用例的 `operation` 包含关键字，且 `content` 或 `operation` 中的 `[...]` 包含有效选择器（如 text、id），即可正确执行。

## 4. 实施步骤

1.  **修改 `Feature.tsx`**: 添加生成按钮和调用逻辑。
2.  **修改 `stage-case/src/index.ts`**: 重写 `scenarioContent`，输出符合 MCP 指令规范的操作文本。
3.  **全链路自测**:
    -   探索 -> 生成功能点 -> 生成用例 -> (模拟)执行用例。

## 5. 风险评估
- **风险**: 用例生成模板修改后，可能影响前端展示的自然度。
- **应对**: 平衡“可读性”与“指令匹配度”，在保证能执行的前提下，保留必要的业务描述上下文。
