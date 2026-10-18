import { createHash } from 'node:crypto'
import type { JWTVerifyGetKey } from 'jose'
import { createTokenValidator, AuthenticationError } from './auth.ts'
import { createUserinfoProof, g3Policy } from './g3.ts'
import { createApi, HttpError } from './server.ts'

export type ProbeEvidence = Record<string, string | number | boolean>
// Deliberately no database import/dispatch. Diagnostic PASS cannot open /me.
export function createG3Probe(record: (event: ProbeEvidence) => void,
  transport: typeof fetch = fetch, keyResolver?: JWTVerifyGetKey) {
  let previousTokenDigest: string | undefined
  const proof = createUserinfoProof({ fetch: transport, onProof: event => record({
    event: 'userinfo_confirmed', source: event.source, elapsedMs: event.elapsedMs,
    sameBearer: true, subjectMatches: true,
  }) })
  const validate = createTokenValidator(g3Policy, async (claims, bearer) => {
    const digest = createHash('sha256').update(bearer).digest('hex')
    record({ event: 'signed_claims', amrPwd: Array.isArray(claims.amr) && claims.amr.includes('pwd'),
      authTimePresent: typeof claims.auth_time === 'number' && Number.isFinite(claims.auth_time),
      authTimeCoherent: typeof claims.auth_time === 'number' && typeof claims.iat === 'number'
        && claims.auth_time > 0 && claims.auth_time <= claims.iat + 30 && claims.auth_time <= Date.now() / 1000 + 30,
      tokenChanged: previousTokenDigest !== undefined && previousTokenDigest !== digest,
      lifetimeSeconds: (claims.exp as number) - (claims.iat as number),
    })
    previousTokenDigest = digest
    return proof(claims, bearer)
  }, keyResolver)
  return createApi({
    authenticate: async bearer => {
      try { return await validate(bearer) }
      catch (error) {
        record({ event: 'authentication_denied', httpStatus: error instanceof AuthenticationError ? 401 : 503 })
        throw error
      }
    },
    dispatch: (_principal, method, url) => {
      if (url.pathname !== '/__dev/g3' || method !== 'GET') throw new HttpError(503, 'data_gate_closed')
      const phase = url.searchParams.get('phase') ?? ''
      if (!['initial', 'cache', 'after_ttl', 'automatic', 'id_negative'].includes(phase)) throw new HttpError(400, 'invalid_probe_phase')
      record({ event: 'probe_accepted', phase, httpStatus: 200, databaseConnected: false })
      return Promise.resolve({ g3TokenAccepted: true, dataGate: 'closed' })
    },
  })
}
