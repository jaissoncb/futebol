import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimePool } from '../database.ts'

void test('remote pool requires verified TLS and never reports connection input in errors', () => {
  for (const input of ['bad-fixture-input', 'https://example.test/db',
    'postgresql://fixture@db.test/dev', 'postgresql://fixture@db.test/dev?sslmode=no-verify',
    'postgresql://fixture@db.test/dev?sslmode=verify-full&sslcert=fixture']) {
    assert.throws(()=>createRuntimePool(input),error=>error instanceof Error && !error.message.includes(input))
  }
})
