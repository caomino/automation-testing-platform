import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAIClient } from '../src/index.js';
import type { AIProviderConfig } from '../src/index.js';

/** Minimal Response-like object produced by our fetch mock. */
interface MockResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

const config: AIProviderConfig = {
  id: 'p1',
  name: 'OpenAI',
  vendor: 'openai',
  baseUrl: 'https://api.openai.com/v1/',
  apiKeyRef: 'sk-test-123',
  model: 'gpt-4o',
  enabled: true,
  temperature: 0.5,
  maxTokens: 256,
};

/** Capture of the last fetch invocation, for assertions. */
let lastCall: { url: string; init: RequestInit } | null = null;

function mockFetch(response: MockResponse): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      lastCall = { url, init };
      return response as unknown as Response;
    }),
  );
}

beforeEach(() => {
  lastCall = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  lastCall = null;
});

describe('infra-ai createAIClient', () => {
  it('parses text and usage from a successful response', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Hello world' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    const client = createAIClient(config);
    const res = await client.complete({ prompt: 'Hi', system: 'Be brief' });

    expect(res.text).toBe('Hello world');
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('sends the request to the correct URL with Bearer auth and expected body', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(config);
    await client.complete({ prompt: 'Hi', system: 'Be brief', temperature: 0.9 });

    expect(lastCall).not.toBeNull();
    expect(lastCall!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(lastCall!.init.method).toBe('POST');
    expect((lastCall!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect((lastCall!.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk-test-123',
    );

    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0.9); // request override wins
    expect(body.max_tokens).toBe(256);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('throws on non-2xx responses', async () => {
    mockFetch({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    });

    const client = createAIClient(config);
    await expect(client.complete({ prompt: 'Hi' })).rejects.toThrow(/401/);
  });
});
