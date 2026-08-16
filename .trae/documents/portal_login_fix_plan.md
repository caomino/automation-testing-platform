# 门户系统登录失败修复计划

## 问题分析

### 核心问题：数据模型字段映射不一致

**现象**：用户配置了门户系统（type: portal），使用账号密码登录（credentialMode: credential），点击登录后立即失败。

**根因**：前端读取系统配置时，凭证字段映射错误

| 层级 | 字段 | 实际存储位置 |
|------|------|-------------|
| 后端存储 | `credentials.credentialRef` | `s.credentials.credentialRef` |
| 前端期望 | `passwordRef` | `s.passwordRef` ❌ undefined |
| 后端存储 | `credentials.username` | `s.credentials.username` |
| 前端期望 | `username` | `s.username` ❌ undefined |

**数据流断裂点**：
1. 用户在项目管理中配置账号密码 → 后端存储为 `credentials: { username, credentialRef }`
2. 前端加载 bootstrap 数据 → `context.tsx` 第955-956行直接读取 `s.username` 和 `s.passwordRef`（均为 undefined）
3. 登录时传递 `credentialRef: undefined` → 后端找不到凭证 → 返回 `failed`

## 修复方案

### 1. 修复 context.tsx 中的数据映射（核心修复）

**文件**: `packages/app/src/context.tsx`

**修改点**：bootstrap 数据加载时，正确映射凭证字段

```typescript
// 第940-960行附近
allSystems.push({
  id: s.id,
  name: s.name,
  type: s.type,
  url: s.url,
  captured: !!s.url,
  parent: p.name,
  projectId: p.id,
  loginMode: s.credentialMode,
  loginStatus: s.loginState === 'logged_in' ? 'logged_in' : 'logged_out',
  parentPortalId: s.parentPortalId,
  parentPortalPath: s.parentPortalPath,  // 补充缺失字段
  sessionState: s.sessionState,
  // 修复凭证字段映射
  username: s.credentials?.username ?? undefined,        // ← 修复
  passwordRef: s.credentials?.credentialRef ?? undefined, // ← 修复
  credentialMode: s.credentialMode,
});
```

### 2. 确保后端 addSystem 正确处理凭证

**文件**: `packages/infra-store/src/index.ts`

**当前状态**：第348行 `credentials: input.credentials` 已正确存储

**验证**：前端 `ProjectMgmt.tsx` 提交数据时，需确保传递 `credentials` 对象

### 3. 增强登录流程日志（便于调试）

**文件**: `packages/stage-login/src/index.ts`

**增加日志**：
- 登录前打印完整输入参数
- 明确区分"浏览器启动失败"、"URL导航失败"、"凭证获取失败"等不同错误

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `packages/app/src/context.tsx` | 编辑 | 修复凭证字段映射 + 补充 parentPortalPath |
| `packages/stage-login/src/index.ts` | 编辑 | 增强错误日志，区分错误类型 |

## 测试验证

1. 创建门户系统，配置 URL 和账号密码
2. 点击「登录系统」→「启动登录」
3. 验证：
   - 浏览器成功启动并导航到系统 URL
   - 账号密码被自动填充
   - 用户点击登录后，「确认登录」按钮可用
   - 点击「确认登录」后登录成功
