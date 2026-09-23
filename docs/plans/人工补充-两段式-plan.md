# 实施计划 · 探索阶段「人工补充」（两段式）

| 项 | 值 |
|---|---|
| 阶段 | Superpowers Phase 3 — Implementation Planning |
| 依据 | `docs/designs/人工补充-两段式-design.md`（已签收：走后端契约 / 存后端 / 7 条全绿） |
| 纪律 | **TDD**（先写失败测试 → 最小实现 → 重构）；契约改动只加**可选**字段；**HARD RULE #0 自查**（无类名/文案清单） |
| 完成定义 | `§7 的 7 条验收全绿` + 真实系统实跑 + 页面/按钮/数据/报错四项验证 |

---

## 进度（每完成一项即更新）

| # | 任务 | 状态 |
|---|---|---|
| T1 | 契约加可选字段 `kind`/`parentMenu`/`menuUrl` | ✅ 完成 |
| T2 | 契约测试（6 例：兼容性 + 新字段 + 非法值） | ✅ **6/6 绿**，tsc 0 错 |
| T3 | 录制器去类名 + 记录 kind/parentMenu/真实落地 URL | ✅ **完成**（`orchestrator/server.ts`；3001 以 `tsx server.ts` 直跑源码，改动即时生效） |
| T4 | `mergeManualSupplement` 补 url / 按 kind 定 type / label 取文本 | ✅ **完成**：新增 7 例测试全绿；`verify/explore.verify.ts` **14/14 绿**；连带修复质量闸门豁免 |
| T5 | 新增"仅合并"后端入口 | ✅ **完成**：`POST /api/store/promote-manual`，curl 实测通过 |
| T6 | 待入树列表读写接口（持久化） | ✅ **完成**：`pending_trees` 表 + `GET/PUT /api/store/pending-tree`；**kill 后端重启后数据仍在**（实测） |
| T7 | 前端类型加 url/type/kind | ✅ **完成**（`PendingTreeItem` 已与 `ModuleNode` 字段对齐） |
| T8 | 前端"停止录制"改逐条采集（最小到按钮/功能） | ✅ **完成**（并实现按点击顺序自动建父子） |
| T9 | 前端入树改调后端合并 + 位置三选 | ✅ **完成**（`above`/`below`/`end` 均已实跑验证；**`end` = 挂为目标子节点**，`above`/`below` = 同级兄弟） |
| T10 | 前端列表补列 + 真实现忽略 + 持久化 | ✅ **完成**：URL/动作列 + depth 缩进 + `[✗忽略]` 真删除 + 列表持久化；**入树按钮改为"始终可点 + 明确提示 + 高亮模块树"**（原先 `disabled` 导致点击毫无反馈） |
| T11 | 端到端 7 条验收 | ✅ **7/7 通过**（录制器 fixture 实测 / 入树带 URL / 类型 / above-below-end / 持久化重启不丢 / 幂等去重 / UI 全链路点击入树）；页面·按钮·数据·报错四项均验证 |

### 验收后修复的真实缺陷（用户反馈驱动）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| A | **待入树列表刷新后数据丢失**（后端 2 条 → 打开页面变 0 条） | `pendingLoadedRef` 在**发起异步加载**时就同步置位，写回 effect 因而在数据回来前就把**首帧空数组** PUT 覆盖后端 | 改用「**加载完成**才置位」的 `pendingHydratedRef`（`.finally` 里赋值）+ `cancelled` 守卫 |
| B | **点「入树」「全部入树」无反应** | 模块树为空时选不中行 → `selectedModuleId=null` → 按钮 `disabled=true`；**HTML 的 disabled 按钮不触发任何事件** | 按钮**始终可点**：未选中目标时 `toast` 提示 + **高亮模块树卡片 1.8s** + `data-need-target` 标记弱化视觉。刻意**不用** `disabled`/`aria-disabled` —— 后两者会让屏幕阅读器与自动化工具（Playwright `isDisabled()`）误判为不可操作 |
| C | **父子关系入树后丢失**（先入父、再入子，子被平铺到根） | 两层原因：① 契约里 `above`/`below` 是**同级兄弟**插入，只有 **`end`** 才是"追加为目标子节点"，而我一直传 `below`；② 父条目入树后已从列表移除，`parentSeq` 指不到条目 | 新增 `resolveInsertTarget`：找到父 → `end`+父 id（成为子节点）；顶层 → `below`+选中行。父定位四级回退：本批新增 id → **`parentMenu` 按 label 查树** → 会话内 seq→id 映射 → 列表内父 label |
| D | 「全部入树」丢 URL/类型 | 走的是前端本地插入 `explorePromoteAll`（只写 `{id,name}`） | 改为**逐条走后端契约**，新增纯函数 `orderForPromote`（按 depth 升序、**父先入树**）；后端响应新增 `addedNodeIds` 供子条目精确引用父 id |

### 验证过程中修复的 3 个真缺陷
1. **录制器**：无文本图标链接被当菜单项（加空文本守卫）；菜单项误写 `parentMenu`（改为仅 action 写）。
2. **入树不幂等**：连续入树同名菜单产生重复节点 → `mergeManualSupplement` 加同名校验 + 2 个单测。
3. **层级造假**（用户截图反馈）：把「点击顺序」当层级 ⇒ 依次点 4 个**同级 tab** 被串成 7 层深链。
   → 改用**真实结构信号**（录制器 `domLevel` + URL 严格子路径），不成立则判**同级**；
   抽纯函数 `app/src/services/pendingHierarchy.ts` + **9 个单测**（含回归）。

### 唯一未覆盖的路径（如实标注）
「在平台 UI 点『人工补充』→ 平台自开浏览器 → **真人在该窗口点击** → 停止录制」这条内置链路未跑（该浏览器实例不被自动化控制）。
录制器的**注入代码**已用**同一段脚本**在真实站点 + fixture 上实测通过。
| T11 | 端到端 7 条验收 | ⏳ 待办 |

**检查点 1（契约）**：✅ 达成 —— `pnpm --filter @test-platform/contracts test` → `manualSupplement.test.ts` 6 passed。

### T4 期间发现的连带问题（必须一并处理）
`assertActionGranularity` 会统计全树 `type==='action' && status==='covered'` 的节点；一旦人工补录产生 action 节点，**会改变自动探索的质量闸门分支**（`actionCount===0` → 走页面级校验；>0 → 走动作覆盖校验），可能把原本合格的页面误标 `needs_review`。
→ **处理**：质量闸门**排除 `manuallyAdded===true` 的节点**（人工补充不参与自动探索的覆盖率判定）。归属 T4。

---

## 任务总览（11 项，按依赖排序）

| # | 任务 | 层 | 依赖 |
|---|---|---|---|
| T1 | 契约加可选字段 `kind`/`parentMenu`/`menuUrl` | contracts | — |
| T2 | 契约测试：新字段可选 + 旧数据兼容 | contracts | T1 |
| T3 | 录制器去类名 + 记录 kind/parentMenu/menuUrl | server.ts | T1 |
| T4 | `mergeManualSupplement` 补 url、按 kind 定 type、label 取文本 | stage-explore | T1 |
| T5 | 新增"仅合并"后端入口 | server.ts | T4 |
| T6 | 待入树列表读写接口（持久化） | server.ts + infra-store | T1 |
| T7 | 前端类型加 url/type/kind | app/context.tsx | T1 |
| T8 | 前端"停止录制"改逐条采集（最小到按钮） | app/Explore.tsx | T3,T7 |
| T9 | 前端入树改调后端合并 + 位置三选 | app | T5,T7 |
| T10 | 前端列表补 URL/类型列 + 真实现忽略 + 持久化读写 | app | T6,T7 |
| T11 | 端到端 7 条验收（真实系统实跑） | e2e | 全部 |

---

## T1 — 契约加可选字段

**文件**：`packages/contracts/src/types/ManualSupplement.ts`

**改动**（只加可选，不改既有语义）：
```ts
export interface ClickStep {
  selector: string;
  text: string;
  url: string;
  timestamp: number;
  /** 本次点击的类别：菜单项 / 页面按钮·功能。契约 v1.1 新增（可选，向后兼容） */
  kind?: 'menu' | 'action';
  /** kind='action' 时：该功能归属的菜单名（来自最近一次 kind='menu' 的点击） */
  parentMenu?: string;
}

export interface ClickPath {
  steps: ClickStep[];
  inferredModule: string;
  confidence: number;
  /** 该菜单页自身的 URL（与 steps 里按钮的 url 区分） */
  menuUrl?: string;
}
```

**验证**：`npx pnpm --filter @test-platform/contracts build` 成功；`npx tsc -p packages/contracts/tsconfig.json --noEmit` 0 错。

---

## T2 — 契约测试（TDD 先红后绿）

**文件**：`packages/contracts/src/__tests__/manualSupplement.test.ts`（新建）

**用例**：
1. 旧形状 `{selector,text,url,timestamp}` **无新字段也能通过校验**（向后兼容）
2. 新形状带 `kind:'action'`+`parentMenu` 通过校验
3. `kind` 非法值（如 `'foo'`）**不通过**

**验证**：`npx pnpm --filter @test-platform/contracts test` 全绿。

---

## T3 — 录制器：去类名 + 记录 kind/parentMenu/menuUrl

**文件**：`packages/orchestrator/server.ts`（注入器，约 594–640 行）

**改动**：
1. **删掉 SEL 里的框架类名**（`.ant-tabs-tab`/`.el-tabs__item`/`.ant-list-item`…），改结构判据：
   `'a[href], button, [role="button"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"]'`
2. 注入**导航区判定**（与自动探索同口径）：元素在「贴边竖向窄条 / 贴顶横向矮条」容器内 → `kind='menu'`；否则 `kind='action'`
3. 维护模块级 `lastMenu`：遇 `kind='menu'` 更新为其实用文本；`kind='action'` 时写入 `parentMenu = lastMenu`、`menuUrl = 该菜单点击时的落地 URL`
4. 推送对象补齐 `kind/parentMenu/menuUrl`

**验证**：`node` 脚本用真实会话录制 3 次点击 → 打印 `window.__tpClicks`，确认含 `kind` 且按钮的 `parentMenu` 正确。

---

## T4 — `mergeManualSupplement`：补 url、按 kind 定 type、label 取文本

**文件**：`packages/stage-explore/src/index.ts`（约 107–171 行）

**改动**：
1. 节点 `label` 改为 **`steps` 末段的 `text`**（当前错误地用了 `inferredModule`）
2. **补 `url`**：`steps` 中最后一个有 http 的 `url`
3. **按 `kind` 定 `type`**：末段 `kind==='menu'` → `'page'`；`'action'` → `'action'`
4. 保留 `above/below/end` + `relativeToNodeId` + 去重逻辑不变

**验证**：`packages/stage-explore` 单测（补 3 条：url 写入 / type=page / type=action）。

---

## T5 — 新增"仅合并"后端入口

**文件**：`packages/orchestrator/server.ts`

**接口**：`POST /api/store/projects/:projectId/module-tree/manual-merge`
```jsonc
{ "systemId": "...", "manualSupplement": { "clickPath": [...], "insertPosition": "below", "relativeToNodeId": "n_1" } }
```
**行为**：读当前树 → 调 `mergeManualSupplement` → 落库 → 返回新树。
**验证**：curl 带一条 clickPath（kind=menu + kind=action）→ 返回树里出现 page 节点且其下挂 action 节点，两者 **url 非空**。

---

## T6 — 待入树列表读写接口（持久化）

**文件**：`packages/orchestrator/server.ts` + `packages/infra-store`（新增表或复用 key-value）
**接口**：`GET/PUT /api/store/projects/:projectId/pending-tree?systemId=`
**验证**：PUT 两条 → GET 读回一致 → **重启后端** → GET 仍在。

---

## T7 — 前端类型加 url/type/kind

**文件**：`packages/app/src/context.tsx`（`ModuleNodeView` ~191、`PendingTreeItem` ~201）
**验证**：`npx vite build`（app）通过。

---

## T8 — 前端"停止录制"改逐条采集

**文件**：`packages/app/src/screens/Explore.tsx`（`handleStopRecording` ~346-388）
**改动**：**删除"按 URL 分组压成 `A → B`"**；改为**每个 step 一条**（最小到按钮），写入 `PendingTreeItem{ name, url, kind, parentMenu, module, confidence, status }`。
**验证**：UI 录制 → 列表行数 == 点击次数（含按钮）。

---

## T9 — 前端入树改调后端合并 + 位置三选

**文件**：`Explore.tsx` + `context.tsx`
**改动**：`[入树]` → 组装 `ManualSupplement` → 调 T5 接口 → 用返回树替换本地树；位置支持 above/below/end（UI 默认 below）。
**验证**：UI 点入树 → 树出现新节点且带 url；选"上方/内部"各测一次。

---

## T10 — 前端列表补列 + 真实现忽略 + 持久化读写

**文件**：`Explore.tsx`
**改动**：列表加 **URL 列 / 类型列**；`[✗忽略]` 从 `toast` 占位改为**真删除**；挂载时从 T6 接口读、变更后写。
**验证**：刷新页面列表仍在；点忽略后条目消失且刷新不复现。

---

## T11 — 端到端 7 条验收（真实系统实跑）

用 **OA**（已有会话）与 ruoyi：按 `design.md §7` 逐条打勾；同时验证 **页面渲染 / 按钮可用 / 落库一致 / 日志与控制台无 error**。

---

## 执行顺序与检查点

```
T1→T2          契约（含测试）        ← 检查点 1：契约测试全绿
T3→T4→T5→T6    后端（含接口）        ← 检查点 2：curl 三接口通
T7→T8→T9→T10   前端（含持久化）      ← 检查点 3：UI 全流程可走
T11            端到端 7 条验收        ← 检查点 4：7 条全绿才收工
```
每个检查点我会把**实际命令输出**贴出来，不通过的继续排查，不宣称完成。
