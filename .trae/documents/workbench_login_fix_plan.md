# 工作台登录功能修复计划

## 1. 问题分析与代码定位

根据用户反馈，工作台的登录功能存在以下核心问题：
1.  **数据模型不一致**：前端 UI 使用的系统模型与后端契约定义不一致，导致登录参数传递错误。
2.  **登录逻辑缺失**：未根据系统类型（单系统、子系统、门户）执行相应的登录流程。

### 关键代码位置
- **前端工作台界面**：`packages/app/src/screens/Workbench.tsx`
- **前端 Pipeline 服务**：`packages/app/src/services/pipeline.ts`
- **后端登录 Stage**：`packages/stage-login/src/index.ts`
- **系统类型定义**：`packages/contracts/src/types/SystemConfig.ts`

### 根本原因
通过分析 `Workbench.tsx` 第 26-34 行的 `handleLogin` 函数，发现了以下问题：

1.  **属性名错误**：
    -   前端传递 `mode: system.loginMode`，但 `SystemConfig.ts` 中定义的属性名为 `credentialMode`。
    -   前端传递 `credentialRef: system.passwordRef`，但 `SystemConfig.ts` 中定义的凭证结构为 `credentials: { username, credentialRef }`。
    -   前端传递 `username: system.username`，但 `SystemConfig.ts` 中 `username` 嵌套在 `credentials` 对象内。

2.  **参数转换缺失**：
    -   前端直接将 UI 的 `system` 对象属性映射到后端 `LoginInput`，但未做适配转换。

## 2. 三种登录类型定义

根据代码分析和文档，系统支持以下三种类型：

1.  **单系统 (standalone)**
    -   **描述**：独立运行的系统，直接登录。
    -   **URL 来源**：自身 URL。
    -   **登录方式**：直接在该系统的登录页完成登录。

2.  **子系统 (subsystem)**
    -   **描述**：依附于父门户的子系统，需要先登录父门户获取会话，再访问子系统。
    -   **URL 来源**：自身 URL + 父门户 URL (`parentPortalUrl`)。
    -   **登录方式**：先登录父门户，利用同一浏览器会话（Cookie/Headers）进入子系统。

3.  **门户 (portal)**
    -   **描述**：集成多个子系统的主入口，自身也是一个单系统。
    -   **URL 来源**：自身 URL。
    -   **登录方式**：与单系统相同，直接登录后，其他子系统可复用其会话。

## 3. 修复方案

### 3.1 修改 `Workbench.tsx` (前端)

需要修改 `handleLogin` 函数，将 UI 的 `system` 对象属性正确映射为后端 `LoginInput` 契约所需的字段。

**修改内容：**
-   修正属性名映射：`loginMode` -> `credentialMode`
-   修正凭证对象结构：正确从 `system.credentials` 中提取 `credentialRef` 和 `username`
-   保持子系统的 `parentPortalUrl` 逻辑不变（已正确实现）

### 3.2 修改 `pipeline.ts` (前端服务层)

可能需要增加一个适配函数，将前端的 `System` 对象转换为 `LoginInput`，以确保类型安全。

### 3.3 验证 `stage-login` (后端)

根据读取的 `stage-login/src/index.ts`，后端已经正确实现了三种登录模式（`no-login`, `credential`, `manual-takeover`）以及子系统的 `parentPortalUrl` 处理逻辑。

**结论**：后端登录逻辑已就绪，无需修改。只需修正前端传参即可。

## 4. 执行步骤

1.  **修改 `Workbench.tsx`**
    -   定位 `handleLogin` 函数 (第 20-58 行)
    -   修正 `runPipelineLogin` 调用时的参数结构
2.  **（可选）更新 `pipeline.ts`**
    -   如果需要，增加一个 `toLoginInput` 转换函数
3.  **测试验证**
    -   确保前端能正确获取当前系统信息
    -   确保登录请求发送的参数符合 `LoginSchema` 校验

## 5. 风险与依赖

-   **风险**：前端 `System` 类型定义可能与 `contracts` 包中的 `System` 类型存在差异。需要确认 `context.tsx` 中使用的 `System` 类型定义。
-   **依赖**：修改后需要启动前端和后端服务进行联调测试。
