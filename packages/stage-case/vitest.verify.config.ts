import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['verify/**/*.verify.ts'],
    // 关闭结果缓存写入：本环境 Windows Defender 会锁 node_modules/.vite 下的 results.json
    cache: false,
  },
});
