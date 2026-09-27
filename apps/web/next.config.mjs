/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@openlango/core', '@openlango/providers'],
  serverExternalPackages: ['better-sqlite3'],
  // msedge-tts 通过 webpackIgnore 运行时原生 import（见 packages/providers/src/tts-msedge.ts），
  // 其内部 ws 的可选原生依赖在打包环境会崩，故绝不能进 bundle。
};

export default nextConfig;
