import { createTokenValidator } from './auth.ts'
import { createUserinfoProof, g3Policy } from './g3.ts'
import { HttpError } from './server.ts'
import type { JWTVerifyGetKey } from 'jose'

type RecordEvent = (event: Record<string, string | number | boolean>) => void

// Explicit DEV diagnostics only. Both paths perform the complete G3 contract;
// fresh uses a zero positive-cache TTL, never stale data or a different token.
export function createStabilizationValidation(record: RecordEvent, transport: typeof fetch = fetch, keyResolver?: JWTVerifyGetKey, nativeTransport?: typeof fetch) {
  const make = (mode: 'fresh' | 'cached' | 'fresh_native') => {
    const proof = createUserinfoProof({ fetch: mode !== 'fresh' && nativeTransport ? nativeTransport : transport,
      timeoutMs: 5000, cacheTtlMs: mode === 'cached' ? 60000 : 0,
      onProof: event => record({ event: 'stabilization_userinfo', mode, source: event.source,
        elapsedMs: event.elapsedMs, headersMs: event.headersMs ?? 0, bodyMs: event.bodyMs ?? 0 }),
      onUnavailable: event => record({ event: 'stabilization_unavailable', mode, reason: event.reason,
        category: event.category, phase: event.phase, elapsedMs: event.elapsedMs, httpStatus: event.httpStatus ?? 0 }),
    })
    return createTokenValidator(g3Policy, async (claims, bearer) => {
      record({ event: 'stabilization_signed_access', mode,
        remainingSeconds: Math.max(0, Math.floor(Number(claims.exp) - Date.now() / 1000)),
        amrPwd: Array.isArray(claims.amr) && claims.amr.includes('pwd'),
        authTimeNumeric: typeof claims.auth_time === 'number' && Number.isFinite(claims.auth_time) })
      return proof(claims, bearer)
    }, keyResolver)
  }
  const fresh = make('fresh'), cached = make('cached')
  const native = nativeTransport ? make('fresh_native') : undefined
  let freshRequests = 0
  return (bearer: string | undefined, url: URL) => {
    if (url.pathname === '/__dev/stabilization') {
      if (!['fresh', 'cached', ...(native ? ['fresh_native'] : [])].includes(url.searchParams.get('mode') ?? '')
        || !['initial', 'sample', 'cache', 'after_ttl', 'automatic'].includes(url.searchParams.get('phase') ?? '')
        || [...url.searchParams.keys()].some(key => !['mode', 'phase'].includes(key))) throw new HttpError(400, 'invalid_probe')
      if (url.searchParams.get('mode') !== 'cached') {
        if (++freshRequests > 16) throw new HttpError(429, 'probe_budget_exhausted')
        return url.searchParams.get('mode') === 'fresh_native' && native ? native(bearer) : fresh(bearer)
      }
    }
    return cached(bearer)
  }
}
