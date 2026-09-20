// 生产构建：把根 server.ts 打成 dist/server.cjs (CJS, Node)。
// 关键：通过插件把 @test-platform/* workspace 包内联进 bundle（借 tsconfig paths 解析到 src），
// 其余裸模块（express / vite / playwright 等第三方）保持外置，运行时从 node_modules 解析。
// 这样 dist/server.cjs 自包含、不依赖 node_modules/@test-platform 符号链接，也不受各包 exports 仅含 ESM 条件的影响。
import { build } from 'esbuild';
import path from 'node:path';

/** @type {import('esbuild').Plugin} */
const externalizeNonWorkspace = {
  name: 'externalize-non-workspace',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const p = args.path;
      // workspace 包 + 相对/绝对路径 → 交给 esbuild 解析并打包
      if (p.startsWith('@test-platform/') || p.startsWith('.') || path.isAbsolute(p)) {
        return undefined;
      }
      // 其余裸模块（第三方依赖）→ 外置
      return { external: true };
    });
  },
};

await build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/server.cjs',
  sourcemap: true,
  tsconfig: 'tsconfig.json',
  plugins: [externalizeNonWorkspace],
  logLevel: 'info',
  // 避免把巨量 node 内建当成外部问题；保留默认即可
});

console.log('[build-server] dist/server.cjs written');
