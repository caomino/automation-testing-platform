# 设计文档 · 探索阶段「人工补充」（两段式）

| 项 | 值 |
|---|---|
| 阶段 | Superpowers Phase 1 — Brainstorming |
| 日期 | 2026-09-21 |
| 依据 | 用户原话 + 用户拍板 4 条 + `docs/自动化测试平台-主规格.md §18.6` / `docs/可执行PRD.md P2-T02·T06·T07` / `docs/问题分析与补充定义.md §3.4` + 契约 `ManualSupplement`（@frozen） |
| 状态 | **待用户签收**（签收后进入 Phase 3 写 plan.md） |

---

## 1. 目标 / 非目标

**目标**：给自动探索做**人工兜底**。用户在真实浏览器里操作自己的系统，平台把点击**采集到"具体按钮/功能"这一最小颗粒度**，按**所属菜单**归位，逐条显示在「待入树列表」，用户选中模块树某行后写入模块树，产出与自动探索**同等可用**的节点（**必须带 URL**）。

**非目标**（明确不做，避免范围蔓延）：
- 不做"零操作自动补录"——这是人工兜底，就是要人点。
- **不改变自动探索的边界**（自动探索仍只到菜单子页粒度、不采页面按钮）。"采到按钮/功能"**仅针对人工补充**。
- 不引入 AI 推断菜单归属（先用规则，规则不可靠处标低置信，允许人工在列表里改）。

---

## 2. 用户流程（已拍板，不改）

| 步 | 动作 | 关键约束 |
|---|---|---|
| ① | 探索屏点「人工补充」 | 弹出**可见浏览器**，复用已登录会话 |
| ② | 用户在浏览器里正常操作（点菜单、点页面按钮） | 平台逐次记录：文字、**归属菜单**、**落地 URL**、时间、类别 |
| ③ | 点「停止录制」 | 记录写入**待入树列表**（探索屏常驻卡片），**不直接改树** |
| ④ | 在模块树**选中目标行** | 该行 = 插入落点 |
| ⑤ | 对列表条目点 **[入树]** | 生成节点（带 URL/类型）→ **落库** |

---

## 3. 数据模型设计

### 3.1 契约现状（@frozen，不改语义，只允许加可选字段）

```ts
ManualSupplement { clickPath: ClickPath[]; insertPosition: 'above'|'below'|'end'; relativeToNodeId: string|null }
ClickPath { steps: ClickStep[]; inferredModule: string; confidence: number }
ClickStep { selector: string; text: string; url: string; timestamp: number }
ModuleNode { id; label; type: 'system'|'module'|'page'|'action'; url?: string; children[]; ... }
```

### 3.2 需要补充（**可选字段**，向后兼容）

| 位置 | 新增 | 用途 |
|---|---|---|
| `ClickStep` | `kind?: 'menu' \| 'action'` | 区分「菜单项」与「页面按钮/功能」——**这是"最小颗粒度到按钮"的落点** |
| `ClickStep` | `parentMenu?: string` | 该按钮/功能**归属哪个菜单**（第 2 条拍板：归属对） |
| `ClickPath` | `menuUrl?: string` | 该菜单页自身的 URL（与按钮的 url 区分开） |

> 理由：契约是 @frozen，加**可选**字段不破坏既有实现与测试；若后续要冻结升级，走 MAJOR + 迁移脚本。

### 3.3 落到模块树的映射（拍板 2、3）

```
菜单项(kind=menu)     → ModuleNode.type = 'page'      （默认页面，可手改）
页面按钮/功能(kind=action) → ModuleNode.type = 'action'  （挂在所属页面下）
```
结果形态：`系统管理(module) > 用户管理(page) > 新增/导出(action)` —— 与功能点表「测试点」对齐。

---

## 4. 关键设计决策（备选方案与权衡）

### D1 录制方式
- **A. 注入点击监听器**（现有：`window.__tpClicks` + `document.addEventListener('click', capture, true)`）——**采用**
- B. 走 CDP 事件（需换引擎接口，收益不抵改动）
- C. 定时轮询 DOM 差异（漏点、噪声大）

**取舍**：A 已在线上跑通，只需**扩充采集内容**（kind/parentMenu），不动机制。

### D2 「归属菜单」如何判定
- A. 纯靠点击路径推（从根到当前的菜单链）
- B. 纯靠点击所在容器（导航区 = 菜单项；内容区 = 功能）
- **C. A+B 混合** ——**采用**

**规则**：点击元素落在**导航区形态容器**（贴边窄条 / 贴顶矮条，与自动探索同口径）→ `kind='menu'`，并**更新"当前菜单上下文"**；否则 → `kind='action'`，`parentMenu` = **最近一次 menu 点击的 text**；本次会话一开始还没点菜单 → 归属留空并在列表标"待定"，允许人工改。

### D3 入树落地路径（**最关键的架构选择**）
- **A. 前端 reducer 自己算**（现状）——优点：即时；缺点：**丢 URL**（`{id,name}`）、不支持 above/内部、与后端实现重复
- **B. 走后端 `mergeManualSupplement`**（契约已实现：above/below/end + relativeToNodeId + 去重）——**采用**

**取舍**：选 B 的代价是**需要新增一个"仅合并、不重探索"的后端入口**（现在 `manualSupplement` 只在**探索时**被消费），但换来：**复用冻结契约的逻辑、单一实现、天然支持三种插入位置与去重**。
> 若你更倾向"前端立即改树、不新增后端接口"，可以选 A，但必须把 URL/type/位置补齐（相当于在前后端各维护一份合并逻辑）。**这是我需要你拍板的第 1 点。**

### D4 入树位置
`above / below / end` 三选，**以模块树选中行为基准**（拍板 4）。`relativeToNodeId = 选中行 id`。

### D5 待入树列表持久化
- A. localStorage（前端本地）
- **B. 后端接口**（与模块树同源）——**采用**
- 理由：文档要求"永久卡片"，且要在**换设备/重启后端**后仍在；localStorage 与项目数据不同源，易丢。

### D6 录制器的元素识别（**遵守 HARD RULE #0**）
现有 `SEL` 含 `.ant-tabs-tab` / `.el-tabs__item` / `.ant-list-item` 等**框架类名** → **必须清掉**，改为**结构判据**：
`可点击元素 = a[href] / button / [role=button|tab|menuitem] / input[type=button|submit]`，再用**几何+结构**区分"导航区 vs 内容区"。**否则换个系统就录不到（写死）**。

---

## 5. 影响面（改动清单）

| 层 | 文件 | 改什么 |
|---|---|---|
| 契约 | `packages/contracts/src/types/ManualSupplement.ts` | 加 3 个**可选**字段（kind / parentMenu / menuUrl） |
| 后端录制 | `packages/orchestrator/server.ts`（注入器 ~594-640） | 清类名、改结构判据；记录 kind/parentMenu/menuUrl |
| 后端合并 | `packages/stage-explore/src/index.ts`（`mergeManualSupplement`） | **补 url**、按 kind 定 type、label 取 step 末段文本 |
| 后端接口 | `packages/orchestrator/server.ts` | **新增**"仅合并"入口（D3 选 B 时必需）；待入树列表读写接口（D5 选 B 时必需） |
| 前端类型 | `packages/app/src/context.tsx` | `ModuleNodeView` / `PendingTreeItem` 加 `url`、`type`、`kind` |
| 前端录制 | `packages/app/src/screens/Explore.tsx` | 停止录制时**不再按 URL 压成一条**；改逐条（最小到按钮）并带 URL/归属 |
| 前端入树 | `Explore.tsx` + `context.tsx` | 调后端合并接口（D3-B）；插入位置三选 |
| 前端列表 | `Explore.tsx` | 列表加 URL/类型列；`[✗忽略]` 真正实现；持久化读写 |

---

## 6. 风险与边界

| 风险 | 处理 |
|---|---|
| 契约 @frozen | 只加**可选**字段；不改既有字段语义；补契约测试 |
| 按钮级录制量大 | 列表按"菜单"分组显示、同元素去重；录制上限（如 300 步）保护 |
| 归属推断不准 | 列表里**归属可手改**；推断不出就标"待定"，不造假 |
| 会话过期 | 录制复用登录态；失效时明确提示"请重新登录"，不静默失败 |
| 又一次"写死" | 录制器/归属判定只用结构+几何+行为判据；提交前按 AGENTS.md HARD RULE #0 自查 |

---

## 7. 验收标准（判定"还差多少"的唯一依据）

1. **录得到**：点菜单 + 页面内按钮 → 列表出现对应条目，**最小到按钮/功能**，每条有名字 + URL
2. **归属对**：每个按钮/功能归到**它所在的那个菜单**
3. **入树**：选中模块树某行 → [入树] → 新节点位置正确、**带真实 URL**
4. **类型**：菜单 → `page`；按钮/功能 → 其下 `action`
5. **位置**：可插到选中行**上方 / 下方 / 内部**
6. **持久化**：刷新页面 + 重启后端后，列表与已入树节点都还在
7. **去重**：重复录制同一菜单 → 标「已去重」，不产生第二个同名节点

---

## 8. 用户签收结论（2026-09-21，已确认）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | **D3 落地路径** | ✅ **走后端契约**：复用 `mergeManualSupplement`（above/below/end + 去重），并**新增一个"仅合并、不重探索"的后端入口** |
| 2 | **D5 持久化** | ✅ **存后端**：新增待入树列表读写接口，与模块树同源 |
| 3 | **本期范围** | ✅ **一次做到 §7 的 7 条全绿**（含持久化与去重） |

> 设计阶段结束，进入 Phase 3（Implementation Planning）→ `docs/plans/人工补充-两段式-plan.md`。
