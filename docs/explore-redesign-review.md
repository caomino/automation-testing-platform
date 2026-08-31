# 探索模块精准化 — 方案审核报告（Superpowers Step 2: Design Validation）

> 审核对象：`docs/explore-precision-redesign.md`（Brainstorming 产物）
> 审核方法：逐条对照本项目 `stage-explore`/`contracts`/`engine-mcp` 实际代码 + 参考项目 `untitled (1)` 真实实现
> 审核目标：确认方案对 **AI 模式 / 非 AI 模式** 均可**完全实现**，且不碰 `contracts`、不碰 `engine-mcp` 内部

---

## 一、审核结论

**✅ 方案可完全实现（双模式均可行），且不违反冻结红线。**

但审核发现 **2 处会直接导致"管线不产出"的硬伤（P0）** + 3 处需 Phase 3 计划闭环的歧义（P1/P2）。这些必须在进入编码前闭环，否则会出现"看起来对、跑起来空树/漏编辑页"的情况。

---

## 二、可行性实证（结合两边代码）

### 2.1 参考项目可移植件（附证据）
| 能力 | 参考实现位置 | 移植形态 | 端口 |
|---|---|---|---|
| SPA 运行时路由内省 | `spaRouterReverseExtractor.ts:11` `getRuntimeBrowserEvaluationScript()` | 纯 JS 字符串 → 直接喂 `engine.evaluate` | ✅ |
| Vue2/3 / Remix / Angular 探针 | `:19` `__vue_app__.$router.getRoutes()`；`:40` `__VUE_DEVTOOLS_GLOBAL_HOOK__`；`:59` `__remixRouter.state.matches` | 同上 | ✅ |
| JS 包静态逆向 | `:78` `extractRoutesFromJavascriptCode(jsCode, prefix, isAi)` | 纯函数（入参 HTML 字符串） | ✅ |
| DOM 菜单直出 | `dynamicScanner.ts` `UniversalDOMExtractor.extractMenusFromHTML` | 纯函数（cheerio 解析 HTML） | ✅ |
| AI 自愈（P6） | `universalScanner.ts:106` `applyAiDataMutations` | 逻辑移植，依赖 `AIClient` | ✅（仅 AI 模式） |
| 去重格式化 | `HierarchyTreeFormatter.formatAndDeduplicate` | 本项目已有 `dedupeClickPath` 等价物 | ✅ |

### 2.2 本项目集成点（已核对实际代码）
| 设计依赖 | 本项目实际 | 结论 |
|---|---|---|
| `ModuleNode` 承载路由树+动作，不动契约 | `contracts/src/types/ModuleNode.ts` 字段：`type('system'\|'module'\|'page'\|'action')` / `url?` / `depth` / `status` / `reviewReason?` | ✅ 无损映射，零契约改动 |
| `:param` 路由 → action 子节点 | `type:'action'` + `parentId` 足以表达 | ✅ |
| 双模式分发 | `index.ts:526` `opts?.ai ? exploreWithAi(...) : exploreNonAi(...)` | ✅ 已隔离，运行时只走一条 |
| 现有 `exploreModules` 作 P2 DOM 源 | `types.ts:112` / `playwright-engine.ts:400` / `mcp-adapter.ts:137` 均暴露 | ✅ 可**复用**，避免重造 DOM 提取 |
| P3 实导航验证 | `index.ts:386/454` `getCurrentUrl()` + `:366` `isLoginPageUrl()` | ✅ 判定"跳登录/404"已具备 |
| 粒度闸门 | `index.ts:205` `assertActionGranularity`（action>0 不误标） | ✅ 与新产出兼容 |
| 引擎已暴露能力 | `evaluate`(`aiExplore.ts:125`)、`navigate`、`getCurrentUrl`、`runStep`、`waitForTimeout`、`extractPageElements`、`exploreModules` | ✅ P1/P3/P4 均够用 |

---

## 三、双模式实现路径（确认两者都跑得通）

```
non-AI:  exploreNonAi ──▶ 融合核心(P1 路由逆向 → P2 复用 exploreModules → P3 只读验证
                           → P4 确定性 harvest 功能点 → P7 去重)  → ModuleNode[]
AI:      exploreWithAi ─▶ 同上融合核心(P1-P5,P7)  → P6 AI 自愈(升级选择器/补语义) → ModuleNode[]

隔离约束满足：共享核心放新文件 routeTreeExplorer.ts / menuFusion.ts，
两模式都 import 它、互不 import（符合 design §4 硬约束）。
```

---

## 四、审核发现的缺口（必须进 Phase 3 计划闭环）

### 🔴 P0-1：空树硬抛 vs "管线永远产出" 冲突
- **现状**：`index.ts:535-561` 当 `moduleTree.length === 0` 时 **`throw EXPLORE_FAILED`**。
- **冲突**：设计 §3 承诺"任何一级失败都独立降级，管线永远产出"，但当前代码会在融合核心空产出时直接崩溃，而非返回降级树。
- **闭环要求**：Phase 3 必须二选一——(a) 融合核心保证至少返回 1 个 `system`/`module` 占位节点（即便全 `needs_review`）；或 (b) 将空树改为返回 `needs_review` 树而非抛错。推荐 (a)。

### 🔴 P0-2：`:param` 动态路由无法实导航验证
- **问题**：`/user/edit/:id` 没有具体 id，**P3 无法 navigate 到字面 URL** 做渲染验证。
- **闭环要求**：明确策略——(a) 对此类路由**跳过 P3 导航**，改为从列表页"编辑"按钮反推 action（P4 负责），并标 `needs_review` + `reviewReason='动态参数路由，需具体 id 验证'`；或 (b) 用列表首行数据的 id 拼出真实 URL 再验证（更准但有耦合）。推荐 (a)，与设计 Q1（action 子节点）一致。

### 🟡 P1-1：P2 应明确复用 `engine.exploreModules()`
- **问题**：设计 §7 只列 `evaluate/navigate/getCurrentUrl`，**漏了 `exploreModules`**，但它是现成、暴露的 DOM 菜单源。
- **闭环要求**：修正 §7，P2 直接复用 `engine.exploreModules()` 作 DOM 来源（不重造 DOM 提取，符合"不碰 engine-mcp"）。

### 🟡 P1-2：AI 模式现有 click-loop 与"P4 共享"冲突
- **问题**：`aiExplore.ts` 当前是独立"点菜单→进页 harvest"循环；设计 §4 称 P1–P5 两模式**完全一致**，意味着 P4 应共享确定性 harvest，AI loop 与 P4 职能重叠。
- **闭环要求**：Phase 3 明确——P4 改为共享确定性 harvest（进每个 covered 页读控件→关键词映射 action）；AI 模式的 `exploreWithAi` 收敛为"调融合核心 + 跑 P6 自愈"，旧 click-loop 退役或仅作 P4 兜底。

### 🟢 P2-1：P5 引擎缺口（`page.on('response')` 未暴露）
- **现状**：engine-mcp 仅 `page.on('dialog'|'popup')`（菜单探索用），**无 response 事件暴露**。
- **闭环要求**：维持设计"best-effort、非阻塞"——P5 加 `typeof page.on==='function'` 守卫，取不到则跳过，绝不阻塞主流程。（设计已认知，Phase 3 落实守卫代码）

### 🟢 P2-2：跨域 JS 包抓取可能被 CORS 拦
- **现状**：P1 静态兜底需抓 `<script src>` 源码；同域包可 `fetch`，CDN/跨域包会被 CORS 拒。
- **闭环要求**：属预期降级，设计 §1 已覆盖"抓不到 script → 退 P2"，无需额外处理。

---

## 五、仍需你最终裁定的 5 项（design §8 Q1–Q5，附本次审核后的推荐）

| # | 问题 | 推荐 | 审核补充 |
|---|---|---|---|
| Q1 | `:param` 路由 → action 子节点 or 独立 page | **action 子节点** | 与 P0-2 联动，跳过 P3 导航 |
| Q2 | P5 后端 API 嗅探启用？ | **best-effort，非阻塞** | 受 P2-1 引擎缺口限制，取不到即跳过 |
| Q3 | 照搬 12 系统硬编码库？ | **不搬** | 会虚构节点，与"精准"冲突 |
| Q4 | 落点 + 不碰 engine/contracts | **同意** | P1-1 修正：P2 复用 `exploreModules` |
| Q5 | P1 前加框架指纹探测？ | **加** | 提升探针命中率，纯 `evaluate` 多探几个全局即可 |

---

## 六、最终判定

**满足"完全实现 + 双模式"条件：是。**
前提：Phase 3（Implementation Planning）必须把 **P0-1（空树不崩）** 与 **P0-2（`:param` 验证降级）** 纳入计划并给出具体代码位置，否则非 AI 模式在弱目标上会抛错、AI 模式会丢失"修改"页。

> 下一步：你裁定 Q1–Q5（或回"按推荐全过"），我即产出 `plan.md`（Phase 3），按 Superpowers 要求拆成 2–5 分钟粒度的可执行任务，含文件路径、关键代码、验证步骤。

---

# 七、实现后复验（Superpowers Step 2 再次验证 · 2026-08-18）

> 状态：**已编码完成并跑通门禁**。本章对照上面审核结论，逐条确认 P0/P1/P2 缺口已闭环、冻结红线未破、降级原因已可见。

## 7.1 门禁结果（实跑）
| 门禁 | 命令 | 结果 |
|---|---|---|
| Typecheck | `pnpm --filter @test-platform/stage-explore typecheck` | ✅ PASS |
| Lint | `pnpm --filter @test-platform/stage-explore lint`（max-warnings 0） | ✅ PASS |
| Test | `pnpm --filter @test-platform/stage-explore test` | ✅ **32/32 PASS**（含 `index.test.ts` / `aiExplore.test.ts` / `verify/explore.verify.ts`） |

## 7.2 改动落点（仅 stage-explore/src，未动 engine / contracts）
- **新增** `routeTreeExplorer.ts`：P1 路由逆向（运行时 SPA 内存探测 + 静态 JS 分包正则），`RawRoute → ModuleNode` 树构建；含 `:param` 路由 → 父页 `action` 子节点。
- **新增** `menuFusion.ts`：P1→P7 无权限多级降级融合核心；`DegradationNote` 记录每级「为什么降级」；`emptyPlaceholderNode` / `mergeExternalPages` / `formatDegradationSummary` 导出。
- **改写** `nonAiExplore.ts`：改调 `buildModuleTreeViaDegradation`（P2 复用 `engine.exploreModules()` 作基线），空树兜底占位。
- **改写** `aiExplore.ts`：保留 `exploreWithAi(engine, ai, ctx, limits?)` 签名（满足 S1 隔离测试与既有调用），内部走「融合基线 + `aiDeepenPages`（P6 AI 自愈）合并」。
- **微调** `index.ts`：非 AI 分发补传 `subsystemId/startUrl` 上下文。

## 7.3 冻结红线复核（✅ 未破）
- **contracts 未改**：`ModuleNode`（`@frozen`）零字段改动；所有降级信息复用 `status='needs_review'` + `reviewReason?`（已存在可选字段）。
- **engine-mcp 未改、未越界**：仅调用其**既有公共方法** `exploreModules / evaluate / navigate / getCurrentUrl / extractPageElements / waitForTimeout / runStep`；未新增/修改任何引擎方法。
- **隔离约束满足**：`aiExplore.ts` 仅 import `./menuFusion`（共享核心），**不** import `nonAiExplore` / `menu-explorer` / `infra-ai` 值级实现（`aiExplore.test.ts` 的 S1 正则断言通过）。

## 7.4 审核缺口闭环确认
| 缺口 | 闭环方式 | 已验证 |
|---|---|---|
| 🔴 P0-1 空树硬抛 | 融合核心空产出时，`nonAi/ai` 返回 `emptyPlaceholderNode`（needs_review + 降级原因汇总）；`index.ts` 仅在「真无引擎」时抛错。管线**永远产出**，不再崩。 | ✅ 测试 `run` 边界用例通过 |
| 🔴 P0-2 `:param` 验证死穴 | `routesToModuleNodes` 将 `/user/edit/:id` 映射为父列表页的 `action` 子节点（`编辑`/`详情`），标 `needs_review` + `reviewReason='动态参数路由无法实导航验证'`，**不再整条丢"修改"页**。 | ✅ 代码路径存在，单测覆盖类型 |
| 🟡 P1-1 P2 复用 exploreModules | `buildModuleTreeViaDegradation` 以 `engine.exploreModules()` 返回树为**基线**，路由发现的页面增量 `augmentWithRoutes` 并入；无 url 的既有节点原样保留。 | ✅ verify 测试断言原树结构不变 |
| 🟡 P1-2 AI 与 P4 冲突 | 非 AI 走确定性融合；AI 走「融合基线 + `aiDeepenPages` 深入」，`mergeExternalPages` 按 url 合并。共享核心在 `routeTreeExplorer/menuFusion`。 | ✅ 双模式单测均过 |
| 🟢 P2-1 P5 引擎缺口 | P5 **显式跳过并说明原因**（引擎无 `page.on(response)`；主动嗅探写操作违反只读铁律），降级原因写入 `DegradationNote`，运行时打印。 | ✅ 日志可见 |
| 🟢 P2-2 跨域 JS 抓取 | 改为**浏览器内 `fetch`**（同源包可抓，跨域/CORS 失败返回空串），失败即降级到 P2。规避 Node 全局 `fetch`/`DOM` 类型依赖（lib 仅 ES2022）。 | ✅ typecheck PASS |

## 7.5 「降级原因」如何可见（你点名的要求）
每一级降级都落因到两处，确保"为什么降级"可追溯：
1. **运行日志**：`[explore][降级链] [P1a→P1b] 运行时SPA路由→静态JS分包：… ｜ [P1b→P2] … ｜ [P5] 后端API嗅探→仅前端源：…`（已在 verify 测试中实测打印）。
2. **树内节点 `reviewReason`**：静态逆向页（needs_review + "运行时探测无结果，改用静态逆向"）、`:param` 动作（"动态参数路由无法实导航验证"）、仅路由发现未验证页（"未能在浏览器实导航验证"）、全空占位根（汇总各级原因）。

## 7.6 与参考项目的关系（纠偏确认）
**未照抄，是移植架构与"无权限来源"**：
- ✅ 采用其 **8 类菜单来源中的无权限子集**（category_1 DOM / category_2 SPA 路由 / category_5 异步分包 / category_8 低代码）作为主源，构建 **P1a→P1b→P2→P3/P4→P5→P7** 显式优先级 + 降级链。
- ❌ **排除** category_3/4（后端 RBAC 菜单）—— 正是"有权限才看得到"的来源，与"无权限方案"冲突。
- ❌ **不搬** 12 系统硬编码拓扑库 —— 会虚构节点，与"精准不臆造"冲突。
- 运行时探针脚本（`__vue_app__` / `__remixRouter` / `__VUE_DEVTOOLS`）直接移植为 `engine.evaluate` 字符串；`:param` 路由**不再跳过**（修正参考项目原实现的漏"修改"页缺陷）。

## 7.7 最终判定（复验）
**方案已落地，双模式均可完全运行，且符合冻结红线与"无权限 + 精准"目标。** 下一步即可接入真实 SPA 后台联调；联调重点观察：弱权限账号下路由树是否完整、`:param` 编辑页是否以 needs_review 形式进入人工审核。
