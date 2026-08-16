# 工作台登录功能修复与会话复用机制计划 V2.1

## 1. 核心目标（商业产品级别）

构建统一的登录与会话管理体系，支持所有系统类型（单系统、门户、子系统），实现：
1.  **灵活配置登录方式**：支持无凭据、账号密码、人工接管三种模式。
2.  **会话持久化与复用（核心）**：登录成功后，将会话（Cookies/Headers/Tokens）持久化到数据库。在**有效期内**，平台所有操作（探索、执行等）均可**免登录**直接进入系统。
3.  **跨子系统会话继承**：子系统可自动复用父门户的有效会话，无需重复登录。

## 2. 关键问题与技术方案

### 2.1 前端：修正参数映射与凭证提取
**问题**：`Workbench.tsx` 调用 `login` 接口时，传递的字段与后端契约不匹配。
**方案**：
修改 `packages/app/src/screens/Workbench.tsx` 中的 `handleLogin` 函数，确保：
-   `mode` 使用 `system.credentialMode`。
-   `credentialRef` 从 `system.credentials?.credentialRef` 获取。
-   `username` 从 `system.credentials?.username` 获取。
-   `parentPortalUrl` 正确用于子系统。

### 2.2 后端：构建会话管理闭环（核心开发）

#### A. 会话存储扩展 (Infra-Store)
**问题**：现有 `ProjectStore` 仅存储系统配置，未存储登录后的会话信息。
**方案**：
1.  **扩展接口**：在 `packages/infra-store/src/index.ts` 中为 `ProjectStore` 增加会话管理方法。
    ```typescript
    export interface ProjectStore {
      // ... existing
      saveSession(systemId: string, session: SessionHandle): Promise<void>;
      getSession(systemId: string): Promise<SessionHandle | null>;
      }
    ```
2.  **实现**：在 `SqliteProjectStore` 中实现上述逻辑，新增 `sessions` 表存储会话数据（JSON 格式），包含 `system_id` 和 `expires_at` 字段。

#### B. 登录模块增强 (Stage-Login)
**问题**：登录成功后，会话信息仅在内存中流转，未持久化。
**方案**：
修改 `packages/stage-login/src/index.ts`：
1.  **依赖注入**：`createLoginStage` 工厂函数需接收 `ProjectStore` 实例。
2.  **保存会话**：在 `runCredential` (Line 88-133) 和 `runManualTakeover` (Line 149-193) 成功获取 `captureSession` 后，立即调用 `store.saveSession`。

#### C. 编排器增加会话复用逻辑 (Orchestrator)
**问题**：执行 Explore/Execute 时，编排器未尝试复用已有会话，导致频繁重新登录。
**方案**：
修改 `packages/orchestrator/src/index.ts` 的 `runStage` 逻辑：
1.  **路由策略**：当执行 **Explore** 或 **Execute** 阶段时：
    -   首先检查目标 `systemId` 是否存在**有效会话**（`expiresAt > Date.now()`）。
    -   如果存在有效会话，**跳过 Login Stage**，直接调用 `engine.applySession` 注入会话，并导航到目标 URL。
    -   如果会话无效或不存在，回退执行正常的 Login Stage。
2.  **子系统复用**：对于 `type === 'subsystem'` 的系统，优先检查其 `parentSystemId` 的会话。如果父会话有效，直接应用父会话进入子系统（利用 SSO 机制）。

## 3. 实施步骤

1.  **阶段一：基础设施（Infra）**
    -   扩展 `infra-store` 接口和实现，增加会话持久化能力。

2.  **阶段二：登录闭环（Login Stage）**
    -   修改 `stage-login`，在登录成功后将会话写入 Store。

3.  **阶段三：智能路由（Orchestrator）**
    -   修改 `orchestrator`，在执行后续阶段前增加会话检查与复用逻辑。

4.  **阶段四：前端修正（Frontend）**
    -   修正 `Workbench.tsx` 的参数传递逻辑。

5.  **阶段五：验证**
    -   验证单系统免登录。
    -   验证子系统继承父门户会话。
    -   验证会话过期自动重新登录。

## 4. 验证场景

1.  **场景 A：单系统免登录**
    -   步骤：登录 System A -> 重启后端 -> 直接点击 System A 的“探索”。
    -   预期：浏览器直接打开 System A 主页，处于已登录状态。

2.  **场景 B：子系统继承登录**
    -   步骤：登录 Portal P -> 直接点击 Subsystem S 的“探索”。
    -   预期：浏览器打开 S，处于已登录状态（复用了 P 的会话）。

3.  **场景 C：会话失效**
    -   步骤：手动清除 Store 中的会话记录 -> 点击“探索”。
    -   预期：系统提示或触发重新登录流程。