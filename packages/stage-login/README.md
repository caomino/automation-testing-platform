# @test-platform/stage-login

> 自动化测试平台 — 登录阶段

## 职责

stage-login 是测试平台五阶段流水线的**第一阶段**，核心职责：

1. **多模式登录**：支持三种登录模式（no-login / credential / manual-takeover），适配不同系统的鉴权方式。
2. **会话捕获**：登录成功后通过 MCP 引擎的会话方法（`getSessionCookies` / `getSessionHeaders` / `getSessionTokens`）捕获完整登录态。
3. **会话输出**：产出 `SessionHandle` 传递给下游的 `stage-explore` 等阶段，实现跨子系统会话复用。

---

## 三种登录模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `no-login` | 不执行登录，直接传递会话（`sessionHandle` 为空） | 无需登录的公开系统 |
| `credential` | 使用凭证自动登录 | 标准账号密码登录系统 |
| `manual-takeover` | 人工接管登录（返回登录页 URL，由用户手动完成） | 含验证码/短信/扫码的复杂登录 |

---

## 接口文档

### `LoginInput`

```typescript
interface LoginInput {
  systemUrl: string;
  mode: 'no-login' | 'credential' | 'manual-takeover';
  credentialRef?: string;
  parentPortalUrl?: string;
  engineConfig?: EngineConfig;
}
```

### `LoginOutput`

```typescript
interface LoginOutput {
  success: boolean;
  sessionHandle: SessionHandle;
  loginUrl: string;
}
```

### `SessionHandle`

```typescript
interface SessionHandle {
  cookies: string[];
  headers: Record<string, string>;
  tokens: string[];
}
```

---

## 使用示例

```typescript
import { run } from '@test-platform/stage-login';

// 凭证登录
const output = await run({
  systemUrl: 'https://oa.example.com',
  mode: 'credential',
  credentialRef: 'cred_oa_admin',
  parentPortalUrl: 'https://portal.example.com',
});

if (output.success) {
  // output.sessionHandle 可传递给 stage-explore
  console.log('Cookies:', output.sessionHandle.cookies);
}
```

---

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@test-platform/contracts` | workspace:* | 提供 `LoginInput` / `LoginOutput` / `SessionHandle` 类型及 Zod 校验 |
| `@test-platform/engine-mcp` | workspace:* | 提供 `McpEngine` / `SessionCapableEngine` 浏览器控制接口 |

---

## 迭代指南

### 7.1 扩展点

#### 新增登录模式
在 `LoginMode` 联合类型中添加新模式，实现对应的登录逻辑：
```typescript
type LoginMode = 'no-login' | 'credential' | 'manual-takeover' | 'sso' | 'oauth2';
```

#### 扩展凭证字段
在 `CredentialRecord` 中添加 SSO/OAuth2 相关的凭证字段。

#### 支持多因素认证
在登录流程中添加 MFA 步骤，支持验证码/短信/扫码等二次验证。

### 7.2 常见修改场景

#### 修改登录表单识别
调整 DOM 选择器策略，适配不同系统的登录页面结构。

#### 添加登录成功判定
扩展判定逻辑，支持通过 URL 跳转、元素出现、Cookie 变化等多种方式判定登录成功。

### 7.3 测试要点
- 三种登录模式的正确性测试
- 会话捕获完整性测试
- 凭证管理安全性测试
- 登录失败重试逻辑测试

### 7.4 注意事项
- **凭证安全**：凭证通过 `credentialRef` 引用，不明文传输
- **会话有效期**：注意会话过期时间，必要时支持自动续期
- **错误恢复**：登录失败后应有清晰的错误信息和重试指引
