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
