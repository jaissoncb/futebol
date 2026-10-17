import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { assertPublicBundle } from './bundle-security.mjs'

const directory = new URL('../dist-dev/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', directory), 'utf8'))
assert.equal(manifest.id, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.start_url, '/#/')
let scripts = ''
for (const file of await readdir(directory, { recursive: true })) {
  if (!/\.(js|html|css|webmanifest|json)$/.test(file)) continue
  const text = await readFile(new URL(file.replaceAll('\\','/'), directory), 'utf8')
  assertPublicBundle(text)
  assert.ok(!/VITE_SUPABASE|sb_publishable_|\.supabase\.co/.test(text), 'Legacy configuration in Kinde DEV artifact')
  if (file.endsWith('.js')) scripts += text
}
for (const value of ['ec7038eb3fba4f958013e0b36437caf1','urn:sabara:futebol:api:dev','https://sabara-test.eu.kinde.com','http://localhost:5173/']) {
  assert.ok(scripts.includes(value), 'Missing confirmed public Test metadata')
}
assert.ok(scripts.includes('futebol-kinde-test-'), 'Missing isolated OAuth storage namespace')
console.log('PASS: Kinde DEV root/PWA/public metadata/isolated storage and bundle secret scanner; no legacy configuration')
