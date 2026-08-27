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
}): SessionCapableEngine & { _setCurrentUrl(url: string): Promise<void> } {
  let dom = opts.initialDom;
  let submitted = false;
  const navigated: string[] = [];
  let currentUrl = opts.initialUrl ?? '';
  const current = (): SemanticNode[] => {
    // DOM 以「当前 URL」为准：`_setCurrentUrl` 模拟用户手动导航（含子系统深页），
    // 此时导航历史未变但页面内容应跟随当前 URL 变化。
    if (opts.domByUrl && currentUrl in opts.domByUrl) return opts.domByUrl[currentUrl];
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

  it('credential：空凭证（占位 credentialRef，凭证库无记录）→ 先开浏览器降级 barrier（Issue 2 修复后行为）', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom() }),
      credentialStoreFactory: () => makeStore({}),
    });
    // 冻结契约要求 mode=credential 时 credentialRef 必填；「完全无凭证」的业务场景由
    // server 桥注入占位 credentialRef 通过校验（见 orchestrator/server.ts preprocessLoginInput），
    // stage-login 查不到占位引用对应凭证 → 降级为打开浏览器人工登录（barrier）。
    const out = await stage.run({ ...baseInput('credential'), credentialRef: 'placeholder-empty' });
    expect(out.loginStatus).toBe('barrier');
  });

  it('credential：会话态直传 username/password（credentialRef 为服务端占位）→ 自动填充并提交登录', async () => {
    const stage = createLoginStage({
      engineFactory: () => makeFakeEngine({ initialDom: loginFormDom(), afterSubmitDom: loggedInDom(), cookies: ['session=abc'] }),
    });
    // 冻结契约允许 LoginInput 携带可选 username/password：stage-login 收到时优先直接
    // 填充提交（不落库/不写 Vault，credentialRef 不会被查询）。注：两个 server 桥
    // （orchestrator/server.ts 与根 server.mjs）实际会把 username/password 存入凭证库
    // 并改注入真实 credentialRef（见 preprocessLoginInput），本用例覆盖的是 stage 层
    // 直调（绕过 server 桥）时的契约行为。
    const out = await stage.run({ ...baseInput('credential'), username: 'admin', password: 'pw', credentialRef: 'placeholder-session' });
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

  it('subsystem（credential）：launch 仅打开门户登录页返回 barrier；手动进入子系统后 confirm → ok（全程不 navigate 子系统）', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: loginFormDom(),
      initialUrl: portalUrl,
      domByUrl: { [portalUrl]: loginFormDom(), [subUrl]: loggedInDom() },
      onNavigate: (u) => navigated.push(u),
      cookies: ['portal=session'],
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    // launch：打开门户登录页即 barrier（D:\test 人工接管模式），绝不等待登录、绝不自动导航子系统
    const launchOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
    });
    expect(launchOut.loginStatus).toBe('barrier');
    expect(navigated).toEqual([portalUrl]);
    expect(navigated).not.toContain(subUrl);

    // 模拟用户完成门户登录并【手动进入子系统】后点击「确认登录」
    await engine._setCurrentUrl(subUrl);
    const confirmOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
      takeoverAction: 'confirm',
    });
    expect(confirmOut.loginStatus).toBe('ok');
    expect(confirmOut.cookies).toContain('portal=session');
    expect(confirmOut.sessionHandle.systemId).toBe('sys1');
    expect(navigated).not.toContain(subUrl); // 确认过程绝不 navigate 子系统
  });

  it('subsystem（credential）：confirm 时浏览器仍在门户登录表单（未完成门户登录）→ 返回 barrier', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: loginFormDom(),
      initialUrl: portalUrl,
      domByUrl: { [portalUrl]: loginFormDom(), [subUrl]: loggedInDom() },
      onNavigate: (u) => navigated.push(u),
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    // launch：打开门户登录页即 barrier（建立接管引擎）
    const launchOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
    });
    expect(launchOut.loginStatus).toBe('barrier');
    // 用户仍停在登录表单（未完成门户登录）就点「确认登录」→ barrier，绝不 navigate
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
      takeoverAction: 'confirm',
    });
    expect(out.loginStatus).toBe('barrier');
    expect(out.sessionHandle.detectionReason).toContain('登录');
    expect(navigated).not.toContain(subUrl);
  });

  it('subsystem（manual-takeover）：launch 打开门户登录页返回 barrier；手动进入子系统后 confirm → ok（全程不 navigate）', async () => {
    const portalUrl = 'https://portal.example.com/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: loginFormDom(),
      initialUrl: portalUrl,
      domByUrl: { [portalUrl]: loginFormDom(), [subUrl]: loggedInDom() },
      onNavigate: (u) => navigated.push(u),
      cookies: ['manual=portal'],
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({}),
    });
    // launch：打开门户登录页即 barrier（D:\test 人工接管模式），不等待、不导航子系统
    const launchOut = await stage.run({
      ...baseInput('manual-takeover'),
      systemId: 'sys2',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
      credentialRef: 'manual-cred',
    });
    expect(launchOut.loginStatus).toBe('barrier');
    expect(navigated).toEqual([portalUrl]);
    expect(navigated).not.toContain(subUrl);

    // 模拟用户完成门户登录并手动进入子系统后点击「确认登录」
    await engine._setCurrentUrl(subUrl);
    const confirmOut = await stage.run({
      ...baseInput('manual-takeover'),
      systemId: 'sys2',
      systemUrl: subUrl,
      parentPortalUrl: portalUrl,
      credentialRef: 'manual-cred',
      takeoverAction: 'confirm',
    });
    expect(confirmOut.loginStatus).toBe('ok');
    expect(confirmOut.cookies).toContain('manual=portal');
    expect(navigated).not.toContain(subUrl); // 确认过程绝不 navigate
  });

  it('subsystem（credential）：信任模型——confirm 时已离开登录表单（门户工作台，pathname 与 systemUrl 不同）→ 直接 ok', async () => {
    // 信任模型（用户确认）：子系统是门户 SPA 的 webview/iframe 嵌入页，顶层 URL 的
    // pathname 与配置 systemUrl 永远不同（如 /typtnew/dist vs /typtnew/sxrdtypt），
    // URL 匹配必然失败。confirm **不做 URL 匹配**，仅以「已离开登录表单」判定：
    // 用户在门户工作台（含「工作台/控制台」等词、无密码框）确认 → detectLoginState ok
    // → 信任已登录 → ok，当前 URL 即子系统入口（capturedUrl 由 orchestrator 记录）。
    const portalWorkbench = 'https://app.example.com/typtnew/dist/#/governmentIndex';
    const subUrl = 'https://app.example.com/typtnew/sxrdtypt/#/sy';
    const portalHomeDom = (): SemanticNode[] => [
      node({ tag: 'DIV', selector: '#nav', text: '工作台 控制台 系统管理 首页导航' }),
    ];
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: portalHomeDom(),
      initialUrl: portalWorkbench,
      domByUrl: { [portalWorkbench]: portalHomeDom(), [subUrl]: loggedInDom() },
      onNavigate: (u) => navigated.push(u),
      cookies: ['portal=session'],
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    // launch：打开门户登录页即 barrier（建立接管引擎）
    const launchOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalWorkbench,
    });
    expect(launchOut.loginStatus).toBe('barrier');
    // 用户停在门户工作台（已登录态）确认 → 信任模型 → ok，全程不 navigate
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalWorkbench,
      takeoverAction: 'confirm',
    });
    expect(out.loginStatus).toBe('ok');
    expect(out.cookies).toContain('portal=session');
    expect(navigated).not.toContain(subUrl);
  });

  it('subsystem（credential）：用户手动进入子系统（webview 嵌入深页，pathname 与 systemUrl 不同）后 confirm → 信任模型 → ok', async () => {
    // 信任模型：confirm **不做 URL 匹配**（子系统是门户 SPA 的 webview/iframe 嵌入页，
    // 顶层 URL pathname 与配置 systemUrl 永远不同）。用户手动进入子系统**业务深页**
    // （如 typtnew/dist/#/gnzx/webview?...，pathname=/typtnew/dist，与配置 sxrdtypt 不同）
    // 后确认 → 当前页无登录表单（detectLoginState ok）→ 信任已登录 → ok，全程不 navigate。
    const portalWorkbench = 'https://app.example.com/typtnew/dist/#/governmentIndex';
    const subEntry = 'https://app.example.com/typtnew/sxrdtypt/#/sy';
    const subDeepPage = 'https://app.example.com/typtnew/dist/#/gnzx/webview?openUrl=%2Ftyptnew%2Fqymldepartment.action';
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: loginFormDom(),
      initialUrl: portalWorkbench,
      domByUrl: {
        [portalWorkbench]: loginFormDom(),
        [subEntry]: loggedInDom(),
        [subDeepPage]: loggedInDom(),
      },
      onNavigate: (u) => navigated.push(u),
      cookies: ['portal=session'],
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    const launchOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subEntry,
      parentPortalUrl: portalWorkbench,
    });
    expect(launchOut.loginStatus).toBe('barrier');
    // 用户手动进入子系统业务深页（顶层 URL 与 systemUrl pathname 不同）后确认 → ok
    await engine._setCurrentUrl(subDeepPage);
    const confirmOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subEntry,
      parentPortalUrl: portalWorkbench,
      takeoverAction: 'confirm',
    });
    expect(confirmOut.loginStatus).toBe('ok');
    expect(confirmOut.cookies).toContain('portal=session');
    expect(navigated).not.toContain(subDeepPage); // 确认过程绝不 navigate
  });

  it('subsystem（credential）：门户根路径 302 重定向到登录页，以实际登录页为门户源基准；手动进入子系统后 confirm → ok', async () => {
    const portalRoot = 'https://portal.example.com/';
    const loginUrl = 'https://portal.example.com/sxrdtypt/#/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: loginFormDom(),
      initialUrl: portalRoot,
      redirectMap: { [portalRoot]: loginUrl }, // 根路径 302 → 登录页
      domByUrl: { [loginUrl]: loginFormDom(), [subUrl]: loggedInDom() },
      onNavigate: (u) => navigated.push(u),
      cookies: ['portal=session'],
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    // launch：navigate 根路径 → 302 到登录页 → 返回 barrier（不导航子系统）
    const launchOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalRoot,
    });
    expect(launchOut.loginStatus).toBe('barrier');
    expect(navigated).toEqual([portalRoot]);
    expect(navigated).not.toContain(subUrl);

    // 用户手动进入子系统后确认 → ok（跨源子系统）
    await engine._setCurrentUrl(subUrl);
    const confirmOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalRoot,
      takeoverAction: 'confirm',
    });
    expect(confirmOut.loginStatus).toBe('ok');
    expect(confirmOut.cookies).toContain('portal=session');
  });

  it('subsystem（credential）：confirm 时仍停留门户登录页（未手动进入子系统）→ 返回 barrier', async () => {
    const portalRoot = 'https://portal.example.com/';
    const loginUrl = 'https://portal.example.com/sxrdtypt/#/login';
    const subUrl = 'https://sub.example.com/console';
    const navigated: string[] = [];
    const engine = makeFakeEngine({
      initialDom: loginFormDom(),
      initialUrl: portalRoot,
      redirectMap: { [portalRoot]: loginUrl },
      domByUrl: { [loginUrl]: loginFormDom(), [subUrl]: loggedInDom() },
      onNavigate: (u) => navigated.push(u),
    });
    const stage = createLoginStage({
      engineFactory: () => engine,
      credentialStoreFactory: () => makeStore({ 'cred-1': { username: 'admin', password: 'pw' } }),
    });
    // launch：打开门户登录页即 barrier（建立接管引擎）
    const launchOut = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalRoot,
    });
    expect(launchOut.loginStatus).toBe('barrier');
    // 用户仍停留登录页就点「确认登录」→ 仍在门户 → barrier，绝不 navigate 子系统
    const out = await stage.run({
      ...baseInput('credential'),
      credentialRef: 'cred-1',
      systemUrl: subUrl,
      parentPortalUrl: portalRoot,
      takeoverAction: 'confirm',
    });
    expect(out.loginStatus).toBe('barrier');
    expect(navigated).not.toContain(subUrl);
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
