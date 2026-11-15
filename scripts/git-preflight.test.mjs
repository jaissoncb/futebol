import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkBase, gitAt } from './git-preflight.mjs'

test('checks ancestry and local changes without touching work in progress', () => {
  const root = mkdtempSync(join(tmpdir(), 'futebol-preflight-'))
  const git = gitAt(root)
  const run = (candidate, options = {}) => checkBase(git, candidate, { log: () => {}, ...options })
  git('init', '-b', 'main')
  git('config', 'user.name', 'Futebol fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  git('commit', '--allow-empty', '-m', 'base original')
  git('branch', 'old')
  git('switch', '-c', 'diverged')
  git('commit', '--allow-empty', '-m', 'trabalho divergente')
  git('switch', 'main')
  git('commit', '--allow-empty', '-m', 'atualizacao principal')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  run('HEAD', { exact: true })
  assert.throws(() => run('old'), /Preflight bloqueado/)
  assert.throws(() => run('diverged'), /Preflight bloqueado/)
  git('switch', '-c', 'current')
  git('commit', '--allow-empty', '-m', 'trabalho atualizado')
  run('HEAD')
  assert.throws(() => run('HEAD', { exact: true }), /Preflight bloqueado/)
  writeFileSync(join(root, 'existing.txt'), 'trabalho local')
  const status = git('status', '--porcelain')
  assert.throws(() => run('HEAD'), /Preflight bloqueado/)
  assert.equal(git('status', '--porcelain'), status)
})
