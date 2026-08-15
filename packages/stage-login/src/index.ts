/**
 * @file index.ts
 * @description 登录与跨域 stage（三模式：no-login / credential / manual-takeover）
 * @input LoginInput @output LoginOutput
 * @frozen v1.0
 *
 * 设计要点：
 * - 冻结入口 `run(input)` 复用默认依赖（真实浏览器引擎 + 真实凭证存储）。
 * - `createLoginStage(deps)` 支持依赖注入，供 verify 注入 fake 引擎/凭证，便于 TDD。
 * - McpEngine 冻结接口已含 `getSessionCookies/getSessionHeaders/getSessionTokens/applySession`
 *   四个**必需**方法（登录后捕获门户会话 + 注入子系统上下文复用）。本包 `SessionCapableEngine`
 *   仅为其类型别名，无需可选降级；调用失败由 run 的 catch 显式映射为 `failed`，不静默吞空。
 * - 子系统（`LoginInput.parentPortalUrl` 存在）须先经父门户浏览器会话登录，捕获会话后
 *   再进入子系统 URL，禁止跳过父门户直接 navigate(systemUrl)。
 * - 凭证经 infra-cred 取回明文仅在运行时内存使用，绝不明文落盘。
 */
import { randomUUID } from 'node:crypto';
import type { LoginInput, LoginOutput, SessionHandle } from '@test-platform/contracts';
import { validateLoginInput, validateLoginOutput } from '@test-platform/contracts';
import type { EngineConfig, McpEngine, SemanticNode } from '@test-platform/engine-mcp';
import { createEngine } from '@test-platform/engine-mcp';
import type { CredentialStore, CredConfig } from '@test-platform/infra-cred';
import { createCredentialStore } from '@test-platform/infra-cred';

/** 真实登录会话默认有效期（ms）：8h */
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/** no-login 模式会话窗口（ms）：1d */
const NO_LOGIN_TTL_MS = 24 * 60 * 60 * 1000;
/** 人工接管默认超时（ms）：3min */
const DEFAULT_MANUAL_TIMEOUT_MS = 180_000;
/** 人工接管轮询间隔（ms） */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * 会话捕获/注入引擎：冻结的 McpEngine 已含 cookie/header/token 读取与 applySession 注入，
 * 此处用与 engine-mcp 冻结接口一致的本地声明（方法均为必需），避免对其它包构建产物的耦合；
 * 真实 `createEngine` 返回的 PlaywrightEngine 已实现这些方法（运行时生效）。
 * 缺失即由 run 的 catch 显式映射为 failed，不静默吞空。
 */
export interface SessionCapableEngine extends McpEngine {
  getSessionCookies(): Promise<string[]>;
  getSessionHeaders(): Promise<Record<string, string>>;
  getSessionTokens(): Promise<string[]>;
  applySession(state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }): Promise<void>;
}

export type EngineFactory = (config: EngineConfig) => SessionCapableEngine;

export interface LoginStageDeps {
  /** 浏览器引擎工厂（默认 createEngine；测试注入 fake） */
  engineFactory: EngineFactory;
  /** 凭证存储工厂（默认 createCredentialStore） */
  credentialStoreFactory: (config: CredConfig) => CredentialStore;
  /** 凭证存储配置（默认从环境变量派生） */
  credConfig: CredConfig;
  /** 人工接管超时（ms） */
  manualTimeoutMs: number;
  /** 人工接管轮询间隔（ms） */
  pollIntervalMs: number;
}

/** 登录状态判定结果 */
export interface LoginDetection {
  status: 'ok' | 'barrier' | 'failed';
  reason: string;
}

function defaultCredConfig(): CredConfig {
  return {
    dir: process.env.TEST_PLATFORM_CRED_DIR ?? '.credentials',
    masterKey: process.env.TEST_PLATFORM_MASTER_KEY ?? 'dev-insecure-master-key',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flatten(nodes: SemanticNode[]): SemanticNode[] {
  const out: SemanticNode[] = [];
  for (const n of nodes) {
    out.push(n);
    out.push(...flatten(n.children));
  }
  return out;
}

/**
 * 基于语义 DOM 判定登录结果（系统无关）：
 * - barrier：检测到验证码/MFA，需人补完；或登录表单仍可见（疑似需验证）。
 * - failed：登录表单仍可见且报错（凭据错误）。
 * - ok：已登录信号（退出/个人中心等）或无密码框。
 */
export function detectLoginState(params: { dom: SemanticNode[] }): LoginDetection {
  const flat = flatten(params.dom);
  const textOf = (n: SemanticNode): string => `${n.text ?? ''} ${n.name ?? ''} ${n.selector}`;
  const hasCaptcha = flat.some((n) => /captcha|验证码|滑块|拼图|slide[- ]?verify|rotate/i.test(textOf(n)));
  const hasMfa = flat.some((n) => /mfa|二次验证|短信验证|扫码|scan[- ]?qr|二维码/i.test(textOf(n)));
  const hasPasswordField = flat.some((n) => n.tag === 'INPUT' && n.type === 'password');
  const hasError = flat.some((n) => /错误|失败|不正确|invalid|error|密码错|账号错/i.test(textOf(n)));
  const loggedInSignal = flat.some((n) =>
    /退出|注销|个人中心|我的账户|user[- ]?menu|dashboard|欢迎|已登录/i.test(textOf(n)),
  );

  if (hasCaptcha || hasMfa) return { status: 'barrier', reason: '检测到验证码/MFA，需人工接管' };
  if (hasPasswordField && hasError) return { status: 'failed', reason: '凭据错误，登录表单仍可见' };
  if (hasPasswordField && !loggedInSignal) return { status: 'barrier', reason: '登录表单仍可见，疑似需验证或未完成' };
  if (loggedInSignal || !hasPasswordField) return { status: 'ok', reason: '已登录' };
  return { status: 'failed', reason: '无法确认登录状态' };
}

/**
 * 硬失败判定：登录表单仍可见且报错（凭据错误/错误页），属不可接管的硬失败。
 * 与可接管障碍（验证码/MFA/SSO 卡住）区分——后者 detectLoginState 已返回 'barrier'。
 */
function isHardFailure(dom: SemanticNode[]): boolean {
  const flat = flatten(dom);
  const textOf = (n: SemanticNode): string => `${n.text ?? ''} ${n.name ?? ''} ${n.selector}`;
  const hasPasswordField = flat.some((n) => n.tag === 'INPUT' && n.type === 'password');
  const hasError = flat.some((n) => /错误|失败|不正确|invalid|error|密码错|账号错/i.test(textOf(n)));
  return hasPasswordField && hasError;
}

interface LoginFields {
  username?: SemanticNode;
  password?: SemanticNode;
  submit?: SemanticNode;
}

/** 从语义 DOM 启发式定位账号/密码/提交控件（兼容多数系统的标准 HTML 语义） */
function findLoginFields(dom: SemanticNode[]): LoginFields {
  const flat = flatten(dom);
  const password = flat.find((n) => n.tag === 'INPUT' && n.type === 'password');
  const username =
    flat.find((n) => n.tag === 'INPUT' && /user|account|login|name|账号|用户|邮箱|email/i.test(n.name ?? '')) ??
    flat.find((n) => n.tag === 'INPUT' && (n.type === 'text' || n.type === 'email' || n.type === 'tel'));
  const submit =
    flat.find((n) => (n.tag === 'BUTTON' || n.tag === 'INPUT') && n.type === 'submit') ??
    flat.find((n) => (n.tag === 'BUTTON' || n.tag === 'A') && /登录|提交|log\s*in|sign\s*in|login/i.test(n.text ?? '')) ??
    flat.find((n) => n.tag === 'BUTTON');
  return { username, password, submit };
}

/** 在登录页填充账号密码并提交（基于语义定位，不依赖具体选择器） */
async function fillAndSubmit(engine: SessionCapableEngine, username: string, password: string): Promise<void> {
  const dom = await engine.extractSemanticDom();
  const fields = findLoginFields(dom);
  if (fields.username && fields.password) {
    await engine.runStep({ kind: 'fill', selector: fields.username.selector, value: username });
    await engine.runStep({ kind: 'fill', selector: fields.password.selector, value: password });
  }
  if (fields.submit) {
    await engine.runStep({ kind: 'click', selector: fields.submit.selector });
  }
}

/** 捕获当前浏览器上下文的门户会话（cookies/headers/tokens），供跨子系统复用 */
async function captureSession(engine: SessionCapableEngine): Promise<{
  cookies: string[];
  headers: Record<string, string>;
  tokens: string[];
}> {
  const cookies = await engine.getSessionCookies();
  const headers = await engine.getSessionHeaders();
  const tokens = await engine.getSessionTokens();
  return { cookies, headers, tokens };
}

function buildOutput(opts: {
  systemId: string;
  status: 'ok' | 'barrier' | 'failed';
  cookies: string[];
  tokens?: string[];
  headers?: Record<string, string>;
}): LoginOutput {
  // 非 ok 状态：会话未真正建立，expiresAt 置 0 表示已失效（供消费方判断需重登/接管）。
  const expiresAt = opts.status === 'ok' ? Date.now() + DEFAULT_SESSION_TTL_MS : 0;
  const sessionHandle: SessionHandle = {
    sessionId: randomUUID(),
    systemId: opts.systemId,
    loginStatus: opts.status,
    cookies: opts.cookies,
    headers: opts.headers,
    tokens: opts.tokens,
    expiresAt,
  };
  const out: LoginOutput = {
    sessionHandle,
    loginStatus: opts.status,
    cookies: opts.cookies,
    expiresAt,
  };
  return validateLoginOutput(out);
}

/** no-login：直接返回 ok 会话（无真实鉴权，会话窗口 1d） */
function runNoLogin(input: LoginInput): LoginOutput {
  const expiresAt = Date.now() + NO_LOGIN_TTL_MS;
  const sessionHandle: SessionHandle = {
    sessionId: randomUUID(),
    systemId: input.systemId,
    loginStatus: 'ok',
    cookies: [],
    headers: {},
    expiresAt,
  };
  const out: LoginOutput = { sessionHandle, loginStatus: 'ok', cookies: [], expiresAt };
  return validateLoginOutput(out);
}

/**
 * credential：取凭证 → 启动浏览器 → 导航 → 填账号密码 → 点击登录 → 捕获会话。
 * 子系统（parentPortalUrl 存在）：先经父门户浏览器会话登录，捕获门户会话后
 * 再 navigate(systemUrl) 进入子系统（同源/SSO 上下文已带门户 Cookie，不可跳过）。
 */
async function runCredential(input: LoginInput, deps: LoginStageDeps): Promise<LoginOutput> {
  const { systemId, systemUrl, credentialRef, parentPortalUrl } = input;
  if (!credentialRef) {
    return buildOutput({ systemId, status: 'failed', cookies: [] });
  }
  const store = deps.credentialStoreFactory(deps.credConfig);
  const cred = await store.get(credentialRef);
  if (!cred) {
    return buildOutput({ systemId, status: 'failed', cookies: [] });
  }
  const engine = deps.engineFactory({ headless: true });
  try {
    await engine.launch();
    // 子系统：优先经父门户会话进入；否则直接目标系统
    const entryUrl = parentPortalUrl ?? systemUrl;
    await engine.navigate(entryUrl);
    await fillAndSubmit(engine, cred.username, cred.password);
    if (parentPortalUrl) {
      // 完成父门户登录后，经同一浏览器上下文（已带门户 SSO Cookie）进入子系统
      await engine.navigate(systemUrl);
    }
    const dom = await engine.extractSemanticDom();
    const det = detectLoginState({ dom });
    const session = await captureSession(engine);
    return buildOutput({ systemId, status: det.status, cookies: session.cookies, tokens: session.tokens, headers: session.headers });
  } catch {
    // 引擎/cookie 捕获异常：显式映射 failed，不静默吞空
    return buildOutput({ systemId, status: 'failed', cookies: [] });
  } finally {
    await engine.close().catch(() => undefined);
  }
}

/**
 * manual-takeover：启动**可见浏览器**（manualTakeover） → 导航 →
 * 等待人在同一浏览器补完验证码/SSO → 轮询检测登录成功 → 捕获会话。
 * 子系统（parentPortalUrl 存在）：先在父门户完成登录，再经同一会话进入子系统。
 * 超时仍未登录（仍处 barrier）→ 返回 barrier，由上层决定升级或终止。
 * detect 'failed'：区分硬失败（错误页/凭据错误，不可接管）与可接管障碍（验证码/SSO）。
 */
async function runManualTakeover(input: LoginInput, deps: LoginStageDeps): Promise<LoginOutput> {
  const { systemId, systemUrl, parentPortalUrl } = input;
  const engine = deps.engineFactory({ headless: false, manualTakeover: true });
  let status: 'ok' | 'barrier' | 'failed' = 'barrier';
  try {
    await engine.launch();
    const entryUrl = parentPortalUrl ?? systemUrl;
    await engine.navigate(entryUrl);
    const deadline = Date.now() + deps.manualTimeoutMs;
    let enteredSubsystem = false;
    while (Date.now() < deadline) {
      const dom = await engine.extractSemanticDom();
      const det = detectLoginState({ dom });
      if (parentPortalUrl && !enteredSubsystem) {
        // 子系统：父门户已登录 → 经同一浏览器会话进入子系统后再检测
        if (det.status === 'ok') {
          await engine.navigate(systemUrl);
          enteredSubsystem = true;
          continue;
        }
      } else if (det.status === 'ok') {
        status = 'ok';
        break;
      }
      if (det.status === 'failed') {
        // 硬失败（错误页/凭据错误）不可接管；其余障碍 → barrier
        status = isHardFailure(dom) ? 'failed' : 'barrier';
        break;
      }
      await sleep(deps.pollIntervalMs);
    }
    const session = await captureSession(engine);
    return buildOutput({ systemId, status, cookies: session.cookies, tokens: session.tokens, headers: session.headers });
  } catch {
    return buildOutput({ systemId, status: 'failed', cookies: [] });
  } finally {
    await engine.close().catch(() => undefined);
  }
}

/**
 * 工厂：注入依赖可替换浏览器引擎与凭证存储（测试用）。未提供时使用真实实现。
 */
export function createLoginStage(
  deps: Partial<LoginStageDeps> = {},
): { run: (input: LoginInput) => Promise<LoginOutput> } {
  const resolved: LoginStageDeps = {
    engineFactory: deps.engineFactory ?? ((cfg: EngineConfig) => createEngine(cfg) as unknown as SessionCapableEngine),
    credentialStoreFactory: deps.credentialStoreFactory ?? createCredentialStore,
    credConfig: deps.credConfig ?? defaultCredConfig(),
    manualTimeoutMs: deps.manualTimeoutMs ?? DEFAULT_MANUAL_TIMEOUT_MS,
    pollIntervalMs: deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  };
  async function run(input: LoginInput): Promise<LoginOutput> {
    const valid = validateLoginInput(input);
    switch (valid.mode) {
      case 'no-login':
        return runNoLogin(valid);
      case 'credential':
        return runCredential(valid, resolved);
      case 'manual-takeover':
        return runManualTakeover(valid, resolved);
    }
  }
  return { run };
}

/** 冻结入口：使用默认依赖（真实浏览器 + 真实凭证存储） */
export const run: (input: LoginInput) => Promise<LoginOutput> = (input) => createLoginStage().run(input);

/**
 * 跨域会话复用：将已有父门户 SessionHandle 注入目标子系统引擎上下文。
 * 真正调用 `engine.applySession(cookies/headers/tokens)` 把门户会话应用到子系统浏览器，
 * 实现「门户登录一次各子系统复用」；并据此重定 systemId、刷新过期时间。
 * 消费方（stage-explore 等）可对每个子系统引擎分别调用本函数完成复用进入。
 */
export async function reuseSession(
  handle: SessionHandle,
  targetSystemId: string,
  engine: SessionCapableEngine,
): Promise<SessionHandle> {
  await engine.applySession({ cookies: handle.cookies, headers: handle.headers, tokens: handle.tokens });
  return { ...handle, systemId: targetSystemId, expiresAt: Date.now() + DEFAULT_SESSION_TTL_MS };
}
