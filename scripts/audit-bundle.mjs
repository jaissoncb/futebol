/** Build from source and measure emitted code, without rewriting generated files. */
import { build } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const app = resolve(import.meta.dirname, '..')
const chunks = []
await build({ root: app, plugins: [{
  name: 'futebol-bundle-audit',
  generateBundle(_options, bundle) {
    for (const entry of Object.values(bundle)) {
      if (entry.type !== 'chunk') continue
      chunks.push({ file: entry.fileName, entry: entry.isEntry, bytes: Buffer.byteLength(entry.code),
        gzipBytes: gzipSync(entry.code).length,
        modules: Object.entries(entry.modules).map(([id, module]) => ({
          id: id.replaceAll('\\', '/').replace(app.replaceAll('\\', '/'), '<app>'),
          renderedLength: module.renderedLength,
        })).sort((a, b) => b.renderedLength - a.renderedLength),
      })
    }
  },
}] })
const output = resolve(app, 'coverage')
await mkdir(output, { recursive: true })
for (const chunk of chunks) {
  const emitted = await readFile(resolve(app, 'dist', chunk.file))
  chunk.bytes = emitted.length
  chunk.gzipBytes = gzipSync(emitted).length
}
await writeFile(resolve(output, 'bundle-audit.json'), JSON.stringify(chunks, null, 2))
for (const chunk of chunks) console.log(`${chunk.file}: ${chunk.bytes} bytes; gzip ${chunk.gzipBytes} bytes`)
if (chunks.some((chunk) => chunk.modules.some(({ id }) => /node_modules\/(playwright(?:-core)?|axe-core)(?:\/|$)/.test(id)))) {
  throw new Error('Browser test tooling entered the production bundle')
}
