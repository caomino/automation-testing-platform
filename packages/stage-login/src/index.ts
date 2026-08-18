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
/** 子系统自动登录检测窗口（ms）：fillAndSubmit 后等待父门户 URL 路径变化（登录成功）的最大时长。
 * 原 5s 太短：用户输入账号/密码/验证码必然超过，导致 launch 阶段「登录成功后自动跳转子系统」
 * 从未生效——waitForPortalLoginSuccess 超时返回 barrier，之后无任何自动跳转逻辑，
 * 用户只能手动跳转子系统页，正是「子系统登录未跳转、停留门户」的直接原因。
 * 放宽到 90s，覆盖真实人工登录（含验证码）耗时；超时仍返回 barrier 等待用户确认。 */
const DEFAULT_PORTAL_LOGIN_WAIT_MS = 90_000;
/** 人工接管浏览器最大存活时间（ms）：15min，超时自动关闭 */
const TAKEOVER_ENGINE_TTL_MS = 15 * 60 * 1000;
/**
 * DOM 提取重试次数：提交登录后页面处于导航/重定向中时，`page.evaluate` 会抛
 * "Execution context was destroyed"，属**瞬时**异常而非登录失败，必须重试而非判死。
 */
const DOM_EXTRACT_RETRIES = 3;
/** DOM 提取重试间隔（ms） */
const DOM_EXTRACT_RETRY_DELAY_MS = 1200;
/** URL 稳定判定：连续读到相同 URL 的次数（判定重定向链已结束） */
const URL_STABLE_CHECKS = 2;
/** URL 稳定判定：单次轮询间隔（ms） */
const URL_STABLE_INTERVAL_MS = 400;
/** URL 稳定判定：最大等待（ms）。SPA 异步重定向（如根路径 → #/login）通常在 2s 内完成 */
const URL_STABLE_TIMEOUT_MS = 6000;

/**
 * 活动的人工接管浏览器实例
 * key: systemId, value: { engine, createdAt }
 */
interface TakeoverEntry {
  engine: SessionCapableEngine;
  createdAt: number;
  systemId: string;
  /** 父门户实际登录页 URL（navigate 后重定向稳定），作为「路径变化 = 登录成功」的基准 */
  portalLoginPageUrl?: string;
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
  /** 子系统自动登录检测窗口（ms）：fillAndSubmit 后等待父门户 URL 路径变化的最大时长 */
  portalLoginWaitMs: number;
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
 * 归一化 URL 用于「路径变化」比较：取 host + pathname + hash，忽略协议/端口/query。
 * 登录页 → 登录后主页（如 /login → /dashboard，或 #/login → #/home）会被判定为路径变化。
 */
export function normalizePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.hash}`;
  } catch {
    return url.trim();
  }
}

/**
 * 等待页面 URL 稳定（连续 `URL_STABLE_CHECKS` 次读到同一 URL 视为重定向链结束）。
 *
 * 为什么必需：真实门户常见「根路径 → 302/SPA 路由 → 登录页」的**异步**重定向。
 * 若在 navigate 后固定 sleep 800ms 就取 URL 作为「登录页基准」，基准会落在根路径上，
 * 随后那次迟到的重定向本身就构成「路径变化」，被 `isPortalLoggedIn` 误判为登录成功，
 * 从而在门户尚未登录时提前跳转子系统。同理，点击提交后也需等页面稳定再检测登录态。
 *
 * @returns 稳定后的当前 URL；`getCurrentUrl` 不可用时返回空串（调用方回退到入口 URL）
 */
export async function waitForUrlStable(
  engine: SessionCapableEngine,
  timeoutMs: number = URL_STABLE_TIMEOUT_MS,
  intervalMs: number = URL_STABLE_INTERVAL_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  let sameCount = 0;
  while (Date.now() < deadline) {
    let cur = '';
    try {
      cur = await engine.getCurrentUrl();
    } catch {
      // 导航中读取失败：视为未稳定，继续轮询
      cur = '';
    }
    if (cur && cur === lastUrl) {
      sameCount += 1;
      if (sameCount >= URL_STABLE_CHECKS) return cur;
    } else {
      sameCount = cur ? 1 : 0;
      lastUrl = cur;
    }
    await sleep(intervalMs);
  }
  return lastUrl;
}

/**
 * 带重试的语义 DOM 提取。
 *
 * 为什么必需：登录提交后页面正在导航时，`extractSemanticDom` 底层的 `page.evaluate`
 * 会抛 "Execution context was destroyed, most likely because of a navigation"。
 * 这是**页面正在成功跳转**的表现，绝不能当成登录失败——旧实现在此异常上直接判
 * `failed` 并删除引擎引用，导致「浏览器实际已登录、平台却报登录失败且无法恢复」。
 *
 * @throws 重试仍全部失败时抛出最后一次错误，由调用方按「可接管障碍」处理
 */
export async function extractDomWithRetry(
  engine: SessionCapableEngine,
  retries: number = DOM_EXTRACT_RETRIES,
  delayMs: number = DOM_EXTRACT_RETRY_DELAY_MS,
): Promise<SemanticNode[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await engine.extractSemanticDom();
    } catch (err) {
      lastErr = err;
      console.warn(
        `[stage-login] extractSemanticDom attempt ${attempt}/${retries} failed: ${err instanceof Error ? err.message : err}`,
      );
      if (attempt < retries) await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('extractSemanticDom failed');
}

/**
 * 判断父门户是否已登录成功（子系统进入前的前置闸门）。
 * 只认 URL 路径变化（离开登录页 = 登录成功）。不用 DOM 关键词判断——
 * 门户首页常含「工作台/控制台/系统管理」等词，DOM 检测会把未登录的门户首页误判为已登录。
 * URL 路径未变化即视为仍在登录页（未登录 / 待验证码 / 待人工点击登录）。
 */
export async function isPortalLoggedIn(engine: SessionCapableEngine, portalLoginUrl: string): Promise<boolean> {
  const basePath = normalizePath(portalLoginUrl);
  try {
    const curUrl = await engine.getCurrentUrl();
    return !!(curUrl && normalizePath(curUrl) !== basePath);
  } catch {
    // getCurrentUrl 失败视为未登录
    return false;
  }
}

/**
 * 轮询等待父门户登录成功（URL 路径变化），用于子系统 launch 阶段的自动登录检测。
 * 超时未登录返回 false（应转为 barrier 等待人工接管）。
 */
export async function waitForPortalLoginSuccess(
  engine: SessionCapableEngine,
  portalLoginUrl: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortalLoggedIn(engine, portalLoginUrl)) return true;
    await sleep(pollIntervalMs);
  }
  return false;
}

/**
 * 子系统进入前置闸门：等待父门户登录成功（URL 从登录页路径变化）后导航到子系统。
 * 基准不是 parentPortalUrl（可能只是门户根路径，navigate 后 302 重定向到登录页），
 * 而是实际登录页 URL `loginPageUrl`（navigate 后重定向稳定，如根路径 → sxrdtypt/#/login）。
 * - 父门户已登录（路径从登录页变化，如 #/login → #/home）→ 导航到 systemUrl，返回 undefined；
 * - 父门户未登录 → 返回 barrier LoginOutput，并把登录页基准写入 entry 供 confirm 阶段复用。
 * 绝不在父门户登录未完成时跳转子系统，避免用户「来不及点击登录」就被带走。
 */
async function enterSubsystemAfterPortalLogin(
  systemId: string,
  systemUrl: string | undefined,
  loginPageUrl: string | undefined,
  engine: SessionCapableEngine,
  deps: LoginStageDeps,
  loginMode: 'credential' | 'manual-takeover',
): Promise<LoginOutput | undefined> {
  if (!loginPageUrl || !systemUrl) return undefined;

  const portalLoggedIn = await waitForPortalLoginSuccess(
    engine,
    loginPageUrl,
    deps.portalLoginWaitMs,
    deps.pollIntervalMs,
  );
  if (!portalLoggedIn) {
    activeTakeoverEngines.set(systemId, {
      engine,
      createdAt: Date.now(),
      systemId,
      portalLoginPageUrl: loginPageUrl,
    });
    console.log(`[stage-login] portal login not yet succeeded for ${systemId}, returning barrier for manual takeover`);
    return buildOutput({
      systemId,
      status: 'barrier',
      cookies: [],
      loginMode,
      detectionReason: '父门户登录未完成，请在浏览器完成登录后点击「确认登录」',
    });
  }

  console.log(`[stage-login] portal login succeeded, navigating to subsystem ${systemUrl}`);
  await engine.navigate(systemUrl);
  await sleep(600);
  return undefined;
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
    return confirmManualLogin(systemId, systemUrl, parentPortalUrl, deps, 'credential', true);
  }

  // Step 1: launch
  if (!systemUrl) {
    console.error(`[stage-login] credential launch failed: systemUrl missing for ${systemId}`);
    return buildOutput({ systemId, status: 'failed', cookies: [], loginMode: 'credential', detectionReason: '系统 URL 未配置' });
  }
  // 不再于「启动浏览器之前」抛错：credential 模式允许「未挂凭证引用」，
  // 此时先打开浏览器、由用户在浏览器中手动登录（降级为人工接管），
  // 满足需求「点击登录按钮第一步先打开浏览器；账号密码模式再自动填入」。
  // 方案 X：优先采用前端会话态直接传入的 username/password 自动填充（不落库）；
  // 否则兼容旧路径：按 credentialRef 从凭证库取（用于 storageState/历史 capture）。
  let cred: { username: string; password: string } | null = null;
  if (input.username && input.password) {
    cred = { username: input.username, password: input.password };
    console.log(`[stage-login] 使用会话态账号密码自动填充: system=${systemId}`);
  } else if (credentialRef) {
    try {
      const store = deps.credentialStoreFactory(deps.credConfig);
      const fetched = await store.get(credentialRef);
      if (fetched) {
        cred = { username: fetched.username, password: fetched.password };
      } else {
        console.warn(`[stage-login] credentialRef ${credentialRef} 无对应凭证，将打开浏览器由用户手动登录`);
      }
    } catch (e) {
      console.warn(`[stage-login] 读取凭证 ${credentialRef} 失败: ${e instanceof Error ? e.message : e}（降级为手动登录）`);
    }
  } else {
    console.warn(`[stage-login] credential 模式但未配置账号密码或凭证引用（system=${systemId}），将打开浏览器由用户手动登录`);
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
    // 等待重定向链结束再取「实际登录页」基准 URL。真实门户常见「根路径 → SPA 路由 → 登录页」
    // 的**异步**重定向：若固定 sleep 800ms 就取 URL，基准会落在根路径，随后那次迟到的重定向
    // 本身构成「路径变化」，被 isPortalLoggedIn 误判为「父门户已登录成功」，从而在用户尚未登录时
    // 提前跳转子系统（与 §18.1「底层单系统、登录方式差异」相悖，且踩中冻结用例忌讳的误跳转）。
    const loginPageUrl = (await waitForUrlStable(engine)) || entryUrl;
    console.log(`[stage-login] resolved login page url: ${loginPageUrl}`);

    // 自动填充凭证并提交（仅当存在有效凭证；否则等待用户在浏览器中手动登录）
    if (cred) {
      try {
        await fillAndSubmit(engine, cred.username, cred.password);
        console.log(`[stage-login] auto-filled credentials + submitted for credential mode: ${systemId}`);
      } catch (fillErr) {
        console.warn(`[stage-login] auto-fill/submit failed: ${fillErr instanceof Error ? fillErr.message : fillErr}`);
      }
    } else {
      console.log(`[stage-login] 无可用凭证，跳过自动填充，等待用户在浏览器中手动登录`);
    }
    await sleep(800);

    // 子系统：先等待父门户登录成功（URL 从登录页路径变化），再进入子系统；
    // 绝不在父门户登录未完成时跳转子系统（否则用户「来不及点击登录」就被带走）
    if (parentPortalUrl && systemUrl) {
      const barrierOut = await enterSubsystemAfterPortalLogin(
        systemId,
        systemUrl,
        loginPageUrl,
        engine,
        deps,
        'credential',
      );
      if (barrierOut) return barrierOut;
    }

    // 存储浏览器实例（barrier 时供用户接管 confirm）
    activeTakeoverEngines.set(systemId, {
      engine,
      createdAt: Date.now(),
      systemId,
      portalLoginPageUrl: loginPageUrl,
    });

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
    return confirmManualLogin(systemId, systemUrl, parentPortalUrl, deps, 'manual-takeover', true);
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
    // 等待重定向链结束再取「实际登录页」基准 URL（理由同 runCredential：避免 SPA 异步
    // 重定向使基准落在根路径，被误判为「父门户已登录成功」而提前跳转子系统）。
    const loginPageUrl = (await waitForUrlStable(engine)) || entryUrl;
    console.log(`[stage-login] resolved login page url: ${loginPageUrl}`);

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

    // 子系统：先等待父门户登录成功（URL 从登录页路径变化），再进入子系统
    if (parentPortalUrl && systemUrl) {
      const barrierOut = await enterSubsystemAfterPortalLogin(
        systemId,
        systemUrl,
        loginPageUrl,
        engine,
        deps,
        'manual-takeover',
      );
      if (barrierOut) return barrierOut;
    }

    // 存储浏览器实例（barrier 时供用户接管 confirm）
    activeTakeoverEngines.set(systemId, {
      engine,
      createdAt: Date.now(),
      systemId,
      portalLoginPageUrl: loginPageUrl,
    });

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
 *
 * @param isUserConfirm 是否来自用户显式点击「确认登录」（takeoverAction='confirm'）。
 *   launch 流程内部复用本函数时为 false，用于守住「父门户登录判定只认 URL 路径变化」
 *   的冻结行为；用户显式确认时为 true，允许以「导航子系统的结果」验证门户会话，
 *   避免门户登录后 URL 不变的真实系统永久卡在 barrier（子系统永不跳转）。
 */
async function confirmManualLogin(
  systemId: string,
  systemUrl: string | undefined,
  parentPortalUrl: string | undefined,
  deps: LoginStageDeps,
  loginMode: 'credential' | 'manual-takeover' = 'manual-takeover',
  isUserConfirm = false,
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
    // 如果是子系统，先检查父门户是否已登录（URL 从登录页路径变化）。
    // 基准优先用 entry 里保存的「实际登录页 URL」（navigate 后重定向稳定），
    // 而非 parentPortalUrl（可能只是门户根路径，重定向会误判为路径变化）。
    if (parentPortalUrl) {
      const portalBaseUrl = entry.portalLoginPageUrl ?? parentPortalUrl;
      const portalLoggedIn = await isPortalLoggedIn(engine, portalBaseUrl);
      // 关键修复：用户确认登录时可能已人工跳转到子系统/应用页（URL 已离开登录页）。
      // 此时**保留当前页**，绝不再 navigate(systemUrl) —— 否则会把浏览器从子系统页
      // 拉回门户闸门/工作台（systemUrl 往往只是门户根路径），导致后续探索门户而非子系统。
      // 判定：当前 URL 已离开「登录页基准」且与目标 systemUrl **同源**（都在门户 SPA 内，
      // 如门户工作台 #/sy 与子系统 #/manager 同源不同 hash）→ 视为已在应用页，保留当前页，
      // capturedUrl 记录用户真实所在页而非门户工作台。
      // 若与目标**跨源**（真正从门户跳转到独立子系统域名）→ 仍需 navigate(systemUrl)。
      let curUrl = '';
      try { curUrl = await engine.getCurrentUrl(); } catch { curUrl = ''; }
      let sameApp = false;
      try {
        sameApp = !!curUrl && !!systemUrl && new URL(curUrl).origin === new URL(systemUrl).origin;
      } catch { sameApp = false; }
      const alreadyOnAppPage =
        !!curUrl &&
        curUrl !== portalBaseUrl &&
        normalizePath(curUrl) !== normalizePath(portalBaseUrl) &&
        sameApp;
      if (alreadyOnAppPage) {
        // 已在应用页（用户人工跳转或门户登录后自然跳转）：直接检测当前页登录态，不导航
        console.log(`[stage-login] ${systemId} already on app page (${curUrl}), keep current page, skip navigate to ${systemUrl}`);
        const domNow = await extractDomWithRetry(engine);
        const detNow = detectLoginState({ dom: domNow });
        status = detNow.status;
        detectionReason = detNow.reason;
      } else if (portalLoggedIn && systemUrl) {
        await engine.navigate(systemUrl);
        // 等重定向链结束再检测，避免在跳转中途取到登录页/空白页
        await waitForUrlStable(engine);
        const dom2 = await extractDomWithRetry(engine);
        const det2 = detectLoginState({ dom: dom2 });
        status = det2.status;
        detectionReason = det2.reason;
      } else if (isUserConfirm && systemUrl) {
        // 用户已显式确认「已在浏览器完成登录」，但父门户 URL 路径未变化。
        // 真实门户大量存在这种形态：登录成功后仍停留同一 hash 路由 / 同一首页 URL。
        // 此时若继续只靠 URL 猜测，会永久返回 barrier —— 子系统永远等不到跳转（死锁）。
        // 改为**以导航结果验证**：打开子系统 → 不再出现登录表单即证明门户会话有效。
        console.log(
          `[stage-login] ${systemId} portal url unchanged on user confirm, verifying portal session via subsystem navigation`,
        );
        await engine.navigate(systemUrl);
        await waitForUrlStable(engine);
        const domSub = await extractDomWithRetry(engine);
        const detSub = detectLoginState({ dom: domSub });
        status = detSub.status;
        detectionReason =
          detSub.status === 'ok' ? '父门户会话有效，已进入子系统' : `子系统仍需登录：${detSub.reason}`;
        if (detSub.status !== 'ok') {
          // 验证未通过：退回父门户，便于用户继续完成门户登录后再次确认
          await engine.navigate(portalBaseUrl).catch(() => {});
        }
      } else {
        // 父门户仍未登录成功（仍停留登录页 / 需验证码）
        const dom = await extractDomWithRetry(engine);
        const det = detectLoginState({ dom });
        status = det.status === 'failed' ? 'failed' : 'barrier';
        detectionReason = det.reason;
      }
    } else {
      // 直接检测登录状态（门户/单系统）。带重试：提交后若页面仍在跳转，
      // extractSemanticDom 会因执行上下文被销毁而抛错，属瞬时态而非登录失败。
      const dom = await extractDomWithRetry(engine);
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
      // 登录失败（凭据错误等硬失败）。**保留引擎引用**：浏览器仍打开，用户可在同一
      // 窗口改用正确账号重新登录后再次「确认登录」。旧实现在此 delete 引用，导致
      // 用户重试时必然收到「无活跃浏览器实例」的二次 failed，且探索阶段也拿不到登录浏览器。
      console.log(`[stage-login] ${systemId} login failed: ${detectionReason}（engine kept for retry）`);
      return buildOutput({ systemId, status: 'failed', cookies: [], loginMode, detectionReason });
    }
  } catch (err) {
    // 检测过程异常：绝大多数是「页面正在跳转导致 evaluate 执行上下文销毁」，
    // 此时浏览器仍存活、且往往登录已经成功。必须按**可接管障碍**处理：
    // 保留引擎引用 + 返回 barrier，让用户再点一次「确认登录」即可完成。
    // 旧实现在此判 failed 并删除引擎，是「登录完成: failed」的直接根因。
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[stage-login] confirm login detection incomplete for ${systemId} (browser kept): ${msg}`);
    return buildOutput({
      systemId,
      status: 'barrier',
      cookies: [],
      loginMode,
      detectionReason: `登录状态检测未完成（${msg}）；若已在浏览器完成登录，请再次点击「确认登录」`,
    });
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
    portalLoginWaitMs: deps.portalLoginWaitMs ?? DEFAULT_PORTAL_LOGIN_WAIT_MS,
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
