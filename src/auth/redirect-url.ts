export function authRedirectUrl(origin: string): string {
  return new URL('/', origin).href
}
