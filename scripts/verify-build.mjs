import { access, readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import ts from 'typescript'
import { assertPublicBundle } from './bundle-security.mjs'
import { getBuildEnvironment } from './build-environment.mjs'

const dist = resolve(import.meta.dirname, '..', 'dist')
export async function verifyBuild({ directory = dist, mode = 'production' } = {}) {
  const environment = getBuildEnvironment(mode)
  const manifestPath = resolve(directory, 'manifest.webmanifest')
  const indexPath = resolve(directory, 'index.html')
  const serviceWorkerPath = resolve(directory, 'sw.js')

  await Promise.all([access(manifestPath), access(indexPath), access(serviceWorkerPath)])

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const index = await readFile(indexPath, 'utf8')

  if (manifest.scope !== '/' || manifest.id !== '/' || manifest.start_url !== '/#/') {
    throw new Error('PWA id/scope/start_url fora da raiz.')
  }

  if (!index.includes('/assets/')) {
    throw new Error('O build nao aplicou base raiz aos assets.')
  }

  const assetPath = (url) => {
    if (!url.startsWith('/') || url.startsWith('//')) throw new Error('Referência HTML fora da base raiz.')
    const path = resolve(directory, url.slice(1))
    if (relative(directory, path).startsWith('..')) throw new Error('Referência HTML fora do artefato.')
    return path
  }
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) await access(assetPath(match[1]))
  for (const icon of manifest.icons ?? []) await access(assetPath(icon.src))
  const entryUrl = index.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)?.[1]
  if (!entryUrl?.startsWith('/assets/')) throw new Error('Entrada JS ausente ou fora de /assets/.')
  const entryPath = assetPath(entryUrl)
  const literalValues = (text) => {
    const values = []
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.push(node.text)
      ts.forEachChild(node, visit)
    }
    visit(ts.createSourceFile('artifact.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS))
    return values
  }
  const hasScopedRegistration = (text) => {
    let found = false
    const visit = (node) => {
      if (ts.isNewExpression(node) && node.arguments?.length === 2) {
        const [url, options] = node.arguments
        if ((ts.isStringLiteral(url) || ts.isNoSubstitutionTemplateLiteral(url)) && url.text === '/sw.js'
          && ts.isObjectLiteralExpression(options)) {
          found ||= options.properties.some((property) => ts.isPropertyAssignment(property)
            && property.name.getText() === 'scope'
            && (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer))
            && property.initializer.text === '/')
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ts.createSourceFile('registration.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS))
    return found
  }
  const entryLiterals = literalValues(await readFile(entryPath, 'utf8'))
  if (!entryLiterals.some((value) => value.trim().replace(/\/$/, '') === environment.url)
    || !entryLiterals.some((value) => value.trim() === environment.publishableKey)) {
    throw new Error('Configuração pública Supabase esperada não foi emitida na entrada JS.')
  }
  const worker = await readFile(serviceWorkerPath, 'utf8')
  if (!worker.includes('/index.html') || !worker.includes('allowlist:[/^\\/$/]')
    || !worker.includes('SKIP_WAITING') || /self\.skipWaiting\(\)\s*[,;]/.test(worker.replace(/self\.addEventListener\("message"[^;]+;/, ''))) {
    throw new Error('Service worker não conserva fallback/scope e atualização por mensagem esperados.')
  }
  let registrationFound = false
  for (const file of await readdir(directory, { recursive: true })) {
    if (!/\.(js|map|html|css|webmanifest|txt)$/.test(file)) continue
    const text = await readFile(resolve(directory, file), 'utf8')
    assertPublicBundle(text)
    if (file.endsWith('.js') && hasScopedRegistration(text)) registrationFound = true
    if (resolve(directory, file) !== entryPath && (text.includes(environment.publishableKey) || text.includes(environment.url))) {
      throw new Error('Configuração pública Supabase emitida fora da entrada JS esperada.')
    }
  }
  if (!registrationFound) throw new Error('Registro do worker com scope raiz não encontrado.')
  return { publicSupabaseConfiguration: true, keyClassification: environment.publishableKey.startsWith('sb_publishable_') ? 'publishable' : 'legacy anon' }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, 'verify-build.mjs')) {
  const result = await verifyBuild({ mode: process.argv.includes('--local') ? 'local-test' : 'production' })
  console.log(`Build verificado: raiz, PWA, configuração pública presente (${result.keyClassification}) e scanner de credenciais aprovado.`)
}
