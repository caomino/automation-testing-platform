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
 * - 子系统（`LoginInput.parentPortalUrl` 存在）采用 D:\test 人工接管模式：launch 仅打开
 *   门户登录页（可选自动填充提交）即返回 barrier；用户在浏览器完成门户登录并【手动进入
 *   子系统】后点击「确认登录」，confirm 以当前页为子系统入口（绝不 navigate 走），
 *   orchestrator 将当前 URL 记录为 capturedUrl 供探索阶段复用（登录与探索均停留在
 *   子系统上下文）。禁止自动跳转子系统：跳转目标可能被历史登录污染为门户工作台 URL。
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
 * （此处再导出类型别名，供本包 verify 及下游以 `@test-platform/stage-login` 引用）
 */
export type { SessionCapableEngine } from '@test-platform/engine-mcp';
export type { CredentialStore } from '@test-platform/infra-cred';

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
 * 检测 entryUrl 是否指向子系统（非门户页面）。移植自 D:\test mcpManualLogin.isSubsystemEntryUrl。
 *
 * 检测策略：
 * 1. 不同 origin（协议/主机/端口）→ 确定是子系统（兼容跨源入口）；
 * 2. 相同 origin：与 targetUrl（子系统入口）**pathname 前缀匹配（忽略 hash）** → 视为
 *    在子系统（SPA 兼容：子系统深页/业务页与配置入口 hash 不同仍算在子系统内，
 *    信任用户手动导航，与 D:\test 语义一致）；
 * 3. 其他（同源但 pathname 不匹配 / 无 targetUrl）→ 不是子系统（仍在门户）。
 *
 * 权衡说明（为什么忽略 hash）：门户登录后工作台与子系统常为**同域同 path、仅 hash 路由
 * 不同**的 SPA（如门户工作台 #/sy vs 子系统 #/manager）。若把 hash 纳入匹配，用户在子系统
 * 的**业务深页**（hash 与配置入口不同，如 #/manager/list）就会被误判为「仍在门户」→ 一直
 * barrier 无法确认。用户采用**手动导航 + 确认登录**的信任模型（D:\test 同款），故此处
 * 以 pathname 前缀为准、忽略 hash；「门户工作台被记成子系统」的旧架构教训由「用户手动
 * 确认」覆盖——用户确认时所在页即视为子系统入口，capturedUrl 记录真实所在页。
 *
 * @param entryUrl  浏览器当前 URL（用户点击「确认登录」时所在页）
 * @param portalUrl 门户（登录源）URL
 * @param targetUrl 子系统目标入口 URL（systemUrl），可为空
 */
export function isSubsystemEntryUrl(
  entryUrl: string | undefined,
  portalUrl: string | undefined,
  targetUrl?: string | undefined,
): boolean {
  if (!entryUrl || !portalUrl) return false;
  try {
    const entry = new URL(entryUrl);
    const portal = new URL(portalUrl);
    // 1. 跨源入口（协议、主机或端口不同）确定是子系统。
    if (entry.origin !== portal.origin) return true;
    // 2. 同主机、无 targetUrl → 无法确认在子系统（守卫：拒绝把门户页记为子系统入口）。
    if (!targetUrl) return false;
    const target = new URL(targetUrl);
    // 2a. targetUrl 跨源而当前仍在门户源 → 不在子系统。
    if (target.origin !== portal.origin) return false;
    // 2b. 同源：pathname 前缀匹配（忽略 hash，SPA 兼容，见上方权衡说明）。
    const entryPath = entry.pathname.replace(/\/+$/, '') || '/';
    const targetPath = target.pathname.replace(/\/+$/, '') || '/';
    return entryPath === targetPath || entryPath.startsWith(targetPath + '/');
  } catch {
    return false;
  }
}

/**
 * 等待页面 URL 稳定（连续 `URL_STABLE_CHECKS` 次读到同一 URL 视为重定向链结束）。
 *
 * 为什么必需：真实门户常见「根路径 → 302/SPA 路由 → 登录页」的**异步**重定向。
 * 若在 navigate 后固定 sleep 800ms 就取 URL 作为「登录页基准」，基准会落在根路径上，
 * 后续的「实际登录页」基准（供子系统 isSubsystemEntryUrl 判定门户源）就取不到。
 * 同理，点击提交后也需等页面稳定再检测登录态。
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
    // 注册到接管引擎 Map，使 orchestrator 层「已登录复用」短路生效（避免反复登录）。
    // 与 credential/manual-takeover 一致：浏览器保持打开，会话随浏览器存活。
    activeTakeoverEngines.set(systemId, {
      engine,
      createdAt: Date.now(),
      systemId,
    });
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
    // 等待重定向链结束再取「实际登录页」基准 URL（如根路径 → sxrdtypt/#/login）。
    // 真实门户常见「根路径 → SPA 路由 → 登录页」的**异步**重定向：若固定 sleep 800ms
    // 就取 URL，基准会落在根路径，后续子系统 isSubsystemEntryUrl 会把门户工作台误判为
    // 子系统页（同域同路径、仅 hash 不同时）。
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

    // 存储浏览器实例（barrier 时供用户接管 confirm）
    activeTakeoverEngines.set(systemId, {
      engine,
      createdAt: Date.now(),
      systemId,
      portalLoginPageUrl: loginPageUrl,
    });

    // 子系统（D:\test 人工接管模式）：launch 仅打开门户登录页（上方已自动填充提交）
    // 即返回 barrier。绝不等待门户登录、绝不自动导航子系统——跳转目标可能被历史登录
    // 污染为门户工作台 URL。用户在浏览器完成门户登录并【手动进入子系统】后点击
    // 「确认登录」，confirm 以当前页为子系统入口（绝不 navigate）。
    if (parentPortalUrl) {
      console.log(`[stage-login] subsystem launch done for ${systemId}, portal login page opened, returning barrier for manual entry`);
      return buildOutput({
        systemId,
        status: 'barrier',
        cookies: [],
        loginMode: 'credential',
        detectionReason: '请在浏览器完成门户登录并手动进入子系统后，点击「确认登录」',
      });
    }

    // 单系统：复用 confirm 逻辑检测登录态（自动提交后可能直接 ok）
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
 *   - 启动可见浏览器 → 导航 → 有凭证则自动填充并提交 → 存储浏览器实例
 *   - 返回 barrier，等待用户在浏览器中完成登录（含验证码）
 *   - 子系统（parentPortalUrl 存在）仅打开门户登录页即 barrier（D:\test 模式）
 *
 * Step 2 (takeoverAction='confirm'):
 *   - 从 Map 中取出已存在的浏览器实例 → 判定登录状态 → 捕获会话
 *   - 返回 ok/failed/barrier
 *
 * 浏览器实例最多保留 15 分钟，超时自动清理；浏览器本身永不关闭。
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

    // 存储浏览器实例（barrier 时供用户接管 confirm）
    activeTakeoverEngines.set(systemId, {
      engine,
      createdAt: Date.now(),
      systemId,
      portalLoginPageUrl: loginPageUrl,
    });

    // 子系统（D:\test 人工接管模式）：launch 仅打开门户登录页即返回 barrier，
    // 绝不等待门户登录、绝不自动导航子系统。用户在浏览器完成门户登录并【手动进入
    // 子系统】后点击「确认登录」，confirm 以当前页为子系统入口（绝不 navigate）。
    if (parentPortalUrl) {
      console.log(`[stage-login] subsystem launch done for ${systemId}, portal login page opened, returning barrier for manual entry`);
      return buildOutput({
        systemId,
        status: 'barrier',
        cookies: [],
        loginMode: 'manual-takeover',
        detectionReason: '请在浏览器完成门户登录并手动进入子系统后，点击「确认登录」',
      });
    }

    // 单系统：复用 confirm 逻辑检测登录态（自动提交后可能直接 ok）
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
 * 从存储的浏览器实例中检测登录状态，捕获会话。
 *
 * 子系统（parentPortalUrl 存在）采用**信任模型**（全程不 navigate）：用户在浏览器完成
 * 门户登录并手动进入子系统后点击「确认登录」。由于子系统是门户 SPA 的 webview/iframe
 * 嵌入页（顶层 URL 与配置 systemUrl 的 pathname 永远不同），**不再做 URL 匹配**，
 * 仅以当前页登录态判定：已离开登录表单（detectLoginState → ok）= 门户会话有效、
 * 信任用户已在子系统，当前 URL 即子系统入口（capturedUrl 由 orchestrator 记录）；
 * 仍显示登录表单/验证码 = barrier（提示完成登录后再次确认）。
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
    if (parentPortalUrl) {
      // 子系统（**信任模型**，经用户确认）：门户已登录（当前页已离开登录表单）即视为
      // 用户已手动进入子系统。为什么不再做 URL 匹配：子系统的真实形态是门户 SPA 的
      // webview/iframe 嵌入页（如顶层 URL typtnew/dist/#/gnzx/webview?openUrl=...，
      // iframe 内才是 typtnew/qymldepartment.action），顶层 URL 的 pathname 与配置的
      // systemUrl（如 typtnew/sxrdtypt/#/sy）**永远不同**，任何 URL 匹配都会把已进入
      // 子系统的用户误判为「仍在门户」→ 永久 barrier。信任模型改为：
      // 1. 当前页仍显示登录表单（密码框/验证码）→ 门户未登录 → barrier；
      // 2. 已离开登录表单 → 信任用户在子系统，当前 URL 即子系统入口，由 orchestrator
      //    记录为 capturedUrl（探索导航该 URL 即自动加载子系统 iframe）。
      const dom = await extractDomWithRetry(engine);
      const det = detectLoginState({ dom });
      if (det.status === 'ok') {
        status = 'ok';
        detectionReason = '已在子系统，门户会话有效';
      } else {
        status = 'barrier';
        detectionReason = `当前页面仍需处理：${det.reason}；请在浏览器完成登录后再次点击「确认登录」`;
      }
    } else {
      // 单系统/门户：直接检测登录状态。带重试：提交后若页面仍在跳转，
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
