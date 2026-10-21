/** Local-only release boundaries. Requires the previously built DEV artifact. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyBuild } from './verify-build.mjs'
import { verifyPagesArtifact } from './verify-pages-artifact.mjs'
import { getFrontendEnvironment } from './frontend-environment.mjs'

const app = resolve(import.meta.dirname, '..')
assert.throws(() => getFrontendEnvironment('production'), /PRD bloqueado/)
assert.throws(() => getFrontendEnvironment('kinde-dev'), /Modo do frontend/)
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: app, encoding: 'utf8', windowsHide: true, timeout: 30000,
  env: { ...process.env, VITE_FUTEBOL_ENV: 'dev', VITE_EXTRA_SECRET: 'SYNTHETIC_MUST_NOT_ENTER_BUILD' },
})
assert.ok(result.status !== null && result.status !== 0, 'PRD must fail closed before emitting an artifact')
assert.match(result.stdout + result.stderr, /PRD bloqueado/)
assert.ok(!(result.stdout + result.stderr).includes('SYNTHETIC_MUST_NOT_ENTER_BUILD'))
await verifyBuild({ directory: resolve(app, 'dist-dev'), mode: 'futebol-dev' })
await verifyPagesArtifact({ directory: resolve(app, 'dist-dev') })
console.log('PASS: default production build rejects missing contract without Test fallback; DEV static artifact passes')

const fixture = await mkdtemp(resolve(tmpdir(), 'futebol-release-'))
assert.equal(dirname(fixture), resolve(tmpdir()))
assert.ok(fixture.startsWith(resolve(tmpdir(), 'futebol-release-')))
const verify = () => verifyBuild({ directory: fixture, mode: 'futebol-dev' })
try {
  await cp(resolve(app, 'dist-dev'), fixture, { recursive: true })
  const assets = await readdir(resolve(fixture, 'assets'))
  const registrationPath = resolve(fixture, 'assets', assets.find(file => file.startsWith('virtual_pwa-register-')))
  const registration = await readFile(registrationPath, 'utf8')
  const changed = registration.replace(/scope\s*:\s*[`"']\/[`"']/, 'scope:"/invalid/"')
  assert.notEqual(changed, registration)
  await writeFile(registrationPath, changed)
  await assert.rejects(verify(), /Registro do worker/)
  await writeFile(registrationPath, registration)
  const entryPath = resolve(fixture, 'assets', assets.find(file => /^index-.*\.js$/.test(file)))
  const entry = await readFile(entryPath, 'utf8')
  const config = getFrontendEnvironment('futebol-dev')
  await writeFile(entryPath, entry.replaceAll(config.apiBaseUrl, 'https://wrong-api.invalid'))
  await assert.rejects(verify(), /Configuração pública Futebol/)
  await writeFile(entryPath, entry + '\n/* /__dev/probe */')
  await assert.rejects(verify(), /instrumentação DEV/)
  await writeFile(entryPath, entry)
  await writeFile(resolve(fixture, 'private.txt'), 'sb_secret_SYNTHETIC_FIXTURE_ONLY')
  await assert.rejects(verify(), /Chave privada/)
  console.log('PASS: altered worker scope, missing API config, DEV instrumentation and synthetic secret are rejected')
} finally {
  await rm(fixture, { recursive: true, force: true })
}
