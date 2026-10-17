import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { KindeProvider, useKindeAuth } from '@kinde-oss/kinde-auth-react'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { cleanKindeCallback } from '../bootstrap/kinde-return'
import { createFutebolAuthorization } from '../auth/kinde-authorization'
import { ApiError, createApiClient } from '../lib/api/client'
import { accountPortalUrl, kindeTestConfig } from './kinde-test-config'

type Session = ReturnType<typeof configureKindeSession>
type Callbacks = NonNullable<ComponentProps<typeof KindeProvider>['callbacks']>

export function KindeDevRoot({ session, initialFailed = false }: { session: Session; initialFailed?: boolean }) {
  const [failed, setFailed] = useState(initialFailed)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const callbacks = useMemo<Callbacks>(() => ({
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
      window.history.replaceState({}, '', cleanKindeCallback(new URL(window.location.href), '#/'))
      // Never retain/display provider descriptions, callback parameters or tokens.
    },
  }), [session])
  return <KindeProvider {...kindeTestConfig} scope={KINDE_SCOPE} store={session.memory}
    useInsecureForRefreshToken={false} refreshOnFocus callbacks={callbacks}>
    {/* Default SDK loading gate completes callback handling before HashRouter mounts. */}
    <HashRouter><Routes>
      <Route path="/" element={<DevHome key={sessionEpoch} session={session} failed={failed} />} />
      <Route path="/conta" element={<DevHome key={sessionEpoch} session={session} failed={failed} />} />
      <Route path="*" element={<Link to="/">Voltar ao Futebol</Link>} />
    </Routes></HashRouter>
  </KindeProvider>
}

function DevHome({ session, failed }: { session: Session; failed: boolean }) {
  const auth = useKindeAuth()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const logoutLock = useRef(false)
  const clients = useRef(new Set<ReturnType<typeof createApiClient>>())
  const generation = useRef(0)
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
        closePrivateRequests(); session.transaction.destroySession(); setStatus(null); setBusy(false)
      }
    }
    return () => channel?.close()
  }, [session, closePrivateRequests])

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
    closePrivateRequests(); setStatus(null); setBusy(true)
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('futebol-dev-session')
    channel?.postMessage('logout'); channel?.close()
    try { await auth.logout() } // normal Kinde logout, never allSessions:true
    catch { setStatus('A sessão local foi encerrada. Tente sair novamente do Sabará ID.') }
    finally { session.transaction.destroySession(); logoutLock.current = false; setLoggingOut(false); setBusy(false) }
  }
  async function checkAccess() {
    if (busy || !auth.isAuthenticated) return
    const requestGeneration = generation.current
    const client = createApiClient('http://localhost:8787', async () => (await auth.getAccessToken()) ?? null)
    clients.current.add(client); setBusy(true); setStatus(null)
    try {
      await client.request('/me')
      if (requestGeneration === generation.current) setStatus('Acesso ao Futebol confirmado.')
    } catch (error) {
      if (requestGeneration === generation.current) setStatus(error instanceof ApiError && error.status === 401
        ? 'A integração DEV ainda está em validação.' : 'Não foi possível verificar o acesso agora.')
    } finally {
      client.close(); clients.current.delete(client)
      if (requestGeneration === generation.current) setBusy(false)
    }
  }
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a><span>DEV</span></header>
    <main className="main-content"><section className="hero-card">
      <p className="eyebrow">Sabará ID · Ambiente de teste</p>
      <h1>Seu Futebol com Sabará ID.</h1>
      <p>Integração DEV em validação. Os grupos e as partidas serão liberados após os testes de acesso.</p>
      {failed ? <p role="alert">Não foi possível concluir a autenticação. Entre novamente.</p> : null}
      {auth.isAuthenticated ? <>
        <p role="status">Login Kinde concluído nesta aba.</p>
        <button className="primary-action" disabled={busy} onClick={() => void checkAccess()}>Verificar acesso ao Futebol</button>
        <button disabled={loggingOut} onClick={() => void logout()}>Sair</button>
      </> : <>
        <button className="primary-action" disabled={busy} onClick={() => void login()}>Entrar com Sabará ID</button>
        <button disabled={busy} onClick={() => void login(true)}>Criar conta no Sabará ID</button>
      </>}
      {status ? <p role="status">{status}</p> : null}
      <p><a href={accountPortalUrl} rel="noopener noreferrer" target="_blank">Gerenciar minha conta Sabará</a></p>
      <p className="helper-text">Ao recarregar ou abrir outra aba, pode ser necessário entrar novamente.</p>
    </section></main>
  </div>
}
