type Phase = 'initial' | 'cache' | 'after_ttl' | 'automatic' | 'id_negative'
// Test tokens go directly from SDK memory to the API. Never decode/display/persist.
export function createG3BrowserProbe(report: (message: string) => void) {
  let enabled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  async function send(token: string, phase: Phase) {
    try {
      const response = await fetch(`http://localhost:8787/__dev/g3?phase=${phase}`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      })
      if (!controller.signal.aborted) report(`G3 ${phase}: HTTP ${response.status}. Dados bloqueados.`)
      return response.status
    } catch {
      if (!controller.signal.aborted) report(`G3 ${phase}: indisponível. Dados bloqueados.`)
      return 0
    }
  }
  return {
    async start(access: string, id: string | undefined) {
      if (enabled || controller.signal.aborted) return
      enabled = true
      if (await send(access, 'initial') !== 200) return
      if (id) await send(id, 'id_negative')
      await send(access, 'cache')
      // This captures the original access only in memory until the TTL test.
      timer = setTimeout(() => { void send(access, 'after_ttl') }, 61000)
    },
    async refreshed(access: string | undefined) {
      if (enabled && access && !controller.signal.aborted) await send(access, 'automatic')
    },
    close() { clearTimeout(timer); controller.abort(); enabled = false },
  }
}
