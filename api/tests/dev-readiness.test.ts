import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyDevReadiness, verifyG3Readiness } from '../dev-readiness.ts'
const native = { projectId: 'ancient-wildflower-55433050', branch: 'dev', pooled: true, tls: 'verify-full',
  tests: ['connection_preflight','restricted_native_login','bootstrap_20_concurrent','native_rls_and_transactions',
    'pooled_30_requests_actor_isolation','disabled_user_rejected','cleanup_ephemeral_login_and_fixtures']
    .map(name => ({ name, status: 'PASS' })) }
function confirmation(phase: string, at: string, source = 'remote') {
  return [{ event: 'signed_claims', amrPwd: true, authTimePresent: true, authTimeCoherent: true, lifetimeSeconds: 600 },
    { event: 'userinfo_confirmed', source, sameBearer: true, subjectMatches: true },
    { event: 'probe_accepted', phase, at, httpStatus: 200, databaseConnected: false }]
}
const lines = [...confirmation('initial','2026-10-18T10:00:00Z'), { event: 'authentication_denied', httpStatus: 401 },
  ...confirmation('cache','2026-10-18T10:00:01Z','cache'), ...confirmation('automatic','2026-10-18T10:09:50Z')]
void test('DEV database entry requires positive initial AND SDK-renewed proof plus native Neon tests; no env/browser override', () => {
  assert.doesNotThrow(() => verifyDevReadiness(lines, native))
  for (const invalid of [[], lines.slice(0, 7), lines.filter(line => line.event !== 'authentication_denied'),
    lines.map(line => line.event === 'signed_claims' ? { ...line, amrPwd: false } : line),
    lines.map(line => line.event === 'signed_claims' ? { ...line, authTimePresent: false } : line),
    lines.map(line => line.event === 'userinfo_confirmed' ? { ...line, subjectMatches: false } : line),
    lines.map(line => line.event === 'probe_accepted' ? { ...line, databaseConnected: true } : line)]) {
    assert.throws(() => verifyDevReadiness(invalid, native), /dev_evidence_pending/)
  }
  for (const invalid of [{ ...native, projectId: 'production' }, { ...native, branch: 'main' },
    { ...native, tls: 'require' }, { ...native, tests: native.tests.map(test => ({ ...test, status: 'FAIL' })) }]) {
    assert.throws(() => verifyDevReadiness(lines, invalid), /dev_evidence_pending/)
  }
})
void test('valid G3 can precede native revalidation but never opens data with failed or mixed native evidence', () => {
  assert.doesNotThrow(() => verifyG3Readiness(lines))
  assert.throws(() => verifyG3Readiness(lines.slice(0, 7)), /dev_evidence_pending/)
  assert.throws(() => verifyDevReadiness(lines, { ...native, tests: [
    ...native.tests, { name: 'connection_preflight', status: 'FAIL' },
  ] }), /dev_evidence_pending/)
  assert.throws(() => verifyDevReadiness(lines, { ...native, tests: [
    { name: 'connection_preflight', status: 'FAIL' }, { name: 'cleanup_ephemeral_login_and_fixtures', status: 'PASS' },
  ] }), /dev_evidence_pending/)
})
