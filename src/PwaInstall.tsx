import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Result = 'accepted' | 'dismissed' | 'installed' | 'unavailable' | null

const InstallContext = createContext<{
  standalone: boolean
  ready: boolean
  requesting: boolean
  result: Result
  request: () => Promise<void>
} | null>(null)

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [standalone, setStandalone] = useState(isStandalone)
  const [ready, setReady] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const prompt = useRef<InstallPromptEvent | null>(null)
  const settled = useRef(false)

  useEffect(() => {
    const mode = window.matchMedia?.('(display-mode: standalone)')
    const syncMode = () => setStandalone(isStandalone())
    const capture = (event: Event) => {
      if (settled.current || isStandalone()) return
      const candidate = event as InstallPromptEvent
      if (typeof candidate.prompt !== 'function') return
      event.preventDefault()
      prompt.current = candidate
      setReady(true)
    }
    const installed = () => {
      settled.current = true
      prompt.current = null
      setReady(false)
      setResult('installed')
    }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', installed)
    mode?.addEventListener?.('change', syncMode)
    syncMode()
    return () => {
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('appinstalled', installed)
      mode?.removeEventListener?.('change', syncMode)
    }
  }, [])

  async function request() {
    const candidate = prompt.current
    if (!candidate || settled.current || isStandalone()) return
    prompt.current = null
    settled.current = true
    setReady(false)
    setRequesting(true)
    try {
      const { outcome } = await candidate.prompt()
      setResult(previous => previous === 'installed' ? previous : outcome)
    } catch {
      setResult(previous => previous === 'installed' ? previous : 'unavailable')
    } finally {
      setRequesting(false)
    }
  }

  return <InstallContext.Provider value={{ standalone, ready, requesting, result, request }}>
    {children}
  </InstallContext.Provider>
}

export function PwaInstall() {
  const install = useContext(InstallContext)
  const returnFocus = useRef(false)
  const status = useRef<HTMLSpanElement>(null)
  const guide = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!install?.result || install.requesting || !returnFocus.current) return
    returnFocus.current = false
    if (document.activeElement === document.body) (guide.current ?? status.current)?.focus()
  }, [install?.requesting, install?.result])
  if (!install || install.standalone) return null
  const { ready, requesting, result, request } = install
  const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const message = result === 'installed' ? 'O Futebol foi instalado.'
    : result === 'accepted' ? 'Pedido de instalação aceito pelo navegador.'
    : result === 'dismissed' ? 'Instalação cancelada.'
    : result === 'unavailable' ? 'O navegador não abriu a instalação. Confira as instruções abaixo.' : ''

  return <div className="pwa-install">
    <span ref={status} role="status" tabIndex={-1}>{message}</span>
    {ready || requesting
      ? <button type="button" className="quiet-action" aria-disabled={requesting}
          onClick={event => {
            if (requesting) return
            returnFocus.current = document.activeElement === event.currentTarget
            void request()
          }}>Instalar Futebol</button>
      : !result || result === 'unavailable' ? <details>
        <summary ref={guide}>Como instalar o Futebol</summary>
        {appleMobile ? <p>No Safari, toque em <strong>Compartilhar</strong> e em <strong>Adicionar à Tela de Início</strong>.
          Se precisar, procure em Ver Mais ou Editar Ações. Ative <strong>Abrir como App</strong> se aparecer e toque em <strong>Adicionar</strong>.</p>
          : <p>No menu do navegador, procure <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.
            Se a opção não aparecer, continue usando o Futebol pelo navegador.</p>}
      </details> : null}
  </div>
}
