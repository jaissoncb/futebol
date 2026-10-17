// Callback route helpers for the future SDK bootstrap. They do not exchange a
// code or accept a session: the official SDK must validate its state/PKCE first.
const returnRoutes = new Set(['#/', '#/conta'])
export function safeKindeReturnHash(value: unknown): string {
  return typeof value === 'string' && returnRoutes.has(value) ? value : '#/'
}
export function cleanKindeCallback(url: URL, restoredHash: unknown): string {
  if (url.origin !== 'http://localhost:5173' || url.pathname !== '/') throw new Error('Callback DEV inválido.')
  // Drop the entire query, including codes, state and provider error text.
  return `/${safeKindeReturnHash(restoredHash)}`
}

export function readKindeCallbackStatus(url: URL): 'none' | 'code' | 'reject' {
  const params = url.searchParams
  const fragment = new URLSearchParams(url.hash.slice(1))
  if (['access_token', 'id_token', 'refresh_token'].some(key => fragment.has(key))) return 'reject'
  if (['error', 'error_description', 'error_uri', 'access_token', 'id_token', 'refresh_token'].some(key => params.has(key))) return 'reject'
  if (!params.has('code') && !params.has('state')) return 'none'
  if (params.getAll('code').length !== 1 || params.getAll('state').length !== 1
    || !params.get('code') || !params.get('state')) return 'reject'
  return 'code' // only the SDK may validate this transaction; never a login result
}
