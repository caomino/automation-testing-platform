import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dataApi from './dataApi';

/** 构造一个最小可用的 Response mock（仅覆盖 dataApi 用到的成员） */
function makeResponse(opts: { status: number; contentType: string; body: unknown }): Response {
  const ok = opts.status >= 200 && opts.status < 300;
  return {
    ok,
    status: opts.status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? opts.contentType : null) },
    json: async () => opts.body,
    text: async () => (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
  } as unknown as Response;
}

describe('dataApi 错误诊断', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('收到 HTML 响应应抛出可读诊断（而非 Unexpected token）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' })),
    );
    await expect(dataApi.listProjects()).rejects.toThrow(/不是 JSON|反向代理|后端/);
  });

  it('正常 JSON 响应应正确解析', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeResponse({ status: 200, contentType: 'application/json', body: { ok: true, data: [{ id: 'p1', name: 'P1', systemCount: 0, updatedAt: 1 }] } }),
      ),
    );
    const r = await dataApi.listProjects();
    expect(r[0].name).toBe('P1');
  });

  it('ok:false 响应应抛出 error 字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ status: 200, contentType: 'application/json', body: { ok: false, error: '自定义错误' } })),
    );
    await expect(dataApi.listProjects()).rejects.toThrow('自定义错误');
  });
});
