import { decodeJwt, decodeProtectedHeader } from 'jose'
import type { KindeConfiguration } from '../config/futebol-environment'

// Diagnostic codes only: never return claims, identifiers, or the bearer itself.
// These checks explain a rejection; only the API can authenticate the token.
export function accessContract(token: string | null | undefined, identity: KindeConfiguration): string[] {
  if (!token) return ['token_missing']
  try {
    const claims = decodeJwt(token), header = decodeProtectedHeader(token)
    const now = Math.floor(Date.now() / 1000)
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    return [
      header.alg !== 'RS256' || !header.kid ? 'algorithm' : '',
      claims.iss !== identity.domain ? 'issuer' : '',
      !audience.includes(identity.audience) ? 'audience' : '',
      claims.azp !== identity.clientId ? 'client' : '',
      typeof claims.iat !== 'number' || typeof claims.exp !== 'number'
        || claims.exp <= now || claims.iat > now + 30 || claims.exp <= claims.iat
        || claims.exp - claims.iat > 601 ? 'lifetime' : '',
      Object.hasOwn(claims, 'gty') ? 'machine_grant' : '',
      !Array.isArray(claims.amr) || !claims.amr.includes('pwd') ? 'password_method' : '',
      typeof claims.auth_time !== 'number' || !Number.isFinite(claims.auth_time)
        || claims.auth_time <= 0 || claims.auth_time > now + 30
        || typeof claims.iat !== 'number' || claims.auth_time > claims.iat + 30 ? 'authentication_time' : '',
    ].filter(Boolean)
  } catch { return ['token_format'] }
}
