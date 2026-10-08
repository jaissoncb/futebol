import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyPagesArtifact } from './verify-pages-artifact.mjs'

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'futebol-pages-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(resolve(root, 'assets'))
  await writeFile(resolve(root, 'index.html'), '<script type="module" src="/assets/app.js"></script>')
  await writeFile(resolve(root, 'manifest.webmanifest'), '{}')
  await writeFile(resolve(root, 'sw.js'), '// worker')
  await writeFile(resolve(root, 'assets/app.js'), '// public app')
  return root
}

test('aceita somente o artefato público e valida seu digest', async (t) => {
  const root = await fixture(t)
  const result = await verifyPagesArtifact({ directory: root })
  assert.match(result.contentDigest, /^[a-f0-9]{64}$/)
  await verifyPagesArtifact({ directory: root, expectedDigest: result.contentDigest })
  await assert.rejects(verifyPagesArtifact({ directory: root, expectedDigest: 'a'.repeat(64) }), /Digest/)
})

test('rejeita arquivos privados e segredos no bundle', async (t) => {
  const root = await fixture(t)
  await writeFile(resolve(root, '.env'), 'PRIVATE=fixture')
  await assert.rejects(verifyPagesArtifact({ directory: root }), /privada/)
  await rm(resolve(root, '.env'))
  await writeFile(resolve(root, 'assets/app.js'), 'const key="sb_secret_synthetic-not-real"')
  await assert.rejects(verifyPagesArtifact({ directory: root }), /publicação bloqueada/)
})
