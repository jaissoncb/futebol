import { createHash } from 'node:crypto'
import { appendFile, lstat, readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPublicBundle } from './bundle-security.mjs'

const privateNames = /^(?:\.git|\.env(?:\..*)?|node_modules|coverage|src|scripts|supabase)$/i
const textFile = /\.(?:css|html|js|json|map|svg|txt|webmanifest)$/i

async function filesUnder(directory, prefix = '') {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Artefato Pages deve ser um diretório regular.')
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.name.startsWith('.') || privateNames.test(entry.name)) throw new Error(`Entrada privada no artefato Pages: ${path}`)
    if (entry.isSymbolicLink()) throw new Error(`Link simbólico no artefato Pages: ${path}`)
    if (entry.isDirectory()) files.push(...await filesUnder(resolve(directory, entry.name), path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Entrada não regular no artefato Pages: ${path}`)
  }
  return files
}

export async function verifyPagesArtifact({ directory, expectedDigest } = {}) {
  directory = resolve(directory ?? 'dist')
  const files = (await filesUnder(directory)).sort()
  for (const required of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    if (!files.includes(required)) throw new Error(`Arquivo público obrigatório ausente: ${required}`)
  }
  if (!files.some((file) => file.startsWith('assets/'))) throw new Error('Diretório público assets ausente.')
  const digest = createHash('sha256')
  for (const file of files) {
    const path = resolve(directory, file)
    if (relative(directory, path).startsWith('..')) throw new Error('Arquivo fora do artefato Pages.')
    const content = await readFile(path)
    if (textFile.test(file)) assertPublicBundle(content.toString('utf8'))
    digest.update(`${file}\0${createHash('sha256').update(content).digest('hex')}\n`)
  }
  const contentDigest = digest.digest('hex')
  if (expectedDigest !== undefined && (!/^[a-f0-9]{64}$/.test(expectedDigest) || expectedDigest !== contentDigest)) {
    throw new Error('Digest do artefato diverge do build aprovado.')
  }
  return { contentDigest, fileCount: files.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPagesArtifact({ directory: process.argv[2], expectedDigest: process.env.EXPECTED_CONTENT_DIGEST })
  console.log(`Artefato Pages validado: ${result.fileCount} arquivos, digest ${result.contentDigest}.`)
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `content_digest=${result.contentDigest}\n`)
}
