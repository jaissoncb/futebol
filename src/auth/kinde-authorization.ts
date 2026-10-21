import { base64UrlEncode, generateAuthUrl, generateRandomString, IssuerRouteTypes, Scopes } from '@kinde-oss/kinde-auth-react/utils'
import { safeKindeReturnHash } from '../bootstrap/kinde-return'
import type { KindeConfiguration } from '../config/futebol-environment'

// React SDK 5.13.1 normalizes away a root trailing slash in login/register.
// Use its supported public utility option; React Provider still owns callback,
// token exchange, memory store, refresh and logout. No protocol fork/library patch.
export async function createFutebolAuthorization(config: KindeConfiguration, returnHash: unknown, register = false): Promise<URL> {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto.subtle) throw new Error('Autenticação requer contexto seguro.')
  const state = base64UrlEncode(JSON.stringify({
    kinde: { event: register ? 'register' : 'login' },
    transactionId: generateRandomString(64),
    returnHash: safeKindeReturnHash(returnHash),
  }))
  const result = await generateAuthUrl(config.domain, register ? IssuerRouteTypes.register : IssuerRouteTypes.login, {
    clientId: config.clientId, redirectURL: config.redirectUri, audience: config.audience,
    scope: [Scopes.openid, Scopes.profile, Scopes.email, Scopes.offline_access], state,
  }, { disableUrlSanitization: true })
  if (result.url.origin !== config.domain || result.url.pathname !== '/oauth2/auth'
    || result.url.searchParams.get('redirect_uri') !== config.redirectUri
    || result.url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('Fluxo de autenticação inválido.')
  return result.url
}
