# modules/app.md · 前端/应用壳简报（Electron 多窗口）

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
前端（React+Vite）+ 应用壳：Electron 原生多窗口，**一窗一模块**（10 屏 = 10 个独立 module：工作台/探索/功能点/用例/执行/缺陷/AI配置/日志/项目管理/知识库）。渲染层经主进程 API（IPC 或 mock provider）调用 stage-*，入参出参均为 contracts 类型。

## 2. 契约要点（去 docs 看细节）
- 边界 = `@test-platform/contracts` 类型；不直接 import stage-* 内部
- 详见 `web/plan-frontend.md`、`docs/可执行PRD.md`(P6-T01)、`docs/自动化测试平台-主规格.md`(§18.3)、`design.md §13`

## 3. 当前进度
- 现有 React+Vite 骨架（**3 个 .ts / 10 文件**，非原写"11草稿2.ts"）；草稿处置待定。
- 多窗口技术形态：**已定 Electron 原生多窗口**（推荐）。⚠️ 缺 `electron` + `electron-builder` 封装与一键启动脚本（plan-frontend 真空区，集成阶段补）。

## 4. 任务清单（来自 web/plan-frontend.md）
- [ ] 架构骨架：Electron shell + 多窗口管理器 + 工作台注册表 + mock provider + 首屏 module
- [ ] 逐屏 module（探索/功能点/用例/执行/缺陷/AI配置/日志/项目管理/知识库）
- [ ] 接真实后端（main 加载 stage-* + engine-mcp，IPC 暴露，替换 mock）

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`（经 IPC/mock）
- 顶层，不被其他包依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/app/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/app build`（app 无 vitest，走 build/lint）
- 改完通知进度，等 merge 回 main
- ⚠️ 11 草稿文件处置需先与用户确认
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
