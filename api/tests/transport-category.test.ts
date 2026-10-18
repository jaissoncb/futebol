import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transportCategory } from '../transport-category.ts'

void test('transport categories traverse bounded nested causes without exposing raw details', () => {
  for (const [code, expected] of [['EAI_AGAIN','dns'],['ENOTFOUND','dns'],['CERT_HAS_EXPIRED','tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID','tls'],['ECONNREFUSED','connect'],['UND_ERR_CONNECT_TIMEOUT','timeout'],
    ['ECONNRESET','reset'],['UND_ERR_SOCKET','reset'],['private-provider-string','transport']]) {
    assert.equal(transportCategory(new Error('secret fixture', {cause:{code}})), expected)
  }
  assert.equal(transportCategory(new AggregateError([{code:'ENETUNREACH'}],'private')), 'connect')
  const cycle: {cause?:unknown} = {}; cycle.cause = cycle
  assert.equal(transportCategory(cycle),'transport')
})
