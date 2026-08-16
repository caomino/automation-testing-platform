/**
 * @file LoginSchema.ts
 * @description LoginInput/Output 的 zod schema（运行时校验）
 * @frozen v1.0
 */
import { z } from 'zod';
import type { LoginInput, LoginOutput } from '../stages/LoginContract';

export const LoginInputSchema = z
  .object({
    projectId: z.string().min(1, 'projectId 必填'),
    systemId: z.string().min(1, 'systemId 必填'),
    mode: z.enum(['no-login', 'credential', 'manual-takeover']),
    credentialRef: z.string().optional(),
    systemUrl: z.string().url('systemUrl 必须是合法 URL'),
    parentPortalUrl: z.string().url().optional(),
    takeoverAction: z.enum(['launch', 'confirm']).optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .refine(
    (data) => data.mode === 'no-login' || data.mode === 'manual-takeover' || !!data.credentialRef?.trim(),
    {
      message: 'credentialRef 在 mode = credential 时必填',
      path: ['credentialRef'],
    },
  )
  .refine(
    (data) => {
      if (data.parentPortalUrl) {
        return data.parentPortalUrl !== data.systemUrl;
      }
      return true;
    },
    {
      message: 'parentPortalUrl 须与 systemUrl 不同',
      path: ['parentPortalUrl'],
    },
  );

export const SessionHandleSchema = z.object({
  sessionId: z.string(),
  systemId: z.string(),
  loginStatus: z.enum(['ok', 'barrier', 'failed']),
  cookies: z.array(z.string()),
  headers: z.record(z.string()).optional(),
  tokens: z.array(z.string()).optional(),
  expiresAt: z.number(),
  loginAt: z.number().optional(),
  loginMode: z.enum(['no-login', 'credential', 'manual-takeover']).optional(),
  detectionReason: z.string().optional(),
  cookieCount: z.number().optional(),
  headerCount: z.number().optional(),
  tokenCount: z.number().optional(),
  ttlMs: z.number().optional(),
});

export const LoginOutputSchema = z.object({
  sessionHandle: SessionHandleSchema,
  loginStatus: z.enum(['ok', 'barrier', 'failed']),
  cookies: z.array(z.string()),
  expiresAt: z.number(),
});

export function validateLoginInput(v: unknown): LoginInput {
  return LoginInputSchema.parse(v);
}
export function validateLoginOutput(v: unknown): LoginOutput {
  return LoginOutputSchema.parse(v);
}
