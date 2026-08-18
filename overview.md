# 探索双模式 · 真机验证交付（2026-08-17）

## 目标
修复探索功能"只抓父集目录、不进入菜单子页面"的问题，颗粒度到**按钮/功能**（列表/新增/修改/删除/查询/导出），父子关系明确；AI 模式与非 AI 模式严格隔离、各自可跑。用 ruoyi 在线 demo 真机验证。

## 根因（真机诊断锁定）
1. **菜单遍历策略错误**：一次性全量收集导航项再批量点击，ruoyi（Element-UI）侧边栏在父菜单展开后会重新渲染子菜单 DOM，`:nth-of-type(N)` selector 失效 → 子页面点不进去。
2. **a 包裹 li 的 DOM 结构**：`a[href]` 直接包裹 `li.el-menu-item`（同文本）时，a 与 li 都命中采集，li 的 parentSelector 指向 a 而非父菜单 → 层级匹配失败（真机只匹配到不被 a 包裹的"日志管理"）。
3. **串页污染**：keep-alive 缓存的隐藏页面 DOM（display:none）仍被当作可见控件采集；导航栏/侧边栏控件（个人中心/刷新/公告弹窗）混入页面 action。
4. **路由切换延迟**：点击菜单后旧页面内容短暂残留，立即采集会拿到上一个页面的控件。

## 修复（全部在 engine-mcp / stage-explore，未触碰 contracts）
### 非 AI 模式（menu-explorer.ts）
- **T1.5 递归 DFS 菜单遍历**：父菜单点击展开 → 等渲染 → 递归子项；叶子点击进页采集 action。
- **T1.6 selector 失效 fallback**：cssPath 点击失败时按文本/href 重新定位。
- **T1.7 页面内容加载等待**：先等主内容区文本稳定变化，再等 table/button 出现，避免串页。
- **T1.8 外链跳过**：外部域菜单（若依官网）不深入。
- **COLLECT_NAV_FN 去重**：a 包裹 li 同文本时保留 li 并继承 href，从保留集合移除 a → 层级匹配正确。
- **COLLECT_CONTROLS_FN 过滤**：跳过不可见元素 + 排除导航栏/侧边栏容器内的控件。

### AI 模式（aiExplore.ts，T3.2 增强）
- 候选标注**菜单/导航类**（sidebar/menu 容器内），prompt 强制 AI 优先点未访问菜单、进入每个子页面。
- 页面 label 取页面标题；URL 去重（新 URL 才 harvest）。
- 危险词硬挡（含删除/清空/重置等）；AI 异常安全收束并标 needs_review。
- T3.3：AI 结果同样过 `assertActionGranularity` 闸门（index.ts:582）。

## 真机验证结果（ruoyi 在线 demo，非 AI 模式）
- 系统管理 → 用户管理/角色管理/菜单管理/部门管理/岗位管理/字典管理/参数设置/通知公告，每个页面产出 **列表/查询/重置/新增/修改/删除/导入/导出** 等 action 叶子。
- 系统监控 → 在线用户（含强退）/定时任务（含新增/修改/删除/导出）/服务监控/缓存监控/缓存列表。
- 系统工具 → 表单构建/代码生成/系统接口。
- 日志管理（三级菜单）→ 操作日志/登录日志。
- 剩余 needs_review 仅限：首页（无功能点）、若依官网（外链）、数据监控（druid iframe）——合理。

## 验证汇总
| 门禁 | 结果 |
|---|---|
| engine-mcp 测试 | 80 通过（新增 11） |
| stage-explore 测试 | 32 通过 |
| orchestrator 测试 | 27 通过 |
| engine-mcp typecheck/lint | 全绿（lint 零警告） |
| stage-explore typecheck/lint/build | 全绿 |
| contracts | **零改动**（冻结红线守住） |
| S1 隔离 | nonAiExplore 零 AI 引用；aiExplore 零交叉引用 ✅ |

## 待用户
- **AI 模式真机验收**：需要有效 AI 配置（baseUrl / apiKeyRef / model），在 Explore 页开启「AI 辅助探索（实验）」后跑 ruoyi，验证同样产出操作级 action 且探索后不登出。
- 前端改动需 `pnpm build:frontend` 部署态生效。
- app 有预存 typecheck/lint 失败（Workbench/pipeline.test 等），非本次引入，建议单独清理。
