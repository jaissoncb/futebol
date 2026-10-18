export class ApiError extends Error {
  readonly status: number
  constructor(status: number) { super('Não foi possível concluir a operação.'); this.status = status }
}

// One instance per authenticated context. No token/data persistence or retries
// across accounts. Auth provider must close this instance before logout/switch.
export function createApiClient(baseUrl: string, getAccessToken: () => Promise<string | null>, transport = fetch) {
  const base = new URL(baseUrl)
  if (base.origin !== 'http://localhost:8787' || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('API DEV inválida.')
  }
  let closed = false
  const requests = new Set<AbortController>()
  const closedListeners = new Set<() => void>()
  return {
    isClosed: () => closed,
    subscribeClosed: (listener: () => void) => {
      if (!closed) closedListeners.add(listener)
      return () => { closedListeners.delete(listener) }
    },
    close() {
      if (closed) return
      closed = true
      for (const request of requests) request.abort()
      requests.clear()
      for (const listener of closedListeners) listener()
      closedListeners.clear()
    },
    async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
      if (closed) throw new ApiError(401)
      const url = new URL(path, base)
      if (!path.startsWith('/') || path.startsWith('//') || url.origin !== base.origin || url.hash) throw new ApiError(400)
      const controller = new AbortController()
      requests.add(controller)
      const timeout = setTimeout(() => controller.abort(), 20000)
      try {
        const token = await getAccessToken()
        if (closed || !token) throw new ApiError(401)
        const response = await transport(url, { method, signal: controller.signal, credentials: 'omit', cache: 'no-store',
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' })
        if (!response.ok) throw new ApiError(response.status)
        const result = await response.json() as T
        if (closed || controller.signal.aborted) throw new ApiError(401)
        return result
      } finally { clearTimeout(timeout); requests.delete(controller) }
    },
  }
}
