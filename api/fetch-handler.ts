import { AuthenticationError, IdentityUnavailableError, type Principal } from './auth.ts'
import { HttpError } from './http-error.ts'

interface FetchDependencies {
  allowedOrigin: string
  authenticate: (authorization: string | undefined) => Promise<Principal>
  dispatch: (principal: Principal, method: string, url: URL, body: unknown) => Promise<unknown>
  now?: () => number
}
const MAX_BODY = 262144

export function jsonResponse(status: number, value?: unknown, headers?: Headers): Response {
  const result = new Headers(headers)
  result.set('Content-Type', 'application/json; charset=utf-8')
  result.set('Cache-Control', 'no-store')
  result.set('Pragma', 'no-cache')
  result.set('X-Content-Type-Options', 'nosniff')
  result.set('Referrer-Policy', 'no-referrer')
  result.set('Vary', 'Origin')
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: result })
}

async function readBody(request: Request): Promise<unknown> {
  if (!['POST', 'PATCH', 'PUT'].includes(request.method)) return undefined
  if (request.headers.get('content-type') !== 'application/json') throw new HttpError(415, 'json_required')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) throw new HttpError(413, 'payload_too_large')
  if (!request.body) throw new HttpError(400, 'invalid_json')
  const reader = request.body.getReader()
  if (request.signal.aborted) {
    void reader.cancel().catch(() => undefined)
    throw new HttpError(408, 'request_timeout')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => { reject(new HttpError(408, 'request_timeout')); void reader.cancel().catch(() => undefined) }
    timer = setTimeout(abort, 20000)
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) abort()
  })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted])
      if (chunk.done) break
      const bytes: unknown = chunk.value
      if (!(bytes instanceof Uint8Array)) throw new HttpError(400, 'invalid_body')
      size += bytes.byteLength
      if (size > MAX_BODY) throw new HttpError(413, 'payload_too_large')
      chunks.push(bytes)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
    catch { throw new HttpError(400, 'invalid_json') }
  } finally {
    clearTimeout(timer)
    if (abort) request.signal.removeEventListener('abort', abort)
    // Do not let an uncooperative producer hold a response open during cleanup.
    void reader.cancel().catch(() => undefined)
  }
}

export function createFetchHandler(dependencies: FetchDependencies): (request: Request) => Promise<Response> {
  // No documented trusted proxy/IP contract is assumed. These bounds apply to
  // the entire isolate, never to user-controlled X-Forwarded-For values.
  const now = dependencies.now ?? Date.now
  let count = 0, reset = 0, active = 0
  return async (request: Request): Promise<Response> => {
    const headers = new Headers()
    let admitted = false
    try {
      const origin = request.headers.get('origin')
      if (origin && origin !== dependencies.allowedOrigin) throw new HttpError(403, 'origin_denied')
      if (origin) headers.set('Access-Control-Allow-Origin', origin)
      const url = new URL(request.url)
      if (url.pathname === '/__dev' || url.pathname.startsWith('/__dev/')
        || [...url.searchParams.keys()].some(key => key.startsWith('__dev')
          || ['phase', 'mode', 'transport', 'trial', 'stabilize'].includes(key))) throw new HttpError(404, 'not_found')
      if (request.method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT')
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        return jsonResponse(204, undefined, headers)
      }
      const time = now()
      if (reset <= time) { count = 0; reset = time + 60000 }
      if (++count > 120 || active >= 8) {
        headers.set('Retry-After', '60')
        throw new HttpError(429, 'rate_limited')
      }
      active++; admitted = true
      if (url.pathname === '/health' && request.method === 'GET') return jsonResponse(200, { status: 'ok' }, headers)
      const authorization = request.headers.get('authorization') ?? undefined
      // Headers combines duplicates with commas; the strict single-Bearer syntax
      // rejects combined values before JWT/JWKS/userinfo or any DB work.
      if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization ?? '')
        || (authorization?.length ?? 0) > 16391) throw new AuthenticationError()
      const principal = await dependencies.authenticate(authorization)
      const body = await readBody(request)
      if (request.signal.aborted) throw new HttpError(408, 'request_timeout')
      if (!['GET', 'POST', 'PATCH', 'PUT'].includes(request.method)) throw new HttpError(404, 'not_found')
      return jsonResponse(200, await dependencies.dispatch(principal, request.method, url, body), headers)
    } catch (error) {
      if (error instanceof AuthenticationError) {
        headers.set('WWW-Authenticate', 'Bearer')
        return jsonResponse(401, { error: 'invalid_access_token' }, headers)
      }
      if (error instanceof IdentityUnavailableError) {
        headers.set('Retry-After', '2')
        return jsonResponse(503, { error: 'identity_unavailable' }, headers)
      }
      if (error instanceof HttpError) return jsonResponse(error.status, { error: error.code }, headers)
      return jsonResponse(503, { error: 'service_unavailable' }, headers)
    } finally {
      if (admitted) active--
    }
  }
}
