# 功能点模块修复与数据流转打通计划

## 1. 现状分析

通过对代码库的审查，我们发现以下关键问题：

### 1.1 探索模块 (Stage-Explore)
- **状态**: 功能完整。
- **输出**: 成功生成 `ModuleNode[]` (模块树)，存储在全局状态 `state.moduleTree` 中。
- **API**: `runPipelineExplore()` 工作正常。

### 1.2 功能点模块 (Stage-Feature)
- **状态**: 不完整。
- **问题**:
  1.  `Feature.tsx` 页面缺少 **“生成功能点”** 的核心操作按钮。
  2.  “AI 提效功能点”按钮仅是占位符（点击只弹 Toast）。
  3.  虽然 `context.tsx` 中已定义 `runPipelineFeature` 方法，但 `Feature.tsx` 并未调用它。
  4.  前端无法将探索产物 (`moduleTree`) 传递给后端 Pipeline 生成功能点。

### 1.3 用例模块 (Stage-Case)
- **状态**: 依赖功能点模块。
- **问题**: 由于功能点无法生成，用例模块也无法从真实数据初始化。

## 2. 修复目标

1.  在 `Feature.tsx` 页面添加 **“生成功能点”** 按钮。
2.  实现基于探索结果 (`moduleTree`) 生成功能点的逻辑。
3.  打通 `Explore` -> `Feature` -> `Case` 的数据流转链路。

## 3. 实施步骤

### 步骤 1: 修改 `packages/app/src/screens/Feature.tsx`
在功能点审核页面添加生成功能点的交互入口。

1.  **引入依赖**: 确保从 `useApp()` 解构出 `runPipelineFeature`, `moduleTree`, `system`, `pipelineLoading` 等必要状态和方法。
2.  **添加“生成功能点”按钮**:
    *   位置：页面顶部操作栏（与“加载固定模板”、“保存草稿”并列）。
    *   逻辑：
        *   检查 `moduleTree` 是否有数据。
        *   若无数据，提示用户“请先完成探索流程”。
        *   若有数据，调用 `runPipelineFeature`。
        *   将 `moduleTree` (前端视图) 通过 `fromModuleView` 转换为 Contract 格式。
        *   构造 `FeatureInput` 并提交。
3.  **处理结果**: `runPipelineFeature` 成功后会自动更新全局状态 `state.featureRows`，表格将自动重渲染。

### 步骤 2: 验证数据流转
确保生成的 `featureRows` 能够：
1.  正确显示在 `Feature.tsx` 的表格中。
2.  被 `Case.tsx` 页面的生成逻辑所使用（`Case.tsx` 已有消费 `featureRows` 的逻辑，需确认链路通畅）。

## 4. 代码变更预览 (概念性)

```typescript
// 在 Feature.tsx 中新增
const { 
  // ... 其他解构
  moduleTree, 
  runPipelineFeature, 
  pipelineLoading 
} = useApp();

const handleGenerateFeatures = async () => {
  if (moduleTree.length === 0) {
    toast("请先完成探索流程");
    return;
  }
  
  try {
    // 1. 转换数据格式
    const contractTree = fromModuleView(moduleTree);
    
    // 2. 调用 Pipeline
    await runPipelineFeature({
      moduleTree: contractTree,
      systemName: system.name,
      confirmedOnly: false
    });
    
    toast("功能点生成成功");
  } catch (e) {
    // 错误已在 runPipelineFeature 中处理
  }
};
```

## 5. 风险与测试
- **风险**: 数据格式转换 (`ModuleNodeView` -> `ModuleNode`) 可能存在字段映射问题。
- **测试**:
  1.  启动应用。
  2.  完成登录和探索。
  3.  切换到功能点页面，点击“生成功能点”。
  4.  检查表格是否根据探索结果填充了数据。
  5.  切换到用例页面，检查是否能基于功能点生成用例。
