import { invalidateDrafts, isDraftLogout } from '../drafts/store'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { KindeProvider, useKindeAuth } from '@kinde-oss/kinde-auth-react'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { cleanKindeCallback } from '../bootstrap/kinde-return'
import { createFutebolAuthorization } from '../auth/kinde-authorization'
import type { FutebolFrontendConfiguration } from '../config/futebol-environment'
import { PwaUpdate } from '../PwaUpdate'
import { PwaInstall, PwaInstallProvider } from '../PwaInstall'
import { FutebolWorkspace } from './FutebolWorkspace'
import { clearSelectedGroup } from '../groups/selected-group'
import { createFutebolSession } from './futebol-session'

type Session = ReturnType<typeof configureKindeSession>
type Callbacks = NonNullable<ComponentProps<typeof KindeProvider>['callbacks']>
type Controller = ReturnType<typeof createFutebolSession>

export function FutebolRoot({ config, session, initialFailed = false }: {
  config: FutebolFrontendConfiguration; session: Session; initialFailed?: boolean
}) {
  const controller = useMemo(() => createFutebolSession(config, session, initialFailed), [config, session, initialFailed])
  useEffect(() => controller.mount(), [controller])
  const [logoutFailed, setLogoutFailed] = useState(false)
  const logoutLockRef = useRef(false)
  const channelName = `futebol-${config.environment}-session`
  useLayoutEffect(() => {
    // Register before the SDK bootstrap can delay mounting its children.
    const end = () => { clearSelectedGroup(); controller.end() }
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName)
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => { if (event.data === 'logout') end() }
    const storage = (event: StorageEvent) => { if (isDraftLogout(event, config.environment)) end() }
    window.addEventListener('storage', storage)
    return () => { channel?.close(); window.removeEventListener('storage', storage) }
  }, [controller, channelName, config.environment])
  const callbacks = useMemo<Callbacks>(() => ({
    onSuccess: (_user, state) => {
      controller.sdkSuccess()
      window.history.replaceState({}, '', cleanKindeCallback(new URL(window.location.href), state.returnHash, config.appOrigin))
    },
    onError: (failure) => {
      if (failure.error === 'ERR_CHECK_AUTH') {
        controller.startupFailure(failure.errorDescription)
      } else if (logoutLockRef.current && (failure.error === 'ERR_LOGOUT' || failure.error === 'ERR_POPUP')) {
        setLogoutFailed(true)
      } else if (failure.error !== 'ERR_REFRESH_TOKEN' && new URL(window.location.href).searchParams.has('code')) {
        controller.end()
        window.history.replaceState({}, '', cleanKindeCallback(new URL(window.location.href), '#/', config.appOrigin))
      }
    },
  }), [controller, config])
  return <KindeProvider {...config.identity} scope={KINDE_SCOPE} store={session.memory}
    useInsecureForRefreshToken={false} refreshOnFocus={false} callbacks={callbacks}>
    <PwaInstallProvider><HashRouter>
      <FutebolHome config={config} controller={controller} logoutLockRef={logoutLockRef} logoutFailed={logoutFailed} />
    </HashRouter></PwaInstallProvider>
  </KindeProvider>
}

function FutebolHome({ config, controller, logoutLockRef, logoutFailed }: {
  config: FutebolFrontendConfiguration; controller: Controller; logoutLockRef: { current: boolean }; logoutFailed: boolean
}) {
  const auth = useKindeAuth()
  const { phase, workspace } = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const channelName = `futebol-${config.environment}-session`

  useEffect(() => {
    controller.syncAuth(auth.isAuthenticated, auth.isLoading, auth.user?.id)
  }, [auth.isAuthenticated, auth.isLoading, auth.user?.id, controller])

  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') controller.foreground() }
    const restored = (event: PageTransitionEvent) => { if (event.persisted) controller.foreground() }
    window.addEventListener('offline', controller.offline)
    window.addEventListener('online', controller.online)
    window.addEventListener('pageshow', restored)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('offline', controller.offline)
      window.removeEventListener('online', controller.online)
      window.removeEventListener('pageshow', restored)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [controller])

  async function login(register = false) {
    setStatus(null); setBusy(true)
    try {
      const url = await createFutebolAuthorization(config.identity, window.location.hash, register)
      window.location.assign(url.href)
    } catch { setStatus('Não foi possível iniciar o acesso. Tente novamente.'); setBusy(false) }
  }

  async function logout() {
    if (logoutLockRef.current) return
    logoutLockRef.current = true
    setStatus(null); setBusy(true)
    clearSelectedGroup()
    controller.end()
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName)
    channel?.postMessage('logout'); channel?.close()
    try {
      await invalidateDrafts(config.environment).catch(() => {
        setStatus('A sessão local foi encerrada. Não foi possível confirmar a remoção dos rascunhos deste dispositivo.')
      })
      await auth.logout()
    }
    catch { setStatus('A sessão local foi encerrada. Tente sair novamente do Sabará ID.') }
    finally { logoutLockRef.current = false; setBusy(false) }
  }

  const loginAvailable = phase === 'anonymous' || phase === 'ended'
  const notice = phase === 'opening' || phase === 'recovering' ? 'Verificando sua sessão…'
    : phase === 'unavailable' ? 'Sessão temporariamente indisponível. Confira a conexão para continuar.'
    : phase === 'reauthenticate' ? 'Não foi possível renovar a sessão. Entre novamente com o Sabará ID.'
    : phase === 'denied' ? 'Seu acesso ao espaço de trabalho não foi confirmado.'
    : phase === 'ended' ? 'A sessão foi encerrada. Entre novamente.' : null
  const retry = phase === 'unavailable' || phase === 'denied'
    ? <button className="secondary-action" onClick={controller.retry}>Tentar novamente</button> : null
  const canReenter = phase === 'reauthenticate' || phase === 'unavailable'
  const reenter = canReenter && !workspace
    ? <button className="secondary-action" disabled={busy} onClick={() => void login()}>Entrar novamente com Sabará ID</button> : null
  const actions = notice ? <section className="notice" aria-label="Sessão do Futebol">
    <p role="status">{notice}</p>{retry}{reenter}
    {logoutFailed ? <p role="alert">A sessão local foi encerrada. Não foi possível confirmar a saída do Sabará ID.</p> : null}
    {status ? <p role="status">{status}</p> : null}
  </section> : null

  const home = workspace ? <FutebolWorkspace services={workspace.services} internalId={workspace.internalId}
    data={workspace.data} drafts={workspace.drafts} draftIssue={workspace.draftIssue} suspended={phase !== 'ready'} sessionActions={actions} onGroupsChanged={() => controller.foreground()}
    onReenter={canReenter ? () => login() : undefined}
    onLogout={logout} loggingOut={busy} environment={config.environment} />
    : <div className="app-shell">
      <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a>{config.environment === 'dev' ? <span>DEV</span> : null}</header>
      <main className="main-content"><PwaUpdate pending={busy || !loginAvailable} /><section className="hero-card futebol-welcome">
        <p className="eyebrow">Seu jogo, sem complicação</p>
        <h1>Times equilibrados em poucos toques.</h1>
        <p className="hero-copy">Selecione quem chegou, escolha dois ou três times e deixe o sorteio cuidar do resto.</p>
        {actions}
        {loginAvailable ? <div className="auth-form welcome-actions">
          <button className="primary-action" disabled={busy} onClick={() => void login()}>Entrar com Sabará ID</button>
          <button className="secondary-action" disabled={busy} onClick={() => void login(true)}>Criar conta no Sabará ID</button>
        </div> : <button className="secondary-action" disabled={busy} onClick={() => void logout()}>Sair</button>}
        {!notice && status ? <p role="status">{status}</p> : null}
        <p className="helper-text">Salve as partidas e consulte os times no histórico do seu grupo.</p>
      </section></main>
      <footer className="footer"><PwaInstall /><a className="topbar-link" href="https://account.sabara.org/" rel="noopener noreferrer" target="_blank">Gerenciar minha conta Sabará</a></footer>
    </div>
  return <Routes><Route path="/" element={home} /><Route path="/conta" element={home} />
    <Route path="*" element={<Link to="/">Voltar ao Futebol</Link>} /></Routes>
}
