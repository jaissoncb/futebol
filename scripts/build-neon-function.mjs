// Local packaging only. No Neon client, credentials, config apply or deployment.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tools = resolve(root, '.tools/neon-functions')
const requireTool = createRequire(resolve(tools, 'package.json'))
const { buildFunctionBundle } = await import(pathToFileURL(requireTool.resolve('@neon/config-runtime/v1')).href)
const { unzipSync } = requireTool('fflate')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
assert.equal(process.versions.node.split('.')[0], '24', 'Node 24 is required')
const baseline = await json(resolve(root, 'deployment/neon-dev.sources.json'))
async function checkSources() {
  for (const file of baseline) assert.equal(sha256(await readFile(resolve(root, file.path))), file.sha256, `Changed stage-1 file: ${file.path}`)
}
await checkSources()
const fn = { slug: 'futebolapi', name: 'Futebol API DEV', source: resolve(root, 'api/function.ts'), env: {}, runtime: 'nodejs24' }
const warnings = []
const zip = await buildFunctionBundle(fn, { onWarning: warning => warnings.push(warning) })
assert.deepEqual(warnings, [], 'Native/undeclared dependency warning')
const entries = unzipSync(zip)
assert.deepEqual(Object.keys(entries), ['index.mjs'], 'Only the executable bundle may ship')
const code = Buffer.from(entries['index.mjs']).toString('utf8')
for (const forbidden of [/postgres(?:ql)?:\/\/[^\s'"`<>]+:[^\s'"`<>]+@/i, /-----BEGIN .*PRIVATE KEY/, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /runtime-dev|stabilization_probe|stabilization_private|native_userinfo_transport|dev-readiness|secret-input|g3-probe/,
  /_Handoff|\.env\.local|readSecretInput|appendFileSync|neon-domain-preflight/]) {
  assert.ok(!forbidden.test(code), `Forbidden bundle content: ${forbidden.source}`)
}
// Inspect actual esbuild inputs with identical official defaults; these include
// dependencies even if an optional CommonJS branch is eliminated at runtime.
const { build } = requireTool('esbuild')
const result = await build({ entryPoints: [fn.source], bundle: true, write: false, outfile: 'index.mjs', minify: true,
  format: 'esm', platform: 'node', banner: { js: code.slice(0, code.indexOf('\n')) }, metafile: true, logLevel: 'silent' })
assert.deepEqual(result.outputFiles[0].contents, entries['index.mjs'], 'Inspected input graph must produce the exact shipped code')
const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'))
const expected = ['auth', 'database', 'fetch-handler', 'function', 'g3', 'http-error', 'routes', 'runtime-config', 'transport-category']
const ownInputs = inputs.filter(path => !path.includes('node_modules/')).map(path => path.replaceAll('\\', '/').split('/').slice(-2).join('/')).sort()
assert.deepEqual(ownInputs, expected.map(name => `api/${name}.ts`).sort())
assert.ok(inputs.some(path => /node_modules\/pg\/lib\/index\.js$/.test(path)))
assert.ok(inputs.some(path => /node_modules\/jose\/dist\/webapi\/jwt\/verify\.js$/.test(path)))
assert.ok(!inputs.some(path => /\.node$|\/scripts\/|_Handoff|\.env(?:\.|$)|runtime-dev|stabilization|userinfo-https/.test(path)))
const base = resolve(root, '.local-backup/neon-functions-20261019')
await mkdir(base, { recursive: true })
const out = await mkdtemp(resolve(base, 'candidate-'))
await writeFile(resolve(out, 'index.mjs'), entries['index.mjs'], { flag: 'wx' })
await writeFile(resolve(out, 'function.zip'), zip, { flag: 'wx' })
// Import the shipped bundle on Node 24: catches pg/CommonJS ESM interop failure.
// Use an empty environment for the fail-closed probe; no credential is inspected.
const { spawnSync } = await import('node:child_process')
const synthetic = await json(resolve(root, 'deployment/neon-dev.runtime-config.json'))
synthetic.database.runtimeRole = 'futebol_api_dev_synthetic_fixture'
const probe = `
import entry from './index.mjs';
globalThis.fetch=()=>{throw new Error('No network allowed in local bundle probe')};
if(typeof entry.fetch!=='function') process.exit(2);
const closed=await entry.fetch(new Request('https://api.fixture.test/me'));
if(closed.status!==503||JSON.stringify(await closed.json())!==JSON.stringify({error:'service_unavailable'}))process.exit(3);
const config=${JSON.stringify(synthetic)};
process.env.FUTEBOL_RUNTIME_CONFIG=JSON.stringify(config);
for(const [key,host] of [['DATABASE_URL',config.database.pooledHost],['DATABASE_URL_UNPOOLED',config.database.unpooledHost]])
  process.env[key]='postgresql://'+config.database.runtimeRole+':SYNTHETIC-ONLY@'+host+'/futebol_dev?sslmode=verify-full';
for(const [path,status,init] of [['/health',200,{}],['/me',401,{}],['/__dev/g3',404,{}],['/me',401,{headers:{Authorization:'Bearer a.b.c'}}],
  ['/me',204,{method:'OPTIONS',headers:{Origin:config.allowedOrigin}}]])
  if((await entry.fetch(new Request('https://api.fixture.test'+path,init))).status!==status)process.exit(4);
`
const checked = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: out, env: {}, encoding: 'utf8' })
assert.equal(checked.status, 0, 'Isolated Node 24 entry import/fail-closed probe failed')
const app = await json(resolve(root, 'package.json'))
const tool = await json(resolve(tools, 'node_modules/@neon/config-runtime/package.json'))
const esbuild = await json(resolve(tools, 'node_modules/esbuild/package.json'))
const manifest = { entry: 'api/function.ts', slug: fn.slug, runtime: fn.runtime, node: process.versions.node,
  bundler: { package: '@neon/config-runtime', version: tool.version, esbuild: esbuild.version, mode: 'official-default-esbuild' },
  files: Object.entries(entries).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) })),
  zip: { bytes: zip.length, sha256: sha256(zip) },
  dependencies: { pg: app.dependencies.pg, jose: app.dependencies.jose },
  inputs, stage1Files: baseline,
  lockfiles: { application: sha256(await readFile(resolve(root, 'pnpm-lock.yaml'))), tools: sha256(await readFile(resolve(tools, 'package-lock.json'))) },
  checks: { onlyIndexMjs: true, forbiddenContent: 'PASS', inputGraph: 'PASS', exactGraphOutput: 'PASS',
    node24Import: 'PASS', emptyConfigFailsClosed: 'PASS', configuredHealthCorsAndAuth: 'PASS' },
  target: { organizationId: 'org-steep-math-64054637', projectId: 'ancient-wildflower-55433050', project: 'futebol-dev-20261018',
    branchId: 'br-shiny-dust-bastckar', branch: 'dev', region: 'aws-eu-central-1', plan: 'Free', monthlyUsd: 0 },
}
await checkSources()
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ output: relative(root, out), ...manifest.zip, checks: manifest.checks }))
