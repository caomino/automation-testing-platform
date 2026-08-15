# 设计验证复核报告（Design Validation Review）

> 复核日期：2026-08-15。依据：工作空间 docs 5 份 + superpowers design/plan + 原型 10 屏 + contracts 当前代码 + 金标准 Excel 实测。
> 目的：诚实批判性审查，回答「方案是否可行 / 有什么风险 / 多 Agent 并行是否可行 / 是不是商业产品」。

---

## 一、总评

**架构方向正确、数据模型已实测对齐，但当前状态「不能直接进入并行开发」，存在 1 个阻断项 + 3 个高风险项，需先补地基、定方案，否则必然返工。**

---

## 二、可行且已验证的部分 ✅

| 项 | 结论 |
|----|------|
| 架构（11 package + app，contracts 0 依赖先行） | ✅ 成熟技术栈（Electron/Playwright/strict TS/zod/vitest），依赖拓扑清晰 |
| 冻结接口 `run(input): Promise<Output>` | ✅ 解耦合理，利于并行 |
| 功能点九列 | ✅ 与 D:\Test 源码逐字段一致 |
| 测试用例八列 / MetaHeader / 测试点标识规则 | ✅ 金标准 Excel 实测完全对齐 |
| 多 Agent 并行拓扑（Batch0→1→2） | ✅ 依赖方向正确，contracts 冻结后 stage-* 可并行 |

---

## 三、风险清单（分级）

### 🔴 阻断项（必须现在解决，否则无法开工）

**R-1 contracts 未完成冻结（完成度约 40%）**
- 现状：types(7) + stages(6) + constants(1) 已写；**schemas/(6 个 zod)、mock/index.ts、src/index.ts 全部缺失**。
- 影响：契约包没有 zod 运行时校验、没有统一导出入口、没有 mock 数据，其他 10 个模块无法依赖它开发。地基没打完，谈不上"冻结"，更谈不上并行。
- 处置：补齐 schemas + mock + index.ts，`pnpm install && build/lint/typecheck/test/verify` 跑绿，才算 P0 地基完成。

### 🟠 高风险项（会导致返工）

**R-2 持久化层缺失（架构缺口）**
- 现状：packages 列表里**没有 storage/db 层**。主规格 §7 只讲"日志外部化"，业务数据（Project/System/FeatureTable/CaseTable/ExecutionReport/Defect）存哪、用什么存储，**全文档未定义**。
- 影响：app 层项目 CRUD、功能点/用例/执行结果都要持久化，但架构里没这个包，P6 集成时才发现就晚了。
- 建议：新增 `infra-store` 包（SQLite，Electron 生态成熟）或明确"app 层用 SQLite/JSON"，写入契约。

**R-3 Electron + Playwright 浏览器共享方案未明确**
- 现状：主规格 §3 说"Electron 自带 Chromium = 自动化浏览器同引擎"，§8 说"共享单例"，但**没给技术路径**（只说"testmaster 先例"）。
- 事实：Playwright 默认启动**自己的** Chromium，与 Electron 的 Chromium 是两个实例。要实现"共享单例可见浏览器"，需 Playwright CDP 连接 Electron BrowserWindow（`launchServer` + `connectOverCDP`），这是有坑的集成点。
- 影响：这是 P6 才暴露的技术难点，如果 P6 才发现两个浏览器无法共享，前面 5 个 P 的探索/执行假设可能全错。
- 建议：**现在就用 D:\test-platform-smoke 临时项目验证**"Playwright CDP 连 Electron"的最小可行方案，别等 P6。

**R-4 工作量 vs 周期（最现实的约束）**
- 现状：PRD 总估时 4-6 个月，P0~P7 共 40+ 任务。用户要求 P0~P6 全链路 + 测试工程师视角自测 + 完全适配陕西人大（门户+13 子系统）。
- 影响：即使多 Agent 并行，这也是**数月级工程**，无法在短期内"一次开发完成"。并行能缩短周期，但不能抹平工作量。
- 建议：诚实对齐——本轮能交付的是"P0 地基 + 若干核心 stage（stage-feature/case 优先）+ 冒烟闭环"，而非"P0~P6 全部一次到位"。分批 checkpoint 交付。

### 🟡 中风险项

| # | 风险 | 说明 |
|---|------|------|
| R-5 | engine-mcp DOM 抽象复杂度 | "适配 95% + 微前端/iframe/虚拟滚动/富文本"远超 70 项矩阵字面量，DOM 抽象层是最大单点工作量 |
| R-6 | round-trip 保真边界多 | 跨行合并(判定规则)、多 meta 布局(妇幼列3)、截图行不固定、备注行，导入导出兼容逻辑多 |
| R-7 | Excel 库未选型 | round-trip 需 ExcelJS 或 xlsx，主规格 §3 技术选型表漏了 |
| R-8 | 多 Agent 集成返工 | 11 模块并行，app 最后集成时接口不匹配是常见返工点，需强 Review + 契约测试兜底 |

### 🟢 低风险项

- safeStorage 在无 GUI/CI 环境可用性（需登录会话/DPAPI）
- 子 agent 是否严格遵守 TDD + 目录规范 + 正反向覆盖

---

## 四、多 Agent 并行可行性判断

**结论：可行，但有严格前提，不是"无脑并行"。**

1. ✅ 依赖拓扑支持：contracts 冻结后，stage-feature/case/login/explore/execute/defect + infra-* 确无相互依赖，可并行。
2. ⚠️ 但前提是：
   - **contracts 必须 100% 冻结**（现在 40%，含 R-1 的 schemas/mock/index + R-2 的 store 定义）
   - **engine-mcp 的 DOM 抽象接口要先稳定**（它是 stage-login/explore/execute 的共同依赖，接口先定死）
   - **Reviewer 必须强把关**（每个 Builder 产出后 spec 合规 + 代码质量两关，防并行返工）
3. ⚠️ 并行缩短的是"各模块独立开发时间"，**app 集成 + 端到端是串行收尾**，仍是瓶颈。

**一句话**：并行可行，但"先冻结 contracts + 定死 engine-mcp 接口 + 强 Review"是并行不返工的三个前提，缺一不可。

---

## 五、是不是商业产品？

**当前方案（P0~P6）= 功能完整的产品内核，但还不是可直接售卖的商业产品。**

| 维度 | P0~P6（本轮） | 商业产品缺的（P7） |
|------|--------------|------------------|
| 核心功能 | 登录/探索/功能点/用例/执行/缺陷 ✅ | — |
| 许可/激活 | ❌ 无 | 在线/离线许可、防破解 |
| 多租户/RBAC | ❌ 无 | 客户间数据隔离、角色权限 |
| 品牌白标 | ❌ 无 | logo/色/标题定制 |
| 回归历史 | ❌ 无 | 多轮执行对比 |
| 自动更新 | ❌ 无 | 版本推送 |
| 导出汇总 | ❌ 无 | 多系统多轮汇总 Excel |

**结论**：P0~P6 做完是"能用的测试平台"，要"卖给客户"还必须做 P7 商业化能力（主规格 §9 已列）。若你的目标是商业交付，需把 P7 纳入计划或明确为下一里程碑。

---

## 六、建议的下一步（按优先级）

1. **【立即】补齐 contracts**：schemas(6) + mock + index.ts + `infra-store` 的持久化接口定义 → 跑绿 → 这才是真正的"冻结"。
2. **【立即】技术预研**：在 D:\test-platform-smoke 验证「Playwright CDP 连 Electron」最小可行（R-3），以及 Excel 库选型（R-7）。
3. **【对齐】周期预期**：与用户确认本轮交付边界（P0 地基 + 核心 stage + 冒烟闭环），而非"P0~P6 一次到位"。
4. **【然后】**：contracts 冻结后，再 spawn 并行 Builder。

---

**结论摘要**：方案方向对、数据模型对、并行思路对；但**没到"完全没有问题"的程度**——有 1 个阻断（contracts 40%）、3 个高风险（持久化缺失/Electron+Playwright 未验证/工作量超预期）。补完地基 + 技术预研 + 对齐周期后，才具备"不返工"开工条件。
