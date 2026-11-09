import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** A new worker waits: updating must never silently discard a draw or retry. */
export function PwaUpdate({ pending }: { pending: boolean }) {
  const [available, setAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const starting = useRef(false)
  const reloadRequested = useRef(false)
  const activated = useRef(false)
  const hasPending = useRef(pending)
  useLayoutEffect(() => { hasPending.current = pending }, [pending])
  const update = useRef<((reload?: boolean) => Promise<void>) | null>(null)
  useEffect(() => {
    if (!import.meta.env.PROD) return
    let mounted = true
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (!mounted) return
      update.current = registerSW({
        onNeedRefresh: () => { if (mounted) setAvailable(true) },
        onNeedReload: () => {
          if (!mounted) return
          activated.current = true
          // A different tab can activate the worker. Reload only on local consent.
          if (reloadRequested.current && !hasPending.current) window.location.reload()
          reloadRequested.current = false
          setAvailable(true)
        },
      })
    }).catch(() => { /* The installed offline shell can remain usable without registration. */ })
    return () => { mounted = false }
  }, [])
  return available ? <aside className="notice pwa-update" aria-label="Atualização disponível">
    <p role="status">Há uma nova versão. Salve seus dados antes de atualizar.</p>
    {error ? <p role="alert">{error}</p> : null}
    <button className="quiet-action" type="button" disabled={pending || updating} onClick={() => {
      if (pending || starting.current || !update.current) return
      if (activated.current) { window.location.reload(); return }
      starting.current = true; reloadRequested.current = true; setUpdating(true); setError(null)
      void update.current(true).catch(() => {
        reloadRequested.current = false
        setError('Não foi possível atualizar. Confira a conexão e tente novamente.')
      })
        .finally(() => { starting.current = false; setUpdating(false) })
    }}>{updating ? 'Atualizando…' : 'Atualizar aplicativo'}</button>
  </aside> : null
}
