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
  /** 初始 URL（登录页），用于模拟「路径变化判断登录成功」 */
  initialUrl?: string;
  /** 点击提交后浏览器跳转到的 URL（模拟用户登录成功后离开登录页） */
  afterSubmitUrl?: string;
  /** navigate 后 302 重定向映射（模拟门户根路径重定向到登录页） */
  redirectMap?: Record<string, string>;
  cookies?: string[];
  tokens?: string[];
  headers?: Record<string, string>;
  /** 按 navigate 的 URL 返回对应 DOM（用于模拟父门户 → 子系统跳转） */
  domByUrl?: Record<string, SemanticNode[]>;
  /** 导航回调：记录调用顺序，断言「先父门户后子系统」路径 */
  onNavigate?: (url: string) => void;
  /** 当前 URL 变更回调（含自动跳转），用于断言路径变化 */
  onUrlChange?: (url: string) => void;
  /** applySession 回调：记录注入内容，断言 reuseSession 真正注入 */
  onApply?: (state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }) => void;
  /** 让 launch 抛错，模拟接管中断（engine 抛错 → catch → failed） */
  throwOnLaunch?: boolean;
}): SessionCapableEngine {
  let dom = opts.initialDom;
  let submitted = false;
  const navigated: string[] = [];
  let currentUrl = opts.initialUrl ?? '';
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
      currentUrl = url;
      // 模拟真实浏览器 302 重定向：navigate 后 currentUrl 跳转到 redirectMap 指定的 URL
      if (opts.redirectMap && url in opts.redirectMap) {
        currentUrl = opts.redirectMap[url];
      }
      opts.onNavigate?.(url);
      opts.onUrlChange?.(currentUrl);
    },
    async getCurrentUrl() {
      return currentUrl;
    },
    async extractSemanticDom() {
      return current();
    },
    async exploreModules() {
      return [];
    },
    async runStep(cmd) {
      if (cmd.kind === 'click') {
        submitted = true;
        // 模拟真实浏览器：用户点击登录后离开登录页（URL 路径变化）
        if (opts.afterSubmitUrl) {
          currentUrl = opts.afterSubmitUrl;
          opts.onUrlChange?.(currentUrl);
        }
      }
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
    /** 测试辅助：手动改变当前 URL，模拟用户在浏览器中完成登录后页面跳转 */
    async _setCurrentUrl(url: string) {
      currentUrl = url;
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

  it('credential：空凭证（无 credentialRef，也未传 username/password）→ 先开浏览器降级 barrier（Issue 2 修复后行为）', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom() }),
      credentialStoreFactory: () => makeStore({}),
    });
    const out = await stage.run(baseInput('credential'));
    expect(out.loginStatus).toBe('barrier');
  });

  it('credential：会话态直传 username/password（无 credentialRef）→ 自动填充并提交登录', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), afterSubmitDom: loggedInDom(), cookies: ['session=abc'] }),
    });
    // 方案 X：账号密码经前端会话态传入，stage-login 直接用其自动填充（不落库/不写 Vault）
    const out = await stage.run({ ...baseInput('credential'), username: 'admin', password: 'pw' });
    expect(out.loginStatus).toBe('ok');
    expect(out.cookies).toContain('session=abc');
  });

  it('credential：凭证不存在（ref 有效但 store 无记录）→ 降级 barrier（先开浏览器，等手动登录）', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom() }),
      credentialStoreFactory: () => makeStore({}),
    });
    const out = await stage.run({ ...baseInput('credential'), credentialRef: 'missing' });
    // 修复 Issue 2 后：credential 模式不再于「开浏览器之前」抛错，
    // 无可用凭证时先打开浏览器并降级为人工接管（barrier），满足「第一步先打开浏览器」。
    expect(out.loginStatus).toBe('barrier');
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
    const headers = { Authorization: 'Bearer tk-manual', 'x-tenant': 't1' };
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loggedInDom(), cookies: ['manual=1'], headers }),
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 1000,
      pollIntervalMs: 50,
    });
    const out = await stage.run({ ...baseInput('manual-takeover'), systemId: 'sys2', credentialRef: 'manual-cred' });
    expect(out.loginStatus).toBe('ok');
    expect(out.cookies).toContain('manual=1');
    // [Minor] 认证头须注入 SessionHandle（供下游跨子系统复用）
    expect(out.sessionHandle.headers).toEqual(headers);
    expect(out.sessionHandle.headers?.['Authorization']).toBe('Bearer tk-manual');
  });

  it('manual-takeover：超时仍未登录（验证码持续）→ barrier', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: captchaDom() }),
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 150,
      pollIntervalMs: 30,
    });
    const out = await stage.run({ ...baseInput('manual-takeover'), systemId: 'sys2', credentialRef: 'manual-cred' });
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

  it('subsystem（credential）：父门户登录成功（URL 路径变化）后才进入子系统，而非直接导航 systemUrl', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const dashboardUrl = 'https://portal.example.com/dashboard';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const stage = createLoginStage({
      engineFactory: () =>
        makeFakeEngine({
          initialDom: loginFormDom(),
          initialUrl: portalUrl,
          afterSubmitUrl: dashboardUrl, // 提交后登录成功 → 离开登录页（路径变化）
          afterSubmitDom: loggedInDom(),
          domByUrl: {
            [portalUrl]: loginFormDom(),
            [dashboardUrl]: loggedInDom(),
            [subUrl]: loggedInDom(),
          },
          onNavigate: (u) => navigated.push(u),
          cookies: ['portal=session'],
        }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
      portalLoginWaitMs: 500,
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

  it('subsystem（credential）：父门户登录未完成（URL 未变化，如遇验证码）→ 不跳子系统，返回 barrier', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const stage = createLoginStage({
      engineFactory: () =>
        makeFakeEngine({
          initialDom: loginFormDom(),
          initialUrl: portalUrl,
          // 不设 afterSubmitUrl：提交后 URL 仍在登录页（登录未完成 / 需验证码）
          afterSubmitDom: captchaDom(),
          domByUrl: {
            [portalUrl]: loginFormDom(),
            [subUrl]: loggedInDom(),
          },
          onNavigate: (u) => navigated.push(u),
        }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
      portalLoginWaitMs: 200,
    });
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
    });
    // 父门户登录未完成：绝不跳子系统
    expect(navigated).not.toContain(subUrl);
    expect(out.loginStatus).toBe('barrier');
  });

  it('subsystem（manual-takeover）：父门户未登录时 launch 返回 barrier，URL 路径变化后 confirm 进入子系统', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const dashboardUrl = 'https://portal.example.com/dashboard';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: loggedInDom(),
      initialUrl: portalUrl,
      domByUrl: {
        [portalUrl]: loggedInDom(),
        [dashboardUrl]: loggedInDom(),
        [subUrl]: loggedInDom(),
      },
      onNavigate: (u) => navigated.push(u),
      cookies: ['manual=portal'],
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 1000,
      pollIntervalMs: 50,
      portalLoginWaitMs: 200,
    });
    // launch：父门户 URL 未变化（仍停留登录页）→ barrier，不跳子系统
    const launchOut = await stage.run({
      ...baseInput('manual-takeover'),
      systemId: 'sys2',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
      credentialRef: 'manual-cred',
    });
    expect(launchOut.loginStatus).toBe('barrier');
    expect(navigated).not.toContain(subUrl);

    // 模拟用户在浏览器完成登录：URL 路径变化（/login → /dashboard）
    (engine as any)._setCurrentUrl(dashboardUrl);

    // confirm：检测到路径变化 → 跳子系统 → ok
    const confirmOut = await stage.run({
      ...baseInput('manual-takeover'),
      systemId: 'sys2',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
      credentialRef: 'manual-cred',
      takeoverAction: 'confirm',
    });
    expect(confirmOut.loginStatus).toBe('ok');
    expect(navigated).toContain(subUrl);
    expect(confirmOut.cookies).toContain('manual=portal');
  });

  it('subsystem（credential）：父门户首页含「工作台/控制台/系统管理」等词但 URL 未变化 → 不误判为已登录，返回 barrier', async () => {
    const portalUrl = 'https://portal.example.com/home';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    // 门户首页：无密码框，但含「工作台」「控制台」「系统管理」等导航词（detectLoginState 会误判为 ok）
    const portalHomeDom = (): SemanticNode[] => [
      node({ tag: 'DIV', selector: '#nav', text: '工作台 控制台 系统管理 首页导航' }),
    ];
    const stage = createLoginStage({
      engineFactory: () =>
        makeFakeEngine({
          initialDom: portalHomeDom(),
          initialUrl: portalUrl,
          domByUrl: { [portalUrl]: portalHomeDom(), [subUrl]: loggedInDom() },
          onNavigate: (u) => navigated.push(u),
        }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
      portalLoginWaitMs: 200,
      pollIntervalMs: 50,
    });
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
    });
    // 关键：URL 未变化（仍停留门户首页），即使 DOM 含「工作台」等词，也不得判定为已登录
    expect(navigated).not.toContain(subUrl);
    expect(out.loginStatus).toBe('barrier');
  });

  it('subsystem（credential）：门户根路径 302 重定向到登录页后，以登录页为基准检测登录成功', async () => {
    const portalRoot = 'https://portal.example.com/';
    const loginUrl = 'https://portal.example.com/sxrdtypt/#/login';
    const homeUrl = 'https://portal.example.com/sxrdtypt/#/home';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const stage = createLoginStage({
      engineFactory: () =>
        makeFakeEngine({
          initialDom: loginFormDom(),
          initialUrl: portalRoot,
          redirectMap: { [portalRoot]: loginUrl }, // 根路径 302 → 登录页
          afterSubmitUrl: homeUrl, // 登录成功 → 主页
          afterSubmitDom: loggedInDom(),
          domByUrl: {
            [loginUrl]: loginFormDom(),
            [homeUrl]: loggedInDom(),
            [subUrl]: loggedInDom(),
          },
          onNavigate: (u) => navigated.push(u),
        }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
      portalLoginWaitMs: 1000,
      pollIntervalMs: 50,
    });
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalRoot,
    });
    // 基准是重定向后的登录页 loginUrl，登录后 URL 变化到 homeUrl → 判定成功
    expect(out.loginStatus).toBe('ok');
    expect(navigated).toContain(subUrl);
  });

  it('subsystem（credential）：门户根路径重定向到登录页后未登录（URL 停留登录页）→ 不跳子系统，返回 barrier', async () => {
    const portalRoot = 'https://portal.example.com/';
    const loginUrl = 'https://portal.example.com/sxrdtypt/#/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const stage = createLoginStage({
      engineFactory: () =>
        makeFakeEngine({
          initialDom: loginFormDom(),
          initialUrl: portalRoot,
          redirectMap: { [portalRoot]: loginUrl },
          // 无 afterSubmitUrl：登录未完成，URL 停在登录页（如遇验证码）
          afterSubmitDom: captchaDom(),
          domByUrl: { [loginUrl]: loginFormDom(), [subUrl]: loggedInDom() },
          onNavigate: (u) => navigated.push(u),
        }),
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
      portalLoginWaitMs: 200,
      pollIntervalMs: 50,
    });
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalRoot,
    });
    // 关键：重定向后 URL 停在登录页（未登录），不得因「根路径→登录页」的重定向误判为登录成功
    expect(navigated).not.toContain(subUrl);
    expect(out.loginStatus).toBe('barrier');
  });

  it('manual-takeover：硬失败（凭据错误/错误页）映射 failed 而非 barrier', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: wrongPwdDom() }),
      credentialStoreFactory: () => makeStore({}),
      manualTimeoutMs: 150,
      pollIntervalMs: 30,
    });
    const out = await stage.run({ ...baseInput('manual-takeover'), systemId: 'sys2', credentialRef: 'manual-cred' });
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
