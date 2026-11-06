import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { KindeProvider, useKindeAuth } from '@kinde-oss/kinde-auth-react'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { cleanKindeCallback } from '../bootstrap/kinde-return'
import { createFutebolAuthorization } from '../auth/kinde-authorization'
import { accessContract } from '../auth/access-contract'
import { ApiError } from '../lib/api/client'
import { createFutebolApiServices, type FutebolApiServices } from '../lib/api/services'
import type { FutebolFrontendConfiguration } from '../config/futebol-environment'
import { PwaUpdate } from '../PwaUpdate'
import { FutebolWorkspace } from './FutebolWorkspace'

type Session = ReturnType<typeof configureKindeSession>
type Callbacks = NonNullable<ComponentProps<typeof KindeProvider>['callbacks']>
const noClientSubscription = () => () => undefined
const noClientClosed = () => true

export function FutebolRoot({ config, session, initialFailed = false }: {
  config: FutebolFrontendConfiguration; session: Session; initialFailed?: boolean
}) {
  const [failed, setFailed] = useState(initialFailed)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const callbacks = useMemo<Callbacks>(() => ({
    onEvent: (event, state) => {
      if (String(event) === 'tokenRefreshed' && state.success === true) setRefreshEpoch(value => value + 1)
    },
    onSuccess: (_user, state) => {
      setFailed(false); setSessionEpoch(value => value + 1)
      window.history.replaceState({}, '', cleanKindeCallback(new URL(window.location.href), state.returnHash, config.appOrigin))
    },
    onError: (failure, _state, context) => {
      // Expected anonymous startup must not erase a pending PKCE callback.
      if (failure.error === 'ERR_CHECK_AUTH' && failure.errorDescription === 'No refresh token found' && !context.isAuthenticated) return
      setFailed(true); setSessionEpoch(value => value + 1)
      session.transaction.destroySession()
      window.history.replaceState({}, '', cleanKindeCallback(new URL(window.location.href), '#/', config.appOrigin))
    },
  }), [session, config])
  return <KindeProvider {...config.identity} scope={KINDE_SCOPE} store={session.memory}
    useInsecureForRefreshToken={false} refreshOnFocus callbacks={callbacks}>
    <HashRouter><Routes>
      <Route path="/" element={<FutebolHome key={sessionEpoch} config={config} session={session} failed={failed} refreshEpoch={refreshEpoch} />} />
      <Route path="/conta" element={<FutebolHome key={sessionEpoch} config={config} session={session} failed={failed} refreshEpoch={refreshEpoch} />} />
      <Route path="*" element={<Link to="/">Voltar ao Futebol</Link>} />
    </Routes></HashRouter>
  </KindeProvider>
}

function FutebolHome({ config, session, failed, refreshEpoch }: {
  config: FutebolFrontendConfiguration; session: Session; failed: boolean; refreshEpoch: number
}) {
  const auth = useKindeAuth()
  const getAccessToken = auth.getAccessToken
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [locallySignedOut, setLocallySignedOut] = useState(false)
  const [accessAttempt, setAccessAttempt] = useState(0)
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
  const channelName = `futebol-${config.environment}-session`
  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName)
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'logout') {
        closePrivateRequests(); session.transaction.destroySession(); setLocallySignedOut(true)
        setWorkspace(null); setStatus(null); setBusy(false)
      }
    }
    return () => channel?.close()
  }, [session, closePrivateRequests, channelName])
  useEffect(() => {
    if (!activeSession) return closePrivateRequests
    const requestGeneration = generation.current
    let contractCodes: string[] = ['token_not_requested']
    const client = createFutebolApiServices(config.apiBaseUrl, async () => {
      const token = (await getAccessToken()) ?? null
      contractCodes = accessContract(token, config.identity)
      return token
    })
    clients.current.add(client)
    let cancelled = false
    void client.me().then(profile => {
      if (!cancelled && requestGeneration === generation.current) {
        setWorkspace({ services: client, internalId: profile.id, generation: requestGeneration })
        setStatus(null)
      }
    }).catch((error: unknown) => {
      if (!cancelled && requestGeneration === generation.current) {
        client.close(); clients.current.delete(client)
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          console.warn('futebol_access_denied', error.status, contractCodes.length ? contractCodes.join(',') : 'contract_matches')
          session.transaction.destroySession(); setLocallySignedOut(true)
        }
        setStatus(error instanceof ApiError && [401, 403].includes(error.status)
          ? 'Não foi possível confirmar o acesso. Entre novamente.' : 'Não foi possível abrir o Futebol agora. Tente novamente em instantes.')
      }
    })
    return () => { cancelled = true; closePrivateRequests() }
  }, [activeSession, accessAttempt, config.apiBaseUrl, config.identity, getAccessToken, closePrivateRequests, session])
  useEffect(() => {
    if (!workspace || workspace.generation !== generation.current || !activeSession) { checkedRefresh.current = refreshEpoch; return }
    if (checkedRefresh.current === refreshEpoch) return
    checkedRefresh.current = refreshEpoch
    const requestGeneration = generation.current
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const rejectSession = () => {
      closePrivateRequests(); setWorkspace(null); session.transaction.destroySession(); setLocallySignedOut(true)
      setStatus('Não foi possível confirmar o acesso. Entre novamente.')
    }
    const checkProfile = (retried = false): void => {
      if (cancelled || requestGeneration !== generation.current) return
      void workspace.services.me().then(profile => {
        if (cancelled || requestGeneration !== generation.current) return
        if (profile.id !== workspace.internalId) rejectSession()
        else setStatus(null)
      }).catch((error: unknown) => {
        if (cancelled || requestGeneration !== generation.current) return
        if (error instanceof ApiError && error.status === 503 && !retried) {
          retryTimer = setTimeout(() => checkProfile(true), 2000); return
        }
        if (error instanceof ApiError && [401, 403].includes(error.status)) rejectSession()
        else setStatus('Não foi possível confirmar a sessão agora. Tente novamente em instantes.')
        // Keep uncertain save attempts frozen for explicit retry with the same UUID.
      })
    }
    checkProfile()
    return () => { cancelled = true; clearTimeout(retryTimer) }
  }, [refreshEpoch, workspace, activeSession, closePrivateRequests, session])

  async function login(register = false) {
    setStatus(null); setBusy(true)
    try {
      const url = await createFutebolAuthorization(config.identity, window.location.hash, register)
      window.location.assign(url.href)
    } catch { setStatus('Não foi possível iniciar o acesso. Tente novamente.'); setBusy(false) }
  }
  async function logout() {
    if (logoutLock.current) return
    logoutLock.current = true; setLoggingOut(true); setLocallySignedOut(true)
    closePrivateRequests(); setWorkspace(null); setStatus(null); setBusy(true)
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName)
    channel?.postMessage('logout'); channel?.close()
    try { await auth.logout() }
    catch { setStatus('A sessão local foi encerrada. Tente sair novamente do Sabará ID.') }
    finally { session.transaction.destroySession(); logoutLock.current = false; setLoggingOut(false); setBusy(false) }
  }
  if (workspace && !workspaceClosed && activeSession) {
    return <FutebolWorkspace services={workspace.services} internalId={workspace.internalId} onLogout={logout}
      loggingOut={loggingOut} sessionNotice={status} environment={config.environment} />
  }
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a>{config.environment === 'dev' ? <span>DEV</span> : null}</header>
    <main className="main-content"><PwaUpdate pending={busy || loggingOut} /><section className="hero-card futebol-welcome">
      <p className="eyebrow">Seu jogo, sem complicação</p>
      <h1>Times equilibrados em poucos toques.</h1>
      <p className="hero-copy">Selecione quem chegou, escolha dois ou três times e deixe o sorteio cuidar do resto.</p>
      {failed ? <p role="alert">Não foi possível concluir a autenticação. Entre novamente.</p> : null}
      {activeSession ? <>
        {status ? <button className="primary-action" onClick={() => { setStatus(null); setAccessAttempt(value => value + 1) }}>Tentar novamente</button>
          : <p role="status">Abrindo seu Futebol…</p>}
        <button className="secondary-action" disabled={loggingOut} onClick={() => void logout()}>Sair</button>
      </> : <div className="auth-form welcome-actions">
        <button className="primary-action" disabled={busy} onClick={() => void login()}>Entrar com Sabará ID</button>
        <button className="secondary-action" disabled={busy} onClick={() => void login(true)}>Criar conta no Sabará ID</button>
      </div>}
      {status ? <p role="status">{status}</p> : null}
      <p className="helper-text">Salve as partidas e consulte os times no histórico do seu grupo.</p>
    </section></main>
    <footer className="footer"><a className="topbar-link" href="https://account.sabara.org/" rel="noopener noreferrer" target="_blank">Gerenciar minha conta Sabará</a></footer>
  </div>
}
