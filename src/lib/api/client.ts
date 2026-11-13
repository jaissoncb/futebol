export class ApiError extends Error {
  readonly status: number
  constructor(status: number, readonly kind: 'http' | 'local' | 'transport' = 'http') {
    super('Não foi possível concluir a operação.'); this.status = status
  }
}

// One instance per authenticated context. No token/data persistence or retries
// across accounts. Auth provider must close this instance before logout/switch.
export function createApiClient(baseUrl: string, getAccessToken: () => Promise<string | null>, transport = fetch,
  onFailure?: (error: ApiError, path: string) => void) {
  const base = new URL(baseUrl)
  const local = base.protocol === 'http:' && base.hostname === 'localhost' && base.port === '8787'
  if ((base.protocol !== 'https:' && !local)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('API Futebol inválida.')
  }
  let closed = false
  let suspended = false
  const requests = new Set<AbortController>()
  const closedListeners = new Set<() => void>()
  function suspend() {
    suspended = true
    for (const request of requests) request.abort()
    requests.clear()
  }
  return {
    isClosed: () => closed,
    subscribeClosed: (listener: () => void) => {
      if (!closed) closedListeners.add(listener)
      return () => { closedListeners.delete(listener) }
    },
    suspend,
    resume() { if (!closed) suspended = false },
    close() {
      if (closed) return
      closed = true
      suspend()
      for (const listener of closedListeners) listener()
      closedListeners.clear()
    },
    async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
      if (suspended) throw new ApiError(401, 'local')
      const url = new URL(path, base)
      if (!path.startsWith('/') || path.startsWith('//') || url.origin !== base.origin || url.hash) throw new ApiError(400)
      const controller = new AbortController()
      requests.add(controller)
      const timeout = setTimeout(() => controller.abort(), 20000)
      try {
        const token = await getAccessToken()
        if (!requests.has(controller) || !token) throw new ApiError(401, 'local')
        if (controller.signal.aborted) throw new ApiError(0, 'transport')
        const response = await transport(url, { method, signal: controller.signal, credentials: 'omit', cache: 'no-store',
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' })
        if (!requests.has(controller)) throw new ApiError(401, 'local')
        if (controller.signal.aborted) throw new ApiError(0, 'transport')
        const result = response.ok ? await response.json() as T : undefined
        if (controller.signal.aborted) throw new ApiError(0, 'transport')
        // Recheck the lease after parsing, including when a throttled timer has not run.
        if (!requests.has(controller) || await getAccessToken() !== token || !requests.has(controller)) throw new ApiError(401, 'local')
        if (controller.signal.aborted) throw new ApiError(0, 'transport')
        if (!response.ok) throw new ApiError(response.status)
        return result as T
      } catch (cause) {
        if (!requests.has(controller)) throw new ApiError(401, 'local')
        const error = cause instanceof ApiError ? cause : new ApiError(0, 'transport')
        if (error.kind !== 'local') onFailure?.(error, url.pathname)
        throw error
      } finally { clearTimeout(timeout); requests.delete(controller) }
    },
  }
}
