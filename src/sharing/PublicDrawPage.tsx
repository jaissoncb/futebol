import { useEffect, useState } from 'react'
import { isPublicDrawSlug, type PublicDraw } from './contracts'
import { Lineup } from './SharedLineup'
import { DRAW_TITLE, drawUrl } from './lineup'
import { ShareControls } from './ShareControls'
import './sharing.css'

type Result = { status: 'loading' | 'unavailable' | 'error' } | { status: 'ready'; draw: PublicDraw }

export function PublicDrawPage({ apiBase, address }: { apiBase: string; address: URL }) {
  const [result, setResult] = useState<Result>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const slug = address.searchParams.size === 1 ? address.searchParams.get('id') ?? '' : ''
  const valid = isPublicDrawSlug(slug)

  useEffect(() => {
    if (!valid) return
    let current: AbortController | null = null
    let expiryTimer: number | undefined
    function enforceExpiry(expiry: number) {
      const remaining = expiry - Date.now()
      if (remaining <= 0) setResult({ status: 'unavailable' })
      else expiryTimer = window.setTimeout(() => enforceExpiry(expiry), Math.min(remaining, 2147483647))
    }
    async function read() {
      current?.abort()
      const controller = new AbortController()
      current = controller
      window.clearTimeout(expiryTimer)
      setResult({ status: 'loading' })
      const endpoint = new URL('/shared-draw', apiBase)
      endpoint.searchParams.set('id', slug)
      const timeout = window.setTimeout(() => {
        controller.abort()
        if (current === controller) setResult({ status: 'error' })
      }, 15000)
      try {
        const response = await fetch(endpoint, {
          credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (response.status === 404) { setResult({ status: 'unavailable' }); return }
        if (!response.ok) throw new Error('unavailable')
        const draw = await response.json() as PublicDraw
        if (controller.signal.aborted) return
        const expiry = Date.parse(draw.expiresAt)
        if (!Number.isFinite(expiry)) throw new Error('invalid publication')
        setResult({ status: 'ready', draw })
        enforceExpiry(expiry)
      } catch {
        if (current === controller) setResult({ status: 'error' })
      } finally {
        window.clearTimeout(timeout)
      }
    }
    function whenVisible() {
      if (document.visibilityState === 'visible') void read()
    }
    function afterRestore(event: PageTransitionEvent) {
      if (event.persisted) void read()
    }
    let disposed = false
    queueMicrotask(() => { if (!disposed) void read() })
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('pageshow', afterRestore)
    return () => {
      disposed = true
      const previous = current
      current = null
      previous?.abort()
      window.clearTimeout(expiryTimer)
      document.removeEventListener('visibilitychange', whenVisible)
      window.removeEventListener('pageshow', afterRestore)
    }
  }, [apiBase, attempt, slug, valid])

  return <div className="public-draw-shell">
    <header className="public-draw-header">
      <a className="brand" href="/"><img width="40" height="40" src="/icons/app-icon-192.png" alt="" /> Futebol</a>
    </header>
    <main id="conteudo" className="public-draw-main">
      <section className="public-draw-lineup" aria-labelledby="draw-title">
        <h1 id="draw-title">{DRAW_TITLE}</h1>
        {!valid || result.status === 'unavailable' ? <div role="status">
          <p>Este link está indisponível. Ele pode estar incorreto, expirado ou revogado.</p>
          <p>Peça um link atualizado a quem organizou a partida.</p>
        </div> : result.status === 'loading' ? <p role="status">Carregando escalação…</p>
          : result.status === 'error' ? <div role="alert">
            <p>Não foi possível carregar a escalação. Verifique sua conexão e tente novamente.</p>
            <button className="quiet-action" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</button>
          </div> : result.status === 'ready' ? <>
            <Lineup snapshot={result.draw.snapshot} />
            <section className="public-draw-share" aria-labelledby="share-title">
              <h2 id="share-title">Compartilhar escalação</h2>
              <ShareControls snapshot={result.draw.snapshot} link={drawUrl(slug, address.origin)} />
            </section>
          </> : null}
      </section>
      <aside className="public-draw-cta" aria-labelledby="futebol-title">
        <h2 id="futebol-title">Também organiza futebol com amigos?</h2>
        <p>Crie seus grupos, organize jogadores e sorteie times equilibrados.</p>
        <a className="quiet-action" href="/">Conheça o Futebol</a>
      </aside>
    </main>
  </div>
}
