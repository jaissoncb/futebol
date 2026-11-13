import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
// @vitest-environment-options {"url":"http://localhost:5173/"}
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActiveStorage, StorageKeys } from '@kinde-oss/kinde-auth-react/utils'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { FutebolRoot } from './FutebolRoot'
import dev from '../../deployment/frontend-dev.json'
import { validateFutebolEnvironment } from '../config/futebol-environment'
import { readSelectedGroup, rememberSelectedGroup } from '../groups/selected-group'
import { group, players } from '../matches/test-fixtures'

const config = validateFutebolEnvironment(dev, 'dev')
const profileId = 'd0000000-0000-0000-0000-000000000001'
const anotherId = 'd0000000-0000-0000-0000-000000000002'
const mocks = vi.hoisted(() => ({
  provider: vi.fn<(props: Record<string, unknown>) => boolean | undefined>(),
  auth: { isAuthenticated: true, isLoading: false, user: { id: 'fixture' }, logout: vi.fn<() => Promise<void>>() },
}))
vi.mock('@kinde-oss/kinde-auth-react', () => ({
  KindeProvider: ({ children, ...props }: { children: ReactNode }) => mocks.provider(props) === false ? null : children,
  useKindeAuth: () => mocks.auth,
}))

const jwt = (lifetime: number, subject = 'fixture') =>
  'e30.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + lifetime, sub: subject })).replace(/=+$/, '') + '.fixture'
const requestUrl = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : input)
const draftField = () => screen.getByRole('textbox', { name: /Nome.*opcional/ })
const signIn = () => screen.getByRole('button', { name: 'Entrar com Sabará ID' })
const foreground = () => fireEvent(document, new Event('visibilitychange'))
const disconnect = () => fireEvent(window, new Event('offline'))
const connect = () => fireEvent(window, new Event('online'))

function fixture(lifetime = 600) {
  const session = configureKindeSession()
  setActiveStorage(session.memory)
  session.memory.setSessionItem(StorageKeys.accessToken, jwt(lifetime))
  session.memory.setSessionItem(StorageKeys.refreshToken, 'synthetic-memory-refresh')
  const destroy = vi.spyOn(session.transaction, 'destroySession')
  const response = (url: URL) => {
    switch (url.pathname) {
      case '/oauth2/token': return Response.json({ access_token: jwt(600), refresh_token: 'rotated', expires_in: 600 })
      case '/me': return Response.json({ id: profileId })
      default: return Response.json({ groups: [group], players })
    }
  }
  const request = vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(response(requestUrl(url))))
  vi.stubGlobal('fetch', request)
  const view = render(<FutebolRoot config={config} session={session} />)
  const calls = (path: string) => request.mock.calls.filter(([url]) => requestUrl(url).pathname === path)
  return { session, destroy, response, request, view, calls }
}

describe('Futebol session boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.provider.mockReturnValue(undefined)
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/#/')
    mocks.auth.isAuthenticated = true
    mocks.auth.isLoading = false
    mocks.auth.user = { id: 'fixture' }
    mocks.auth.logout.mockResolvedValue(undefined)
    vi.stubGlobal('BroadcastChannel', undefined)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('leaves an anonymous startup and its PKCE transaction intact', () => {
    mocks.auth.isAuthenticated = false
    mocks.auth.isLoading = true
    const { request, session, destroy, view } = fixture()
    const props = mocks.provider.mock.calls[0]![0]
    expect(props).toMatchObject({ ...config.identity, scope: KINDE_SCOPE, store: session.memory,
      useInsecureForRefreshToken: false, refreshOnFocus: false })
    const callbacks = props.callbacks as { onError: (failure: { error: string; errorDescription: string }) => void }
    window.history.replaceState({}, '', '/?code=synthetic&state=synthetic#/')
    callbacks.onError({ error: 'ERR_CHECK_AUTH', errorDescription: 'No refresh token found' })
    mocks.auth.isLoading = false
    view.rerender(<FutebolRoot config={config} session={session} />)
    expect(signIn()).toBeVisible()
    expect(window.location.search).toBe('?code=synthetic&state=synthetic')
    expect(request).not.toHaveBeenCalled()
    expect(destroy).not.toHaveBeenCalled()
  })

  it('opens only after /me and workspace verify the same bearer against the configured API', async () => {
    const { calls } = fixture()
    expect(await screen.findByRole('heading', { name: 'Configure a partida' })).toBeVisible()
    expect(calls('/me')).toHaveLength(1)
    expect(calls('/workspace')).toHaveLength(1)
    for (const [url, options] of [...calls('/me'), ...calls('/workspace')]) {
      expect((url as URL).origin).toBe(config.apiBaseUrl)
      expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Authorization: expect.stringMatching(/^Bearer /) as string } })
    }
    expect(calls('/workspace')[0]?.[1]?.headers).toEqual(calls('/me')[0]?.[1]?.headers)
  })

  it('keeps a mounted draft across refresh transport failure, offline and revalidation', async () => {
    const { request, response, calls, destroy, session } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    const draft = draftField()
    fireEvent.change(draft, { target: { value: 'Rascunho transitório' } })
    session.memory.setSessionItem(StorageKeys.accessToken, jwt(-1))
    request.mockImplementation(url => {
      const target = requestUrl(url)
      return target.pathname === '/oauth2/token'
        ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(response(target))
    })
    foreground()
    await waitFor(() => expect(calls('/oauth2/token')).toHaveLength(1))
    disconnect()
    expect(screen.getByText(/Sessão temporariamente indisponível/)).toBeVisible()
    expect(draft).not.toBeVisible()
    expect(draft).toBeInTheDocument()
    expect(destroy).not.toHaveBeenCalled()
    expect(session.memory.getSessionItem(StorageKeys.refreshToken)).toBe('synthetic-memory-refresh')
    request.mockImplementation(url => Promise.resolve(response(requestUrl(url))))
    connect()
    await waitFor(() => expect(draft).toBeVisible())
    expect(draftField()).toBe(draft)
    expect(draft).toHaveValue('Rascunho transitório')
    expect(calls('/oauth2/token')).toHaveLength(2)
    expect(calls('/me')).toHaveLength(2)
    expect(calls('/workspace')).toHaveLength(2)
  })

  it('renews an expired token before sending the first API request', async () => {
    const { request, calls, session } = fixture(-1)
    await screen.findByRole('heading', { name: 'Configure a partida' })
    expect(request.mock.calls.map(([url]) => requestUrl(url).pathname)).toEqual(['/oauth2/token', '/me', '/workspace'])
    const renewed = session.memory.getSessionItem(StorageKeys.accessToken) as string
    expect(calls('/me')[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${renewed}` })
  })

  it('limits automatic retries while a transport failure persists online', async () => {
    const { request, calls, session } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    session.memory.setSessionItem(StorageKeys.accessToken, jwt(-1))
    request.mockRejectedValue(new TypeError('Failed to fetch'))
    foreground()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(screen.getByText(/Sessão temporariamente indisponível/)).toBeVisible()
    foreground(); connect()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(calls('/oauth2/token')).toHaveLength(2)
    expect(calls('/workspace')).toHaveLength(1)
  })

  it('uses explicit re-entry for an opaque SDK HTTP rejection without repeating the exchange', async () => {
    const { request, calls, destroy, session } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    session.memory.setSessionItem(StorageKeys.accessToken, jwt(-1))
    request.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    foreground()
    expect(await screen.findByRole('button', { name: 'Entrar novamente com Sabará ID' })).toBeVisible()
    foreground(); connect()
    expect(calls('/oauth2/token')).toHaveLength(1)
    expect(destroy).not.toHaveBeenCalled()
    expect(screen.queryByText('invalid_grant')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Configure a partida' })).not.toBeInTheDocument()
  })

  it('ends a session on a real API 401 after a successful renewal', async () => {
    const { request, response, calls, destroy } = fixture(-1)
    request.mockImplementation(url => {
      const target = requestUrl(url)
      return Promise.resolve(target.pathname === '/me' ? Response.json({}, { status: 401 }) : response(target))
    })
    await screen.findByRole('button', { name: 'Entrar com Sabará ID' })
    expect(calls('/oauth2/token')).toHaveLength(1)
    expect(calls('/workspace')).toHaveLength(0)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('checks current membership on resource 403 without ending the session', async () => {
    const { request, response, calls, destroy } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    request.mockImplementation(url => {
      const target = requestUrl(url)
      if (target.pathname.endsWith('/matches')) return Promise.resolve(Response.json({}, { status: 403 }))
      if (target.pathname === '/workspace') return Promise.resolve(Response.json({ groups: [], players: [] }))
      return Promise.resolve(response(target))
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir histórico' }))
    expect(await screen.findByRole('button', { name: 'Criar grupo' })).toBeVisible()
    expect(screen.queryByText(group.name)).not.toBeInTheDocument()
    expect(calls('/oauth2/token')).toHaveLength(0)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('treats /me 403 as workspace denial without destroying the SDK session', async () => {
    const { request, calls, destroy } = fixture()
    request.mockResolvedValue(Response.json({}, { status: 403 }))
    expect(await screen.findByText('Seu acesso ao espaço de trabalho não foi confirmado.')).toBeVisible()
    expect(calls('/workspace')).toHaveLength(0)
    expect(calls('/oauth2/token')).toHaveLength(0)
    expect(destroy).not.toHaveBeenCalled()
  })

  it.each(['/me', '/workspace'])('removes previously authorized data after a definitive %s 403', async (path) => {
    const { request, response, destroy, calls } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    const draft = draftField()
    fireEvent.change(draft, { target: { value: 'Rascunho revogado' } })
    request.mockImplementation(url => {
      const target = requestUrl(url)
      return Promise.resolve(target.pathname === path ? Response.json({}, { status: 403 }) : response(target))
    })
    foreground()
    await screen.findByText('Seu acesso ao espaço de trabalho não foi confirmado.')
    expect(draft).not.toBeInTheDocument()
    expect(screen.queryByText(group.name)).not.toBeInTheDocument()
    expect(destroy).not.toHaveBeenCalled()
    expect(calls('/oauth2/token')).toHaveLength(0)

    request.mockImplementation(url => Promise.resolve(response(requestUrl(url))))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByRole('heading', { name: 'Configure a partida' })
    expect(draftField()).toHaveValue('')
  })

  it('deduplicates foreground, pageshow, reconnect and manual access during an outstanding renewal', async () => {
    const { request, response, calls, session } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    session.memory.setSessionItem(StorageKeys.accessToken, jwt(-1))
    let release!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    request.mockImplementation(url => {
      const target = requestUrl(url)
      return target.pathname === '/oauth2/token' ? pending : Promise.resolve(response(target))
    })
    foreground()
    await waitFor(() => expect(calls('/oauth2/token')).toHaveLength(1))
    disconnect(); connect(); foreground()
    fireEvent(window, Object.assign(new Event('pageshow'), { persisted: true }))
    expect(calls('/oauth2/token')).toHaveLength(1)
    await act(async () => { release(response(new URL('/oauth2/token', config.identity.domain))); await pending })
    await screen.findByRole('heading', { name: 'Configure a partida' })
    expect(calls('/oauth2/token')).toHaveLength(1)
    expect(calls('/me')).toHaveLength(2)
  })

  it('aborts pending private data on logout and ignores a late response', async () => {
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    rememberSelectedGroup(profileId, group.id)
    const { request, destroy } = fixture()
    request.mockReturnValue(pending)
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sair' }))
    expect(mocks.auth.logout).toHaveBeenCalledOnce()
    expect(readSelectedGroup(profileId)).toBeNull()
    expect(destroy).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    await act(async () => { release(Response.json({ id: profileId })); await pending })
    expect(signIn()).toBeVisible()
    expect(request).toHaveBeenCalledOnce()
  })

  it('blocks a late SDK refresh from repopulating token storage after cross-tab logout', async () => {
    const channels: { onmessage: ((event: MessageEvent<unknown>) => void) | null }[] = []
    vi.stubGlobal('BroadcastChannel', class {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      constructor() { channels.push(this) }
      close() { /* disposable channel */ }
    })
    const { request, calls, session, response } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    session.memory.setSessionItem(StorageKeys.accessToken, jwt(-1))
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    request.mockReturnValue(pending)
    foreground()
    await waitFor(() => expect(calls('/oauth2/token')).toHaveLength(1))
    act(() => channels[0]?.onmessage?.(new MessageEvent('message', { data: 'logout' })))
    await act(async () => { release(response(new URL('/oauth2/token', config.identity.domain))); await pending })
    expect(signIn()).toBeVisible()
    expect(mocks.auth.logout).not.toHaveBeenCalled()
    expect(session.memory.getSessionItem(StorageKeys.accessToken)).toBeNull()
    expect(session.memory.getSessionItem(StorageKeys.refreshToken)).toBeNull()
    expect(calls('/me')).toHaveLength(1)
  })

  it('discards the previous account when foreground verification returns another internal ID', async () => {
    const { request, calls, response, destroy, session } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    fireEvent.change(draftField(), { target: { value: 'Somente conta anterior' } })
    session.memory.setSessionItem(StorageKeys.accessToken, jwt(-1))
    request.mockImplementation(url => {
      const target = requestUrl(url)
      return Promise.resolve(target.pathname === '/me' ? Response.json({ id: anotherId }) : response(target))
    })
    foreground()
    await screen.findByRole('button', { name: 'Entrar com Sabará ID' })
    expect(screen.queryByDisplayValue('Somente conta anterior')).not.toBeInTheDocument()
    expect(calls('/workspace')).toHaveLength(1)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('handles cross-tab logout before the SDK mounts its children', () => {
    let receiveLogout: ((event: MessageEvent<unknown>) => void) | undefined
    vi.stubGlobal('BroadcastChannel', class {
      set onmessage(listener: (event: MessageEvent<unknown>) => void) { receiveLogout = listener }
      close() { /* disposable channel */ }
    })
    mocks.provider.mockReturnValue(false)
    mocks.auth.isLoading = true
    const { request, session, view } = fixture()
    act(() => receiveLogout?.(new MessageEvent('message', { data: 'logout' })))
    session.memory.setSessionItem(StorageKeys.accessToken, jwt(600))
    mocks.provider.mockReturnValue(true)
    mocks.auth.isLoading = false
    view.rerender(<FutebolRoot config={config} session={session} />)
    expect(signIn()).toBeVisible()
    expect(request).not.toHaveBeenCalled()
    expect(session.memory.getSessionItem(StorageKeys.accessToken)).toBeNull()
  })
  it('invalida o rascunho ao revalidar o grupo com papel de membro', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const { request, response } = fixture()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    fireEvent.change(draftField(), { target: { value: 'Rascunho antes da revogação' } })
    await screen.findByText('Rascunho guardado neste dispositivo.')
    request.mockImplementation(input => {
      const url = requestUrl(input)
      return Promise.resolve(url.pathname === '/workspace'
        ? Response.json({ groups: [{ ...group, role: 'member' }], players }) : response(url))
    })
    foreground()
    await screen.findByText('Membro')
    expect(screen.queryByRole('textbox', { name: /Nome.*opcional/ })).toBeNull()
    request.mockImplementation(input => Promise.resolve(response(requestUrl(input))))
    foreground()
    await screen.findByRole('heading', { name: 'Configure a partida' })
    expect(draftField()).toHaveValue('')
  })
})
