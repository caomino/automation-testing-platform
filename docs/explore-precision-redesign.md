# 探索模块精准化重建 — 设计文档（Brainstorming / Phase 1）

> 目标：让探索模块**精准读取全部菜单 + 具体测试点（新增/修改/列表/删除/查询/导出）**，精确到子目录与具体功能页。
> 约束：**不改动 `packages/contracts`（@frozen）**；复用现有 `aiExplore` / `nonAiExplore` 双模式；借鉴参考项目 `untitled (1)` 的**多源融合 + 显式优先级 + 多级降级**架构，但落地为**无权限（permission-free）**方案。

---

## 1. 根因重述（为什么当前"不进子目录/不抓功能点"）

| 现有手段 | 缺陷 | 后果 |
|---|---|---|
| DOM 菜单点击（`exploreViaMenus`） | 只采集**渲染出来且能匹配**的菜单项；SPA 的子路由（弹窗路由、`/user/add`、`/user/edit/:id`）不出现在菜单 DOM 里 | 永远发现不了独立子路由 → 只抓到父集目录 |
| `Router.getRoutes()` 内存逆向 | ① 生产构建常剥离 `__vue_app__`/`__remixRouter` 全局；② 动态 `:param` 路由被参考项目**默认跳过**（丢了"修改"页）；③ 只给路由不给"增删改查"动作 | 静默退化 / 漏掉编辑功能 / 拿不到测试点 |
| 后端菜单接口（`/api/menu`） | **被 RBAC 按登录用户权限裁剪** | 低权限账号看到的菜单是残缺的 → "有权限才看得到" |

**结论**：单一手段都有死穴。**必须用"多源融合 + 优先级 + 降级"**，且把**前端产物（路由/分包/低代码）作为无权限主源**，后端 RBAC 菜单只作交叉校验、不作权威。

---

## 2. 参考项目架构解码（此前漏读部分，已补全）

参考项目 `untitled (1)` 的真实形态 = **8 类菜单来源（`MenuSourceCategory`）+ 全能探测总线（`UniversalMultiEngineScanner`）**：

| 类别 | 来源 | 权限依赖 | 在本方案角色 |
|---|---|---|---|
| 1 `category_1_dom` | 前端 HTML/DOM 直出（cheerio 解析 `.el-menu/.ant-menu/nav` + 真实按钮/表头） | ⚠️ 部分（RBAC 可隐藏 DOM 项） | **P2 增强/交叉验证** |
| 2 `category_2_spa_router` | Vue/React/Angular Router（运行时内存 + JS 包静态正则逆向） | ❌ 无 | **P1 无权限主源** |
| 3 `category_3_backend_api` | 后端菜单接口（`/api/menu`/`getRouters`） | ✅ 有（RBAC 裁剪） | **P5 仅交叉校验** |
| 4 `category_4_rbac_dynamic` | 权限动态过滤菜单 | ✅ 有 | 明确**不作为权威** |
| 5 `category_5_async_chunk` | 懒加载分包 | ❌ 无 | P1 增强（动态路由补全） |
| 6 `category_6_micro_frontend` | 微前端/iframe（qiankun/wujie） | ❌ 无 | 可选增强（延后） |
| 7 `category_7_state_modal` | 无路由抽屉/Tab 状态机 | ❌ 无 | 可选增强（延后） |
| 8 `category_8_lowcode_schema` | 低代码元数据（AMIS/宜搭/Formily） | ❌ 无 | P1 增强 |

**参考项目的显式降级链**（`universalScanner.scanSystem`）：
```
P1 DOM 直出 ──(为空)──▶ P2 已知系统硬编码拓扑库(12系统按 url/name 匹配)
   ──▶ P3 逐节点实点击深入 ──(仅 ai_mcp)──▶ P4 AI 语义自愈 ──▶ P5 去重格式化
```

**关键纠正（此前误判）**：参考项目主流程的兜底其实是"12 个硬编码已知系统库"，而非纯 SPA 逆向——这正是它"精准"的来源之一，但也带来"对未知系统退化+可能虚构节点"的风险。本方案**不照搬硬编码库**（与"精准、不虚构"目标冲突），改用"前端逆向 + DOM"的通用融合。

---

## 3. 本方案：无权限多级融合管线（Priority + Degrade）

```
L0 会话准备（复用现有 prepareActiveSessionEngine / prepareFreshEngineSession，已存在）
 │
P1 前端路由逆向【无权限主源 · category_2/5/8】
 │   ① 运行时内存：router.getRoutes() / __remixRouter / __VUE_DEVTOOLS_GLOBAL_HOOK__
 │   ② 静态兜底：抓 <script> 源码正则逆向 path:/title:（★含 :param 动态路由，不再跳过）
 │   → 输出完整路由树（含 /user/add、/user/edit/:id）
 │   降级条件：生产剥离全局变量且抓不到 script → 退 P2
 │
P2 DOM 菜单直出【可见结构增强 · category_1】
 │   解析 .el-menu/.ant-menu/nav + 提取真实按钮/表头列
 │   用途：给 P1 路由补中文标题、确认可达性、提供叶子页控件
 │   权限依赖：⚠️ 仅增强/交叉验证，不作权威
 │   降级条件：DOM 无菜单结构 → 仅用 P1 / AI
 │
P3 逐路由实导航验证【护栏 · 只读不提交】
 │   对每个 P1∪P2 路由 navigate（只导航，不填表不提交）
 │   渲染正常（非 404/登录回跳）→ status='covered'
 │   重定向登录/404 → status='needs_review'（复用现有机制，不静默丢）
 │   权限依赖：❌ 无（只读验证存在性）
 │
P4 叶子页功能点抽取【测试点：增删改查等】
 │   进入每个 covered 叶子页，读真实控件 → 关键词映射 type='action'
 │   create/update/delete/query/export/import/detail/auth
 │   复用现有 collectControls / extractPageActions
 │   权限依赖：❌ 无（读渲染页控件）
 │   降级条件：控件识别失败 → 该页标 needs_review
 │
P5 后端 API 菜单嗅探【仅交叉校验 · category_3 · 非权威】
 │   监听 /api/menu|getRouters 响应，补 label/action 候选
 │   ★标记 rbacFiltered=true；绝不因"API 没返回"而删除 P1/P2 发现
 │   仅当引擎能暴露请求事件时启用，否则跳过（不阻塞）
 │
P6 AI 语义自愈【仅 AI 模式 · 对应 ai_mcp】
 │   升级脆弱选择器为语义定位、LLM 推断动作类型、补 :param 路由语义
 │   非 AI 模式：纯确定性关键词匹配，跳过 P6
 │
P7 去重与格式化（复用 dedupeClickPath 思路 + validateExploreOutput）
```

**任何一级失败都独立降级，管线永远产出；未确认项一律 `needs_review`，绝不静默丢弃。**

---

## 4. 双模式隔离（AI / 非 AI）

现有 `stage-explore` 已通过 `exploreWithAi` / `exploreNonAi` 分发（`index.ts:526` 运行时只走一条）。两模式**共享同一套路由发现核心**（新增 `routeTreeExplorer.ts` + `menuFusion.ts`），差异仅在 P6：

| 阶段 | non_ai（结构化） | ai_mcp（AI 辅助） |
|---|---|---|
| P1–P5, P7 | ✅ 完全一致 | ✅ 完全一致 |
| P6 选择器 | 确定性 `button:has-text('新增')` | AI 升级为 `role=button[name='新增']` 语义定位 |
| P6 动作推断 | 关键词匹配 | LLM 解析 i18n key / 函数式 title，补语义 |
| 确定性 | 可复现 | 允许语义增强 |

---

## 5. 契约映射（不碰 @frozen contracts）

`ModuleNode`（`packages/contracts/src/types/ModuleNode.ts`）字段已足够承载，**无需新增字段**：
- P1 路由 → `type:'page'`，`url` = `origin + routePath`，`depth` = 路由层级
- `:param` 动态路由（如 `/user/edit/:id`）→ **建议作为父列表页的 `type:'action'` 子节点**（label「编辑(单条)」，type `update`），更利于用例生成（见待确认 Q1）
- 测试点 → `type:'action'` 子节点，动作编码进 `label`
- 未确认/降级 → `status:'needs_review'` + `reviewReason`（承载来源/降级原因，作 provenance 旁路，不新增契约字段）
- 输出经 `validateExploreOutput` 校验（现有闸门 `assertActionGranularity` 不再把整棵树误判）

---

## 6. 可验证验收标准（确保能落地）

1. 对任意已知后台（RuoYi/GVA 类），探索产出**完整路由树**，含此前丢失的 `/system/user`、`/system/user/edit/:id` 等子路由。
2. 每个列表页至少含 1 个 `action` 子节点，且覆盖 `query` + 适用时的 `create/update/delete`。
3. **无权限验证**：测试登录账号无权访问的路由仍被发现（前端逆向），渲染正常标 `covered`，重定向标 `needs_review`。
4. `assertActionGranularity` 不再因 `actionCount===0` 误标整树 `needs_review`。
5. 双模式结构一致；non_ai 确定性可复现。
6. **零 contracts 改动**；`pnpm typecheck && pnpm lint && pnpm verify` 通过。

---

## 7. 落点（不碰红线）

- 新增 `packages/stage-explore/src/routeTreeExplorer.ts`（P1 路由逆向 + 静态兜底）
- 新增 `packages/stage-explore/src/menuFusion.ts`（P1–P5 融合 + P3 验证 + P4 功能点）
- `aiExplore.ts` / `nonAiExplore.ts` 改为调用融合核心（保留双模式隔离）
- **不动** `packages/engine-mcp`（只用其已暴露的 `evaluate`/`navigate`/`getCurrentUrl`）
- **不动** `packages/contracts`

---

## 8. 待你裁定（确认后进入 Phase 3 实施计划）

- **Q1**：`:param` 动态路由（`/user/edit/:id`）→ 作为**父列表页的 action 子节点（编辑）**，还是作为独立 `page` 节点？→ 推荐 action 子节点。
- **Q2**：P5 后端 API 嗅探是否启用？→ 推荐 best-effort（仅当引擎能暴露请求事件），不阻塞主流程。
- **Q3**：是否照搬参考项目的"12 系统硬编码拓扑库"作 L2 兜底？→ **推荐不搬**（避免虚构节点，与"精准"冲突），改为纯前端逆向 + DOM。
- **Q4**：落点（第 7 节）与"不碰 engine-mcp / contracts"是否同意？
- **Q5**：是否需要在 P1 之前先加一个"前端框架指纹探测"（Vue2/3、React、Angular、低代码）来选对应的逆向脚本？→ 推荐加，提升命中率。
