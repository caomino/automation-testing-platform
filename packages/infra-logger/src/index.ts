/**
 * @file index.ts
 * @description 文件型日志层实现（JSON-lines，支持滚动/保留/查询/清理）
 * @frozen v1.0
 */
import { appendFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
  meta?: unknown;
}

export interface LoggerConfig {
  /** 日志目录（外部化，如 D:/test-platform-data/logs） */
  dir: string;
  /** 保留天数 */
  retentionDays: number;
  /** 单文件上限（字节） */
  maxFileSize?: number;
}

export interface Logger {
  info(scope: string, message: string, meta?: unknown): void;
  warn(scope: string, message: string, meta?: unknown): void;
  error(scope: string, message: string, meta?: unknown): void;
  query(filter?: { scope?: string; level?: LogLevel; since?: number }): LogEntry[];
  flush(): Promise<void>;
  cleanup(): Promise<number>;
}

const MAIN_FILE = 'app.log';
const DAY_MS = 86_400_000;

function isLogName(name: string): boolean {
  return name === MAIN_FILE || name.startsWith(`${MAIN_FILE}.`);
}

class FileLogger implements Logger {
  private readonly dir: string;
  private readonly retentionDays: number;
  private readonly maxFileSize?: number;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(config: LoggerConfig) {
    this.dir = config.dir;
    this.retentionDays = config.retentionDays;
    this.maxFileSize = config.maxFileSize;
  }

  info(scope: string, message: string, meta?: unknown): void {
    this.log('info', scope, message, meta);
  }

  warn(scope: string, message: string, meta?: unknown): void {
    this.log('warn', scope, message, meta);
  }

  error(scope: string, message: string, meta?: unknown): void {
    this.log('error', scope, message, meta);
  }

  query(filter?: { scope?: string; level?: LogLevel; since?: number }): LogEntry[] {
    const result: LogEntry[] = [];
    if (!existsSync(this.dir)) {
      return result;
    }
    const files = readdirSync(this.dir)
      .filter(isLogName)
      .sort((a, b) => (a === MAIN_FILE ? -1 : b === MAIN_FILE ? 1 : a.localeCompare(b)));

    for (const name of files) {
      const filePath = path.join(this.dir, name);
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      for (const raw of content.split('\n')) {
        if (!raw.trim()) {
          continue;
        }
        try {
          result.push(JSON.parse(raw) as LogEntry);
        } catch {
          // 跳过损坏行
        }
      }
    }

    result.sort((a, b) => a.ts - b.ts);

    return result.filter((entry) => {
      if (filter?.scope !== undefined && entry.scope !== filter.scope) {
        return false;
      }
      if (filter?.level !== undefined && entry.level !== filter.level) {
        return false;
      }
      if (filter?.since !== undefined && entry.ts < filter.since) {
        return false;
      }
      return true;
    });
  }

  flush(): Promise<void> {
    return this.writeChain;
  }

  async cleanup(): Promise<number> {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    const threshold = Date.now() - this.retentionDays * DAY_MS;
    let deleted = 0;
    for (const name of files) {
      if (!isLogName(name)) {
        continue;
      }
      const filePath = path.join(this.dir, name);
      const info = await stat(filePath);
      if (info.mtimeMs < threshold) {
        await unlink(filePath);
        deleted += 1;
      }
    }
    return deleted;
  }

  private log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
    const entry: LogEntry = { ts: Date.now(), level, scope, message, meta };
    const line = `${JSON.stringify(entry)}\n`;
    this.writeChain = this.writeChain
      .then(() => this.writeLine(line))
      .catch(() => undefined);
  }

  private async writeLine(line: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const base = path.join(this.dir, MAIN_FILE);
    if (this.maxFileSize !== undefined && existsSync(base)) {
      const size = statSync(base).size;
      if (size + Buffer.byteLength(line, 'utf8') > this.maxFileSize) {
        const rotated = `${base}.${Date.now()}`;
        await rename(base, rotated);
      }
    }
    await appendFile(base, line, 'utf8');
  }
}

export function createLogger(config: LoggerConfig): Logger {
  return new FileLogger(config);
}
