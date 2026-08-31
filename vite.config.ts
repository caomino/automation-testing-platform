import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@test-platform/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
        '@test-platform/engine-mcp': path.resolve(__dirname, 'packages/engine-mcp/src/index.ts'),
        '@test-platform/infra-ai': path.resolve(__dirname, 'packages/infra-ai/src/index.ts'),
        '@test-platform/infra-cred': path.resolve(__dirname, 'packages/infra-cred/src/index.ts'),
        '@test-platform/infra-logger': path.resolve(__dirname, 'packages/infra-logger/src/index.ts'),
        '@test-platform/infra-store': path.resolve(__dirname, 'packages/infra-store/src/index.ts'),
        '@test-platform/orchestrator': path.resolve(__dirname, 'packages/orchestrator/src/index.ts'),
        '@test-platform/stage-case': path.resolve(__dirname, 'packages/stage-case/src/index.ts'),
        '@test-platform/stage-defect': path.resolve(__dirname, 'packages/stage-defect/src/index.ts'),
        '@test-platform/stage-execute': path.resolve(__dirname, 'packages/stage-execute/src/index.ts'),
        '@test-platform/stage-explore': path.resolve(__dirname, 'packages/stage-explore/src/index.ts'),
        '@test-platform/stage-feature': path.resolve(__dirname, 'packages/stage-feature/src/index.ts'),
        '@test-platform/stage-login': path.resolve(__dirname, 'packages/stage-login/src/index.ts'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
