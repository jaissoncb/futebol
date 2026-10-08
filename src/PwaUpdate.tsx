import { useEffect, useRef, useState } from 'react'

/** A new worker waits: updating must never silently discard a draw or retry. */
export function PwaUpdate({ pending }: { pending: boolean }) {
  const [available, setAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = useRef<((reload?: boolean) => Promise<void>) | null>(null)
  useEffect(() => {
    if (!import.meta.env.PROD) return
    void import('virtual:pwa-register').then(({ registerSW }) => {
      update.current = registerSW({ onNeedRefresh: () => setAvailable(true) })
    }).catch(() => { /* The installed offline shell can remain usable without registration. */ })
  }, [])
  return available ? <aside className="notice pwa-update" aria-label="Atualização disponível">
    <p role="status">Há uma nova versão. Salve seus dados antes de atualizar.</p>
    {error ? <p role="alert">{error}</p> : null}
    <button className="quiet-action" type="button" disabled={pending} onClick={() => {
      if (window.confirm('Atualizar recarrega o aplicativo e descarta dados que ainda não foram salvos. Atualizar agora?')) {
        setError(null)
        void update.current?.(true).catch(() => setError('Não foi possível atualizar. Confira a conexão e tente novamente.'))
      }
    }}>Atualizar aplicativo</button>
  </aside> : null
}
