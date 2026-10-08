/** Reproducible release checks with PUBLIC, deliberately synthetic values only. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyBuild } from './verify-build.mjs'

const app = resolve(import.meta.dirname, '..')
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')))
const valid = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbCdEfGhIjKlMnOpQrStUvWxYz012345',
}
function release(overrides) {
  return spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm build'] : ['build'], {
      cwd: app, encoding: 'utf8', windowsHide: true, timeout: 120_000,
      env: { ...baseEnv, VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', ...overrides },
    })
}
for (const [name, env] of [
  ['missing configuration', {}],
  ['missing URL', { ...valid, VITE_SUPABASE_URL: '' }],
  ['missing key', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: '' }],
  ['placeholder', { ...valid, VITE_SUPABASE_URL: 'https://your-project.supabase.co' }],
  ['invalid key', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'arbitrary-invalid-string' }],
  ['privileged key', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic-not-real' }],
  ['local HTTP in release', { ...valid, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }],
  ['remote HTTP in release', { ...valid, VITE_SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' }],
  ['URL credentials', { ...valid, VITE_SUPABASE_URL: 'https://synthetic-user:synthetic-password@abcdefghijklmnopqrst.supabase.co' }],
  ['service role literal', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'service_role' }],
  ['privileged legacy JWT', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.synthetic-signature` }],
]) {
  const result = release(env)
  assert.ok(result.status !== null && result.status !== 0, `Release must reject ${name}, not time out`)
  const log = `${result.stdout}${result.stderr}`
  assert.ok(log.includes('VITE_SUPABASE'), `Expected configuration rejection for ${name}`)
  for (const value of Object.values(env)) if (value) assert.ok(!log.includes(value), 'Configuration values must not enter error logs')
  console.log(`PASS: pnpm build rejects ${name} without revealing values`)
}
const extra = 'FUTEBOL_EXTRA_MUST_NOT_ENTER_BROWSER_8C'
const result = release({ ...valid, VITE_EXTRA_SECRET: extra })
assert.equal(result.status, 0, 'Configured synthetic release build must pass')
for (const file of await readdir(resolve(app, 'dist'), { recursive: true })) {
  if (!/\.(js|map|html|css|webmanifest)$/.test(file)) continue
  const text = await readFile(resolve(app, 'dist', file), 'utf8')
  assert.ok(!text.includes(extra) && !text.includes('VITE_EXTRA_SECRET'), 'Extra VITE variable entered the artifact')
}
console.log('PASS: configured pnpm build, artifact verifier, scanner and extra VITE exclusion')
// Mutate isolated test copies only; never edit the generated release artifact.
const fixture = await mkdtemp(resolve(tmpdir(), 'futebol-verify-'))
assert.equal(dirname(fixture), resolve(tmpdir()))
assert.ok(fixture.startsWith(resolve(tmpdir(), 'futebol-verify-')))
const previous = { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY }
Object.assign(process.env, valid)
try {
  await cp(resolve(app, 'dist'), fixture, { recursive: true })
  await verifyBuild({ directory: fixture })
  const entries = await readdir(resolve(fixture, 'assets'))
  const registrationFile = entries.find((file) => file.startsWith('virtual_pwa-register-'))
  assert.ok(registrationFile, 'Expected real worker registration fixture')
  const registrationPath = resolve(fixture, 'assets', registrationFile)
  const registration = await readFile(registrationPath, 'utf8')
  const changed = registration.replace(/scope\s*:\s*[`"']\/[`"']/, 'scope:"/invalid/"')
  assert.notEqual(changed, registration, 'Fixture scope mutation must happen')
  await writeFile(registrationPath, changed)
  await assert.rejects(verifyBuild({ directory: fixture }), /Registro do worker/)
  await writeFile(registrationPath, registration)
  const entryFile = entries.find((file) => /^index-.*\.js$/.test(file))
  assert.ok(entryFile, 'Expected real JS entry fixture')
  const entryPath = resolve(fixture, 'assets', entryFile)
  const entry = await readFile(entryPath, 'utf8')
  assert.ok(entry.includes(valid.VITE_SUPABASE_PUBLISHABLE_KEY))
  await writeFile(entryPath, entry.replaceAll(valid.VITE_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_0123456789AbCdEfGhIjKlMnOpQrStUvW'))
  await assert.rejects(verifyBuild({ directory: fixture }), /Configuração pública Supabase/)
  console.log('PASS: isolated artifact copies reject non-root worker scope and missing expected public configuration')
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  await rm(fixture, { recursive: true, force: true })
}
console.log('PASS: independent root release build; no upload or deployment')
