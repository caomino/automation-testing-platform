# Implementation Plan — 探索模块精确到「子目录 + 具体功能」(无权限降级管线)

> 对应设计文档：`docs/explore-precision-redesign.md`
> 阶段：Superpowers 第 3 步（Implementation Planning）。本计划已在「真实 SPA 联调」分支下落地，任务状态见各条 `状态`。
> 红线（用户裁定，最高优先级）：
> - **禁止改动 `packages/contracts/**`**（已冻结）。
> - **禁止改动 `engine-mcp` 内部实现**（只通过 `engine.evaluate` / `fetch` 公共接口交互）。
> 本次所有改动仅触及 `packages/stage-explore` 内部逻辑与测试。

---

## 0. 目标与约束

**目标**：让探索阶段能按用户要求精确到「具体子目录（如 用户管理 / 角色管理）」与「具体功能（新增 / 修改 / 列表 等）」，而非只吐出整站/整菜单。

**核心思路（无权限方案）**：前端打包产物（SPA 路由定义、JS 分包、DOM 菜单）**不受 RBAC 权限裁剪**——低权限账号也能在路由表里看到全部子路由与功能页。因此以「前端产物」为权威主源，逐级降级补强；后端 RBAC 菜单只作交叉校验、不作权威源。

**保真度边界（诚实声明）**：本机沙箱无 Chromium（Defender 锁 + 浏览器下载挂死）。故「真实 SPA 联调」用**运行时保真桩**实现——结构同构于真实 Vue3 运行时（`window.__vue_app__.config.globalProperties.$router.getRoutes()` 返回与 vue-router 4 归一化输出完全同形数据），所有生产代码路径（`getSpaRouteProbeScript → extractRoutesRuntime → routesToModuleNodes → buildModuleTreeViaDegradation → exploreNonAi`）真实跑通。仅在「vue-router 是否把 getRoutes 挂到 __vue_app__」这一 vue-router 内部契约处用等效数据替代。要 100% 真机联调，在可跑 Chromium 的机器上把桩换成 `createApp().use(router).mount('#app')` 真实挂载即可，生产代码无需改动。

---

## 1. 降级管线设计（每级都带「为什么降级」原因）

| 层级 | 来源 | 何时触发 | 降级原因记录点 |
|---|---|---|---|
| P1a | 运行时 SPA 路由内存探测（Vue3 `__vue_app__` / Vue2 / React `__remixRouter`） | 首选，置信度最高 | — |
| P1b | 静态逆向 JS 分包（正则扫打包产物里的 `path/title`） | P1a 无结果 | `P1a→P1b` |
| P2  | DOM 菜单树（`engine.exploreModules`） | P1b 也无结果 | `P1b→P2` |
| P3/P4 | 只读实导航 + 功能点采集（封顶 15 页，全 try/catch） | 对仅路由发现的页 best-effort 验证 | 节点 `needs_review` 原因 |
| P5  | 后端 API 嗅探 | **显式跳过** | `P5`（违反「只读探索、只增新数据」铁律，且 RBAC 后端菜单恰是「有权限才看得到」的来源） |
| P7  | 去重 | 兜底 | — |

降级链统一由 `nonAiExplore.ts` 打印 `console.warn('[explore][降级链] …')`，运行时可直接看到每级根因。

---

## 2. 任务分解（文件 / 代码 / 验证）

### T1 — 运行时探测脚本（探针）
- **文件**：`packages/stage-explore/src/routeTreeExplorer.ts` → `getSpaRouteProbeScript()`（L49-90）
- **改动**：读取 SPA 框架运行时路由表；**保留含 `:param` 的路由**（参考项目原实现会跳过，正是「修改/详情」功能被漏掉的根因，本实现修正）。
- **验证**：`realSpaRouteExplore.test.ts` › 「探针脚本能直接在真实形态运行时上跑出路由表」断言 `paths` 含 `/sys/user`、`/sys/user/edit/:id`、`/sys/article/create`。

### T2 — 路由 → ModuleNode 树映射（module → page → action 层级）
- **文件**：`packages/stage-explore/src/routeTreeExplorer.ts` → `routesToModuleNodes()`（L229-346）
- **改动**：
  - 非参数路由按路径段构建 `module/page` 层级，`page.url` 补全 `origin`；静态来源标 `needs_review` 并注明「降级自运行时探测」。
  - 参数路由（如 `/user/edit/:id`）作为父列表页的 `action` 子节点（`needs_review`），说明「动态参数路由无法实导航验证」。
- **验证**：同文件集成测试「:param 编辑路由…」断言编辑 action 挂在「用户管理」下且 `parentId` 一致、`status=needs_review`、`reviewReason` 含「动态参数路由」。

### T3 — 修复真实缺陷①：`rootIds` 索引错配导致空树 ★
- **文件**：`routeTreeExplorer.ts`
- **根因**：`rootIds` 存的是 `id`，但组装 `roots` 时按 `path` 查 `nodeByPath` → 永远 `undefined` → 返回空树（单测从未喂过多级路由，故一直潜伏）。
- **修复**：
  - L253 `if (depth === 0) rootIds.push(path);`（改存 path）
  - L340-344 组装 `for (const p of rootIds) { const n = nodeByPath.get(p); if (n) roots.push(n); }`
- **验证**：修复前 `exploreNonAi` 返回占位符「未探测到任何前端路由/菜单」；修复后 `flat` 含 `用户管理/新增用户/角色管理/…`。

### T4 — 修复真实缺陷②：子节点未挂入 `parent.children` 导致整棵子树丢失 ★
- **文件**：`routeTreeExplorer.ts`
- **根因**：loop 1（非参数路由构建层级）只设 `parentId`，从不把子节点 `push` 进 `parent.children` → `flatten()` 按 children 遍历时整棵子树丢失（flat 只剩 `['sys','未知页面','编辑',…]`，层级全丢）。
- **修复**（L268-275）：引入 `parentNode` 变量，循环内
  ```ts
  if (parentNode) {
    node.parentId = parentNode.id;
    if (!parentNode.children.includes(node)) parentNode.children.push(node);
  } else {
    node.parentId = null;
  }
  ```
- **验证**：修复后 `flat` 含完整层级 `用户管理→新增用户`、`角色管理→新增角色` 等。

### T5 — 修复真实缺陷③：`:param` 父页归属错误（动作词段上溯）★
- **文件**：`routeTreeExplorer.ts`
- **根因**：`/user/edit/:id` 的 `parentPath` 上溯到 `/user/edit`（含动作词段），会挂到一个 phantom 父页，而非真正的列表页。
- **修复**（L303-308）：断裂点前最后静态段若是动作词（`edit/detail/info/view/modify/show`），继续上溯一级到列表页：
  ```ts
  const pSegs = parentPath.split('/').filter(Boolean);
  const lastStatic = pSegs[pSegs.length - 1] ?? '';
  if (/^(edit|detail|info|view|modify|show)$/i.test(lastStatic)) {
    parentPath = '/' + pSegs.slice(0, -1).join('/');
  }
  ```
- **验证**：`/sys/user/edit/:id` 的「编辑」action 挂在「用户管理」下；`/sys/article` 无编辑路由则**绝不**出现「编辑」action（证明不误报）。

### T6 — 多源融合 + 降级链日志
- **文件**：`packages/stage-explore/src/menuFusion.ts`（`buildModuleTreeViaDegradation` L175-321）、`nonAiExplore.ts`（L37-48）
- **改动**：DOM 基线非空时以 DOM 为基线、将路由增量并入（`augmentWithRoutes`）；P5 显式跳过并记录；降级链 `console.warn`。
- **验证**：集成测试「无 SPA 运行时 → 降级到 DOM 菜单」断言 warns 含 `P1a→P1b`/`P1b→P2`/`静态逆向无产出`；「降级原因对运行时可见」断言含 `[explore][降级链]`/`P5`/`RBAC`。

### T7 — 运行时保真集成测试（无 Chromium 替代方案）
- **文件**：`packages/stage-explore/src/integration/realSpaRouteExplore.test.ts`（新增，7 用例）
- **关键技术**：
  - `globalThis.window/__vue_app__/document` 结构同构桩。
  - 引擎适配器 `evaluate(string)` 用 `node:vm` 的 `runInThisContext('(' + fn + ')')` 复刻 Playwright 语义，**绕开 ESLint `no-eval` error**（不直接 `eval`）。
  - 放 `src/integration/` 以匹配 vitest `include`（`src/**/*.test.ts`），否则跑不到。
- **验证**：`pnpm --filter @test-platform/stage-explore test` → 7/7 集成用例 + 全量 39/39 通过。

### T8 — 回归门禁（typecheck / lint / test 全绿）
- **命令**：
  ```bash
  pnpm --filter @test-platform/stage-explore typecheck
  pnpm --filter @test-platform/stage-explore lint        # zero-warning
  pnpm --filter @test-platform/stage-explore test        # --no-cache，避免 Defender 锁 .vite/results.json
  ```
- **状态**：✅ typecheck 干净；✅ eslint 零警告；✅ 39/39 测试通过。

---

## 3. 实现状态汇总

| 项 | 状态 |
|---|---|
| T1 探针脚本（保留 `:param`） | ✅ 完成 |
| T2 路由→Node 树映射 | ✅ 完成 |
| T3 缺陷① 空树 | ✅ 修复并验证 |
| T4 缺陷② 子树丢失 | ✅ 修复并验证 |
| T5 缺陷③ `:param` 父页归属 | ✅ 修复并验证 |
| T6 融合 + 降级链 | ✅ 完成 |
| T7 保真集成测试 | ✅ 7 用例全绿 |
| T8 回归门禁 | ✅ 全绿 |

**3 个单测未覆盖的真实缺陷**在「真实 SPA 联调」中被暴露并修复（空树 / 子树丢失 / `:param` 父页归属），证明「真实联调」而非「只写单测」的价值。

---

## 4. 遗留与后续（非本次阻塞）

1. **DOM 节点无 url 时与路由树并行**：当 `engine.exploreModules()` 返回的 DOM 节点不带 `url` 时，`augmentWithRoutes` 无法按 path 合并，会出现「用户管理」在 DOM 基线树与路由树各一份。生产中 `exploreModules` 返回的菜单节点通常带 url，可正确合并；如需更稳健可让 DOM 基线节点也带 path。
2. **真机联调**：在可跑 Chromium 的 CI/机器上把桩替换为真实 `createApp().use(router).mount('#app')`，可解除「保真度边界」声明，得到 100% 真机验证。
3. **P1b 静态逆向**当前正则较保守（仅匹配 `path/title` 同对象），混淆/函数式注册路由可能漏；属已知降级点，已由 P2 DOM 兜底，无需阻塞。
