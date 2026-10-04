import { readFileSync, writeFileSync } from 'node:fs'

const bundle = 'lib/client.js'
const marker = '/* __MOE4ALL_CSS__ */'
const source = readFileSync(bundle, 'utf8')
if (source.split(marker).length !== 2) throw new Error('CSS injection marker missing or duplicated')

const css = readFileSync('lib/style.css', 'utf8')
const injection = [
  `const css = ${JSON.stringify(css)};`,
  `const tagId = 'dsh-remote-web-ui-moe4all/style.css';`,
  `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
  `  const tag = document.createElement('style');`,
  `  tag.dataset.plugin = 'dsh-remote-web-ui-moe4all';`,
  `  tag.dataset.pluginCss = tagId;`,
  `  tag.textContent = css;`,
  `  document.head.appendChild(tag);`,
  `}`,
].join('\n')
writeFileSync(bundle, source.replace(marker, injection))
