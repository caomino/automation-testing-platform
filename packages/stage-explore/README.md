# @test-platform/stage-explore

> 自动化测试平台 — 探索阶段

## 职责

stage-explore 是测试平台五阶段流水线的**第二阶段**，核心职责：

1. **模块树遍历**：通过 MCP 引擎的 DOM 语义抽象能力，自动遍历被测系统页面，生成包含 `page`/`action`/`form`/`module`/`container` 等节点类型的模块树。
2. **人工补充合并**：允许用户对自动生成的模块树进行人工补充（`ManualSupplement`），支持 above/below/end 三种插入位置。
3. **覆盖率计算**：计算 `covered`/`needs_review`/`unexplored` 节点的覆盖率，为后续功能点生成提供完整输入。
4. **断点续跑**：支持 `resumeFrom` 参数，从上次断点继续探索，避免重复遍历。

---

## 接口文档

### `ExploreInput`

```typescript
interface ExploreInput {
  systemUrl: string;
  subsystemId: string;
  sessionHandle: SessionHandle;
  resumeFrom?: string;
  manualSupplement?: ManualSupplement;
}
```

### `ExploreOutput`

```typescript
interface ExploreOutput {
  moduleTree: ModuleNode[];
  coverage: { visited: number; total: number; frontier: string[] };
  needsReview: string[];
  checkpoint: McpExplorationCheckpoint;
}
```

---

## 使用示例

```typescript
import { run } from '@test-platform/stage-explore';

const output = await run({
  systemUrl: 'https://oa.example.com/dashboard',
  subsystemId: 'oa_sys',
  sessionHandle: loginOutput.sessionHandle,
});

console.log(`覆盖率: ${output.coverage.visited}/${output.coverage.total}`);
console.log(`待审查: ${output.needsReview}`);
```

---

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@test-platform/contracts` | workspace:* | 提供 `ExploreInput` / `ExploreOutput` / `ModuleNode` / `ManualSupplement` 类型及 Zod 校验 |
| `@test-platform/engine-mcp` | workspace:* | 提供 `McpEngine` / `SessionCapableEngine` 浏览器控制接口 |

---

## 迭代指南

### 7.1 扩展点

#### 新增节点类型
在 `ModuleNode` 的 `type` 联合类型中添加新的节点类型：
```typescript
type NodeType = 'page' | 'action' | 'form' | 'module' | 'container' | 'table' | 'chart';
```

#### 扩展遍历策略
实现新的遍历算法（如基于 URL 规则、基于 DOM 深度限制等），在 `run()` 函数中切换。

#### 添加过滤规则
在遍历过程中添加 URL/节点过滤规则，避免不必要的页面探索。

### 7.2 常见修改场景

#### 调整覆盖率计算
修改 `coverage` 计算逻辑，支持更细粒度的覆盖率统计。

#### 优化遍历深度
调整最大遍历深度和超时时间，平衡完整性和效率。

### 7.3 测试要点
- 模块树结构正确性测试
- 覆盖率计算准确性测试
- 断点续跑功能测试
- 人工补充合并测试

### 7.4 注意事项
- **遍历效率**：避免在大型系统中过度遍历导致超时
- **状态捕获**：对需要状态才能触发的链接，应先执行必要的交互
- **去重逻辑**：确保同一节点不会被重复添加到模块树
- **异常处理**：单个页面遍历失败不应中断整个探索流程
