import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Windows 下默认 worker 池偶发 shell 崩溃，强制单线程池以稳定运行
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
