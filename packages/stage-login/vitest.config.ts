import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'verify/**/*.verify.ts'],
    // 登录 stage 在真实引擎用例（如 no-login 启动真实浏览器）需要更长时限；
    // 自动提交后也需等待页面跳转/渲染，故统一放宽到 20s。
    testTimeout: 20000,
  },
});
