/**
 * @file SystemConfig.ts
 * @description 系统/项目/会话类型 — 底层单系统模型（主规格 §18）
 * @contract 主规格 §18.1/§18.2
 * @frozen v1.0
 */

/** 系统类型：类型只决定登录方式与 URL 来源，不存在"登录路径"模型 */
export type SystemType = 'portal' | 'standalone' | 'subsystem';

/** 登录方式（三选一，所有类型一致，每系统独立设置） */
export type CredentialMode = 'no-login' | 'credential' | 'manual-takeover';

/** 会话句柄 */
export interface SessionHandle {
  /** 会话 ID */
  sessionId: string;
  /** 关联系统 ID */
  systemId: string;
  /** 登录状态 */
  loginStatus: 'ok' | 'barrier' | 'failed';
  /** Cookie 列表 */
  cookies: string[];
  /** 会话头 */
  headers?: Record<string, string>;
  /** Token */
  tokens?: string[];
  /** 过期时间戳（ms） */
  expiresAt: number;
  /** 登录时间戳（ms） */
  loginAt?: number;
  /** 登录模式 */
  loginMode?: 'no-login' | 'credential' | 'manual-takeover';
  /** 登录状态检测原因 */
  detectionReason?: string;
  /** Cookie 数量统计 */
  cookieCount?: number;
  /** Header 数量统计 */
  headerCount?: number;
  /** Token 数量统计 */
  tokenCount?: number;
  /** 会话持续时间（ms，从登录到过期） */
  ttlMs?: number;
}

/** 会话状态（子系统注册时捕获，不止 URL） */
export interface SessionState {
  cookies?: string[];
  headers?: Record<string, string>;
  tokens?: string[];
}

/** 系统（底层都是单系统，type 只决定登录方式与 URL 来源） */
export interface System {
  /** 系统 ID */
  id: string;
  /** 系统名称 */
  name: string;
  /** 系统访问 URL（subsystem = 经父门户浏览器捕获；其余手动输入） */
  url: string;
  /** 系统类型 */
  type: SystemType;
  /** 页面标题（浏览器捕获） */
  pageTitle?: string;
  /** type=subsystem 必填：父门户系统 ID（可跨项目） */
  parentPortalId?: string;
  /** type=subsystem 只读展示：父门户内进入路径 */
  parentPortalPath?: string;
  /** 登录方式三选一，每系统独立设置 */
  credentialMode: CredentialMode;
  /** credentialMode ≠ no-login 时：用户名 + safeStorage 凭证引用 */
  credentials?: { username: string; credentialRef: string };
  /** 会话状态 */
  sessionState?: SessionState;
  /** 导航路径（从门户到子系统的点击路径） */
  navigationPath?: string[];
  /** 登录状态 */
  loginState: 'logged_out' | 'logged_in';
  /** 各阶段进度 */
  progress: { explored: boolean; featured: boolean; cased: boolean; executed: boolean };
  /** 接入时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * @deprecated v1.5 起统一用 `System`（`type: 'subsystem'`）。保留别名仅为兼容契约 §1.3.1 导出签名。
 * 子系统本质就是 `System` 的一个特例，不应单独建模（避免"登录路径"模型）。
 */
export type SubsystemConfig = System & { type: 'subsystem' };

/** 项目（一个项目 = 多个系统） */
export interface Project {
  /** 项目 ID */
  id: string;
  /** 项目名称 */
  name: string;
  /** 项目描述 */
  description: string;
  /** 项目类型（历史遗留，v1.5 后以 System.type 为准） */
  type: SystemType;
  /** 系统列表 */
  systems: System[];
  /** 日志保留天数 */
  logRetentionDays: number;
  /** AI 辅助是否启用 */
  aiAssistEnabled: boolean;
  /** 当前选中的系统 ID */
  activeSystemId?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}
