import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose'
import type { JWTVerifyGetKey, JWTPayload } from 'jose'

export class AuthenticationError extends Error {
  constructor() { super('invalid_access_token') }
}

export interface Principal { issuer: string; subject: string }
export interface TokenPolicy {
  issuer: string
  audience: string
  clientId: string
  jwksUri: string
  maxLifetimeSeconds: number
}
// This is an internal integration boundary, never a callback/claim from the browser.
export type ProveUserAccessToken = (claims: Readonly<JWTPayload>) => Promise<boolean>

// BLOCKING TODO G3: replace only after Identity supplies a documented positive
// user-access discriminator and real user/ID/M2M Test evidence. No env override.
export const unverifiedPrincipal: ProveUserAccessToken = () => Promise.resolve(false)

export function validatePolicy(policy: TokenPolicy): void {
  const issuer = new URL(policy.issuer)
  const jwks = new URL(policy.jwksUri)
  if (issuer.protocol !== 'https:' || jwks.protocol !== 'https:'
    || issuer.origin !== jwks.origin || issuer.username || issuer.password
    || issuer.search || issuer.hash || jwks.username || jwks.password || jwks.search || jwks.hash
    || !policy.audience || !policy.clientId || policy.audience === policy.clientId
    || !Number.isInteger(policy.maxLifetimeSeconds) || policy.maxLifetimeSeconds < 60
    || policy.maxLifetimeSeconds > 86400) throw new Error('invalid_token_policy')
}

export function createTokenValidator(
  policy: TokenPolicy,
  proveUser: ProveUserAccessToken = unverifiedPrincipal,
  keyResolver?: JWTVerifyGetKey,
) {
  validatePolicy(policy)
  // Fixed from operator configuration, never JWT jku/x5u/iss input.
  const keys = keyResolver ?? createRemoteJWKSet(new URL(policy.jwksUri), {
    timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000,
  })
  return async (authorization: string | undefined): Promise<Principal> => {
    try {
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization ?? '')
      if (!match || match[1].length > 16384) throw new AuthenticationError()
      const header = decodeProtectedHeader(match[1])
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 128
        || header.jku || header.jwk || header.x5u || header.crit) throw new AuthenticationError()
      const { payload } = await jwtVerify(match[1], keys, {
        algorithms: ['RS256'], issuer: policy.issuer, audience: policy.audience,
        requiredClaims: ['iss', 'aud', 'sub', 'azp', 'iat', 'exp'], clockTolerance: 30,
        maxTokenAge: policy.maxLifetimeSeconds,
      })
      const now = Math.floor(Date.now() / 1000)
      if (payload.azp !== policy.clientId || typeof payload.sub !== 'string' || !payload.sub.trim()
        || payload.sub.length > 256 || [...payload.sub].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        || typeof payload.iat !== 'number' || typeof payload.exp !== 'number'
        || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
        || payload.exp <= payload.iat || payload.iat > now + 30
        || payload.exp - payload.iat > policy.maxLifetimeSeconds
        || (payload.nbf !== undefined && (typeof payload.nbf !== 'number'
          || !Number.isInteger(payload.nbf) || payload.nbf >= payload.exp))) throw new AuthenticationError()
      // Fail on unknown grant shapes too; absence of gty never proves user access.
      if (payload.gty !== undefined && (typeof payload.gty !== 'string' && !Array.isArray(payload.gty)
        || (Array.isArray(payload.gty) && payload.gty.some((x: unknown) => typeof x !== 'string'))
        || [payload.gty].flat().includes('client_credentials'))) throw new AuthenticationError()
      if (!await proveUser(Object.freeze(payload))) throw new AuthenticationError()
      return Object.freeze({ issuer: policy.issuer, subject: payload.sub })
    } catch { throw new AuthenticationError() }
  }
}
