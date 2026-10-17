// Public Test metadata from Identity's current handoff, read back 17/10/2026.
// Account is a portal only. It is neither this issuer nor our OAuth callback.
export const kindeTestConfig = Object.freeze({
  domain: 'https://sabara-test.eu.kinde.com',
  clientId: 'ec7038eb3fba4f958013e0b36437caf1',
  audience: 'urn:sabara:futebol:api:dev',
  redirectUri: 'http://localhost:5173/',
  logoutUri: 'http://localhost:5173/',
})
export const accountPortalUrl = 'https://account.sabara.org/'

export function assertKindeDevLocation(url: URL) {
  if (url.origin !== 'http://localhost:5173' || url.pathname !== '/') throw new Error('Origem DEV Futebol inválida.')
}
