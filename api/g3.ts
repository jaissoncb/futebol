import { createHash } from 'node:crypto'
import type { JWTPayload, JWTVerifyGetKey } from 'jose'
import { AuthenticationError, createTokenValidator, IdentityUnavailableError } from './auth.ts'

export const g3Policy = Object.freeze({
  issuer: 'https://sabara-test.eu.kinde.com',
  audience: 'urn:sabara:futebol:api:dev',
  clientId: 'ec7038eb3fba4f958013e0b36437caf1',
  jwksUri: 'https://sabara-test.eu.kinde.com/.well-known/jwks',
  maxLifetimeSeconds: 600,
  // Identity observed exp-iat=601 with the configured 600 s lifetime.
  lifetimeRoundingSeconds: 1,
})
export const userinfoUrl = 'https://sabara-test.eu.kinde.com/oauth2/v2/user_profile'
const MAX_BODY = 65536
const MAX_CACHE = 1024
const MAX_IN_FLIGHT = 8
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export interface ProofEvent {
  source: 'remote' | 'cache' | 'concurrent'
  elapsedMs: number
}
interface ProofOptions {
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
  onProof?: (event: ProofEvent) => void
}

// No configurable endpoint, bearer logging, negative cache or stale fallback.
// This is a per-instance proof cache, not a replacement for per-request DB ACLs.
export function createUserinfoProof(options: ProofOptions = {}) {
  const request = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 2000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) throw new Error('invalid_timeout')
  const cache = new Map<string, { context: string; until: number }>()
  const inFlight = new Map<string, { context: string; work: Promise<boolean> }>()
  return async (claims: Readonly<JWTPayload>, bearer: string): Promise<boolean> => {
    // These checks also run on cache hits, after JWT verification on every request.
    const seconds = now() / 1000
    if (!Array.isArray(claims.amr) || !claims.amr.includes('pwd')
      || claims.amr.some((value: unknown) => typeof value !== 'string')
      || typeof claims.auth_time !== 'number' || !Number.isFinite(claims.auth_time)
      || claims.auth_time <= 0 || claims.auth_time > seconds + 30
      || typeof claims.iat !== 'number' || claims.auth_time > claims.iat + 30
      || typeof claims.exp !== 'number' || claims.exp <= seconds
      || typeof claims.sub !== 'string' || !claims.sub.trim()) throw new AuthenticationError()
    const key = sha256(bearer.slice(7))
    const context = sha256(JSON.stringify([claims.iss, claims.sub, claims.aud, claims.azp]))
    for (const [entry, value] of cache) if (value.until <= now()) cache.delete(entry)
    const cached = cache.get(key)
    if (cached?.context === context && cached.until > now()) {
      options.onProof?.({ source: 'cache', elapsedMs: 0 }); return true
    }
    const pending = inFlight.get(key)
    if (pending) {
      if (pending.context !== context) throw new AuthenticationError()
      const accepted = await pending.work
      if (claims.exp * 1000 <= now()) throw new AuthenticationError()
      options.onProof?.({ source: 'concurrent', elapsedMs: 0 }); return accepted
    }
    if (inFlight.size >= MAX_IN_FLIGHT) throw new IdentityUnavailableError()
    const started = now()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new IdentityUnavailableError()) }, timeoutMs)
    })
    const remote = async () => {
      const response = await request(userinfoUrl, {
        method: 'GET', headers: { Authorization: bearer, Accept: 'application/json' },
        redirect: 'error', credentials: 'omit', signal: controller.signal,
      })
      if (controller.signal.aborted) throw new IdentityUnavailableError()
      if (response.status !== 200) {
        await response.body?.cancel()
        if ([400, 401, 403].includes(response.status)) throw new AuthenticationError()
        throw new IdentityUnavailableError()
      }
      if (response.redirected || response.url && response.url !== userinfoUrl
        || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
        || Number(response.headers.get('content-length') ?? 0) > MAX_BODY
        || !response.body) {
        await response.body?.cancel()
        throw new IdentityUnavailableError()
      }
      const reader = response.body.getReader()
      const cancelReader = () => { void reader.cancel().catch(() => undefined) }
      controller.signal.addEventListener('abort', cancelReader, { once: true })
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          const bytes: unknown = chunk.value
          if (!(bytes instanceof Uint8Array)) throw new IdentityUnavailableError()
          size += bytes.byteLength
          if (size > MAX_BODY) throw new IdentityUnavailableError()
          chunks.push(bytes)
        }
      } finally {
        controller.signal.removeEventListener('abort', cancelReader)
        await reader.cancel()
      }
      const profile: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)
        || !('sub' in profile) || typeof profile.sub !== 'string' || !profile.sub.trim()) throw new IdentityUnavailableError()
      if (profile.sub !== claims.sub) throw new AuthenticationError()
      if (controller.signal.aborted) throw new IdentityUnavailableError()
      if ((claims.exp as number) * 1000 <= now()) throw new AuthenticationError()
      // Start TTL at request start so remote latency cannot extend confirmation.
      const until = Math.min(started + 60000, (claims.exp as number) * 1000)
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string)
      if (until > now()) cache.set(key, { context, until })
      options.onProof?.({ source: 'remote', elapsedMs: Math.max(0, now() - started) })
      return true
    }
    const work = Promise.race([remote(), timeout]).catch((error: unknown) => {
      if (error instanceof AuthenticationError) throw error
      throw new IdentityUnavailableError()
    }).finally(() => {
      clearTimeout(timer); controller.abort(); inFlight.delete(key)
    })
    inFlight.set(key, { context, work })
    return work
  }
}

export function createG3Validator(options: ProofOptions = {}, keyResolver?: JWTVerifyGetKey) {
  return createTokenValidator(g3Policy, createUserinfoProof(options), keyResolver)
}
