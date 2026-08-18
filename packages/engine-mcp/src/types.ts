/**
 * @file types.ts
 * @description engine-mcp DOM 语义抽象层类型 — 框架无关，只读标准 HTML 语义
 * @frozen v1.0 — 适配 95% 系统的核心抽象，类型只允许加可选字段
 */
import type { ModuleNode, CaseRow, ExecutionStepResult, ScreenshotRef, ExploredElement } from '@test-platform/contracts';
import type { AIClient } from '@test-platform/infra-ai';

/** 语义化 DOM 节点（不依赖 Vue/React/jQuery，只读标准 HTML 语义；70 项矩阵落点） */
export interface SemanticNode {
  /** 标签名（div/button/input/table/a/form/select/li...） */
  tag: string;
  /** aria role（如有） */
  role?: string;
  /** 可见文本（截断至 200 字） */
  text?: string;
  /** 表单 name / aria-label / title（可空） */
  name?: string;
  /** input/select/button 类型 */
  type?: string;
  /** input placeholder 文本 */
  placeholder?: string;
  /** 稳定 CSS selector（优先 id → data-* → 位置路径） */
  selector: string;
  /** href（链接） */
  href?: string;
  /** 子节点 */
  children: SemanticNode[];
  /** 视口矩形 */
  rect?: { x: number; y: number; w: number; h: number };
  /** 是否可交互（点击/输入/选择） */
  interactive: boolean;
  /** 是否数据写操作控件（input/textarea/提交按钮等；只读模式红线禁用） */
  isDataControl: boolean;
}

/** 浏览器原子命令 */
export type BrowserCommand =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; selector: string }
  | { kind: 'fill'; selector: string; value: string }
  | { kind: 'select'; selector: string; value: string }
  | { kind: 'press'; selector: string; key: string }
  | { kind: 'wait'; selector: string }
  | { kind: 'screenshot'; path: string }
  | { kind: 'dom'; selector?: string };

/** 引擎类型：mcp（通过 @playwright/mcp 代理）| direct（Playwright 直连） */
export type EngineType = 'mcp' | 'direct';

/** 引擎配置 */
export interface EngineConfig {
  /** 引擎类型：mcp（通过 MCP 工具）| direct（Playwright 直连） */
  engineType?: EngineType;
  /** 无头模式 */
  headless: boolean;
  /** 浏览器可执行路径（复用已装 chromium；缺省由 Playwright 自动定位） */
  executablePath?: string;
  /** 视口 */
  viewport?: { width: number; height: number };
  /** 超时（ms） */
  timeoutMs?: number;
  /** 只读探索模式：禁止任何数据写操作（陕西人大红线） */
  readOnly?: boolean;
  /** 人为接管登录的可见浏览器（遇验证码/SSO 时人在同一浏览器补完） */
  manualTakeover?: boolean;
  /** MCP Server 启动命令（仅 engineType=mcp 时生效） */
  mcpCommand?: string;
  /** MCP Server 启动参数（仅 engineType=mcp 时生效） */
  mcpArgs?: string[];
  /** Playwright Storage State（包含 cookies、localStorage 等会话信息） */
  /** 用于在不同阶段（Login -> Explore -> Feature -> Case）之间复用登录状态 */
  storageState?: PlaywrightStorageState;
  /** 所属子系统 ID（探索产出 ModuleNode 的 subsystemId 来源） */
  subsystemId?: string;
  /** 系统 ID（探索产出 ModuleNode 的 system 根节点标识） */
  systemId?: string;
  /** 可选 AI 客户端：仅在调用方显式注入时启用（受应用层 AI 开关门控），不注入则纯结构化探索 */
  ai?: AIClient;
}

/** Playwright Storage State 类型定义 */
export interface PlaywrightStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

/** MCP 引擎接口（冻结）— 所有 stage 经此控制浏览器 */
export interface McpEngine {
  /** 启动浏览器 */
  launch(): Promise<void>;
  /** 导航 */
  navigate(url: string): Promise<void>;
  /** DOM 语义抽象：抓取当前页语义化节点树（框架无关） */
  extractSemanticDom(rootSelector?: string): Promise<SemanticNode[]>;
  /** 探索：返回模块树（供 stage-explore 消费） */
  exploreModules(): Promise<ModuleNode[]>;
  /** 二次探索：提取指定 URL 页面的可交互元素（供 stage-case 生成真实用例） */
  extractPageElements(url?: string): Promise<ExploredElement[]>;
  /** 执行单条浏览器命令 */
  runStep(cmd: BrowserCommand): Promise<ExecutionStepResult>;
  /** 执行一条用例（解析步骤/操作，供 stage-execute 消费） */
  runCase(row: CaseRow): Promise<ExecutionStepResult[]>;
  /** 截图 */
  screenshot(path: string): Promise<ScreenshotRef>;
  /** 获取当前 Storage State（用于跨阶段会话复用） */
  getStorageState(): Promise<PlaywrightStorageState>;
  /** 获取当前页面 URL */
  getCurrentUrl(): Promise<string>;
  /** 提取当前会话 Cookie（登录后捕获，供跨子系统复用门户会话） */
  getSessionCookies(): Promise<string[]>;
  /** 提取当前会话请求头（含鉴权头，供复用） */
  getSessionHeaders(): Promise<Record<string, string>>;
  /** 提取当前会话 Token（localStorage/sessionStorage，供复用） */
  getSessionTokens(): Promise<string[]>;
  /**
   * 抓取当前页面全部 localStorage + sessionStorage（任意 key，不限固定白名单）。
   * 用于跨重载会话保持：context.storageState() 不抓取 sessionStorage，而 sessionStorage
   * 在完整 page.goto 重载后必然清空且无法靠外部回灌恢复，故需本方法额外捕获。
   */
  getAllStorageTokens(): Promise<Array<{ storage: 'local' | 'session'; name: string; value: string }>>;
  /**
   * 注册页面初始化脚本：在每次导航/页面脚本执行前注入，可在 SPA 启动前写回会话存储，
   * 从而跨重载无失真恢复登录态（含 sessionStorage）。arg 作为唯一参数传入脚本。
   */
  addInitScript(fn: (arg?: unknown) => void, arg?: unknown): Promise<void>;
  /** 注入复用会话（将门户会话的 cookies/headers/tokens 应用到当前上下文，实现跨子系统复用） */
  applySession(state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }): Promise<void>;
  /** 等待指定毫秒数（用于 SPA 渲染/页面跳转等待） */
  waitForTimeout(ms: number): Promise<void>;
  /** 在页面上下文执行任意表达式（用于人工补录点击录制等场景） */
  evaluate<T = any>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
  /** 关闭 */
  close(): Promise<void>;
}

/**
 * 会话捕获/注入引擎接口 — 扩展 McpEngine，确保会话管理方法可用
 * 所有真实引擎（PlaywrightEngine / McpPlaywrightAdapter）均实现此接口
 */
export interface SessionCapableEngine extends McpEngine {
  getSessionCookies(): Promise<string[]>;
  getSessionHeaders(): Promise<Record<string, string>>;
  getSessionTokens(): Promise<string[]>;
  applySession(state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }): Promise<void>;
  /** 检查当前页面是否有登录表单（可选，用于会话复用判断） */
  hasLoginForm?(): Promise<boolean>;
  /** 导航并确保会话有效：先检查已登录，再应用保存的会话（可选，用于会话复用） */
  ensureSession?(
    url: string,
    sessionState?: { cookies?: string[]; headers?: Record<string, string>; tokens?: string[] }
  ): Promise<{ loggedIn: boolean; method: 'reuse' | 'applied' | 'anonymous' }>;
}

/**
 * 浏览器捕获引擎接口 — 扩展 SessionCapableEngine，支持 URL/标题/导航路径捕获
 * 用于子系统 URL 浏览器捕获场景（项目管理 → 子系统类型 → 打开浏览器捕获）
 */
export interface CaptureEngine extends SessionCapableEngine {
  /** 获取当前页面标题 */
  getCurrentTitle(): Promise<string>;
  /** 获取导航路径（从父门户到当前页面的 URL 列表） */
  getNavigationPath(): Promise<string[]>;
}

// --- MCP 适配器扩展类型 ---

/** @playwright/mcp 工具名 */
export type McpToolName =
  | 'browser_navigate'
  | 'browser_navigate_back'
  | 'browser_navigate_forward'
  | 'browser_reload'
  | 'browser_snapshot'
  | 'browser_click'
  | 'browser_hover'
  | 'browser_drag'
  | 'browser_type'
  | 'browser_fill_form'
  | 'browser_select_option'
  | 'browser_check'
  | 'browser_uncheck'
  | 'browser_press_key'
  | 'browser_wait_for'
  | 'browser_tabs'
  | 'browser_handle_dialog'
  | 'browser_take_screenshot'
  | 'browser_cookies'
  | 'browser_cookies_set'
  | 'browser_localstorage_get_all'
  | 'browser_localstorage_set'
  | 'browser_storage_state'
  | 'browser_network_requests'
  | 'browser_evaluate'
  | 'browser_console_messages';

/** MCP 工具调用参数（通用） */
export interface McpToolCallParams {
  [key: string]: unknown;
}

/** MCP 工具调用结果 */
export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** browser_snapshot 返回的节点条目 */
export interface McpSnapshotEntry {
  /** ref 标识（如 e15） */
  ref: string;
  /** 元素描述（如 'button "Submit"'） */
  description: string;
  /** 是否可交互 */
  interactive: boolean;
  /** 元素类型 */
  element?: string;
}

export type { ExploredElement };
