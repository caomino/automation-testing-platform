# AI 模型配置模块修复计划

## 一、问题诊断总结

### 1.1 当前状态

| 模块 | 文件路径 | 状态 |
|------|---------|------|
| AI 配置页面 | `packages/app/src/screens/AIConfig.tsx` | 有 UI，无真实功能 |
| 前端状态管理 | `packages/app/src/context.tsx` | 有 AiConfigView 类型和 reducer，无持久化 |
| 数据 API 层 | `packages/app/src/services/dataApi.ts` | **缺少** AI 配置 CRUD 接口 |
| AI 基础设施 | `packages/infra-ai/src/index.ts` | 有 createAIClient 和 provider 管理，但未接入前端 |
| 后端服务 | `packages/orchestrator/server.ts` | **缺少** AI 配置相关路由 |
| 日志模块 | `packages/infra-logger/src/index.ts` | 有实现，但后端路由未对接 |
| 日志页面 | `packages/app/src/screens/Logs.tsx` | 有 UI，调用的 API 不存在 |

### 1.2 核心问题清单

| # | 问题 | 严重度 | 根因 |
|---|------|--------|------|
| P1 | 只有页面无实际功能 | 高 | 前端状态未持久化、无后端 API、infra-ai 未对接 |
| P2 | 日志存放位置不明确 | 中 | infra-logger 有实现但未配置目录、后端无路由、前端 API 不存在 |
| P3 | 列表冗余（两个列表） | 低 | AIConfig.tsx 同时渲染 Card+Table 和原生 table，需合并 |
| P4 | 添加模型功能不足 | 高 | 缺少 API Key、厂商预设模型、测试连接、高级参数 |

---

## 二、相关代码位置清单

### 2.1 需修改的文件

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `packages/infra-ai/src/index.ts` | 扩展 | 添加厂商预设配置、模型列表、测试连接方法 |
| `packages/infra-ai/src/vendors.ts` | **新建** | 厂商预设配置表（Base URL、模型列表映射） |
| `packages/infra-store/src/index.ts` | 扩展 | 添加 AI 配置持久化方法 |
| `packages/orchestrator/server.ts` | 扩展 | 添加 AI 配置 CRUD 路由、日志管理路由 |
| `packages/app/src/services/dataApi.ts` | 扩展 | 添加 AI 配置和日志管理的 API 客户端 |
| `packages/app/src/screens/AIConfig.tsx` | 重构 | 合并列表、添加启用按钮、完善添加/编辑表单 |
| `packages/app/src/context.tsx` | 修改 | AiConfigView 增加 apiKey 字段，增加持久化调用 |
| `packages/infra-ai/README.md` | 更新 | 反映新增的厂商预设和测试连接功能 |

### 2.2 参考文件（不修改）

| 文件 | 说明 |
|------|------|
| `docs/自动化测试平台-主规格.md` §14 | AI 模型配置设计规范 |
| `docs/模块接口契约与开发规范.md` | 接口契约定义 |
| `packages/infra-logger/src/index.ts` | 日志层实现（参考） |
| `packages/infra-cred/src/index.ts` | 凭证加密存储（参考） |
| `packages/contracts/src/types/SystemConfig.ts` | 系统类型定义 |

---

## 三、详细修改方案

### 3.1 新建 `packages/infra-ai/src/vendors.ts` — 厂商预设配置

**目的**：根据选择的厂商自动填充 Base URL 和提供模型列表

```typescript
/**
 * @file vendors.ts
 * @description AI 厂商预设配置表
 *   选择厂商后自动带出 Base URL 和可用模型列表
 * @frozen v1.0
 */

export type AIVendor = 
  | 'openai' 
  | 'azure' 
  | 'anthropic' 
  | 'google' 
  | 'deepseek' 
  | 'qwen' 
  | 'zhipu' 
  | 'custom';

export interface VendorPreset {
  vendor: AIVendor;
  label: string;
  baseUrl: string;
  models: string[];
  description: string;
}

/** 厂商预设注册表 */
export const VENDOR_PRESETS: Record<AIVendor, VendorPreset> = {
  openai: {
    vendor: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    description: '原生 OpenAI API',
  },
  azure: {
    vendor: 'azure',
    label: 'Azure OpenAI',
    baseUrl: 'https://{resource}.openai.azure.com',
    models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
    description: 'Azure OpenAI Service（需替换 {resource}）',
  },
  anthropic: {
    vendor: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-sonnet'],
    description: 'Anthropic Claude API',
  },
  google: {
    vendor: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
    description: 'Google Gemini API',
  },
  deepseek: {
    vendor: 'deepseek',
    label: 'Deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: 'Deepseek AI API',
  },
  qwen: {
    vendor: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    description: '阿里巴巴通义千问 API',
  },
  zhipu: {
    vendor: 'zhipu',
    label: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'],
    description: '智谱 AI 开放平台',
  },
  custom: {
    vendor: 'custom',
    label: '自定义/中转站',
    baseUrl: '',
    models: [],
    description: '兼容 OpenAI Chat Completions 的任意端点',
  },
};

/** 获取厂商预设 */
export function getVendorPreset(vendor: AIVendor): VendorPreset | undefined {
  return VENDOR_PRESETS[vendor];
}

/** 获取所有厂商列表 */
export function listVendors(): VendorPreset[] {
  return Object.values(VENDOR_PRESETS);
}

/** 根据厂商获取模型列表 */
export function getModelsForVendor(vendor: AIVendor): string[] {
  return VENDOR_PRESETS[vendor]?.models ?? [];
}

/** 根据厂商获取 Base URL */
export function getBaseUrlForVendor(vendor: AIVendor): string {
  return VENDOR_PRESETS[vendor]?.baseUrl ?? '';
}
```

### 3.2 扩展 `packages/infra-ai/src/index.ts` — 添加测试连接功能

**新增内容**：
1. 导入 `vendors.ts` 中的预设配置
2. 添加 `testConnection()` 方法用于真实 API 连通性测试
3. 添加 `fetchModels()` 方法用于从远端获取模型列表（如果 API 支持）

### 3.3 扩展 `packages/infra-store/src/index.ts` — AI 配置持久化

**新增方法**（在 `ProjectStore` 接口中）：

```typescript
// AI 配置持久化
saveAIConfig(config: AIConfigRecord): Promise<void>;
listAIConfigs(): Promise<AIConfigRecord[]>;
getAIConfig(id: string): Promise<AIConfigRecord | null>;
updateAIConfig(id: string, patch: Partial<AIConfigRecord>): Promise<AIConfigRecord>;
deleteAIConfig(id: string): Promise<void>;
setDefaultAIConfig(id: string): Promise<void>;
toggleAIConfigEnabled(id: string, enabled: boolean): Promise<void>;
```

**新增类型**：

```typescript
interface AIConfigRecord {
  id: string;
  name: string;
  vendor: AIVendor;
  baseUrl: string;
  apiKeyRef: string;  // 引用 infra-cred 的凭证
  model: string;
  enabled: boolean;
  isDefault: boolean;
  temperature?: number;
  maxTokens?: number;
  createdAt: number;
  updatedAt: number;
}
```

### 3.4 扩展 `packages/orchestrator/server.ts` — 添加后端路由

**新增路由**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/ai-configs` | GET | 获取所有 AI 配置 |
| `/api/ai-configs` | POST | 新增 AI 配置 |
| `/api/ai-configs/:id` | GET | 获取单个配置 |
| `/api/ai-configs/:id` | PUT | 更新配置 |
| `/api/ai-configs/:id` | DELETE | 删除配置 |
| `/api/ai-configs/:id/toggle` | POST | 切换启用状态 |
| `/api/ai-configs/:id/default` | POST | 设为默认 |
| `/api/ai-configs/test` | POST | 测试连接（真实 API 调用） |
| `/api/ai-configs/models` | POST | 获取远端模型列表 |
| `/api/logs` | GET | 获取日志文件列表 |
| `/api/logs/dir` | GET | 获取日志目录路径 |
| `/api/logs/cleanup` | POST | 清理过期日志 |
| `/api/logs` | DELETE | 清空全部日志 |
| `/api/logs/:filename` | DELETE | 删除单个日志文件 |
| `/api/logs/policy` | PUT | 更新日志策略 |

### 3.5 扩展 `packages/app/src/services/dataApi.ts` — 前端 API 客户端

**新增函数**：

```typescript
// AI 配置 API
export async function listAIConfigs(): Promise<AIConfigView[]>;
export async function getAIConfig(id: string): Promise<AIConfigView | null>;
export async function createAIConfig(config: CreateAIConfigInput): Promise<AIConfigView>;
export async function updateAIConfig(id: string, patch: Partial<AIConfigView>): Promise<AIConfigView>;
export async function deleteAIConfig(id: string): Promise<void>;
export async function toggleAIConfigEnabled(id: string, enabled: boolean): Promise<void>;
export async function setAIConfigDefault(id: string): Promise<void>;
export async function testAIConnection(config: AIConfigView): Promise<{ success: boolean; message: string }>;
export async function fetchAIModels(vendor: string, baseUrl: string, apiKeyRef: string): Promise<string[]>;

// 日志管理 API（补充缺失的调用）
export async function listLogs(): Promise<LogFileView[]>;
export async function getLogDir(): Promise<string>;
export async function cleanupExpiredLogs(): Promise<number>;
export async function clearAllLogs(): Promise<void>;
export async function deleteLogFile(filename: string): Promise<void>;
export async function updateLogPolicy(policy: LogPolicy): Promise<void>;
```

### 3.6 重构 `packages/app/src/screens/AIConfig.tsx` — 页面完善

**3.6.1 合并冗余列表**
- 删除第 95-133 行的原生 `<table>` 渲染
- 保留 Card + Table 组件实现
- 在 Table 的"启用"列添加点击切换按钮（当前只有 Tag 显示）

**3.6.2 完善添加/编辑表单**
- **厂商选择**：改为下拉选择，选择后自动填充 Base URL 和模型列表
- **Base URL**：根据厂商自动填充，可手动修改（支持中转站/自定义）
- **API Key**：新增字段，支持两种方式：
  1. 输入新 Key → 自动存入 `infra-cred` → 返回 credentialRef
  2. 从已有凭证中选择
- **模型选择**：改为下拉（显示预设模型）+ 自定义输入支持
- **高级参数**（可折叠）：
  - Temperature（0-2，默认 0.7）
  - Max Tokens
- **测试连接**：新增按钮，调用真实 API 验证

**3.6.3 新增状态管理**
- 厂商选择时的联动（Base URL、模型列表更新）
- 测试连接的 loading 状态和结果展示
- API Key 的安全处理（不明文存储，只存引用）

### 3.7 更新 `packages/app/src/context.tsx` — 状态持久化

**修改内容**：
1. `AiConfigView` 增加 `apiKeyRef`、`temperature`、`maxTokens` 字段
2. AI 相关操作改为异步调用后端 API：
   - `aiAdd` → 调用 `dataApi.createAIConfig()`
   - `aiUpdate` → 调用 `dataApi.updateAIConfig()`
   - `aiRemove` → 调用 `dataApi.deleteAIConfig()`
   - `aiToggleEnabled` → 调用 `dataApi.toggleAIConfigEnabled()`
   - `aiSetDefault` → 调用 `dataApi.setAIConfigDefault()`
3. 启动时从后端加载 AI 配置列表

### 3.8 日志存放位置说明

**日志路径**：`D:\test-platform-data\logs`

**配置方式**：
- `infra-logger` 的 `createLogger({ dir, retentionDays, maxFileSize })` 配置
- 需要在 `server.ts` 初始化时创建 Logger 实例并传入日志目录
- 日志文件命名：`app.log`（主文件）+ `app.log.{timestamp}`（滚动文件）

**日志文件格式**：JSON Lines
```json
{"ts": 1724000000000, "level": "info", "scope": "ai-config", "message": "AI 配置已保存", "meta": {"id": "xxx"}}
```

---

## 四、实施步骤

### 阶段 1：基础设施层（infra-ai 扩展）
1. 新建 `vendors.ts` — 厂商预设配置
2. 扩展 `index.ts` — 测试连接方法、fetchModels

### 阶段 2：存储层（infra-store 扩展）
3. 添加 AI 配置的数据库表和 CRUD 方法

### 阶段 3：后端服务层（server.ts 扩展）
4. 添加 AI 配置 API 路由
5. 添加日志管理 API 路由
6. 初始化 Logger 实例

### 阶段 4：前端 API 层（dataApi.ts 扩展）
7. 添加 AI 配置和日志的 API 客户端

### 阶段 5：前端状态层（context.tsx 修改）
8. AiConfigView 类型扩展
9. AI 操作改为异步持久化

### 阶段 6：前端页面层（AIConfig.tsx 重构）
10. 合并冗余列表
11. 添加启用按钮到列表
12. 重写添加/编辑表单（厂商下拉、自动填充、API Key、测试连接）

### 阶段 7：验证
13. 本地启动后端服务
14. 验证 AI 配置 CRUD 流程
15. 验证测试连接功能
16. 验证日志写入和读取

---

## 五、风险与注意事项

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| Contracts 包冻结 | AIConfigRecord 类型不能加在 contracts 中 | 定义在 infra-store 本地 |
| API Key 安全 | 明文存储风险 | 使用 infra-cred 的 AES-256-GCM 加密存储 |
| 跨域限制 | 前端直接调 AI API 会被 CORS 拦截 | 测试连接走后端代理 |
| Azure 特殊 URL | Azure 的 URL 格式不同 | 预设中用占位符 `{resource}` 提示用户 |
| 模型列表获取 | 不同厂商获取模型列表的 API 不同 | 先使用预设列表，后续可扩展动态获取 |
| 现有数据兼容 | 前端 state 中的 aiConfigs 需迁移 | 保持前端 state 结构不变，增加 apiKeyRef 字段 |

---

## 六、关于大模型接入的技术说明

### 6.1 标准接入流程（参考 CCswitch）

```
用户操作流程：
1. 选择厂商下拉 → 自动填充 Base URL → 加载预设模型
2. 输入 API Key → 加密存储 → 获取 credentialRef
3. 选择或输入模型名
4. 可选：调整 Temperature、Max Tokens
5. 点击"测试连接" → 后端代理发请求 → 返回结果
6. 保存配置
```

### 6.2 API 调用规范

所有厂商统一走 OpenAI Chat Completions 协议：

```
POST {baseUrl}/chat/completions
Headers:
  Content-Type: application/json
  Authorization: Bearer {apiKey}
Body:
  {
    "model": "{model}",
    "messages": [{"role": "user", "content": "{prompt}"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }
```

### 6.3 测试连接实现

```typescript
// 后端代理实现
async function testConnection(config) {
  const url = `${config.baseUrl}/chat/completions`;
  const body = {
    model: config.model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 10,
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${decryptKey(config.apiKeyRef)}`,
    },
    body: JSON.stringify(body),
  });
  
  return {
    success: response.ok,
    status: response.status,
    message: response.ok ? '连接成功' : `连接失败: ${response.statusText}`,
  };
}
```

### 6.4 预设厂商 Base URL 对照表

| 厂商 | vendor | Base URL | 模型示例 |
|------|--------|----------|---------|
| OpenAI | openai | `https://api.openai.com/v1` | gpt-4o, gpt-4o-mini |
| Azure | azure | `https://{resource}.openai.azure.com` | gpt-4o（需部署） |
| Anthropic | anthropic | `https://api.anthropic.com` | claude-3-5-sonnet |
| Google | google | `https://generativelanguage.googleapis.com` | gemini-1.5-pro |
| Deepseek | deepseek | `https://api.deepseek.com/v1` | deepseek-chat |
| 通义 | qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-max, qwen-plus |
| 智谱 | zhipu | `https://open.bigmodel.cn/api/paas/v4` | glm-4, glm-3-turbo |
| 自定义 | custom | 用户输入 | 用户输入 |

---

## 七、交付物

1. **代码修改**：上述 8 个文件的修改
2. **新增文件**：`packages/infra-ai/src/vendors.ts`
3. **功能验证**：
   - AI 配置 CRUD 完整流程
   - 厂商选择 → Base URL 自动填充
   - 模型预设下拉 + 自定义输入
   - 测试连接真实 API 调用
   - 启用/禁用切换
   - 设为默认
   - 日志正确写入 `D:\test-platform-data\logs`

---

*计划版本：v1.0*  
*生成时间：2026-08-16*  
*状态：待审批*