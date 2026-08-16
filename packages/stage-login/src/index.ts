/**
 * @file index.ts
 * @description 登录与跨域 stage（三模式：no-login / credential / manual-takeover）
 * @input LoginInput @output LoginOutput
 * @frozen v1.1
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
 * - 人工接管采用两步式：launch=启动浏览器返回 barrier；confirm=确认登录状态。
 *   浏览器实例通过模块级 Map 跨请求保存，支持用户在浏览器中完成登录后手动确认。
 */
import { randomUUID } from 'node:crypto';
import type { LoginInput, LoginOutput, SessionHandle } from '@test-platform/contracts';
import { validateLoginInput, validateLoginOutput } from '@test-platform/contracts';
import type { EngineConfig, SemanticNode, SessionCapableEngine } from '@test-platform/engine-mcp';
import { createEngine } from '@test-platform/engine-mcp';
import type { CredentialStore, CredConfig } from '@test-platform/infra-cred';
import { createCredentialStore } from '@test-platform/infra-cred';
import type { ProjectStore } from '@test-platform/infra-store';

/** 真实登录会话默认有效期（ms）：8h */
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/** no-login 模式会话窗口（ms）：1d */
const NO_LOGIN_TTL_MS = 24 * 60 * 60 * 1000;
/** 人工接管默认超时（ms）：10min */
const DEFAULT_MANUAL_TIMEOUT_MS = 600_000;
/** 人工接管轮询间隔（ms） */
const DEFAULT_POLL_INTERVAL_MS = 2000;
/** 人工接管浏览器最大存活时间（ms）：15min，超时自动关闭 */
const TAKEOVER_ENGINE_TTL_MS = 15 * 60 * 1000;

/**
 * 活动的人工接管浏览器实例
 * key: systemId, value: { engine, createdAt }
 */
interface TakeoverEntry {
  engine: SessionCapableEngine;
  createdAt: number;
  systemId: string;
}
const activeTakeoverEngines = new Map<string, TakeoverEntry>();

/** 清理过期的浏览器实例（仅从 Map 中移除，不关闭浏览器） */
function cleanupExpiredEngines(): void {
  const now = Date.now();
  for (const [key, entry] of activeTakeoverEngines) {
    if (now - entry.createdAt > TAKEOVER_ENGINE_TTL_MS) {
      console.log(`[stage-login] Expired takeover engine removed from tracking for ${entry.systemId} (browser keeps running)`);
      activeTakeoverEngines.delete(key);
    }
  }
}

/** 定期清理（每 2 分钟） */
setInterval(cleanupExpiredEngines, 2 * 60 * 1000).unref?.();

/** 强制关闭指定系统的浏览器（已禁用 - 浏览器永不关闭） */
export function closeTakeoverEngine(systemId: string): void {
  const entry = activeTakeoverEngines.get(systemId);
  if (entry) {
    console.log(`[stage-login] closeTakeoverEngine called for ${systemId} - browser keeps running`);
  }
}

/**
 * 获取指定系统的人工接管（已登录）浏览器引擎，供后续阶段（探索/执行）复用会话。
 * 登录成功后引擎保留在 Map 中，浏览器保持打开状态，会话随浏览器存活。
 */
export function getTakeoverEngine(systemId: string): SessionCapableEngine | undefined {
  cleanupExpiredEngines();
  const entry = activeTakeoverEngines.get(systemId);
  if (entry) {
    // 滑动续期：命中即刷新时间戳，避免长时间探索/执行途中过期被清理
    entry.createdAt = Date.now();
    console.log(`[stage-login] takeover engine reuse hit for ${systemId}`);
    return entry.engine;
  }
  return undefined;
}

/**
 * 会话捕获/注入引擎接口：使用 engine-mcp 导出的 SessionCapableEngine
 * （扩展 McpEngine + 4 个会话方法），保证跨 stage 类型一致
 */

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
  /** 项目数据存储（用于会话持久化） */
  store?: ProjectStore;
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

export function sleep(ms: number): Promise<void> {
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
  const textOf = (n: SemanticNode): string => `${n.text ?? ''} ${n.name ?? ''} ${n.placeholder ?? ''} ${n.selector}`;
  const hasCaptcha = flat.some((n) => /captcha|验证码|滑块|拼图|slide[- ]?verify|rotate|校验码/i.test(textOf(n)));
  const hasMfa = flat.some((n) => /mfa|二次验证|短信验证|扫码|scan[- ]?qr|二维码/i.test(textOf(n)));
  const hasPasswordField = flat.some((n) => n.tag === 'INPUT' && n.type === 'password');
  const hasCaptchaInput = flat.some((n) => n.tag === 'INPUT' && n.type !== 'password' && /code|captcha|verify|valid|check/i.test(`${n.name ?? ''} ${n.placeholder ?? ''}`));
  
  const hasLoginError = flat.some((n) => 
    /账号.{0,5}错误|密码.{0,5}错误|账号.{0,5}不存在|用户.{0,5}不存在|账号.{0,5}禁用|密码.{0,5}不正确|invalid.{0,5}(username|password|credentials)|incorrect.{0,5}(password|credentials)|login.{0,5}failed|authentication.{0,5}failed/i.test(textOf(n))
  );
  
  const loggedInSignal = flat.some((n) =>
    /退出|退出登录|注销|个人中心|我的账户|user[- ]?menu|dashboard|控制台|工作台|系统管理|系统监控/i.test(textOf(n)),
  );

  const hasMinimalContent = flat.filter((n) => n.text && n.text.trim().length > 0).length < 3;

  if (hasCaptcha || hasCaptchaInput || hasMfa) return { status: 'barrier', reason: '检测到验证码/MFA，需人工接管' };
  if (hasPasswordField && hasLoginError) return { status: 'failed', reason: '凭据错误，登录表单仍可见' };
  if (hasPasswordField && !loggedInSignal) return { status: 'barrier', reason: '登录表单仍可见，疑似需验证或未完成' };
  if (!hasPasswordField && !loggedInSignal && hasMinimalContent) return { status: 'barrier', reason: 'SPA 页面未渲染完成' };
  if (loggedInSignal || (!hasPasswordField && !hasMinimalContent)) return { status: 'ok', reason: '已登录' };
  return { status: 'failed', reason: '无法确认登录状态' };
}

/**
 * 硬失败判定：登录表单仍可见且报错（凭据错误/错误页），属不可接管的硬失败。
 * 与可接管障碍（验证码/MFA/SSO 卡住）区分——后者 detectLoginState 已返回 'barrier'。
 */
export function isHardFailure(dom: SemanticNode[]): boolean {
  const flat = flatten(dom);
  const textOf = (n: SemanticNode): string => `${n.text ?? ''} ${n.name ?? ''} ${n.selector}`;
  const hasPasswordField = flat.some((n) => n.tag === 'INPUT' && n.type === 'password');
  // 更精确的错误检测
  const hasLoginError = flat.some((n) => 
    /账号.{0,5}错误|密码.{0,5}错误|账号.{0,5}不存在|用户.{0,5}不存在|账号.{0,5}禁用|密码.{0,5}不正确|invalid.{0,5}(username|password|credentials)|incorrect.{0,5}(password|credentials)|login.{0,5}failed|authentication.{0,5}failed/i.test(textOf(n))
  );
  return hasPasswordField && hasLoginError;
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
export async function fillAndSubmit(engine: SessionCapableEngine, username: string, password: string): Promise<void> {
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
  loginMode?: 'no-login' | 'credential' | 'manual-takeover';
  detectionReason?: string;
}): LoginOutput {
  // 非 ok 状态：会话未真正建立，expiresAt 置 0 表示已失效（供消费方判断需重登/接管）。
  const now = Date.now();
  const ttlMs = opts.status === 'ok' ? DEFAULT_SESSION_TTL_MS : 0;
  const expiresAt = opts.status === 'ok' ? now + ttlMs : 0;
  const sessionHandle: SessionHandle = {
    sessionId: randomUUID(),
    systemId: opts.systemId,
    loginStatus: opts.status,
    cookies: opts.cookies,
    headers: opts.headers,
    tokens: opts.tokens,
    expiresAt,
    loginAt: opts.status === 'ok' ? now : undefined,
    loginMode: opts.loginMode,
    detectionReason: opts.detectionReason,
    cookieCount: opts.cookies.length,
    headerCount: opts.headers ? Object.keys(opts.headers).length : 0,
    tokenCount: opts.tokens ? opts.tokens.length : 0,
    ttlMs: opts.status === 'ok' ? ttlMs : undefined,
  };
  const out: LoginOutput = {
    sessionHandle,
    loginStatus: opts.status,
    cookies: opts.cookies,
    expiresAt,
  };
  
  // 输出会话统计信息
  if (opts.status === 'ok') {
    console.log(`[stage-login] Session established: system=${opts.systemId}, cookies=${sessionHandle.cookieCount}, headers=${sessionHandle.headerCount}, tokens=${sessionHandle.tokenCount}, ttl=${ttlMs}ms`);
  }
  
  return validateLoginOutput(out);
}

/**
 * no-login：打开浏览器 → 导航 URL → 直接捕获会话（无需凭证）
 * 统一行为：所有模式都必须先打开浏览器
 */
async function runNoLogin(input: LoginInput, deps: LoginStageDeps): Promise<LoginOutput> {
  const systemId = input.systemId;
  const systemUrl = input.systemUrl;
  const parentPortalUrl = input.parentPortalUrl;

  console.log(`[stage-login] no-login launch: system=${systemId}, url=${systemUrl}, parentPortalUrl=${parentPortalUrl}`);

  if (!systemUrl) {
    console.error(`[stage-login] no-login failed: systemUrl missing for ${systemId}`);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'no-login', detectionReason: '系统 URL 未配置' });
  }

  // 打开浏览器（统一行为：所有模式都必须先打开浏览器）
  const engine = deps.engineFactory({ headless: false, manualTakeover: true });

  try {
    await engine.launch();
    console.log(`[stage-login] no-login browser launched for ${systemId}`);

    // 对于子系统，先导航到父门户 URL
    const entryUrl = parentPortalUrl ?? systemUrl;
    console.log(`[stage-login] navigating to ${entryUrl}`);
    await engine.navigate(entryUrl);
    console.log(`[stage-login] navigated to ${entryUrl}`);

    // 等待页面加载
    await sleep(800);

    // 直接捕获会话（no-login 模式无需凭证，直接捕获当前浏览器状态）
    const session = await captureSession(engine);
    console.log(`[stage-login] no-login session captured: cookies=${session.cookies.length}, headers=${Object.keys(session.headers).length}`);

    const now = Date.now();
    const ttlMs = NO_LOGIN_TTL_MS;
    const expiresAt = now + ttlMs;
    const sessionHandle: SessionHandle = {
      sessionId: randomUUID(),
      systemId,
      loginStatus: 'ok',
      cookies: session.cookies,
      headers: session.headers,
      tokens: session.tokens,
      expiresAt,
      loginAt: now,
      loginMode: 'no-login',
      detectionReason: '免登录模式，已打开浏览器并捕获会话',
      cookieCount: session.cookies.length,
      headerCount: Object.keys(session.headers).length,
      tokenCount: session.tokens.length,
      ttlMs,
    };
    const out: LoginOutput = { sessionHandle, loginStatus: 'ok', cookies: session.cookies, expiresAt };

    // 持久化会话
    if (deps.store) {
      try {
        await deps.store.saveSession(systemId, sessionHandle);
        console.log(`[stage-login] no-login session saved for ${systemId}`);
      } catch (err) {
        console.warn(`[stage-login] failed to save no-login session for ${systemId}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[stage-login] Session established (no-login): system=${systemId}, cookies=${session.cookies.length}, ttl=${ttlMs}ms`);
    return validateLoginOutput(out);
  } catch (err) {
    console.error(`[stage-login] no-login failed for ${systemId}:`, err instanceof Error ? err.message : err);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'no-login', detectionReason: err instanceof Error ? err.message : '启动浏览器失败' });
  }
  // 注意：浏览器永不关闭，保持可视状态
}

/**
 * credential：两步式账号密码登录
 *
 * Step 1 (takeoverAction='launch' 或首次调用):
 *   - 启动可见浏览器 → 导航 → 自动填充凭证（不提交）→ 存储浏览器实例
 *   - 返回 barrier，等待用户在浏览器中完成登录（点击提交、处理验证码等）
 *
 * Step 2 (takeoverAction='confirm'):
 *   - 从 Map 中取出已存在的浏览器实例 → 检测登录状态 → 捕获会话
 *   - 返回 ok/failed
 */
async function runCredential(input: LoginInput, deps: LoginStageDeps): Promise<LoginOutput> {
  const { systemId, systemUrl, credentialRef, parentPortalUrl, takeoverAction } = input;
  const action = takeoverAction ?? 'launch';

  console.log(`[stage-login] credential launch: system=${systemId}, url=${systemUrl}, action=${action}`);

  if (action === 'confirm') {
    return confirmManualLogin(systemId, systemUrl, parentPortalUrl, deps, 'credential');
  }

  // Step 1: launch
  if (!systemUrl) {
    console.error(`[stage-login] credential launch failed: systemUrl missing for ${systemId}`);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'credential', detectionReason: '系统 URL 未配置' });
  }
  // credential 模式必须提供凭证引用（契约层缺省时此处显式抛出，便于上层识别为「输入错误」）
  if (!credentialRef) {
    throw new Error('credentialRef 未配置：credential 模式必须提供凭证引用');
  }

  const store = deps.credentialStoreFactory(deps.credConfig);
  const cred = await store.get(credentialRef);
  if (!cred) {
    console.error(`[stage-login] credential launch failed: credential not found for ref ${credentialRef}`);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'credential', detectionReason: '凭证引用无效' });
  }

  // 如果已有该系统的浏览器实例，仅替换引用
  const existing = activeTakeoverEngines.get(systemId);
  if (existing) {
    console.log(`[stage-login] Replacing existing engine reference for ${systemId} (old browser keeps running)`);
    activeTakeoverEngines.delete(systemId);
  }

  const engine = deps.engineFactory({ headless: false, manualTakeover: true });

  try {
    await engine.launch();
    console.log(`[stage-login] credential browser launched for ${systemId}`);

    const entryUrl = parentPortalUrl ?? systemUrl;
    console.log(`[stage-login] navigating to ${entryUrl}`);
    await engine.navigate(entryUrl);
    await sleep(800);

    // 自动填充凭证并提交（credential 模式：尝试自动登录，而非停在 barrier 等人工）
    try {
      await fillAndSubmit(engine, cred.username, cred.password);
      console.log(`[stage-login] auto-filled credentials + submitted for credential mode: ${systemId}`);
    } catch (fillErr) {
      console.warn(`[stage-login] auto-fill/submit failed: ${fillErr instanceof Error ? fillErr.message : fillErr}`);
    }
    await sleep(800);

    // 子系统：门户登录后进入子系统 URL，再统一检测登录态
    if (parentPortalUrl && systemUrl) {
      console.log(`[stage-login] navigating to subsystem ${systemUrl}`);
      await engine.navigate(systemUrl);
      await sleep(600);
    }

    // 存储浏览器实例（barrier 时供用户接管 confirm）
    activeTakeoverEngines.set(systemId, { engine, createdAt: Date.now(), systemId });

    // 复用 confirm 逻辑：检测登录态 + (子系统)跳转 + 捕获会话 → ok/failed/barrier
    const out = await confirmManualLogin(systemId, systemUrl, parentPortalUrl, deps, 'credential');
    console.log(`[stage-login] credential login result for ${systemId}: ${out.loginStatus}`);
    return out;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[stage-login] credential launch failed for ${systemId}:`, errorMsg);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'credential', detectionReason: `登录失败: ${errorMsg}` });
  }
  // 注意：浏览器永不关闭，保持可视状态
}

/**
 * manual-takeover：两步式人工接管
 *
 * Step 1 (takeoverAction='launch' 或首次调用):
 *   - 启动可见浏览器 → 导航 → 自动填充凭证（不提交）→ 存储浏览器实例
 *   - 返回 barrier，等待用户在浏览器中完成登录
 *
 * Step 2 (takeoverAction='confirm'):
 *   - 从 Map 中取出已存在的浏览器实例 → 检测登录状态 → 捕获会话
 *   - 返回 ok/failed，并关闭浏览器
 *
 * 浏览器实例最多保留 15 分钟，超时自动清理。
 */
async function runManualTakeover(input: LoginInput, deps: LoginStageDeps): Promise<LoginOutput> {
  const { systemId, systemUrl, parentPortalUrl, credentialRef, takeoverAction } = input;
  const action = takeoverAction ?? 'launch';

  console.log(`[stage-login] manual-takeover launch: system=${systemId}, url=${systemUrl}, action=${action}`);

  if (action === 'confirm') {
    return confirmManualLogin(systemId, systemUrl, parentPortalUrl, deps, 'manual-takeover');
  }

  // Step 1: launch
  if (!systemUrl) {
    console.error(`[stage-login] manual-takeover launch failed: systemUrl missing for ${systemId}`);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'manual-takeover', detectionReason: '系统 URL 未配置' });
  }

  // 如果已有该系统的浏览器实例，仅替换引用（不关闭旧浏览器）
  const existing = activeTakeoverEngines.get(systemId);
  if (existing) {
    console.log(`[stage-login] Replacing existing takeover engine reference for ${systemId} (old browser keeps running)`);
    activeTakeoverEngines.delete(systemId);
  }

  const engine = deps.engineFactory({ headless: false, manualTakeover: true });

  // 获取凭证用于自动填充
  let credUsername: string | null = null;
  let credPassword: string | null = null;
  if (credentialRef) {
    try {
      const store = deps.credentialStoreFactory(deps.credConfig);
      const cred = await store.get(credentialRef);
      if (cred) {
        credUsername = cred.username;
        credPassword = cred.password;
      }
    } catch {
      console.warn(`[stage-login] failed to get credential for manual-takeover: ${credentialRef}`);
    }
  }

  try {
    await engine.launch();
    console.log(`[stage-login] manual-takeover browser launched for ${systemId}`);
    
    const entryUrl = parentPortalUrl ?? systemUrl;
    console.log(`[stage-login] navigating to ${entryUrl}`);
    await engine.navigate(entryUrl);
    await sleep(800);

    // 有凭证时自动填充并提交（尝试自动登录）；无凭证则直接进入人工接管流程
    if (credUsername && credPassword) {
      try {
        await fillAndSubmit(engine, credUsername, credPassword);
        console.log(`[stage-login] auto-filled credentials + submitted for manual-takeover: ${systemId}`);
      } catch (fillErr) {
        console.warn(`[stage-login] auto-fill/submit failed: ${fillErr instanceof Error ? fillErr.message : fillErr}`);
      }
    }
    await sleep(800);

    // 子系统：门户登录后进入子系统 URL
    if (parentPortalUrl && systemUrl) {
      console.log(`[stage-login] navigating to subsystem ${systemUrl}`);
      await engine.navigate(systemUrl);
      await sleep(600);
    }

    // 存储浏览器实例（barrier 时供用户接管 confirm）
    activeTakeoverEngines.set(systemId, { engine, createdAt: Date.now(), systemId });

    // 复用 confirm 逻辑：检测登录态 + (子系统)跳转 + 捕获会话 → ok/failed/barrier
    const out = await confirmManualLogin(systemId, systemUrl, parentPortalUrl, deps, 'manual-takeover');
    console.log(`[stage-login] manual-takeover login result for ${systemId}: ${out.loginStatus}`);
    return out;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[stage-login] manual takeover launch failed for ${systemId}:`, errorMsg);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'manual-takeover', detectionReason: `登录失败: ${errorMsg}` });
  }
  // 注意：浏览器永不关闭，保持可视状态
}

/**
 * Step 2: 确认登录状态
 * 从存储的浏览器实例中检测登录状态，捕获会话
 */
async function confirmManualLogin(
  systemId: string,
  systemUrl: string | undefined,
  parentPortalUrl: string | undefined,
  deps: LoginStageDeps,
  loginMode: 'credential' | 'manual-takeover' = 'manual-takeover',
): Promise<LoginOutput> {
  const entry = activeTakeoverEngines.get(systemId);
  if (!entry) {
    console.log(`[stage-login] no active takeover engine for ${systemId}, cannot confirm login`);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode, detectionReason: '无活跃浏览器实例' });
  }

  const { engine } = entry;
  let status: 'ok' | 'barrier' | 'failed' = 'barrier';
  let detectionReason = '';

  try {
    // 如果是子系统，先检查父门户是否已登录
    if (parentPortalUrl) {
      const dom = await engine.extractSemanticDom();
      const det = detectLoginState({ dom });
      detectionReason = det.reason;
      if (det.status === 'ok' && systemUrl) {
        await engine.navigate(systemUrl);
        // 再次检测子系统登录状态
        const dom2 = await engine.extractSemanticDom();
        const det2 = detectLoginState({ dom: dom2 });
        status = det2.status;
        detectionReason = det2.reason;
      } else {
        status = det.status === 'failed' ? 'failed' : 'barrier';
      }
    } else {
      // 直接检测登录状态
      const dom = await engine.extractSemanticDom();
      const det = detectLoginState({ dom });
      status = det.status;
      detectionReason = det.reason;
    }

    console.log(`[stage-login] ${systemId} confirm login: status=${status}, reason=${detectionReason}`);

    if (status === 'ok') {
      const session = await captureSession(engine);
      const output = buildOutput({ 
        systemId, 
        status, 
        cookies: session.cookies, 
        tokens: session.tokens, 
        headers: session.headers,
        loginMode,
        detectionReason,
      });

      if (deps.store) {
        try {
          await deps.store.saveSession(systemId, output.sessionHandle);
          console.log(`[stage-login] ${loginMode} session saved for system ${systemId}`);
        } catch (err) {
          console.warn(`[stage-login] failed to save session for ${systemId}:`, err instanceof Error ? err.message : err);
        }
      }

      // 登录成功：保留引擎引用（供探索/执行阶段复用会话），浏览器保持打开
      console.log(`[stage-login] ${loginMode} login successful for ${systemId}, engine kept for session reuse`);

      return output;
    } else if (status === 'barrier') {
      // 仍需人工干预，浏览器保持打开
      console.log(`[stage-login] ${systemId} still requires manual intervention: ${detectionReason}`);
      return buildOutput({ systemId, status: 'barrier', cookies: [], loginMode, detectionReason });
    } else {
      // 登录失败，从 Map 中移除引用，但浏览器保持打开
      console.log(`[stage-login] ${systemId} login failed: ${detectionReason}`);
      activeTakeoverEngines.delete(systemId);
      return buildOutput({ systemId, status: 'failed', cookies: [], loginMode, detectionReason });
    }
  } catch (err) {
    console.error(`[stage-login] confirm login failed for ${systemId}:`, err instanceof Error ? err.message : err);
    activeTakeoverEngines.delete(systemId);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode, detectionReason: '检测异常' });
  }
  // 注意：浏览器永不关闭，保持可视状态
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
    store: deps.store,
  };
  async function run(input: LoginInput): Promise<LoginOutput> {
    const valid = validateLoginInput(input);
    switch (valid.mode) {
      case 'no-login':
        return runNoLogin(valid, resolved);
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
