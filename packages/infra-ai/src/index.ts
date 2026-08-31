/**
 * @file index.ts
 * @description AI 配置层冻结接口（多厂商、模型在配置页统一配，不写死）
 * @frozen v1.1
 */
import type { AIVendor as _AIVendor, VendorPreset } from './vendors.js';
export type { VendorPreset };
export type AIVendor = _AIVendor;
export { VENDOR_PRESETS, getVendorPreset, listVendors, getModelsForVendor, getBaseUrlForVendor } from './vendors.js';

export type AIVendorLegacy = 'openai' | 'azure' | 'anthropic' | 'google' | 'deepseek' | 'qwen' | 'zhipu' | 'local' | 'custom';

export interface TestConnectionResult {
  success: boolean;
  status: number;
  message: string;
  latencyMs: number;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  vendor: AIVendor;
  baseUrl: string;
  apiKeyRef: string;
  model: string;
  enabled: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface AIRequest {
  prompt: string;
  system?: string;
  temperature?: number;
}

export interface AIResponse {
  text: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AIClient {
  complete(req: AIRequest): Promise<AIResponse>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  temperature: number;
  max_tokens?: number;
  messages: ChatMessage[];
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: ChatCompletionUsage;
}

/** Minimal shape of the global fetch Response we rely on. */
interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

const DEFAULT_TEMPERATURE = 0.7;

export function buildChatUrl(baseUrl: string): string {
  let url = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '/chat/completions';

  if (url.endsWith('/chat/completions')) {
    return url;
  }
  if (/^https?:\/\/api\.minimax(i)?\.chat$/i.test(url)) {
    return `${url}/v1/chat/completions`;
  }
  if (/^https?:\/\/api\.openai\.com$/i.test(url)) {
    return `${url}/v1/chat/completions`;
  }
  if (/^https?:\/\/api\.deepseek\.com$/i.test(url)) {
    return `${url}/v1/chat/completions`;
  }
  if (/^https?:\/\/api\.moonshot\.cn$/i.test(url)) {
    return `${url}/v1/chat/completions`;
  }

  return `${url}/chat/completions`;
}

export function buildModelsUrl(baseUrl: string): string {
  let url = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '/models';

  if (url.endsWith('/models')) {
    return url;
  }
  if (url.endsWith('/chat/completions')) {
    url = url.slice(0, -'/chat/completions'.length);
  }
  if (/^https?:\/\/api\.minimax(i)?\.chat$/i.test(url)) {
    return `${url}/v1/models`;
  }
  if (/^https?:\/\/api\.openai\.com$/i.test(url)) {
    return `${url}/v1/models`;
  }
  if (/^https?:\/\/api\.deepseek\.com$/i.test(url)) {
    return `${url}/v1/models`;
  }
  if (/^https?:\/\/api\.moonshot\.cn$/i.test(url)) {
    return `${url}/v1/models`;
  }
  return `${url}/models`;
}

export function createAIClient(config: AIProviderConfig): AIClient {
  const url = buildChatUrl(config.baseUrl);

  return {
    async complete(req: AIRequest): Promise<AIResponse> {
      const messages: ChatMessage[] = [
        ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ];

      const temperature = req.temperature ?? config.temperature ?? DEFAULT_TEMPERATURE;

      const body: ChatCompletionRequest = {
        model: config.model,
        temperature,
        max_tokens: config.maxTokens,
        messages,
      };

      const response = (await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKeyRef}`,
        },
        body: JSON.stringify(body),
      })) as unknown as JsonResponse;

      if (!response.ok) {
        const errorText = (await response.json().catch(() => null)) as string | null;
        throw new Error(`AI request failed (${response.status}): ${errorText ?? ''}`);
      }

      const parsed = (await response.json()) as ChatCompletionResponse;

      const text = parsed.choices?.[0]?.message?.content ?? '';

      const usage = parsed.usage
        ? {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
          }
        : undefined;

      return { text, usage };
    },
  };
}

const providerStore = new Map<string, AIProviderConfig>();
let defaultProviderId: string | null = null;

export function addProvider(config: AIProviderConfig): void {
  providerStore.set(config.id, config);
  if (defaultProviderId === null && config.enabled) {
    defaultProviderId = config.id;
  }
}

export function getProvider(id: string): AIProviderConfig | undefined {
  return providerStore.get(id);
}

export function setDefault(id: string): void {
  if (!providerStore.has(id)) {
    throw new Error(`Provider "${id}" not found`);
  }
  defaultProviderId = id;
}

export function getDefault(): AIProviderConfig | undefined {
  if (defaultProviderId === null) return undefined;
  return providerStore.get(defaultProviderId);
}

export function listProviders(): AIProviderConfig[] {
  return Array.from(providerStore.values());
}

export function resetProviderStore(): void {
  providerStore.clear();
  defaultProviderId = null;
}

export async function testConnection(config: AIProviderConfig): Promise<TestConnectionResult> {
  const url = buildChatUrl(config.baseUrl);
  const start = performance.now();

  try {
    const body: ChatCompletionRequest = {
      model: config.model,
      temperature: 0.7,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKeyRef}`,
      },
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - start);

    if (response.ok) {
      return {
        success: true,
        status: response.status,
        message: '连接成功',
        latencyMs,
      };
    }

    let errorText = '';
    try {
      const parsed = (await response.json()) as { error?: { message?: string; msg?: string }; message?: string };
      errorText = parsed.error?.message ?? parsed.error?.msg ?? parsed.message ?? response.statusText;
    } catch {
      errorText = response.statusText;
    }

    return {
      success: false,
      status: response.status,
      message: `连接失败: ${errorText}`,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: 0,
      message: `网络错误: ${message}`,
      latencyMs,
    };
  }
}

export async function fetchRemoteModels(
  baseUrl: string,
  apiKey: string,
): Promise<{ success: boolean; models: string[]; message: string }> {
  const url = buildModelsUrl(baseUrl);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        models: [],
        message: `获取模型列表失败 (${response.status})`,
      };
    }

    const parsed = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = (parsed.data ?? [])
      .map((m) => m.id ?? '')
      .filter((id) => id.length > 0);

    return {
      success: true,
      models,
      message: `获取到 ${models.length} 个模型`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      models: [],
      message: `获取模型列表失败: ${message}`,
    };
  }
}
