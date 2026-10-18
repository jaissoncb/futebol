import { readFileSync } from 'node:fs'

type Evidence = Record<string, unknown>
function object(value: unknown): Evidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('dev_evidence_pending')
  return value as Evidence
}
// This is an additional deployment preflight, never an alternative to per-request
// JWT/userinfo/RLS. No env override or browser-provided evidence is accepted.
export function verifyDevReadiness(lines: unknown[], nativeEvidence: unknown): void {
  const native = object(nativeEvidence)
  if (native.projectId !== 'ancient-wildflower-55433050' || native.branch !== 'dev'
    || native.pooled !== true || native.tls !== 'verify-full' || !Array.isArray(native.tests)) throw new Error('dev_evidence_pending')
  for (const name of ['connection_preflight', 'restricted_native_login', 'bootstrap_20_concurrent',
    'native_rls_and_transactions', 'pooled_30_requests_actor_isolation', 'disabled_user_rejected', 'cleanup_ephemeral_login_and_fixtures']) {
    if (!native.tests.some(test => object(test).name === name && object(test).status === 'PASS')) throw new Error('dev_evidence_pending')
  }
  const records = lines.map(object)
  const confirmed = new Map<string, number>()
  for (let i = 2; i < records.length; i++) {
    const accepted = records[i], proof = records[i - 1], claims = records[i - 2]
    if (accepted.event !== 'probe_accepted' || accepted.httpStatus !== 200 || accepted.databaseConnected !== false
      || proof.event !== 'userinfo_confirmed' || !['remote', 'cache'].includes(String(proof.source))
      || proof.sameBearer !== true || proof.subjectMatches !== true
      || claims.event !== 'signed_claims' || claims.amrPwd !== true || claims.authTimePresent !== true
      || claims.authTimeCoherent !== true || ![600, 601].includes(Number(claims.lifetimeSeconds))) continue
    const at = Date.parse(String(accepted.at))
    if (Number.isFinite(at) && proof.source === 'remote') confirmed.set(String(accepted.phase), at)
    if (accepted.phase === 'cache' && proof.source === 'cache') confirmed.set('cache', at)
  }
  if (!confirmed.has('initial') || !confirmed.has('automatic') || !confirmed.has('cache')
    || confirmed.get('automatic')! <= confirmed.get('initial')!
    || !records.some(record => record.event === 'authentication_denied' && record.httpStatus === 401)) throw new Error('dev_evidence_pending')
}

export function assertDevReadiness(): void {
  const root = 'D:/Projetos/_Handoff/Futebol/'
  try {
    const lines = readFileSync(`${root}FUTEBOL_G3_EVIDENCIAS_2026-10-18.jsonl`, 'utf8').trim().split('\n')
      .filter(Boolean).map(line => JSON.parse(line) as unknown)
    const native: unknown = JSON.parse(readFileSync(`${root}FUTEBOL_NEON_NATIVE_EVIDENCIAS_2026-10-18.json`, 'utf8'))
    verifyDevReadiness(lines, native)
  } catch { throw new Error('dev_evidence_pending') }
}
