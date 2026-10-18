import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { readSecretInput } from '../secret-input.ts'

void test('secret stdin is bounded across chunks and trims framing only', async () => {
  assert.equal(await readSecretInput(Readable.from([Buffer.from('  fixture'), Buffer.from('-only\r\n')])), 'fixture-only')
  await assert.rejects(readSecretInput(Readable.from([Buffer.alloc(10000), Buffer.alloc(6385)])), /invalid_secret_input/)
})
void test('secret stdin works with the exact Node child-process pipe and restricted environment', async () => {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    "import {readSecretInput} from './api/secret-input.ts'; const input=await readSecretInput(); process.exitCode=input==='fixture-only'?0:1"], {
    cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'],
    env: Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  })
  const closed = once(child, 'exit')
  child.stdin.end('fixture-only')
  const [code] = await closed as [number | null, string | null]
  assert.equal(code, 0)
})
