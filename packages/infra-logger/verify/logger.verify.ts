/**
 * @file logger.verify.ts
 * @description infra-logger 质量门验证（≥3 测试）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../src/index';
import type { Logger } from '../src/index';

let tmp: string;

beforeEach(() => {
  tmp = path.join(
    os.tmpdir(),
    `infra-logger-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('infra-logger', () => {
  it('写入条目后按 level/scope 查询返回匹配子集', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    logger.info('svc-a', 'started');
    logger.error('svc-a', 'boom');
    logger.warn('svc-b', 'slow');
    await logger.flush();

    expect(logger.query().length).toBe(3);
    expect(logger.query({ level: 'error' }).length).toBe(1);
    expect(logger.query({ scope: 'svc-b' }).length).toBe(1);
    expect(logger.query({ scope: 'svc-a' }).length).toBe(2);
    expect(logger.query({ scope: 'svc-a', level: 'error' })[0]?.message).toBe('boom');
  });

  it('cleanup 删除过期文件并返回正确数量', async () => {
    await mkdir(tmp, { recursive: true });
    const fresh = path.join(tmp, 'app.log');
    const old = path.join(tmp, 'app.log.old');
    await writeFile(fresh, '');
    await writeFile(old, '');
    const tenDaysAgo = Date.now() - 10 * 86_400_000;
    await utimes(old, tenDaysAgo / 1000, tenDaysAgo / 1000);

    const logger: Logger = createLogger({ dir: tmp, retentionDays: 1 });
    const deleted = await logger.cleanup();

    expect(deleted).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('query 按 since 时间戳过滤', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    const before = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    logger.info('t', 'after-ts');
    await logger.flush();

    expect(logger.query().length).toBe(1);
    expect(logger.query({ since: Date.now() + 1000 }).length).toBe(0);
    expect(logger.query({ since: before }).length).toBe(1);
  });
});
