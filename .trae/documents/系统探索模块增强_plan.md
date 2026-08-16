# 系统探索模块增强计划

## 一、需求概述

| # | 需求 | 优先级 | 类型 |
|---|------|--------|------|
| 1 | 新增模块刷新后数据丢失 | P0 | Bug 修复 |
| 2 | 确认探索是否使用 @playwright/mcp | P0 | 信息确认 |
| 3 | 删除选中支持多选删除（含父子联动） | P1 | 功能增强 |
| 4 | 人工补录功能修复（真实打开浏览器录制） | P1 | 功能修复 |
| 5 | 模块树增强（全选/反选/拖拽排序/父子关系调整） | P2 | 功能增强 |

---

## 二、各需求详细分析与修改方案

### 需求 1：新增模块刷新后数据丢失

**根因分析**：
- `handleSubmitNewModule` 调用 `exploreAddModule()` 更新状态后调用 `saveModuleTreeToBackend()`
- `saveModuleTreeToBackend()` 调用 `dataApi.saveModuleTree()` 发送 PUT 请求
- 需检查后端 `infra-store` 的 `saveModuleTree` 实现和 `orchestrator` 路由

**修改文件**：
- [packages/infra-store/src/index.ts](file:///d:/newTest/packages/infra-store/src/index.ts) — 检查 `saveModuleTree` / `getModuleTree`
- [packages/orchestrator/server.ts](file:///d:/newTest/packages/orchestrator/server.ts) — 检查路由处理
- [packages/app/src/services/dataApi.ts](file:///d:/newTest/packages/app/src/services/dataApi.ts) — 检查 API 封装

**修改方案**：
1. 确认 `saveModuleTree` 的 INSERT/UPDATE 逻辑正确
2. 确认前端 `moduleTreeToContract` 转换后的数据包含 `manuallyAdded` 标记
3. 确认 `getModuleTree` 加载时正确恢复模块树结构

---

### 需求 2：探索使用 @playwright/mcp 确认

**结论**：✅ 已确认使用 @playwright/mcp

**代码位置**：
- [packages/engine-mcp/src/mcp-adapter.ts](file:///d:/newTest/packages/engine-mcp/src/mcp-adapter.ts#L38-L39)

```typescript
const args = this.config.mcpArgs || ['@playwright/mcp@latest'];
```

**实现类**：`McpPlaywrightAdapter` 通过 `@modelcontextprotocol/sdk` 的 `StdioClientTransport` 连接 `@playwright/mcp` 进程，使用 `browser_navigate`、`browser_snapshot`、`browser_click` 等工具进行浏览器自动化。

---

### 需求 3：删除选中支持多选删除

**当前问题**：
- `handleDeleteSelected` 只处理单个 `selectedModuleId`
- `EXPLORE_TOGGLE_CHECKED` 只切换单节点，不联动子节点

**修改文件**：
- [packages/app/src/screens/Explore.tsx](file:///d:/newTest/packages/app/src/screens/Explore.tsx#L188-L197) — 修改删除逻辑
- [packages/app/src/context.tsx](file:///d:/newTest/packages/app/src/context.tsx#L623-L625) — 修改 reducer

**修改方案**：

#### 3.1 新增 Action Types
```typescript
| { type: "EXPLORE_TOGGLE_CHECKED_RECURSIVE"; id: string; checked: boolean }
| { type: "EXPLORE_SELECT_ALL" }
| { type: "EXPLORE_INVERT_SELECTION" }
| { type: "EXPLORE_REMOVE_MODULES_BATCH"; ids: string[] }
```

#### 3.2 修改 EXPLORE_TOGGLE_CHECKED
选中父模块时递归选中所有子模块：
```typescript
case "EXPLORE_TOGGLE_CHECKED": {
  const collectAllIds = (node: ModuleNodeView): string[] => [
    node.id,
    ...(node.children?.flatMap(collectAllIds) ?? [])
  ];
  const targetNode = findNode(state.moduleTree, action.id);
  if (!targetNode) return state;
  const allIds = collectAllIds(targetNode);
  const has = state.treeChecked.includes(action.id);
  const newChecked = has 
    ? state.treeChecked.filter((id) => !allIds.includes(id))
    : [...new Set([...state.treeChecked, ...allIds])];
  return { ...state, treeChecked: newChecked };
}
```

#### 3.3 修改 handleDeleteSelected
```typescript
const handleDeleteSelected = async () => {
  const idsToDelete = treeChecked.length > 0 ? treeChecked : (selectedModuleId ? [selectedModuleId] : []);
  if (idsToDelete.length === 0) {
    toast("请先选择要删除的模块");
    return;
  }
  exploreRemoveModulesBatch(idsToDelete);
  toast(`已删除 ${idsToDelete.length} 个模块`);
  setConfirmOpen(false);
  await saveModuleTreeToBackend();
};
```

#### 3.4 UI 增加全选/反选按钮
在模块树卡片顶部添加：
```tsx
<div className="row" style={{ marginBottom: 8 }}>
  <Button size="sm" onClick={exploreSelectAll}>全选</Button>
  <Button size="sm" onClick={exploreInvertSelection}>反选</Button>
  <span>已选 {treeChecked.length} 项</span>
</div>
```

---

### 需求 4：人工补录功能修复

**当前问题**：
- 点击"人工补充"按钮只打开一个纯前端表单弹窗
- 没有真实打开浏览器和录制功能
- 录制数据（URL、点击路径等）全部是模拟的

**修改文件**：
- [packages/app/src/screens/Explore.tsx](file:///d:/newTest/packages/app/src/screens/Explore.tsx#L199-L217) — 修改 handleManualAdd
- [packages/orchestrator/server.ts](file:///d:/newTest/packages/orchestrator/server.ts) — 新增录制 API
- [packages/stage-explore/src/index.ts](file:///d:/newTest/packages/stage-explore/src/index.ts) — 新增录制方法

**修改方案**：

#### 4.1 新增后端录制 API
```
POST /api/explore/start-recording
Body: { systemId, url }
Response: { recordingId, browserUrl }

POST /api/explore/stop-recording
Body: { recordingId }
Response: { clicks: ClickStep[], url, title }
```

#### 4.2 后端实现（stage-explore）
```typescript
async startRecording(systemUrl: string): Promise<{ recordingId: string }> {
  const recordingId = `rec-${Date.now()}`;
  // 通过 @playwright/mcp 打开浏览器并导航到系统 URL
  await engine.launch();
  await engine.navigate(systemUrl);
  // 开启录制模式（监听浏览器点击事件）
  activeRecordings[recordingId] = { url: systemUrl, clicks: [], startedAt: Date.now() };
  return { recordingId };
}

async stopRecording(recordingId: string): Promise<ManualSupplement> {
  const recording = activeRecordings[recordingId];
  // 获取当前页面快照和标题
  const snapshot = await engine.extractSemanticDom();
  // 返回录制数据
  return {
    clickPath: { steps: recording.clicks },
    insertPosition: 'below',
    relativeToNodeId: null,
    capturedUrl: recording.url,
    capturedTitle: snapshot.title
  };
}
```

#### 4.3 前端实现
```typescript
const [recordingId, setRecordingId] = useState<string | null>(null);

const handleManualStartRecording = async () => {
  if (!system.url) {
    toast("请先设置系统 URL");
    return;
  }
  try {
    const res = await dataApi.startRecording(system.id, system.url);
    setRecordingId(res.recordingId);
    setManualOpen(true);
    toast("浏览器已打开，请在浏览器中进行操作");
  } catch (e: any) {
    toast(`启动录制失败：${e.message}`);
  }
};

const handleManualStopRecording = async () => {
  if (!recordingId) return;
  try {
    const data = await dataApi.stopRecording(recordingId);
    // 将录制数据转换为待入树条目
    const seq = Math.max(0, ...pendingTree.map((p) => p.seq)) + 1;
    exploreAddPending({
      seq,
      path: data.clickPath.steps.map(s => s.label).join(" / "),
      module: data.capturedTitle,
      confidence: "0.95",
      status: "待入树",
    });
    setRecordingId(null);
    setManualOpen(false);
    toast("录制完成，请在待入树列表中确认");
  } catch (e: any) {
    toast(`停止录制失败：${e.message}`);
  }
};
```

#### 4.4 数据 API 封装（dataApi.ts）
```typescript
export async function startRecording(systemId: string, url: string): Promise<{ recordingId: string }> {
  const res = await fetch(`${BASE}/explore/start-recording`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemId, url })
  });
  return res.json();
}

export async function stopRecording(recordingId: string): Promise<any> {
  const res = await fetch(`${BASE}/explore/stop-recording`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordingId })
  });
  return res.json();
}
```

---

### 需求 5：模块树增强功能

#### 5.1 全选/反选功能

**修改文件**：[packages/app/src/context.tsx](file:///d:/newTest/packages/app/src/context.tsx#L296-L305)

**新增 Actions**：
```typescript
| { type: "EXPLORE_SELECT_ALL" }
| { type: "EXPLORE_INVERT_SELECTION" }
```

**Reducer 实现**：
```typescript
case "EXPLORE_SELECT_ALL": {
  const collectAllIds = (nodes: ModuleNodeView[]): string[] =>
    nodes.flatMap(n => [n.id, ...(n.children ? collectAllIds(n.children) : [])]);
  return { ...state, treeChecked: collectAllIds(state.moduleTree) };
}

case "EXPLORE_INVERT_SELECTION": {
  const collectAllIds = (nodes: ModuleNodeView[]): string[] =>
    nodes.flatMap(n => [n.id, ...(n.children ? collectAllIds(n.children) : [])]);
  const allIds = collectAllIds(state.moduleTree);
  return { ...state, treeChecked: allIds.filter(id => !state.treeChecked.includes(id)) };
}
```

**UI 按钮**：在 Tree 组件上方添加全选/反选按钮组。

---

#### 5.2 拖拽排序功能

**修改文件**：
- [packages/app/src/components.tsx](file:///d:/newTest/packages/app/src/components.tsx#L441-L466) — 增强 TreeNode 组件
- [packages/app/src/context.tsx](file:///d:/newTest/packages/app/src/context.tsx) — 新增拖拽 action
- [packages/app/src/screens/Explore.tsx](file:///d:/newTest/packages/app/src/screens/Explore.tsx) — 绑定拖拽事件

**实现方案**：使用 HTML5 Drag and Drop API

**组件增强**：
```typescript
export interface TreeItem {
  // ... 现有字段
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragOver?: (e: React.DragEvent, id: string) => void;
  onDrop?: (targetId: string, position: 'before' | 'after' | 'child') => void;
  dragOverPosition?: 'before' | 'after' | 'child' | null;
}
```

**TreeNode 增强**：
```tsx
<div 
  className={`node ${item.selected ? "sel" : ""} ${item.draggable ? "draggable" : ""}`.trim()}
  draggable={item.draggable}
  onDragStart={(e) => { e.dataTransfer.setData('text/plain', item.id); item.onDragStart?.(item.id); }}
  onDragOver={(e) => { e.preventDefault(); item.onDragOver?.(e, item.id); }}
  onDrop={(e) => {
    e.preventDefault();
    const position = item.dragOverPosition || 'after';
    item.onDrop?.(item.id, position);
  }}
>
  {/* ... 现有内容 */}
</div>
```

**新增 Action**：
```typescript
| { type: "EXPLORE_MOVE_NODE"; sourceId: string; targetId: string; position: "before" | "after" | "child" }
```

**Reducer 实现**：
```typescript
case "EXPLORE_MOVE_NODE": {
  const { sourceId, targetId, position } = action;
  
  // 1. 查找源节点并从原位置移除
  let sourceNode: ModuleNodeView | null = null;
  const removeSource = (nodes: ModuleNodeView[]): ModuleNodeView[] =>
    nodes.filter(n => {
      if (n.id === sourceId) { sourceNode = n; return false; }
      return true;
    }).map(n => ({ ...n, children: n.children ? removeSource(n.children) : undefined }));
  
  // 防止移动到自己的子节点中
  const isDescendant = (node: ModuleNodeView, targetId: string): boolean =>
    node.id === targetId || (node.children?.some(c => isDescendant(c, targetId)) ?? false);
  
  if (!sourceNode || isDescendant(sourceNode, targetId)) return state;
  
  // 2. 在目标位置插入
  const insertAt = (nodes: ModuleNodeView[]): ModuleNodeView[] => {
    const result: ModuleNodeView[] = [];
    for (const n of nodes) {
      if (n.id === targetNode.id) {
        if (position === 'before') {
          result.push(sourceNode!);
          result.push(n);
        } else if (position === 'after') {
          result.push(n);
          result.push(sourceNode!);
        } else {
          // child - 作为子节点
          result.push({ ...n, children: [...(n.children ?? []), sourceNode!] });
        }
      } else {
        result.push({ ...n, children: n.children ? insertAt(n.children) : undefined });
      }
    }
    return result;
  };
  
  // 先从树中移除源节点
  const treeWithoutSource = removeSource(state.moduleTree);
  // 再插入到目标位置
  const newTree = insertAt(treeWithoutSource);
  
  return { ...state, moduleTree: newTree };
}
```

---

## 三、实施步骤

### Phase 1：Bug 修复
1. [ ] 检查并修复新增模块数据持久化问题
2. [ ] 验证刷新后数据完整性

### Phase 2：多选删除功能
3. [ ] 新增全选/反选/批量删除 action
4. [ ] 修改 checkbox 联动子节点逻辑
5. [ ] 修改删除按钮支持批量删除
6. [ ] 添加全选/反选 UI 按钮

### Phase 3：人工补录修复
7. [ ] 后端新增录制 API（startRecording/stopRecording）
8. [ ] 前端实现真实录制流程
9. [ ] 录制数据转换为待入树条目

### Phase 4：拖拽功能
10. [ ] Tree 组件增强拖拽支持
11. [ ] Reducer 实现节点移动逻辑
12. [ ] 前端绑定拖拽事件和位置指示

### Phase 5：自测验证
13. [ ] 单元测试覆盖
14. [ ] 集成测试验证
15. [ ] 端到端功能验证

---

## 四、风险与注意事项

1. **向后兼容**：新增 action types 需确保旧的 reducer 逻辑不受影响
2. **数据迁移**：拖拽操作可能影响已有模块树结构，需保存前验证
3. **性能**：大规模模块树（>1000节点）的递归操作需注意性能
4. **浏览器兼容**：HTML5 Drag and Drop API 在所有现代浏览器中支持良好
5. **录制稳定性**：@playwright/mcp 的录制功能依赖浏览器状态，需处理异常情况

---

## 五、验证标准

| # | 测试项 | 预期结果 |
|---|--------|----------|
| 1 | 新增模块后刷新页面 | 新增的模块仍然存在 |
| 2 | 选中父模块 checkbox | 所有子模块自动选中 |
| 3 | 全选按钮 | 所有模块被选中 |
| 4 | 反选按钮 | 选中状态反转 |
| 5 | 批量删除 | 所有选中模块被删除并持久化 |
| 6 | 人工补充 | 浏览器自动打开，录制完成后数据进入待入树列表 |
| 7 | 拖拽排序 | 模块顺序改变并持久化 |
| 8 | 拖拽到父节点 | 模块成为新父节点的子节点 |
| 9 | 拖拽到子节点内 | 防止循环引用（应该被阻止） |
