import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'verify/**/*.verify.ts'],
    // 本环境 Windows Defender 会锁 node_modules/.vite 缓存，禁用缓存避免 EPERM
    cache: false,
    // 单线程避免此环境 vitest 工作进程崩溃（exit code 1 / 空输出）
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
