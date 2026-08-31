/**
 * @file LoginContract.ts
 * @description 登录与跨域 stage 的 I/O 契约
 * @input LoginInput @output LoginOutput
 * @frozen v1.0
 */
import type { SessionHandle } from '../types/SystemConfig';

/** 输入（冻结） */
export interface LoginInput {
  /** 项目 ID */
  projectId: string;
  /** 目标系统 ID（登录以系统为单位） */
  systemId: string;
  /** 登录方式（三选一，所有类型一致；取 System.credentialMode，项目管理中配置，弹窗只读带入） */
  mode: 'no-login' | 'credential' | 'manual-takeover';
  /** safeStorage 凭证 ID（mode ≠ no-login 时必填） */
  credentialRef?: string;
  /** 系统 URL（必填；子系统 URL 经父门户浏览器捕获） */
  systemUrl: string;
  /** 父门户 URL（仅 type=subsystem，用于经父门户会话进入子系统） */
  parentPortalUrl?: string;
  /** 人工接管动作：launch=启动浏览器(默认)，confirm=确认登录状态 */
  takeoverAction?: 'launch' | 'confirm';
  /** 用户名（用于自动存储凭证） */
  username?: string;
  /** 密码（用于自动存储凭证） */
  password?: string;
}

/** 输出（冻结） */
export interface LoginOutput {
  /** 会话句柄 */
  sessionHandle: SessionHandle;
  /** 登录状态 */
  loginStatus: 'ok' | 'barrier' | 'failed';
  /** Cookie 列表 */
  cookies: string[];
  /** 过期时间戳（ms） */
  expiresAt: number;
}

/** run 函数签名（冻结） */
export type LoginRun = (input: LoginInput) => Promise<LoginOutput>;
