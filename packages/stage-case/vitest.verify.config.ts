import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['verify/**/*.verify.ts'],
    // 关闭结果缓存写入：本环境 Windows Defender 会锁 node_modules/.vite 下的 results.json
    cache: false,
    // 单线程避免此环境 vitest 工作进程崩溃（exit code 1 / 空输出）
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
