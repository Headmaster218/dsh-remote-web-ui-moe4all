import { defineConfig } from 'tsdown'

const id = 'dsh-remote-web-ui-moe4all'

export default defineConfig([
  {
    entry: { index: 'src/index.ts', invariant: 'src/invariant.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    deps: {
      neverBundle: specifier => specifier.startsWith('@deepseek-ai/')
        || specifier.startsWith('node:')
        || ['schemastery', 'zod', 'cloudflared'].includes(specifier),
    },
    outputOptions: { entryFileNames: '[name].js' },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    deps: {
      alwaysBundle: ['clsx', 'qrcode.react'],
      neverBundle: specifier => specifier.startsWith('react') || specifier.startsWith('@deepseek-ai/'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      exports: 'named',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: '/* __MOE4ALL_CSS__ */ return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
