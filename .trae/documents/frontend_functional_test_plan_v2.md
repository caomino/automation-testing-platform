# 前端完整功能测试计划（v2 - 全面覆盖）

## 研究结论

### 应用结构
- **10 个页面**：Workbench(s1), Explore(s2), Feature(s3), Case(s4), Execute(s5), Defect(s6), Logs(s8), AIConfig(s7), ProjectMgmt(s9), Knowledge(s10)
- **全局状态管理**：React Context + useReducer，80+ 个 action
- **导航**：侧边栏分组导航 + 顶部面包屑 + 快速操作按钮

### 发现的根本问题

| # | 问题 | 文件 | 严重度 |
|---|------|------|--------|
| 1 | 导出按钮全部为占位 toast，无实际导出逻辑 | Feature.tsx, Execute.tsx, Explore.tsx, Defect.tsx | 🔴 高 |
| 2 | Feature.tsx `navigator.clipboard.writeText()` 在非安全上下文会静默失败 | Feature.tsx L71 | 🔴 高 |
| 3 | LoginModal 子系统登录流程：父门户复用逻辑未完整测试 | Workbench.tsx | 🟡 中 |
| 4 | Case.tsx 表格列头与规范不符（有"首次结果""回归结果"） | Case.tsx L149-151 | 🟡 中 |
| 5 | ProjectMgmt 子系统（subsystem）配置与父门户关联逻辑未测试 | ProjectMgmt.tsx | 🟡 中 |
| 6 | AIConfig 测试连接为模拟，未对接后端 | AIConfig.tsx | 🟢 低 |
| 7 | Knowledge 编辑/保存/重置流程未测试 | Knowledge.tsx | 🟢 低 |
| 8 | Logs 清理策略 CRUD 未测试 | Logs.tsx | 🟢 低 |

---

## 第一阶段：修复源码根本问题

### 1.1 Feature.tsx — 修复复制和导出
**问题**：`navigator.clipboard.writeText()` 在 http:// 环境会静默失败
**修复**：
- `handleCopyToExcel()`：改为生成 tab-separated 纯文本，使用 `navigator.clipboard.writeText()` + `document.execCommand('copy')` 降级方案
- `导出 Excel`：实现真正的 CSV 导出（生成 Blob → 创建临时 `<a>` → 触发下载）

### 1.2 Case.tsx — 添加导出按钮 + 修复列
**修复**：
- 移除"首次结果"和"回归结果"列表头和对应数据单元格
- 添加 `导出 CSV` 按钮，实现真正的 CSV 导出

### 1.3 Execute.tsx — 实现导出结果
**修复**：将 execMatrix 数据转为 CSV 格式并触发下载

### 1.4 Explore.tsx — 实现导出模块树
**修复**：将 moduleTree 转为 JSON 格式并触发下载

### 1.5 Defect.tsx — 实现导出缺陷
**修复**：将 defectRows 转为 CSV 格式并触发下载

---

## 第二阶段：为所有 10 个页面编写完整交互测试

### 2.1 Workbench 页面（12 测试）

| 测试 | 内容 |
|------|------|
| 登录状态渲染 | 已登录/未登录状态正确显示 |
| 系统类型标签 | standalone/subsystem/portal 标签正确 |
| 子系统父门户显示 | subsystem 类型显示父门户信息 |
| 未登录按钮状态 | 登录按钮可用，流水线按钮禁用 |
| 登录流程（credential） | 填写凭据 → runPipelineLogin → 状态更新 |
| 登录流程（manual-takeover） | 人工接管模式 → 验证码 → 确认登录 |
| 登录流程（no-login） | 免登录模式直接进入 |
| 切换系统菜单 | 点击"切换系统"展开下拉 → 选择系统 → setSystem |
| 探索按钮 | 点击 🔍 探索 → runPipelineExplore → 导航到 s2 |
| 功能点按钮 | 点击 📋 功能点 → runPipelineFeature → 导航到 s3 |
| 用例按钮 | 点击 🧪 用例 → runPipelineCase → 导航到 s4 |
| 执行按钮 | 点击 ▶ 执行 → runPipelineExecute → 导航到 s5 |
| 缺陷按钮 | 点击 🐛 缺陷 → runPipelineDefect → 导航到 s6 |
| 活动记录 | 最近活动列表正确显示 |

### 2.2 Explore 页面（10 测试）

| 测试 | 内容 |
|------|------|
| 模块树渲染 | 多级模块树正确显示 |
| 空状态 | 空模块树不崩溃 |
| 选中模块 | 点击树节点 → exploreSetSelected |
| 勾选多选 | 复选框 toggle 调用 exploreToggleChecked |
| 新增模块 | 点"+ 新增模块" → 填名称 → exploreAddModule |
| 编辑模块 | 选中 → "编辑选中" → 改名称 → exploreUpdateModule |
| 删除模块 | 选中 → "删除选中" → 确认 → exploreRemoveModule |
| 人工补充 | 打开手动补充 Modal → 填写路径/模块 → exploreAddPending |
| 入树操作 | 待入树列表 → 行内"入树" → explorePromoteToTree |
| 全部入树 | "✓ 全部入树" → explorePromoteAll |
| 覆盖率 | 覆盖率统计正确显示 |
| 导出模块树 | 点击"导出模块树" → 触发 JSON 下载 |

### 2.3 Feature 页面（12 测试）

| 测试 | 内容 |
|------|------|
| 表格渲染 | 功能点表格 9 列正确显示 |
| 合并单元格 | merge=true 的行正确 rowspan |
| 加载固定模板 | 点击"加载固定模板" → toast |
| 加载本轮版本 | 有数据时 toast 成功，无数据时 toast 提示 |
| AI 提效功能点 | 点击"AI 提效功能点" → toast |
| 新增行 | 点"+ 新增行" → featureAddRow(afterIndex) |
| 删除行 | 点"×" → 确认对话框 → featureRemoveRow |
| 编辑单元格 | 点击单元格 → 编辑 → 失焦 → featureUpdateRow |
| needs_review 标记 | 显示 needs_review 标签，点击切换 |
| 复制到 Excel | 点击"📋 复制到 Excel" → 生成剪贴板文本 |
| 导出 Excel | 点击"导出 Excel" → 触发下载 |
| 整体确认 | 点击"✓ 整体确认" → 确认对话框 → featureConfirm |
| 取消确认 | 已确认状态 → 点击 → featureUnconfirm |

### 2.4 Case 页面（14 测试）

| 测试 | 内容 |
|------|------|
| 表格渲染 | 用例表格 8 列正确显示 |
| 单元格编辑 | 点击单元格 → 编辑 → 失焦 → caseUpdateRow |
| 插入新行 | 点"+" → caseAddRow(index) → 下方插入 |
| 删除行 | 点"×" → 确认对话框 → caseRemoveRow |
| 配置 Modal | 点"⚙ 配置" → 打开 → 填写字段 → caseUpdateMeta |
| Meta 编辑 | 双击 Meta 头字段 → Modal 编辑 → caseUpdateMeta |
| 选择模块 Modal | 点"⚙ 选择模块" → SearchableSelect → caseSetSelection |
| AI 辅助开关 | Toggle on/off → caseToggleAi |
| 生成选中 | 点击"生成选中" → caseRegenerate |
| 全部生成 | 点击"全部生成" → caseRegenerate |
| 导出 CSV | 点击导出按钮 → 触发 CSV 下载 |
| 空数据容错 | 空 caseRows 不崩溃 |
| 结论列渲染 | 结论列含操作按钮（+/×） |

### 2.5 Execute 页面（10 测试）

| 测试 | 内容 |
|------|------|
| 模块树渲染 | 模块列表带用例数正确显示 |
| 勾选模块 | 点击模块 checkbox → execToggleModule |
| 全选/取消全选 | 全选按钮 → execToggleAll |
| 执行选中（无选中） | 无选中时按钮 disabled |
| 执行选中（有选中） | 有选中 → execRun("selected") |
| 执行全部 | 点击 → execRun("all") |
| 矩阵单元格点击 | 点击单元格 → 显示详情 Modal |
| 数据隔离 Verify | 打开 Modal → 运行 Verify → execVerifyIsolation |
| 导出结果 | 点击"📥 导出结果" → 触发 CSV 下载 |
| 浏览器渲染 | 多浏览器列头正确显示 |

### 2.6 Defect 页面（10 测试）

| 测试 | 内容 |
|------|------|
| 缺陷列表渲染 | 缺陷表格正确显示 |
| 筛选 | 点击筛选按钮 → defectSetFilter |
| 新建缺陷 | 点"+ 新建缺陷" → 填写表单 → defectAdd |
| 编辑缺陷 | 点编辑 → 打开编辑 Modal → defectUpdate |
| 删除缺陷 | 点删除 → 确认 → defectRemove |
| 优先级标签 | 高/中 优先级 Tag 颜色正确 |
| Lightbox | 点击截图 → Lightbox 显示 |
| 导出 | 点击"📤 导出" → 触发 CSV 下载 |
| 导入 | 点击"📥 导入" → toast |
| 空状态 | 空列表不崩溃 |

### 2.7 ProjectMgmt 页面（12 测试）

| 测试 | 内容 |
|------|------|
| 项目列表渲染 | 项目表格正确显示 |
| 新建项目 | 填写项目表单 → addProject |
| 编辑项目 | 编辑项目 → updateProject |
| 删除项目 | 删除确认 → removeProject |
| 系统列表渲染 | 系统表格正确显示 |
| 新建 standalone 系统 | 类型选 standalone → 填 URL → addSystem |
| 新建 portal 系统 | 类型选 portal → addSystem |
| 新建 subsystem 系统 | 类型选 subsystem → 选择父门户 → 自动填充 URL → addSystem |
| 子系统门户路径 | subsystem 显示父门户路径 |
| 登录方式选择 | no-login/credential/manual-takeover |
| credential 凭据 | 账号密码字段正确显示 |
| manual-takeover 提示 | 人工接管说明正确 |
| 进入系统 | 点"进入" → setSystem + setActiveScreen("s1") |

### 2.8 AIConfig 页面（8 测试）

| 测试 | 内容 |
|------|------|
| 列表渲染 | AI 配置列表正确显示 |
| 新建配置 | "+ 添加配置" → 填写 → aiAdd |
| 编辑配置 | 编辑 Modal → aiUpdate |
| 删除配置 | 删除确认 → aiRemove |
| 启用/禁用 | 点击启用按钮 → aiToggleEnabled |
| 设为默认 | 点击"设为默认" → aiSetDefault |
| 测试连接 | 点击"测试" → 显示测试结果 Modal |
| 空列表 | 空列表不崩溃 |

### 2.9 Logs 页面（6 测试）

| 测试 | 内容 |
|------|------|
| 保留天数选择 | 7/15/30/90 天切换 |
| 单文件大小 | 修改 maxFileSizeMB → logUpdatePolicy |
| 最多文件数 | 修改 maxFiles → logUpdatePolicy |
| 保存策略 | 保存策略 → logUpdatePolicy |
| 清理过期 | 确认清理 → logCleanupExpired |
| 一键清空 | 确认清空 → logClearAll |

### 2.10 Knowledge 页面（5 测试）

| 测试 | 内容 |
|------|------|
| 知识列表渲染 | 知识条目树正确显示 |
| 选择条目 | 点击条目 → 切换编辑内容 |
| 编辑内容 | textarea 编辑 → knowledgeUpdate |
| 保存 | 点击"保存" → knowledgeUpdate → toast |
| 重置 | 点击"重置" → 恢复原始内容 |

### 2.11 App.tsx 导航测试（8 测试）

| 测试 | 内容 |
|------|------|
| 侧边栏导航 | 点击导航项 → setActiveScreen |
| 面包屑 | 项目+系统名正确显示 |
| 子系统面包屑 | 子系统显示父门户 › 子系统 |
| 顶部连接系统 | 点击"连接系统" → setLoginStatus |
| 顶部退出登录 | 已登录时 → setLoginStatus(logged_out) |
| 播放下一步 | 点击"播放下一步 ▷" → setActiveScreen("s2") |
| Toast 显示 | toastMsg 不为空时显示 toast |
| Screen 切换 | activeScreen 对应 section 有 active class |

---

## 第三阶段：执行与验证

1. 运行所有测试
2. 确认 80+ 测试全部通过
3. 覆盖所有页面的所有交互按钮

---

## 技术要点

### 测试 Mock 策略
- **useApp mock**：使用 `vi.mock('../context')` 完全 mock，提供所有 state 和 action
- **Pipeline 服务 mock**：mock `runPipelineLogin/Explore/Feature/Case/Execute/Defect` 返回合理数据
- **Clipboard mock**：`navigator.clipboard.writeText` mock
- **下载测试 mock**：`Blob`、`URL.createObjectURL`、`<a>.click` mock
- **数据 API mock**：`dataApi` 模块 mock

### 文件结构
```
src/
├── screens/
│   ├── workflow.test.tsx    (重写 - 10 个页面的交互测试)
│   ├── Feature.tsx          (修复导出/复制)
│   ├── Case.tsx              (修复列 + 添加导出)
│   ├── Execute.tsx           (修复导出)
│   ├── Explore.tsx           (修复导出)
│   └── Defect.tsx            (修复导出)
├── App.tsx                   (保持不变)
├── App.test.tsx              (新建 - 导航测试)
└── context.tsx               (保持不变)
```

### 测试执行
```bash
cd d:\newTest\packages\app
pnpm run test
```

---

## 风险处理

| 风险 | 应对 |
|------|------|
| jsdom 不支持 Clipboard API | mock `navigator.clipboard`，实现降级路径测试 |
| 文件下载在测试环境无法触发 | mock Blob/URL/anchor，验证 mock 被调用 |
| 异步流水线调用超时 | 使用 `vi.useFakeTimers()` + `vi.advanceTimersByTime()` |
| 大量 mock 导致测试代码臃肿 | 抽取 setup helper 函数，保持每个测试简洁 |
| 组件间状态联动复杂 | 严格隔离每个测试用例，beforeEach 重置所有 mock |
