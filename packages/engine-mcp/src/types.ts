/**
 * @file types.ts
 * @description engine-mcp DOM 语义抽象层类型 — 框架无关，只读标准 HTML 语义
 * @frozen v1.0 — 适配 95% 系统的核心抽象，类型只允许加可选字段
 */
import type { ModuleNode, CaseRow, ExecutionStepResult, ScreenshotRef } from '@test-platform/contracts';

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

/** 引擎配置 */
export interface EngineConfig {
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
  /** 执行单条浏览器命令 */
  runStep(cmd: BrowserCommand): Promise<ExecutionStepResult>;
  /** 执行一条用例（解析步骤/操作，供 stage-execute 消费） */
  runCase(row: CaseRow): Promise<ExecutionStepResult[]>;
  /** 截图 */
  screenshot(path: string): Promise<ScreenshotRef>;
  /** 提取当前会话 Cookie（登录后捕获，供跨子系统复用门户会话） */
  getSessionCookies(): Promise<string[]>;
  /** 提取当前会话请求头（含鉴权头，供复用） */
  getSessionHeaders(): Promise<Record<string, string>>;
  /** 提取当前会话 Token（localStorage/sessionStorage，供复用） */
  getSessionTokens(): Promise<string[]>;
  /** 注入复用会话（将门户会话的 cookies/headers/tokens 应用到当前上下文，实现跨子系统复用） */
  applySession(state: { cookies: string[]; headers?: Record<string, string>; tokens?: string[] }): Promise<void>;
  /** 关闭 */
  close(): Promise<void>;
}
