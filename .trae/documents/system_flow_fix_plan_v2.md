---
design_type: initiative
created_at: 2026-08-16
---

# 测试平台完整流程修复 — 真实浏览器自动化打通

## 目标

打通完整流程：**创建项目→创建系统→真实浏览器登录→真实探索→真实功能点→真实用例→真实执行**

所有阶段必须通过后端 Playwright 引擎操作真实浏览器，不允许假数据/模拟状态。

## 核心发现

### 架构现状

```
前端 Workbench.tsx
  → pipeline.ts (HTTP 调用)
    → server.mjs (端口 3001)
      → PipelineOrchestrator
        → PlaywrightEngine (真实 Chromium)
          → stage-login / stage-explore / stage-feature / stage-case / stage-execute
```

**后端能力完整** — PlaywrightEngine 可启动真实浏览器、导航、提取 DOM、执行步骤。
**问题全部在前端↔后端的对接层** — 参数传递错误、类型不匹配、API 缺失。

---

## 7 个具体修复点（按优先级）

### 修复点 1: Explore 阶段 — sessionHandle 和 systemUrl 传递 (CRITICAL)

**文件**: `packages/app/src/screens/Workbench.tsx`

**问题**:
```typescript
// 当前代码 - sessionHandle 可能为 undefined
const sessionHandle = hasSession && system.sessionState?.cookies ? {...} : undefined;
// no-login 模式下 sessionHandle = undefined → 后端崩溃

// 当前代码 - 缺少 systemUrl
const result = await runPipelineExplore({
  sessionHandle,
  subsystemId: system.id,
  // 缺少: systemUrl
});
```

**修复**:
```typescript
// 1. no-login 模式也构造有效 sessionHandle
const sessionHandle = {
  sessionId: system.id,
  systemId: system.id,
  loginStatus: 'ok' as const,
  cookies: system.sessionState?.cookies ?? [],
  headers: system.sessionState?.headers ?? {},
  tokens: system.sessionState?.tokens ?? [],
  expiresAt: Date.now() + 3600000,
};

// 2. 传递 systemUrl
const result = await runPipelineExplore({
  sessionHandle,
  subsystemId: system.id,
  systemUrl: system.url,  // ← 新增
});
```

---

### 修复点 2: 后端 Store API 补充 — 系统 CRUD (CRITICAL)

**文件**: `packages/orchestrator/server.mjs`

**问题**: `dataApi.ts` 调用的以下 API 在 server.mjs 中不存在：
- `POST /api/store/projects/:id/systems` — 添加系统
- `PUT /api/store/projects/:id/systems/:sysId` — 更新系统
- `DELETE /api/store/projects/:id/systems/:sysId` — 删除系统

**修复**: 在 server.mjs 中新增系统 CRUD 路由，调用 `orchestrator.getStore()` 对应方法。

---

### 修复点 3: Feature 阶段数据格式对齐 (HIGH)

**文件**: `packages/app/src/services/pipeline.ts`

**问题**: `fromFeatureView` 返回 `string[][][]`，但后端 `FeatureInput.featureTable` 期望 `FeatureRow[][]`（每行是 `string[]` 的九列数组）

**修复**: 修正 `fromFeatureView` 返回 `FeatureRow[][]`：
```typescript
export function fromFeatureView(rows: FeatureRowView[]): FeatureRow[][] {
  return [rows.map((r) => [
    r.seq, r.type, r.chapter, r.system, r.mainModule,
    r.subModule, r.feature, r.testPoint, r.testPointId,
  ] as FeatureRow)];
}
```

---

### 修复点 4: ModuleNode 转换修正 (MEDIUM)

**文件**: `packages/app/src/services/pipeline.ts`

**问题**: `fromModuleView` 将所有节点标记为 `manuallyAdded: true`

**修复**: 移除默认标记，只有人工补充的节点才设为 true：
```typescript
export function fromModuleView(nodes: ModuleNodeView[], ...): ModuleNode[] {
  return nodes.map((n) => ({
    // ... 其他字段
    manuallyAdded: false,  // 只有真正人工补充的才为 true
  }));
}
```

---

### 修复点 5: 登录流程修正 (HIGH)

**文件**: `packages/app/src/screens/Workbench.tsx` (LoginModal)

**问题**:
1. `LoginInput` 要求 `projectId` 字段，但前端传了额外的 `username` 字段
2. 登录成功后没有正确保存 `sessionState`

**修复**: 确保登录输入符合 `LoginInput` 契约，并在登录成功后正确更新会话状态。

---

### 修复点 6: Execute 阶段参数格式修正 (HIGH)

**文件**: `packages/app/src/screens/Workbench.tsx`

**问题**:
1. `browserOSMatrix` 格式需要符合 `BrowserOS` 接口
2. 执行时需要传递 `systemUrl`、`cookies`、`headers`、`tokens`

**修复**: 确保执行参数格式正确。

---

### 修复点 7: MetaHeader 字段名对齐 (MEDIUM)

**文件**: `packages/app/src/screens/Workbench.tsx`, `packages/app/src/services/pipeline.ts`

**问题**: `MetaHeader.system` vs `MetaHeader.systemName`

**修复**: 统一使用 `systemName`，前端 `context.tsx` 中 `MetaHeader` 字段对齐。

---

## 实施顺序

| Step | 修复点 | 文件 | 依赖 |
|------|--------|------|------|
| 1 | #2 系统 CRUD API | server.mjs | 无 |
| 2 | #1 Explore sessionHandle + systemUrl | Workbench.tsx | 无 |
| 3 | #3 Feature 数据格式 | pipeline.ts | 无 |
| 4 | #4 ModuleNode 转换 | pipeline.ts | 无 |
| 5 | #5 登录流程 | Workbench.tsx | #2 |
| 6 | #6 Execute 参数 | Workbench.tsx | #3, #4 |
| 7 | #7 MetaHeader 对齐 | pipeline.ts + context.tsx | #3 |

## 验证步骤

1. 启动后端: `pnpm server`（端口 3001）
2. 启动前端: `pnpm dev`（端口 5173）
3. 创建项目 → 创建系统
4. 点击登录（手动接管模式）→ 真实浏览器打开 → 手动完成登录 → 会话建立
5. 点击探索 → 后端导航到系统 URL → 提取 DOM → 返回模块树
6. 点击功能点 → 基于模块树生成九列表格
7. 点击用例 → 基于功能点生成八列表格
8. 点击执行 → 真实浏览器执行用例 → 返回执行报告

## 注意事项

- 所有后端 API 已在 `server.mjs` 中实现，修复仅限于补充缺失路由
- `PlaywrightEngine` 已实现完整浏览器自动化，无需修改
- Stage 业务逻辑已冻结，不修改
- 修复集中在 **前端参数传递** 和 **后端 API 补充** 两个层面
