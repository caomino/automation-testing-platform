# P1 代码审查报告 (Code Review)

- 生成方式：Superpowers Phase 6，使用 **子代理分流（subagent-fanout）** 并行派 6 个只读 Review Agent，对照 `prototype/自动化测试平台-原型.html` (v1.5) + `docs/` 做「规格合规 + 代码质量」两关审查。
- 本审查**未改动任何 contracts / docs，未提交**。

## 总览

| 包 | 结论 | Critical | Major | Minor |
|----|------|----------|-------|-------|
| stage-login   | **FAIL** | 2 | 1 | 2 |
| stage-explore | WARN | 0 | 2 | 4 |
| stage-feature | WARN | 0 | 3 | 2 |
| stage-case    | WARN | 0 | 0 | 4 |
| stage-execute | WARN | 0 | 1 | 4 |
| stage-defect  | WARN | 0 | 0 | 5 |

全量门禁现状：**typecheck ✅ / lint ✅ / verify ✅**（12 包测试全过，85+ 用例）。

## 阻断项（必须修复后才能 Finish）

### stage-login (FAIL)
- **[Critical]** `src/index.ts:192`(runCredential) / `:217`(runManualTakeover)：子系统登录未通过父门户浏览器会话。直接 `navigate(systemUrl)`，从不读取契约字段 `parentPortalUrl`，缺 `type==='subsystem'` 分支。违反原型「子系统 URL 须通过父门户浏览器会话捕获」与 LoginContract。
- **[Critical]** `src/index.ts:277`(reuseSession)：跨域会话复用为数据 stub。`reuseSession` 仅克隆 SessionHandle 并重定 systemId/刷新过期时间，从未调用 `engine.applySession(cookies/headers/tokens)` 将会话注入子系统浏览器上下文，故「门户登录一次各子系统复用」实际不生效。
- **[Major]** `src/index.ts:35 / :196-197 / :232-233`：引擎接口已冻结为含 `getSessionCookies/getSessionTokens/getSessionHeaders/applySession` 的**必需**方法，旧 `?.() ?? []` 降级成死防御代码，会把捕获失败静默吞成空数组。
- **[Minor]** `:196` 引擎提供 `getSessionHeaders()` 但 runCredential/runManualTakeover 未取，鉴权头会话在 SessionHandle 中丢失。
- **[Minor]** `:226` manual-takeover 把 detect `'failed'` 一律映射 `barrier` 并 break，硬失败（错误页）误报为可接管障碍。

## 警告项（建议修复）

### stage-explore (WARN)
- **[Major]** `src/index.ts:187` run() 未将 `sessionHandle` 注入引擎（①登录→②探索会话未衔接）。
- **[Major]** `src/index.ts:191` `resumeFrom` 为 no-op，断点续跑未实现。
- **[Minor]** `:119` 同 target 批量 above/below 插入顺序反转；`:94` 无去重/父节点校验；`:34` `countNodes` 孤儿导出；测试缺会话衔接/兄弟插入/边界断言。

### stage-feature (WARN)
- **[Major]** `src/abbreviation.ts:29` 缩写对 UUID/路径哈希/多词元 id 不收敛为 3 段（base>3 段，违反「base_NN 4 段」规则）。
- **[Major]** `src/abbreviation.ts:41` 中文未按 docs R-A-01 转拼音首字母（生成中文标识，不符 `QYYX_PZ_JCX` 风格）。
- **[Major]** `src/featureTable.ts:123` `testPointId` 仅组内唯一，非全局行内唯一（违反 SPEC 行内唯一；且为用例编号绑定键）。
- **[Minor]** `:119` 需求章节合成占位 `'1.1'` 非 `X.Y.Z`；`:26` 注释与实现不符。

### stage-execute (WARN)
- **[Major]** `src/executeCase.ts:75` 未复用 stage-defect 的 `createDefect`（手拼 defectRef）。**注：与 docs §4.2「模块间不 import 内部函数」及冻结 `defectRef: string` 存在张力，属设计决策，需上游确认。**
- **[Minor]** `constants.ts:17` `DEFECT_REF_PREFIX` 跨包重复未共享；`run.ts:36` 引擎未按 env 隔离；测试缺多次 run 不串味 + 引擎失败边界。

### stage-case (WARN)
- **[Minor]** `index.ts:84` 三场景共号致用例编号非唯一；`:73` `ScenarioContext` 死字段；`:152` `metaHeader` 引用别名（round-trip 下会污染输入）；测试缺八列逐字段 + 边界。

### stage-defect (WARN)
- **[Minor]** `logic.ts:145` 表头列名 `问题级别/问题产生环境` 与 SPEC 简述差异（代码对齐冻结 docs 主规格）；`:133` 带 version 环境串用空格分隔（与 `Win11·Chrome·...` 三段式不符）；`index.ts:80` screenshots 未去重；`:100` `moduleFilter` 空串边界；测试缺完整列名 + 安全性分支断言。

## 需用户决策的设计张力
1. **stage-execute 是否复用 stage-defect.createDefect**：复用符合 SPEC「复用而非重写」，但违反 docs §4.2 模块隔离 + 冻结 `defectRef: string`。建议二选一：① execute 内委托 createDefect 生成引用语义；② 将 defectRef 生成上移为共享常量。
2. **stage-feature 缩写鲁棒性（pinyin / UUID / 全局唯一）**：当前为已知偏离（见 ③-2 pinyin limitation）。是否现在补齐拼音映射 + 段数收敛 + 全局去重？

## 结论
实现完成度约 85%；全量测试门禁已绿，但 **stage-login 存在 2 个 Critical 规格违反（阻断发布）**，其余为 Major/Minor 质量与边界缺口。按 Superpowers 规则，阻断项修复后才能进入 Finishing。
