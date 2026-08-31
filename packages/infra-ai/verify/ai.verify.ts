import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProvider,
  createAIClient,
  getDefault,
  getProvider,
  listProviders,
  resetProviderStore,
  setDefault,
} from '../src/index.js';
import type { AIProviderConfig } from '../src/index.js';

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

const configNoTemp: AIProviderConfig = {
  id: 'p2',
  name: 'NoTemp',
  vendor: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyRef: 'sk-no-temp',
  model: 'gpt-4o-mini',
  enabled: true,
};

const configNoMax: AIProviderConfig = {
  id: 'p3',
  name: 'NoMax',
  vendor: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKeyRef: 'sk-no-max',
  model: 'gpt-4o',
  enabled: true,
  temperature: 0.3,
};

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

describe('infra-ai createAIClient — existing tests', () => {
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
    expect(body.temperature).toBe(0.9);
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

describe('infra-ai createAIClient — positive supplementary', () => {
  it('handles baseUrl without trailing slash', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(configNoTemp);
    await client.complete({ prompt: 'Hi' });

    expect(lastCall!.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('handles baseUrl with trailing slash', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(config);
    await client.complete({ prompt: 'Hi' });

    expect(lastCall!.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('omits system message when system prompt is not provided', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(config);
    await client.complete({ prompt: 'Hi' });

    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('uses default temperature 0.7 when neither request nor config specifies it', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(configNoTemp);
    await client.complete({ prompt: 'Hi' });

    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.temperature).toBe(0.7);
  });

  it('uses config temperature when request does not override', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(config);
    await client.complete({ prompt: 'Hi' });

    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.temperature).toBe(0.5);
  });

  it('request temperature overrides config temperature', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(config);
    await client.complete({ prompt: 'Hi', temperature: 0.1 });

    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.temperature).toBe(0.1);
  });

  it('does not send max_tokens when config has no maxTokens', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(configNoMax);
    await client.complete({ prompt: 'Hi' });

    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.max_tokens).toBeUndefined();
  });

  it('returns undefined usage when response has no usage field', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Hello' } }] }),
    });

    const client = createAIClient(config);
    const res = await client.complete({ prompt: 'Hi' });

    expect(res.text).toBe('Hello');
    expect(res.usage).toBeUndefined();
  });

  it('returns zero tokens when usage fields are missing', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Hello' } }],
        usage: {},
      }),
    });

    const client = createAIClient(config);
    const res = await client.complete({ prompt: 'Hi' });

    expect(res.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});

describe('infra-ai createAIClient — negative supplementary', () => {
  it('throws when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const client = createAIClient(config);
    await expect(client.complete({ prompt: 'Hi' })).rejects.toThrow('ECONNREFUSED');
  });

  it('returns empty text when response has no choices field', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ usage: { prompt_tokens: 1 } }),
    });

    const client = createAIClient(config);
    const res = await client.complete({ prompt: 'Hi' });

    expect(res.text).toBe('');
  });

  it('returns empty text when choices array is empty', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    const client = createAIClient(config);
    const res = await client.complete({ prompt: 'Hi' });

    expect(res.text).toBe('');
  });

  it('throws when response JSON parsing fails', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token');
      },
    });

    const client = createAIClient(config);
    await expect(client.complete({ prompt: 'Hi' })).rejects.toThrow();
  });

  it('throws on 5xx server error', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal server error' }),
    });

    const client = createAIClient(config);
    await expect(client.complete({ prompt: 'Hi' })).rejects.toThrow(/500/);
  });

  it('throws on 4xx error with detailed message', async () => {
    mockFetch({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limit exceeded' }),
    });

    const client = createAIClient(config);
    await expect(client.complete({ prompt: 'Hi' })).rejects.toThrow(/429/);
  });

  it('handles error response when json() also fails', async () => {
    mockFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Bad Gateway');
      },
    });

    const client = createAIClient(config);
    await expect(client.complete({ prompt: 'Hi' })).rejects.toThrow(/502/);
  });
});

describe('infra-ai createAIClient — boundary tests', () => {
  it('handles empty prompt gracefully', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const client = createAIClient(config);
    const res = await client.complete({ prompt: '' });

    expect(res.text).toBe('ok');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: '' }]);
  });

  it('handles very long prompt without truncation', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    const longPrompt = 'A'.repeat(10000);
    const client = createAIClient(config);
    const res = await client.complete({ prompt: longPrompt });

    expect(res.text).toBe('ok');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.messages[0].content).toHaveLength(10000);
  });
});

describe('infra-ai provider management', () => {
  beforeEach(() => {
    resetProviderStore();
  });

  const providerA: AIProviderConfig = {
    id: 'prov-a',
    name: 'Provider A',
    vendor: 'openai',
    baseUrl: 'https://api.a.com/v1',
    apiKeyRef: 'key-a',
    model: 'model-a',
    enabled: true,
  };

  const providerB: AIProviderConfig = {
    id: 'prov-b',
    name: 'Provider B',
    vendor: 'azure',
    baseUrl: 'https://api.b.com/v1',
    apiKeyRef: 'key-b',
    model: 'model-b',
    enabled: true,
  };

  it('addProvider and getProvider round-trip', () => {
    addProvider(providerA);
    expect(getProvider('prov-a')).toEqual(providerA);
    expect(getProvider('prov-b')).toBeUndefined();
  });

  it('listProviders returns all added providers', () => {
    addProvider(providerA);
    addProvider(providerB);
    const list = listProviders();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(['prov-a', 'prov-b']);
  });

  it('listProviders returns empty array initially', () => {
    expect(listProviders()).toEqual(expect.arrayContaining([]));
  });

  it('first enabled provider becomes default automatically', () => {
    addProvider(providerA);
    expect(getDefault()).toEqual(providerA);
  });

  it('setDefault switches the active provider', () => {
    addProvider(providerA);
    addProvider(providerB);
    setDefault('prov-b');
    expect(getDefault()).toEqual(providerB);
  });

  it('setDefault throws when id does not exist', () => {
    expect(() => setDefault('nonexistent')).toThrow(/not found/);
  });

  it('getDefault returns undefined when no providers added', () => {
    expect(getDefault()).toBeUndefined();
  });

  it('getProvider returns undefined for non-existent id', () => {
    expect(getProvider('ghost')).toBeUndefined();
  });

  it('addProvider overwrites existing provider with same id', () => {
    addProvider(providerA);
    const updated = { ...providerA, name: 'Provider A Updated' };
    addProvider(updated);
    expect(getProvider('prov-a')!.name).toBe('Provider A Updated');
    expect(listProviders()).toHaveLength(1);
  });
});
