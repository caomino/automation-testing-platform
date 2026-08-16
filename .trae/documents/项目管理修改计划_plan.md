# 项目管理模块修改计划

## 1. 需求分析与现状评估

### 1.1 需求点拆解
用户提出三个明确需求：
1.  **建立项目与系统的绑定关系**：添加系统（特别是门户系统）时需要选择对应的项目。
2.  **优化操作列按钮样式**：现有按钮不美观。
3.  **删除“选中”按钮**：移除操作列中的“选中”按钮。

### 1.2 当前代码现状
通过分析 `ProjectMgmt.tsx` 和 `context.tsx`：
-   **数据模型**：`SystemInfo` 接口目前**缺少** `projectId` 字段。系统和项目的关联是隐式的（通过 `state.project` 当前选中项），不是显式的。
-   **UI 结构**：
    -   项目列表操作列包含：`选中`、`编辑`、`删除`。
    -   系统列表操作列包含：`进入`、`编辑`、`删除`。
    -   “新建系统”表单中**没有**“所属项目”选择器。
-   **样式**：`.op` (操作列容器) 和 `.btn.sm` (小按钮) 使用统一的 CSS，按钮为 24x24 像素的方形按钮组。

---

## 2. 修改计划

### 2.1 数据层修改 (`packages/app/src/context.tsx`)
-   **目标**：建立显式的项目-系统关联。
-   **步骤**：
    1.  修改 `SystemInfo` 接口，增加 `projectId: string` 字段。
    2.  修改 `initialState` 及 Bootstrap 加载逻辑，确保系统列表包含 `projectId`。
    3.  更新 `addSystem` action，使其可以接收 `projectId` 参数。如果未指定，则默认使用当前 `state.project.id`。
    4.  在 UI 初始化时，系统应展示其所属项目。

### 2.2 UI 组件修改 (`packages/app/src/screens/ProjectMgmt.tsx`)
-   **目标**：实现需求 1、3，并配合样式优化。
-   **步骤**：
    1.  **系统表单（新建/编辑）**：
        -   增加“所属项目”下拉选择框。
        -   选项列表来源于 `projects` 状态。
        -   仅当系统类型为 "portal" 或 "standalone" 时显示（子系统继承父门户的项目）。
    2.  **系统列表展示**：
        -   在表头增加“所属项目”列。
        -   根据 `system.projectId` 从 `projects` 中查找并显示项目名称。
    3.  **项目列表操作列**：
        -   **删除** `选中` 按钮。改为点击行即可选中（或通过其他方式），简化操作。
    4.  **逻辑修正**：确保 `addSystem` 和 `updateSystem` 正确传递 `projectId`。

### 2.3 样式优化 (`packages/app/src/styles.css`)
-   **目标**：实现需求 2，提升操作列美观度。
-   **步骤**：
    1.  修改 `.op` 容器样式：去除硬编码的 24x24 方形按钮，改为更柔和的按钮组（例如使用 `gap: 6px;` 和圆角边框）。
    2.  调整 `.btn.sm` 样式：减小 padding，优化视觉比例。
    3.  （可选）为不同操作（编辑、删除）添加特定颜色或图标，增加辨识度。

### 2.4 服务层同步 (`packages/app/src/services/dataApi.ts`)
-   确保 `addSystem` API 调用时，后端 URL 路径仍然是 `/projects/${projectId}/systems`，逻辑不变，但前端传参逻辑需支持动态 `projectId`。

---

## 3. 风险与注意事项
-   **数据兼容性**：旧数据可能没有 `projectId`。在 Bootstrap 加载时，若 `system.projectId` 为空，应使用 `state.project.id` 作为默认值进行兜底。
-   **子系统逻辑**：子系统的 `projectId` 应自动继承自其 `parentPortalId` 对应的系统的 `projectId`，防止数据错乱。
-   **样式影响范围**：修改 `.op` 样式可能影响其他页面（如 Feature, Case 等）的操作列。需全局评估或使用特定类名（如 `.op-project`）进行隔离。

---

## 4. 执行顺序
1.  修改 `context.tsx` (数据模型与逻辑)
2.  修改 `ProjectMgmt.tsx` (UI 实现)
3.  修改 `styles.css` (样式优化)
4.  验证功能