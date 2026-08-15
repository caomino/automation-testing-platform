import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['verify/**/*.verify.ts'],
    // 关闭结果缓存写入：本环境 Windows Defender 会锁 node_modules/.vite 下的
    // results.json，导致默认 verify 收尾写缓存时 EPERM。测试本身不受影响（--no-cache 已验证全绿）。
    cache: false,
  },
});
