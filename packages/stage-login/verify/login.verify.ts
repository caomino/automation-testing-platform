/**
 * @file login.verify.ts
 * @description stage-login 冻结契约校验（TDD：先红后绿）
 *   - 三模式分支：no-login / credential / manual-takeover
 *   - SessionHandle 结构合法性
 *   - barrier 检测（验证码/MFA/凭据错误）
 *   - 跨域会话复用 reuseSession
 *   - 边界：空凭证 / 凭证不存在 / 非法 systemUrl
 * @frozen v1.0
 */
import { describe, it, expect } from 'vitest';
import type { SemanticNode, LoginInput, SessionHandle } from '@test-platform/contracts';
import { createLoginStage, reuseSession, detectLoginState } from '../src';
import type { SessionCapableEngine, CredentialStore } from '../src';

/* ---------- 测试替身（fake） ---------- */

function node(p: Partial<SemanticNode> & { tag: string; selector: string }): SemanticNode {
  return {
    text: undefined,
    name: undefined,
    type: undefined,
    role: undefined,
    href: undefined,
    children: [],
    interactive: false,
    isDataControl: false,
    ...p,
  } as SemanticNode;
}

function makeFakeEngine(opts: {
  initialDom: SemanticNode[];
  afterSubmitDom?: SemanticNode[];
  cookies?: string[];
  tokens?: string[];
  headers?: Record<string, string>;
  /** 按 navigate 的 URL 返回对应 DOM（用于模拟父门户 → 子系统跳转） */
  domByUrl?: Record<string, SemanticNode[]>;
  /** 导航回调：记录调用顺序，断言「先父门户后子系统」路径 */
  onNavigate?: (url: string) => void;
  /** applySession 回调：记录注入内容，断言 reuseSession 真正注入 */
  onApply?: (state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }) => void;
  /** 让 launch 抛错，模拟接管中断（engine 抛错 → catch → failed） */
  throwOnLaunch?: boolean;
}): SessionCapableEngine {
  let dom = opts.initialDom;
  let submitted = false;
  const navigated: string[] = [];
  const current = (): SemanticNode[] => {
    const url = navigated[navigated.length - 1];
    if (url && opts.domByUrl && url in opts.domByUrl) return opts.domByUrl[url];
    return submitted ? opts.afterSubmitDom ?? dom : dom;
  };
  return {
    async launch() {
      if (opts.throwOnLaunch) throw new Error('engine launch failed');
    },
    async navigate(url: string) {
      navigated.push(url);
      opts.onNavigate?.(url);
    },
    async extractSemanticDom() {
      return current();
    },
    async exploreModules() {
      return [];
    },
    async runStep(cmd) {
      if (cmd.kind === 'click') submitted = true;
      return { step: cmd.kind, operation: JSON.stringify(cmd), expected: '', actual: 'ok', result: 'passed' };
    },
    async runCase() {
      return [];
    },
    async screenshot() {
      return { id: 's', fileName: 's', path: 's' };
    },
    async close() {},
    async getSessionCookies() {
      return opts.cookies ?? [];
    },
    async getSessionHeaders() {
      return opts.headers ?? {};
    },
    async getSessionTokens() {
      return opts.tokens ?? [];
    },
    async applySession(state) {
      opts.onApply?.(state);
    },
  };
}

function makeStore(records: Record<string, { username: string; password: string }>): CredentialStore {
  return {
    async save() {
      return 'x';
    },
    async get(ref) {
      return records[ref] ?? null;
    },
    async delete() {},
    async list() {
      return [];
    },
  };
}

/* ---------- DOM 构造 ---------- */

const loginFormDom = (extra: SemanticNode[] = []): SemanticNode[] => [
  node({ tag: 'INPUT', type: 'text', name: 'username', selector: '#username', interactive: true, isDataControl: true }),
  node({ tag: 'INPUT', type: 'password', name: 'password', selector: '#password', interactive: true, isDataControl: true }),
  node({ tag: 'BUTTON', type: 'submit', selector: '#loginBtn', interactive: true, isDataControl: true, text: '登录' }),
  ...extra,
];
const loggedInDom = (): SemanticNode[] => [node({ tag: 'DIV', selector: '#user', text: '退出' })];
const captchaDom = (): SemanticNode[] => loginFormDom([node({ tag: 'DIV', selector: '#cap', text: '验证码' })]);
const wrongPwdDom = (): SemanticNode[] => loginFormDom([node({ tag: 'DIV', selector: '#err', text: '密码错误' })]);

const baseInput = (mode: LoginInput['mode']): LoginInput => ({
  projectId: 'p1',
  systemId: 'sys1',
  mode,
  systemUrl: 'https://example.com/login',
});

/* ---------- 用例 ---------- */

describe('stage-login 三模式 + 契约', () => {
  it('no-login：直接返回 ok 会话，SessionHandle 结构合法', async () => {
    const stage = createLoginStage();
    const out = await stage.run(baseInput('no-login'));
    expect(out.loginStatus).toBe('ok');
    expect(out.sessionHandle.systemId).toBe('sys1');
    expect(out.sessionHandle.loginStatus).toBe('ok');
    expect(Array.isArray(out.cookies)).toBe(true);
    expect(out.expiresAt).toBeGreaterThan(Date.now());
  });

  it('credential：成功登录，捕获会话与 cookies', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), afterSubmitDom: loggedInDom(), cookies: ['session=abc'] }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    const out = await stage.run({ ...baseInput('credential'), credentialRef: 'cred-1' });
    expect(out.loginStatus).toBe('ok');
    expect(out.cookies).toContain('session=abc');
    expect(out.sessionHandle.systemId).toBe('sys1');
    expect(out.sessionHandle.loginStatus).toBe('ok');
  });

  it('credential：空凭证（无 credentialRef）→ failed', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom() }),
      credentialStoreFactory: () => makeStore({}),
    });
    const out = await stage.run(baseInput('credential'));
    expect(out.loginStatus).toBe('failed');
  });

  it('credential：凭证不存在 → failed', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom() }),
      credentialStoreFactory: () => makeStore({}),
    });
    const out = await stage.run({ ...baseInput('credential'), credentialRef: 'missing' });
    expect(out.loginStatus).toBe('failed');
  });

  it('credential：凭据错误（表单仍可见且报错）→ failed', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), afterSubmitDom: wrongPwdDom() }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'bad' } }),
    });
    const out = await stage.run({ ...baseInput('credential'), credentialRef: 'cred-1' });
    expect(out.loginStatus).toBe('failed');
  });

  it('credential：遇验证码 → barrier（需人工/接管升级）', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), afterSubmitDom: captchaDom() }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    const out = await stage.run({ ...baseInput('credential'), credentialRef: 'cred-1' });
    expect(out.loginStatus).toBe('barrier');
  });

  it('manual-takeover：人补完登录 → ok', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loggedInDom(), cookies: ['manual=1'] }),
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 1000,
      pollIntervalMs: 50,
    });
    const out = await stage.run({ ...baseInput('manual-takeover'), systemId: 'sys2' });
    expect(out.loginStatus).toBe('ok');
    expect(out.cookies).toContain('manual=1');
  });

  it('manual-takeover：超时仍未登录（验证码持续）→ barrier', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: captchaDom() }),
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 150,
      pollIntervalMs: 30,
    });
    const out = await stage.run({ ...baseInput('manual-takeover'), systemId: 'sys2' });
    expect(out.loginStatus).toBe('barrier');
  });

  it('barrier 检测：detectLoginState 三态', () => {
    expect(detectLoginState({ dom: captchaDom() }).status).toBe('barrier');
    expect(detectLoginState({ dom: loggedInDom() }).status).toBe('ok');
    expect(detectLoginState({ dom: wrongPwdDom() }).status).toBe('failed');
  });

  it('跨域会话复用：reuseSession 真正经 applySession 注入引擎并重定 systemId', async () => {
    const handle: SessionHandle = {
      sessionId: 's1',
      systemId: 'sysA',
      loginStatus: 'ok',
      cookies: ['a=1'],
      tokens: ['t'],
      headers: { h: '1' },
      expiresAt: Date.now(),
    };
    const applied: Array<{ cookies: string[]; headers?: Record<string, string>; tokens?: string[] }> = [];
    const engine = makeFakeEngine({ initialDom: loggedInDom(), onApply: (s) => applied.push(s) });
    const reused = await reuseSession(handle, 'sysB', engine);
    expect(applied).toHaveLength(1);
    expect(applied[0].cookies).toEqual(['a=1']);
    expect(applied[0].tokens).toEqual(['t']);
    expect(applied[0].headers).toEqual({ h: '1' });
    expect(reused.systemId).toBe('sysB');
    expect(reused.cookies).toEqual(['a=1']);
    expect(reused.tokens).toEqual(['t']);
    expect(reused.sessionId).toBe('s1');
    expect(reused.expiresAt).toBeGreaterThan(handle.expiresAt);
  });

  it('subsystem（credential）：先经父门户会话登录再进入子系统，而非直接导航 systemUrl', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const stage = createLoginStage({
      engineFactory: () =>
        makeFakeEngine({
          initialDom: loginFormDom(),
          domByUrl: {
            [portalUrl]: loginFormDom(),
            [subUrl]: loggedInDom(),
          },
          onNavigate: (u) => navigated.push(u),
          cookies: ['portal=session'],
        }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
    });
    // 路径：先父门户，后子系统；不可跳过父门户直接到 systemUrl
    expect(navigated[0]).toBe(portalUrl);
    expect(navigated).toContain(subUrl);
    expect(navigated.indexOf(subUrl)).toBeGreaterThan(navigated.indexOf(portalUrl));
    expect(out.loginStatus).toBe('ok');
    expect(out.cookies).toContain('portal=session');
    expect(out.sessionHandle.systemId).toBe('sys1');
  });

  it('subsystem（manual-takeover）：父门户登录后进入子系统，状态 ok', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const stage = createLoginStage({
      engineFactory: () =>
        makeFakeEngine({
          initialDom: loggedInDom(),
          domByUrl: {
            [portalUrl]: loggedInDom(),
            [subUrl]: loggedInDom(),
          },
          onNavigate: (u) => navigated.push(u),
          cookies: ['manual=portal'],
        }),
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 1000,
      pollIntervalMs: 50,
    });
    const out = await stage.run({
      ...baseInput('manual-takeover'),
      systemId: 'sys2',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
    });
    expect(navigated[0]).toBe(portalUrl);
    expect(navigated).toContain(subUrl);
    expect(out.loginStatus).toBe('ok');
    expect(out.cookies).toContain('manual=portal');
  });

  it('manual-takeover：硬失败（凭据错误/错误页）映射 failed 而非 barrier', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: wrongPwdDom() }),
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 150,
      pollIntervalMs: 30,
    });
    const out = await stage.run({ ...baseInput('manual-takeover'), systemId: 'sys2' });
    expect(out.loginStatus).toBe('failed');
    expect(out.expiresAt).toBe(0);
  });

  it('非 ok 状态（barrier/failed）会话 expiresAt = 0 语义', async () => {
    const barrierStage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), afterSubmitDom: captchaDom() }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    const barrierOut = await barrierStage.run({ ...baseInput('credential'), credentialRef: 'cred-1' });
    expect(barrierOut.loginStatus).toBe('barrier');
    expect(barrierOut.expiresAt).toBe(0);

    const failStage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), afterSubmitDom: wrongPwdDom() }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'bad' } }),
    });
    const failOut = await failStage.run({ ...baseInput('credential'), credentialRef: 'cred-1' });
    expect(failOut.loginStatus).toBe('failed');
    expect(failOut.expiresAt).toBe(0);
  });

  it('接管中断：引擎 launch 抛错 → catch → 返回 failed 会话', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), throwOnLaunch: true }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    const out = await stage.run({ ...baseInput('credential'), credentialRef: 'cred-1' });
    expect(out.loginStatus).toBe('failed');
    expect(out.expiresAt).toBe(0);
  });

  it('边界：非法 systemUrl 触发契约校验抛错', async () => {
    const stage = createLoginStage();
    await expect(stage.run({ ...baseInput('no-login'), systemUrl: 'not-a-url' })).rejects.toThrow();
  });
});
