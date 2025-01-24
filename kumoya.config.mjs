export const kumoyaConfig = {
  entry: './src/index.ts',
  outputFolder: 'dist',
  bundle: true,
  outputType: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  minify: true,
  extension: 'mjs',
};