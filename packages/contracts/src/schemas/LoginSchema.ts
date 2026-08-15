/**
 * @file LoginSchema.ts
 * @description LoginInput/Output 的 zod schema（运行时校验）
 * @frozen v1.0
 */
import { z } from 'zod';
import type { LoginInput, LoginOutput } from '../stages/LoginContract';

export const LoginInputSchema = z.object({
  projectId: z.string().min(1, 'projectId 必填'),
  systemId: z.string().min(1, 'systemId 必填'),
  mode: z.enum(['no-login', 'credential', 'manual-takeover']),
  credentialRef: z.string().optional(),
  systemUrl: z.string().url('systemUrl 必须是合法 URL'),
  parentPortalUrl: z.string().url().optional(),
});

export const SessionHandleSchema = z.object({
  sessionId: z.string(),
  systemId: z.string(),
  loginStatus: z.enum(['ok', 'barrier', 'failed']),
  cookies: z.array(z.string()),
  headers: z.record(z.string()).optional(),
  tokens: z.array(z.string()).optional(),
  expiresAt: z.number(),
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
