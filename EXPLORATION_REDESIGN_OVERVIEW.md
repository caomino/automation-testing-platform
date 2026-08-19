# 探索模块「无权限精准降级」重构 — 交付总览（v2，通用适配版）

## 目标
让探索模块**精确到子目录 + 具体功能（添加/修改/列表/删除/导出/导入…）**，且**不受登录账号 RBAC 权限影响**——低权限账号也能发现全部子路由与功能页。
**产品定位：商业产品，适配所有管理系统（Vue/React/Angular SPA、传统多页、低代码），不写死任何系统拓扑。**

## 实现（仅 `packages/stage-explore/src`，未碰 `contracts` / `engine-mcp`）
- **`routeTreeExplorer.ts`（新增）**：P1 路由逆向，构建**单一权威树**。
  - P1a 运行时 SPA 路由内存探测（Vue2/3 `__vue_app__` / React `__remixRouter__`）。
  - P1b 静态逆向 JS 分包（`fetch` 同源脚本，规避 Node 全局类型依赖）。
  - `routesToModuleNodes`：**以 path 段为唯一权威、确定性建层级**（module→page→action）。
    - 同 path 多条路由只取首个非空标题，优先含中文者（避免裸 name 覆盖）。
    - 含子页面的节点后处理修正为 `module`（杜绝「单段路由既作页又作父容器」的层级混乱）。
    - `:param` 路由（/user/edit/:id）映射为父列表页的 `action` 子节点（needs_review，说明动态路由无法实导航）。
- **`pageActionExplorer.ts`（新增）**：**页面内「具体功能点」抽取器**（对齐参考项目 `extractButtonsFromDOM`）。
  - `getActionExtractScript()`：浏览器内只扫主内容区，排除 nav/sidebar/header 等导航控件与隐藏元素，抓页面内真实按钮。
  - `classifyActionType()`：完整动作词表（新增/批量删除/删除/修改/授权/导出/导入/详情/查询；批量删除严格先于删除、授权独立归类）。
  - `extractPageActions()`：导航到页 → `engine.evaluate` 抽按钮 → 转 `type:'action'` 子节点挂到 page 下；DOM 实采为空但标题像 CRUD 模块时，按标题**兜底推断**功能点并标 `needs_review`（诚实不造假）。
- **`menuFusion.ts`（新增，融合核心）**：**单树融合，绝不 merge 两棵树**。
  - 主源优先级：**路由树（path 确定性强）> DOM 菜单树（非 SPA 回退）**。
  - DOM 菜单**仅作「中文标题富化」**（按 path/label 匹配抄标题），**不并行为第二棵树**——这是消除「层级混乱/数据重复」的关键。
  - P3/P4 对**所有 page**（含无 url 的 DOM 页）抽取功能点；引擎已给足（≥3 covered）则跳过。
  - P5 后端 API 嗅探显式跳过（引擎未暴露网络事件 + 只读铁律）。
  - P7 全局去重（按 id 去重兜底）。
- **`index.ts`（微调）**：`assertActionGranularity` 粒度闸门改为**按页面、子树计 covered 动作**——任一页面子树内无「浏览器实采确认」功能点即标 needs_review（避免靠「标题推断占位」骗过闸门；容器页子孙有功能点则不误伤）。
- `nonAiExplore.ts` / `aiExplore.ts`：双模式均走融合核心；AI = 融合基线 + `aiDeepenPages`（P6）合并；保留原签名。

## 为什么这套是「层级分明、不重复、不缺失、功能不缺」的（对照参考项目 Untitled）
参考项目 `universalScanner.ts` 的主路径是 **DOM 层级抽取直接产出单树**，`getStandardSystemDefinition`（硬编码库）**仅在 DOM 完全抽不到时兜底**；最终 `formatAndDeduplicate` 做**全局 0 重复校验**。
本项目等价采用「单一权威树 + 全局去重」的通用算法：
- **层级分明**：路由 path 段确定性建层级，节点类型（module/page/action）由结构推导，无并行 phantom 父节点。
- **不重复**：全程以 path 为 key，DOM 只富化标题不新建节点，杜绝「用户管理」出现两份。
- **不缺失**：路由树覆盖全部前端子路由（不受 RBAC 裁剪）；无 url 的 DOM 页也纳入功能点抽取。
- **功能不缺**：每个 page 跑页面内按钮抽取（完整动作词表），缺失时按标题推断并标待确认。

## 关键设计判断（不变）
- **无权限主源 = 前端产物**（路由/分包/DOM），RBAC 不裁剪。
- **P5 后端 API 嗅探显式跳过**：引擎未暴露网络事件，且主动嗅探写操作违反「只读探索」铁律。
- **排除硬编码系统库**：不抄参考项目的 12 系统硬编码拓扑（会虚构节点/有权限才可见），改为 100% 运行时逆向，适配任意系统。

## 红线守约
未碰 `packages/contracts/**`，未碰 `engine-mcp` 内部实现（只用其公共 `evaluate`/`navigate`/`exploreModules`）。

## 本轮（v2）修正记录
- **删除 `systemAdapters.ts`（原 P0 硬编码系统拓扑）**：该写法写死了 `mod_index`/`mod_aichat` 等具体结构，违反「商业产品适配所有系统」，已整体移除并删除其测试。
- **融合由「双树 merge」改为「单树 + DOM 标题富化」**：原 `augmentWithRoutes` 把 DOM 树与路由树当两棵独立树合并，DOM 无 url 节点匹配不上 → 重复、混插 phantom 父节点 → 层级乱、缺失；现以路由树为唯一权威树，DOM 仅抄中文标题。
- **粒度闸门改为按页面子树计 covered 动作**：原按「全部 action 叶子」计数，被标题推断占位骗过；现仅计浏览器实采确认者。

## 门禁
- typecheck ✅ / lint(0 warning) ✅ / stage-explore test **43/43 PASS**（route/integration/index/aiExplore 四套）。
- 全仓自测：stage-explore 零回归；其余失败均为既有（stage-login 契约↔用例冲突、app 未实现前端），与本轮无关。

## 文档
- `docs/explore-precision-redesign.md` — Brainstorming 设计
- `docs/explore-redesign-review.md` — Step2 审核 + 第七章「实现后复验」
