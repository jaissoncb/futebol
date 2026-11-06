/** Local-only release boundaries. Requires the previously built PRD artifact. */
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyBuild } from './verify-build.mjs'
import { verifyPagesArtifact } from './verify-pages-artifact.mjs'
import { getFrontendEnvironment } from './frontend-environment.mjs'
import { validateFutebolEnvironment } from '../src/config/futebol-environment.ts'

const app = resolve(import.meta.dirname, '..')
const production = getFrontendEnvironment('production')
assert.throws(() => validateFutebolEnvironment({ ...production, apiBaseUrl: null }, 'prd'), /PRD bloqueado/)
assert.throws(() => validateFutebolEnvironment({ ...production, identity: null }, 'prd'), /PRD bloqueado/)
assert.throws(() => getFrontendEnvironment('kinde-dev'), /Modo do frontend/)
await verifyBuild({ directory: resolve(app, 'dist'), mode: 'production' })
await verifyPagesArtifact({ directory: resolve(app, 'dist') })
console.log('PASS: PRD contract and artifact; incomplete contract rejected without Test fallback')

const fixture = await mkdtemp(resolve(tmpdir(), 'futebol-release-'))
assert.equal(dirname(fixture), resolve(tmpdir()))
assert.ok(fixture.startsWith(resolve(tmpdir(), 'futebol-release-')))
const verify = () => verifyBuild({ directory: fixture, mode: 'production' })
try {
  await cp(resolve(app, 'dist'), fixture, { recursive: true })
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
  const config = production
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
