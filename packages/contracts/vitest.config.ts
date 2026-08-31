import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 单元测试（*.test.ts）；契约测试（*.verify.ts）在 verify/ 目录，由 verify 脚本单独触发
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
  },
});
