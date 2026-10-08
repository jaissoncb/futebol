import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateReleaseRequest } from './release-guard.mjs'

const workflow = await readFile(new URL('../.github/workflows/ci-pages.yml', import.meta.url), 'utf8')
const sha = 'a'.repeat(40)

test('release manual exige main e o SHA exato', () => {
  assert.deepEqual(validateReleaseRequest({ eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha, expectedSha: sha }), { releaseAllowed: true, sha })
  assert.throws(() => validateReleaseRequest({ eventName: 'workflow_dispatch', ref: 'refs/heads/other', sha, expectedSha: sha }))
  assert.throws(() => validateReleaseRequest({ eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha, expectedSha: 'b'.repeat(40) }))
  assert.equal(validateReleaseRequest({ eventName: 'push', ref: 'refs/heads/main', sha, expectedSha: sha }).releaseAllowed, false)
})

test('workflow publica somente dist e não contém acoplamentos da arquitetura antiga', () => {
  assert.match(workflow, /path: dist/)
  assert.match(workflow, /actions\/upload-pages-artifact@v5\.0\.0/)
  assert.match(workflow, /actions\/deploy-pages@v4/)
  assert.match(workflow, /pages: write[\s\S]*id-token: write/)
  for (const forbidden of ['apps/futebol', '_site/futebol', 'root-only', 'root-rollback', 'site_variant']) {
    assert.equal(workflow.includes(forbidden), false, `workflow contém ${forbidden}`)
  }
})
