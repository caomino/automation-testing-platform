# @test-platform/infra-ai

企业管理系统自动化测试平台的 AI 配置层包。

## 职责

本包负责 AI 模型配置的抽象与多厂商支持。核心设计原则：

- **配置与代码分离**：AI 模型、API 端点、密钥引用均在配置页统一管理，不硬编码
- **多厂商中立**：统一的 `AIClient` 接口屏蔽底层厂商差异
- **可插拔提供者**：运行时动态注册、切换 AI 提供者

## 接口文档

### `AIClient`

AI 客户端实例，由 `createAIClient` 工厂创建。

```typescript
interface AIClient {
  complete(req: AIRequest): Promise<AIResponse>;
}
```

#### `complete(req)`

向 AI 模型发送请求并获取回复。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| req.prompt | `string` | 是 | 用户提示文本 |
| req.system | `string` | 否 | 系统提示（高优先级指令） |
| req.temperature | `number` | 否 | 采样温度，覆盖配置中的默认值 |

返回 `AIResponse`：

| 字段 | 类型 | 说明 |
|------|------|------|
| text | `string` | AI 回复文本 |
| usage | `{ promptTokens: number; completionTokens: number }` \| `undefined` | Token 消耗统计 |

### `AIProviderConfig`

AI 提供者配置，存储在配置页中。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | `string` | 唯一标识符 |
| name | `string` | 显示名称 |
| vendor | `AIVendor` | 厂商类型：`openai` \| `azure` \| `anthropic` \| `local` \| `custom` |
| baseUrl | `string` | API 端点基础地址（如 `https://api.openai.com/v1`） |
| apiKeyRef | `string` | API Key 引用标识（实际密钥由密钥管理服务保管） |
| model | `string` | 模型名称 |
| enabled | `boolean` | 是否启用 |
| temperature | `number` | 默认采样温度（请求级可覆盖） |
| maxTokens | `number` | 最大生成 Token 数 |

### `AIRequest` / `AIResponse`

请求与响应的详细结构：

```typescript
interface AIRequest {
  prompt: string;
  system?: string;
  temperature?: number;
}

interface AIResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}
```

## 使用示例

### 基础调用

```typescript
import { createAIClient } from '@test-platform/infra-ai';

const client = createAIClient({
  id: 'my-provider',
  name: 'My Provider',
  vendor: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyRef: 'sk-prod-001',
  model: 'gpt-4o',
  enabled: true,
  temperature: 0.7,
  maxTokens: 2048,
});

const res = await client.complete({
  prompt: '帮我生成一份测试用例',
  system: '你是一位专业的软件测试工程师',
});

console.log(res.text);       // AI 回复文本
console.log(res.usage);      // Token 消耗（可选）
```

### 动态温度控制

```typescript
// 使用配置中的默认温度 (0.7)
await client.complete({ prompt: 'Hi' });

// 请求级覆盖温度
await client.complete({ prompt: 'Hi', temperature: 0.3 });
```

### 提供者管理

```typescript
import {
  addProvider,
  getProvider,
  setDefault,
  getDefault,
  listProviders,
} from '@test-platform/infra-ai';

// 注册提供者
addProvider({
  id: 'azure-east',
  name: 'Azure East US',
  vendor: 'azure',
  baseUrl: 'https://eastus.api.cognitive.microsoft.com',
  apiKeyRef: 'azure-key-001',
  model: 'gpt-4o',
  enabled: true,
});

// 查询提供者
const provider = getProvider('azure-east');

// 设置默认提供者
setDefault('azure-east');
const def = getDefault();

// 列出所有提供者
const all = listProviders();
```

## 多厂商支持

本包通过 `AIVendor` 联合类型支持以下厂商：

| 厂商 | vendor 值 | 说明 |
|------|-----------|------|
| OpenAI | `openai` | 原生 OpenAI API |
| Azure | `azure` | Azure OpenAI Service |
| Anthropic | `anthropic` | Anthropic Claude API |
| 本地模型 | `local` | 本地部署模型（如 Ollama） |
| 自定义 | `custom` | 任何兼容 OpenAI Chat Completions 协议的端点 |

所有厂商统一走 `/chat/completions` 端点（或其兼容路径），由 `baseUrl` 决定实际地址。

## 知识库指令注入机制

系统支持两层提示注入，确保 AI 在回复时遵循特定行为约束：

1. **系统提示（System Prompt）**：高优先级，用于注入角色定义、行为约束等不可被用户覆盖的指令。通过 `AIRequest.system` 字段传入，会作为 `role: 'system'` 的消息插入到对话最前端。

2. **通用提示（General Prompt）**：低优先级，用于注入业务上下文、知识库摘要等辅助信息。通常由上层业务在调用 `complete` 时拼装到 `prompt` 中。

```
消息序列：
[system] 你是一位专业的测试工程师        ← 高优先级，不可覆盖
[user] 根据以下需求生成测试用例：...      ← 用户 prompt（含业务上下文）
```

温度回退链：`请求级 temperature` → `配置级 temperature` → `默认值 0.7`

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| `zod` | ^3.23.8 | 配置校验（可选，上层使用） |

运行时仅依赖标准 `fetch` API，无需额外网络库。

---

## 7. 迭代指南

### 7.1 扩展点

#### 新增 AI 厂商
在 `AIVendor` 联合类型中添加新值，实现对应的 API 适配器：
```typescript
type AIVendor = 'openai' | 'azure' | 'anthropic' | 'deepseek' | 'qwen' | 'zhipu' | 'custom' | 'new-vendor';
```

#### 扩展配置项
在 `AIProviderConfig` 接口中添加可选字段，支持更多配置选项。

#### 支持流式响应
扩展 `AIResponse` 接口，添加流式数据支持，实现 `completeStream()` 方法。

### 7.2 常见修改场景

#### 添加新的提示词模板
在调用 `complete()` 方法前，根据不同业务场景组装不同的 system prompt。

#### 实现 fallback 机制
当主 AI 服务不可用时，自动切换到备用服务：
```typescript
async function completeWithFallback(req: AIRequest): Promise<AIResponse> {
  try {
    return await primaryClient.complete(req);
  } catch {
    return await fallbackClient.complete(req);
  }
}
```

### 7.3 测试要点
- 各厂商 API 调用正确性测试
- 配置管理 CRUD 测试
- 温度回退链测试
- 错误处理和重试测试

### 7.4 注意事项
- **API Key 安全**：API Key 不明文存储，通过 `apiKeyRef` 引用凭证存储
- **速率限制**：注意各 AI 厂商的 API 速率限制
- **超时处理**：AI 请求应有合理的超时设置
- **成本控制**：在日志中记录 Token 消耗，便于成本分析