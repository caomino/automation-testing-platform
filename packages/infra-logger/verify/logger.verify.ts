/**
 * @file logger.verify.ts
 * @description infra-logger 质量门验证（≥3 测试）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
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
  // ── 现有测试 ──

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

  // ── 正向测试 ──

  it('日志滚动：单文件超限后自动轮转', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7, maxFileSize: 300 });
    for (let i = 0; i < 10; i++) {
      logger.info('roll', `message-${i}`);
    }
    await logger.flush();

    const files = await readdir(tmp);
    const logFiles = files.filter((f) => f.startsWith('app.log'));
    expect(logFiles.length).toBeGreaterThanOrEqual(2);
    expect(logger.query().length).toBe(10);
  });

  it('meta 参数正确写入并可查询', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    const meta = { userId: 'u-001', action: 'login', duration: 1234 };
    logger.info('auth', 'user logged in', meta);
    await logger.flush();

    const entries = logger.query({ scope: 'auth' });
    expect(entries.length).toBe(1);
    expect(entries[0]?.meta).toEqual(meta);
    expect(entries[0]?.message).toBe('user logged in');
  });

  it('多次 flush 后数据完整性', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    logger.info('batch', 'group-1');
    await logger.flush();
    logger.info('batch', 'group-2');
    await logger.flush();
    logger.info('batch', 'group-3');
    await logger.flush();

    const entries = logger.query({ scope: 'batch' });
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.message)).toEqual(['group-1', 'group-2', 'group-3']);
  });

  // ── 反向测试 ──

  it('空目录查询返回空数组', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });

    expect(logger.query()).toEqual([]);

    logger.info('s', 'test');
    await logger.flush();
    const before = logger.query().length;

    const tmp2 = path.join(tmp, 'subdir');
    const logger2: Logger = createLogger({ dir: tmp2, retentionDays: 7 });
    expect(logger2.query()).toEqual([]);
    expect(logger.query().length).toBe(before);
  });

  it('损坏的 JSON 行被跳过', async () => {
    await mkdir(tmp, { recursive: true });
    const logFile = path.join(tmp, 'app.log');
    const validEntry = JSON.stringify({ ts: 1000, level: 'info', scope: 's', message: 'ok' });
    const corrupted = 'this-is-not-valid-json\n';
    await writeFile(logFile, `${corrupted}${validEntry}\n`);

    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    const entries = logger.query();
    expect(entries.length).toBe(1);
    expect(entries[0]?.message).toBe('ok');
  });

  it('cleanup 对不存在的目录不报错', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    const nonExistent = path.join(tmp, 'not-exist');
    const logger2: Logger = createLogger({ dir: nonExistent, retentionDays: 7 });

    await expect(logger2.cleanup()).resolves.toBe(0);
    await expect(logger.cleanup()).resolves.toBe(0);
  });

  it('并发写入的可靠性', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    const total = 50;
    for (let i = 0; i < total; i++) {
      logger.info('concurrent', `msg-${i}`);
    }
    await logger.flush();

    const entries = logger.query({ scope: 'concurrent' });
    expect(entries.length).toBe(total);
  });

  // ── 边界测试 ──

  it('超长 message 截断', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    const longMsg = 'a'.repeat(15_000);
    logger.info('edge', longMsg);
    await logger.flush();

    const entries = logger.query();
    expect(entries.length).toBe(1);
    expect(entries[0]?.message.length).toBeLessThanOrEqual(10_000 + '...[truncated]'.length);
    expect(entries[0]?.message.endsWith('...[truncated]')).toBe(true);
  });

  it('特殊字符处理', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    const specialMsg = '中文测试 🎉 "quoted" \\backslash\\ line1\nline2';
    const specialScope = '模块-①②③';
    logger.info(specialScope, specialMsg);
    await logger.flush();

    const entries = logger.query({ scope: specialScope });
    expect(entries.length).toBe(1);
    expect(entries[0]?.message).toBe(specialMsg);
    expect(entries[0]?.scope).toBe(specialScope);
  });

  it('scope 空字符串处理', async () => {
    const logger: Logger = createLogger({ dir: tmp, retentionDays: 7 });
    logger.info('', 'empty-scope');
    logger.info('normal', 'has-scope');
    await logger.flush();

    expect(logger.query().length).toBe(2);
    expect(logger.query({ scope: '' }).length).toBe(1);
    expect(logger.query({ scope: '' })[0]?.message).toBe('empty-scope');
    expect(logger.query({ scope: 'nonexistent' }).length).toBe(0);
  });
});