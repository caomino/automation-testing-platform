/**
 * @file index.ts
 * @description AI 配置层冻结接口（多厂商、模型在配置页统一配，不写死）
 * @frozen v1.0
 */
export type AIVendor = 'openai' | 'azure' | 'anthropic' | 'local' | 'custom';

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

export function createAIClient(config: AIProviderConfig): AIClient {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

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

export function listProviders(): AIProviderConfig[] {
  return [];
}
