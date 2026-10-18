import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { KindeProvider, useKindeAuth } from '@kinde-oss/kinde-auth-react'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { cleanKindeCallback } from '../bootstrap/kinde-return'
import { createFutebolAuthorization } from '../auth/kinde-authorization'
import { ApiError } from '../lib/api/client'
import { createFutebolApiServices, type FutebolApiServices } from '../lib/api/services'
import { DevWorkspace } from './DevWorkspace'
import { accountPortalUrl, kindeTestConfig } from './kinde-test-config'
import { createG3BrowserProbe } from './g3-probe'
import { PwaUpdate } from '../PwaUpdate'
import { StabilizationPanel } from './StabilizationPanel'

type Session = ReturnType<typeof configureKindeSession>
type Callbacks = NonNullable<ComponentProps<typeof KindeProvider>['callbacks']>
const noClientSubscription = () => () => undefined
const noClientClosed = () => true

export function KindeDevRoot({ session, initialFailed = false }: { session: Session; initialFailed?: boolean }) {
  const [failed, setFailed] = useState(initialFailed)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const [probeStatus, setProbeStatus] = useState('')
  const probe = useMemo(() => createG3BrowserProbe(setProbeStatus), [])
  useEffect(() => () => probe.close(), [probe])
  const callbacks = useMemo<Callbacks>(() => ({
    onEvent: (event, _state, context) => {
      // No manual refresh control: the official SDK timer/focus owns refresh.
      if (String(event) === 'tokenRefreshed' && _state.success === true) {
        setRefreshEpoch(value => value + 1)
        void context.getAccessToken().then(token => probe.refreshed(token))
          .catch(() => setProbeStatus('G3 automatic: indisponível. Dados bloqueados.'))
      }
    },
    onSuccess: (_user, state) => {
      setFailed(false)
      setSessionEpoch(value => value + 1)
      window.history.replaceState({}, '', cleanKindeCallback(new URL(window.location.href), state.returnHash))
    },
    onError: (failure, _state, context) => {
      // The SDK treats a fresh anonymous page as a missing-refresh result.
      if (failure.error === 'ERR_CHECK_AUTH' && failure.errorDescription === 'No refresh token found' && !context.isAuthenticated) return
      setFailed(true)
      setSessionEpoch(value => value + 1)
      session.transaction.destroySession()
      probe.close()
      window.history.replaceState({}, '', cleanKindeCallback(new URL(window.location.href), '#/'))
      // Never retain/display provider descriptions, callback parameters or tokens.
    },
  }), [session, probe])
  return <KindeProvider {...kindeTestConfig} scope={KINDE_SCOPE} store={session.memory}
    useInsecureForRefreshToken={false} refreshOnFocus callbacks={callbacks}>
    {/* Default SDK loading gate completes callback handling before HashRouter mounts. */}
    <HashRouter><Routes>
      <Route path="/" element={<DevHome key={sessionEpoch} session={session} failed={failed} probe={probe} probeStatus={probeStatus} refreshEpoch={refreshEpoch} />} />
      <Route path="/conta" element={<DevHome key={sessionEpoch} session={session} failed={failed} probe={probe} probeStatus={probeStatus} refreshEpoch={refreshEpoch} />} />
      <Route path="*" element={<Link to="/">Voltar ao Futebol</Link>} />
    </Routes></HashRouter>
  </KindeProvider>
}

function DevHome({ session, failed, probe, probeStatus, refreshEpoch }: { session: Session; failed: boolean;
  probe: ReturnType<typeof createG3BrowserProbe>; probeStatus: string; refreshEpoch: number }) {
  const auth = useKindeAuth()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [locallySignedOut, setLocallySignedOut] = useState(false)
  const activeSession = auth.isAuthenticated && !locallySignedOut && !failed
  const [workspace, setWorkspace] = useState<{ services: FutebolApiServices; internalId: string; generation: number } | null>(null)
  const workspaceClosed = useSyncExternalStore(workspace?.services.subscribeClosed ?? noClientSubscription,
    workspace?.services.isClosed ?? noClientClosed, noClientClosed)
  const logoutLock = useRef(false)
  const clients = useRef(new Set<FutebolApiServices>())
  const generation = useRef(0)
  const checkedRefresh = useRef(refreshEpoch)
  const closePrivateRequests = useCallback(() => {
    generation.current++
    for (const client of clients.current) client.close()
    clients.current.clear()
  }, [])
  useEffect(() => {
    if (!auth.isAuthenticated) closePrivateRequests()
    return closePrivateRequests
  }, [auth.isAuthenticated, closePrivateRequests])
  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('futebol-dev-session')
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'logout') {
        probe.close(); closePrivateRequests(); session.transaction.destroySession(); setLocallySignedOut(true); setWorkspace(null); setStatus(null); setBusy(false)
      }
    }
    return () => channel?.close()
  }, [session, closePrivateRequests, probe])
  useEffect(() => {
    if (!workspace || workspace.generation !== generation.current || !activeSession) { checkedRefresh.current = refreshEpoch; return }
    if (checkedRefresh.current === refreshEpoch) return
    checkedRefresh.current = refreshEpoch
    const requestGeneration = generation.current
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const rejectSession = () => {
      closePrivateRequests(); setWorkspace(null); setStatus('Não foi possível confirmar o acesso. Entre novamente.')
    }
    // Only a successful official SDK event triggers this check. The retained
    // client obtains the renewed access from SDK memory; UUID must stay stable.
    const checkProfile = (retried = false): void => {
      if (cancelled || requestGeneration !== generation.current) return
      void workspace.services.me().then(profile => {
        if (cancelled || requestGeneration !== generation.current) return
        if (profile.id !== workspace.internalId) rejectSession()
        else setStatus(null)
      }).catch((error: unknown) => {
        if (cancelled || requestGeneration !== generation.current) return
        if (error instanceof ApiError && error.status === 503 && !retried) {
          retryTimer = setTimeout(() => checkProfile(true),2000)
          return
        }
        if (error instanceof ApiError && [401,403].includes(error.status)) rejectSession()
        else setStatus('Não foi possível confirmar a sessão agora. Tente novamente em instantes.')
        // Availability failures never authorize new data; the API still requires
        // fresh G3 per request. Keep a frozen save attempt available for safe retry.
      })
    }
    checkProfile()
    return () => { cancelled = true; clearTimeout(retryTimer) }
  }, [refreshEpoch, workspace, activeSession, closePrivateRequests])

  async function login(register = false) {
    setStatus(null)
    try {
      const url = await createFutebolAuthorization(window.location.hash, register)
      window.location.assign(url.href)
    } catch { setStatus('Não foi possível iniciar o acesso. Tente novamente.') }
  }
  async function logout() {
    if (logoutLock.current) return
    logoutLock.current = true; setLoggingOut(true)
    setLocallySignedOut(true)
    probe.close()
    closePrivateRequests(); setWorkspace(null); setStatus(null); setBusy(true)
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('futebol-dev-session')
    channel?.postMessage('logout'); channel?.close()
    try { await auth.logout() } // normal Kinde logout, never allSessions:true
    catch { setStatus('A sessão local foi encerrada. Tente sair novamente do Sabará ID.') }
    finally { session.transaction.destroySession(); logoutLock.current = false; setLoggingOut(false); setBusy(false) }
  }
  async function checkAccess() {
    if (busy || !activeSession) return
    const requestGeneration = generation.current
    const client = createFutebolApiServices(async () => (await auth.getAccessToken()) ?? null)
    let retained = false
    clients.current.add(client); setBusy(true); setStatus(null)
    try {
      const profile = await client.me()
      const repeated = await client.me() // DEV vertical proof of idempotent /me.
      if (repeated.id !== profile.id) throw new Error('inconsistent_profile')
      if (requestGeneration === generation.current) {
        retained = true; probe.close()
        setWorkspace({ services: client, internalId: profile.id, generation: requestGeneration })
      }
    } catch (error) {
      if (requestGeneration === generation.current) setStatus(error instanceof ApiError && error.status === 401
        ? 'A integração DEV ainda está em validação.' : 'Não foi possível verificar o acesso agora.')
    } finally {
      if (!retained) { client.close(); clients.current.delete(client) }
      if (requestGeneration === generation.current) setBusy(false)
    }
  }
  async function startProbe() {
    try {
      const access = await auth.getAccessToken()
      if (access) await probe.start(access, await auth.getIdToken())
    } catch { setStatus('Não foi possível iniciar o diagnóstico. Dados bloqueados.') }
  }
  if (workspace && !workspaceClosed && activeSession) return <DevWorkspace services={workspace.services} internalId={workspace.internalId}
    onLogout={logout} loggingOut={loggingOut} sessionNotice={status}
    diagnostics={<StabilizationPanel active={activeSession} getAccessToken={auth.getAccessToken} refreshEpoch={refreshEpoch} privateRead={workspace.services.stabilizationRead} />} />
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a><span>DEV</span></header>
    <main className="main-content"><PwaUpdate pending={busy || loggingOut} /><section className="hero-card">
      <p className="eyebrow">Sabará ID · Ambiente de teste</p>
      <h1>Seu Futebol com Sabará ID.</h1>
      <p>Integração DEV em validação. Os grupos e as partidas serão liberados após os testes de acesso.</p>
      {failed ? <p role="alert">Não foi possível concluir a autenticação. Entre novamente.</p> : null}
      {activeSession ? <>
        <p role="status">Login Kinde concluído nesta aba.</p>
        <button className="primary-action" disabled={busy} onClick={() => void checkAccess()}>Verificar acesso ao Futebol</button>
        <button disabled={loggingOut} onClick={() => void logout()}>Sair</button>
        <button disabled={busy || loggingOut} onClick={() => void startProbe()}>Iniciar diagnóstico G3</button>
      </> : <>
        <button className="primary-action" disabled={busy} onClick={() => void login()}>Entrar com Sabará ID</button>
        <button disabled={busy} onClick={() => void login(true)}>Criar conta no Sabará ID</button>
      </>}
      {status ? <p role="status">{status}</p> : null}
      {probeStatus ? <p role="status">{probeStatus}</p> : null}
      <StabilizationPanel active={activeSession} getAccessToken={auth.getAccessToken} refreshEpoch={refreshEpoch} />
      <p><a href={accountPortalUrl} rel="noopener noreferrer" target="_blank">Gerenciar minha conta Sabará</a></p>
      <p className="helper-text">Ao recarregar ou abrir outra aba, pode ser necessário entrar novamente.</p>
    </section></main>
  </div>
}
