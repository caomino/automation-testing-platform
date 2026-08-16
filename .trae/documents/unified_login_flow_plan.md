# 统一登录流程修复计划

## 问题诊断

### 用户核心要求
> **不管哪种方式登录，点击登录按钮都是先打开浏览器**

### 当前代码问题

| 模式 | 是否打开浏览器 | 问题 |
|------|--------------|------|
| `no-login` | ❌ 没有 | `runNoLogin` 直接返回成功，跳过浏览器 |
| `credential` | ✅ 有 | 但凭证字段映射错误导致 `credentialRef` 为空 |
| `manual-takeover` | ✅ 有 | 正常 |

### 数据映射问题（导致 credential 模式失败）

| 层级 | 字段路径 | 实际值 |
|------|---------|--------|
| 后端存储 | `s.credentials.credentialRef` | 正确存储 |
| 前端读取 | `s.passwordRef` | ❌ undefined |

---

## 修复方案

### 1. 改造 `runNoLogin`：强制打开浏览器

**文件**: `packages/stage-login/src/index.ts`

**修改逻辑**：
```typescript
async function runNoLogin(input: LoginInput, deps: LoginStageDeps): Promise<LoginOutput> {
  // 1. 打开浏览器（统一行为）
  const engine = deps.engineFactory({ headless: false, manualTakeover: true });
  await engine.launch();
  await engine.navigate(input.systemUrl);
  
  // 2. 直接捕获会话（无需填充凭证）
  const session = await captureSession(engine);
  
  // 3. 返回成功
  // ...
}
```

### 2. 修复 `context.tsx` 数据映射

**文件**: `packages/app/src/context.tsx`（第940-960行）

**修改**：
```typescript
allSystems.push({
  // ...
  username: s.credentials?.username ?? undefined,        // 从 credentials 对象读取
  passwordRef: s.credentials?.credentialRef ?? undefined, // 从 credentials 对象读取
  parentPortalPath: s.parentPortalPath,  // 补充缺失字段
  // ...
});
```

### 3. 统一登录流程（所有模式）

```
点击「启动登录」
    ↓
打开可见浏览器
    ↓
导航到系统 URL
    ↓
┌─────────────────────────────────────────┐
│  no-login:  直接捕获会话                │
│  credential: 自动填充凭证（不提交）      │
│  manual-takeover: 等待用户手动操作       │
└─────────────────────────────────────────┘
    ↓
返回 barrier 状态
    ↓
用户在浏览器中完成操作
    ↓
点击「确认登录」
    ↓
检测登录状态 → 捕获会话 → 返回结果
```

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `packages/stage-login/src/index.ts` | 编辑 | 改造 `runNoLogin` 函数，强制打开浏览器 |
| `packages/app/src/context.tsx` | 编辑 | 修复凭证字段映射 + 补充 `parentPortalPath` |

## 测试验证

1. **no-login 模式**：点击登录 → 浏览器打开 → 自动完成会话捕获 → 返回成功
2. **credential 模式**：点击登录 → 浏览器打开 → 自动填充凭证 → 用户点击登录 → 确认登录
3. **manual-takeover 模式**：点击登录 → 浏览器打开 → 用户手动操作 → 确认登录
