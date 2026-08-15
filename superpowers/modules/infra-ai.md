# modules/infra-ai.md · AI 配置模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
AI 模型配置抽象：独立配置页，模型不写死；为功能点/用例生成、AI 辅助执行提供可注入的模型与提示词（含知识库指令兜底，见 design.md §8）。

## 2. 契约要点（去 docs 看细节）
- 类型：`KnowledgeBase { globalPrompt, systemPrompts }`、AI 模型配置结构
- 详见 `design.md §8`、plan.md、`docs/自动化测试平台-主规格.md` §18.8

## 3. 当前进度
- **4 个 .ts**（实测，非原写 1），骨架+部分实现。

## 4. 任务清单（来自 plan.md）
- [ ] AI 模型配置接口（provider/model/baseURL/key 不写死）
- [ ] 知识库指令注入机制（系统提示高优先 + 通用低优先）
- [ ] 被 feature/case/execute 调用验证

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`
- 被 feature/case/execute 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/infra-ai/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/infra-ai verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
