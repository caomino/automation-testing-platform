# 项目管理页面重构计划

## 1. 需求分析

### 1.1 问题描述
当前页面设计为"项目列表"和"系统列表"两个独立面板，不符合"一个项目对应多个系统"的层级关系。

### 1.2 需求拆解
1. **树形结构**：项目列表为主表，每行可展开/折叠显示该项目下的系统
2. **快速添加**：项目行内增加"+ 添加系统"按钮，自动绑定项目，无需选择
3. **系统表单优化**：从项目行触发添加系统时，隐藏"所属项目"选择器，自动带入
4. **子系统联动**：子系统自动继承父门户所属项目（已有逻辑，保持）

### 1.3 当前代码现状
- `ProjectMgmt.tsx`：两个独立 Card 并排显示（项目列表 + 系统列表）
- 系统表单中"所属项目"选择器在非子系统时显示
- 数据层已支持 `SystemInfo.projectId` 字段

---

## 2. 修改计划

### 2.1 `ProjectMgmt.tsx` 主要重构

#### 新增状态
```typescript
const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
const [systemContext, setSystemContext] = useState<{ projectId: string } | null>(null);
```

#### 项目行改造
- 增加展开/折叠图标（▶/▼），点击切换 `expandedProjects`
- 操作列增加 "+ 添加系统" 按钮（带项目上下文）
- 展开区域渲染该项目下的系统列表（内联表格）

#### 系统表单改造
- 新增 `systemContext` 参数
- 当 `systemContext` 存在时：
  - 隐藏"所属项目"选择器
  - 自动设置 `newSystem.projectId = systemContext.projectId`
- 当 `systemContext` 为 null 时（独立添加系统）：
  - 保持原逻辑，显示项目选择器

#### 移除独立系统列表
- 移除右侧独立的"系统列表"Card
- 保留顶部"+ 新建系统"按钮（无项目上下文，需手动选择）

### 2.2 `styles.css` 新增样式

```css
/* 展开行图标 */
.proj-expand { display: inline-block; width: 16px; cursor: pointer; transition: transform 0.2s; user-select: none; }
.proj-expand.open { transform: rotate(90deg); }

/* 子系统内联表格 */
.sub-sys-table { margin: 8px 0 8px 32px; background: #f8fafc; border-radius: 6px; }
.sub-sys-table table { font-size: 12px; }
.sub-sys-table td { padding: 6px 10px; }
.sub-sys-table th { padding: 6px 10px; font-size: 12px; background: #eef2f7; }
```

### 2.3 文件修改清单
| 文件 | 修改内容 |
|------|----------|
| `packages/app/src/screens/ProjectMgmt.tsx` | 重构 UI 布局，实现展开/折叠、内联系统列表、上下文添加系统 |
| `packages/app/src/styles.css` | 新增展开行和内联表格样式 |

---

## 3. 交互流程

### 3.1 从项目行添加系统
1. 用户点击项目行的 "+ 添加系统"
2. 打开系统 Modal，`systemContext = { projectId: p.id }`
3. 表单中"所属项目"选择器**隐藏**，项目已自动绑定
4. 保存时直接使用 `systemContext.projectId`

### 3.2 从顶部全局添加系统
1. 用户点击顶部 "+ 新建系统"
2. 打开系统 Modal，`systemContext = null`
3. 表单中"所属项目"选择器**显示**，用户手动选择

### 3.3 子系统添加
1. 用户选择父门户系统
2. 自动继承父门户的 `projectId`
3. 无需手动选择项目

---

## 4. 风险与注意事项
- **数据兼容性**：旧系统数据的 `projectId` 已在 bootstrap 时绑定，无需额外处理
- **子系统联动**：子系统选择父门户时已自动继承 `projectId`，保持现有逻辑
- **独立添加系统**：顶部"+ 新建系统"仍保留，用于添加不属于特定项目的系统（或批量操作）
- **表格性能**：内联系统列表使用简化列（去除重复列），避免信息冗余

---

## 5. 执行顺序
1. 修改 `styles.css` 添加新样式
2. 重构 `ProjectMgmt.tsx` 实现新布局
3. 验证交互流程