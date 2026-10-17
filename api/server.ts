import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Principal } from './auth.ts'
import { AuthenticationError } from './auth.ts'

export interface ApiDependencies {
  authenticate: (authorization: string | undefined) => Promise<Principal>
  dispatch: (principal: Principal, method: string, url: URL, body: unknown) => Promise<unknown>
}
export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code }
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  if (!['POST', 'PATCH', 'PUT'].includes(request.method ?? '')) return undefined
  if (request.headers['content-type'] !== 'application/json') throw new HttpError(415, 'json_required')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array)
    length += bytes.length
    if (length > 262144) throw new HttpError(413, 'payload_too_large')
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new HttpError(400, 'invalid_json') }
}
function reply(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer' })
  response.end(JSON.stringify(value))
}
export function createApi(dependencies: ApiDependencies) {
  // Memory bounded limiter for local DEV. Distributed hosting must supply its own limiter.
  const buckets = new Map<string, { count: number; reset: number }>()
  return createServer({ maxHeaderSize: 16384, requestTimeout: 20000, headersTimeout: 10000 }, (request, response) => {
    void (async () => {
      response.setHeader('Vary', 'Origin')
      const origin = request.headers.origin
      if (origin && origin !== 'http://localhost:5173') throw new HttpError(403, 'origin_denied')
      if (origin) response.setHeader('Access-Control-Allow-Origin', origin)
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT')
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        reply(response, 204, undefined); return
      }
      const now = Date.now()
      for (const [key, bucket] of buckets) if (bucket.reset < now) buckets.delete(key)
      const address = request.socket.remoteAddress ?? 'unknown'
      const bucket = buckets.get(address) ?? { count: 0, reset: now + 60000 }
      if (++bucket.count > 120 || (!buckets.has(address) && buckets.size >= 10000)) throw new HttpError(429, 'rate_limited')
      buckets.set(address, bucket)
      const url = new URL(request.url ?? '/', 'http://localhost:8787')
      if (url.pathname === '/health' && request.method === 'GET') {
        reply(response, 200, { status: 'dev', authentication: 'gated' }); return
      }
      // Authenticate before body parsing and, critically, before DB dispatch/bootstrap.
      const principal = await dependencies.authenticate(request.headers.authorization)
      const body = await readBody(request)
      reply(response, 200, await dependencies.dispatch(principal, request.method ?? '', url, body))
    })().catch((error: unknown) => {
      if (error instanceof AuthenticationError) {
        response.setHeader('WWW-Authenticate', 'Bearer')
        reply(response, 401, { error: 'invalid_access_token' })
      } else if (error instanceof HttpError) reply(response, error.status, { error: error.code })
      else reply(response, 503, { error: 'service_unavailable' })
      // No request/headers/body/error logging: provider errors may contain secrets.
    })
  })
}
