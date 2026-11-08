// @vitest-environment-options {"url":"http://localhost:5173/"}
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { FutebolRoot } from './FutebolRoot'
import dev from '../../deployment/frontend-dev.json'
import { validateFutebolEnvironment } from '../config/futebol-environment'
import { readSelectedGroup, rememberSelectedGroup } from '../groups/selected-group'

const config = validateFutebolEnvironment(dev, 'dev')
const profileId = 'd0000000-0000-0000-0000-000000000001'
const mocks = vi.hoisted(() => ({
  provider: vi.fn<(props: Record<string, unknown>) => void>(),
  auth: { isAuthenticated: true, getAccessToken: vi.fn<() => Promise<string | undefined>>(), logout: vi.fn<() => Promise<void>>() },
}))
vi.mock('@kinde-oss/kinde-auth-react', () => ({
  KindeProvider: ({ children, ...props }: { children: ReactNode }) => { mocks.provider(props); return children },
  useKindeAuth: () => mocks.auth,
}))
function transport() {
  return vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(Response.json(
    (url as URL).pathname === '/workspace' ? { groups: [], players: [] } : { id: profileId, display_name: null })))
}
function callbacks() {
  return mocks.provider.mock.lastCall![0].callbacks as {
    onEvent: (event: string, result: { success: boolean }) => void
    onError: (failure: { error: string; errorDescription: string }, state: unknown, context: typeof mocks.auth) => void
  }
}

describe('public Futebol session boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/#/')
    mocks.auth.isAuthenticated = true
    mocks.auth.getAccessToken.mockResolvedValue('synthetic-memory-access')
    mocks.auth.logout.mockResolvedValue(undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })

  it('uses SDK memory/PKCE options and shows no diagnostics or private requests while anonymous', () => {
    mocks.auth.isAuthenticated = false
    const request = transport(); vi.stubGlobal('fetch', request)
    const session = configureKindeSession()
    render(<FutebolRoot config={config} session={session} />)
    expect(mocks.provider.mock.calls[0]![0]).toMatchObject({ ...config.identity, scope: KINDE_SCOPE,
      store: session.memory, useInsecureForRefreshToken: false, refreshOnFocus: true })
    expect(screen.getByRole('button', { name: 'Entrar com Sabará ID' })).toBeVisible()
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/diagnóstico|estabilização|probe/i)).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })
  it('opens the existing domain UI automatically after one /me from the configured HTTPS Function', async () => {
    const request = transport(); vi.stubGlobal('fetch', request)
    render(<FutebolRoot config={config} session={configureKindeSession()} />)
    expect(await screen.findByRole('button', { name: 'Criar grupo' })).toBeVisible()
    expect(request.mock.calls.filter(([url]) => (url as URL).pathname === '/me')).toHaveLength(1)
    for (const [url, options] of request.mock.calls) {
      expect((url as URL).origin).toBe(config.apiBaseUrl)
      expect((url as URL).pathname).not.toContain('__dev')
      expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Authorization: 'Bearer synthetic-memory-access' } })
    }
  })
  it('aborts pending private access on logout, clears only this session and rejects late data', async () => {
    rememberSelectedGroup(profileId, 'group-preference')
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const request = vi.fn<typeof fetch>().mockReturnValue(pending); vi.stubGlobal('fetch', request)
    const session = configureKindeSession(), destroy = vi.spyOn(session.transaction, 'destroySession')
    render(<FutebolRoot config={config} session={session} />)
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sair' }))
    expect(mocks.auth.logout).toHaveBeenCalledWith()
    expect(readSelectedGroup(profileId)).toBeNull()
    expect(destroy).toHaveBeenCalled()
    expect(request.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    await act(async () => { release(Response.json({ id: profileId })); await pending })
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entrar com Sabará ID' })).toBeVisible()
  })
  it('gates refresh on successful official SDK events and removes data if renewed identity changes', async () => {
    let meCalls = 0
    const request = transport().mockImplementation(url => Promise.resolve(Response.json(
      (url as URL).pathname === '/workspace' ? { groups: [], players: [] }
        : { id: ++meCalls > 1 ? 'd0000000-0000-0000-0000-000000000002' : profileId })))
    vi.stubGlobal('fetch', request)
    render(<FutebolRoot config={config} session={configureKindeSession()} />)
    await screen.findByRole('button', { name: 'Criar grupo' })
    await act(async () => { callbacks().onEvent('tokenRefreshed', { success: false }); await Promise.resolve() })
    expect(meCalls).toBe(1)
    mocks.auth.getAccessToken.mockResolvedValue('synthetic-renewed-access')
    await act(async () => { callbacks().onEvent('tokenRefreshed', { success: true }); await Promise.resolve() })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Entrar com Sabará ID' })).toBeVisible()
    expect(request.mock.lastCall![1]?.headers).toMatchObject({ Authorization: 'Bearer synthetic-renewed-access' })
  })
  it('leaves a pending OAuth callback intact on anonymous startup and clears private data on real SDK failure', async () => {
    vi.stubGlobal('fetch', transport())
    const session = configureKindeSession(), destroy = vi.spyOn(session.transaction, 'destroySession')
    render(<FutebolRoot config={config} session={session} />)
    await screen.findByRole('button', { name: 'Criar grupo' })
    window.history.replaceState({}, '', '/?code=synthetic&state=synthetic#/')
    await act(async () => { callbacks().onError({ error: 'ERR_CHECK_AUTH', errorDescription: 'No refresh token found' }, {}, { ...mocks.auth, isAuthenticated: false }); await Promise.resolve() })
    expect(window.location.search).toBe('?code=synthetic&state=synthetic')
    expect(destroy).not.toHaveBeenCalled()
    await act(async () => { callbacks().onError({ error: 'ERR_REFRESH_TOKEN', errorDescription: 'SYNTHETIC_PRIVATE_DETAIL' }, {}, mocks.auth); await Promise.resolve() })
    expect(window.location.search).toBe('')
    expect(destroy).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    expect(screen.queryByText('SYNTHETIC_PRIVATE_DETAIL')).not.toBeInTheDocument()
  })
  it('offers a manual read retry after 503 and never opens groups after denied /me', async () => {
    const request = transport().mockResolvedValue(Response.json({}, { status: 503 })); vi.stubGlobal('fetch', request)
    render(<FutebolRoot config={config} session={configureKindeSession()} />)
    await screen.findByRole('button', { name: 'Tentar novamente' })
    expect(request).toHaveBeenCalledOnce()
    request.mockResolvedValue(Response.json({}, { status: 401 }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByRole('button', { name: 'Entrar com Sabará ID' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('closes data on another Futebol tab logout without a global Kinde logout', async () => {
    const channels: { name: string; onmessage: ((event: MessageEvent<unknown>) => void) | null }[] = []
    vi.stubGlobal('BroadcastChannel', class {
      name: string
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      constructor(name: string) { this.name = name; channels.push(this) }
      close() { /* disposable channel */ }
    })
    vi.stubGlobal('fetch', transport())
    const session = configureKindeSession(), destroy = vi.spyOn(session.transaction, 'destroySession')
    render(<FutebolRoot config={config} session={session} />)
    await screen.findByRole('button', { name: 'Criar grupo' })
    expect(channels[0]?.name).toBe('futebol-dev-session')
    rememberSelectedGroup(profileId, 'group-in-this-tab')
    await act(async () => { channels[0]?.onmessage?.(new MessageEvent('message', { data: 'logout' })); await Promise.resolve() })
    expect(readSelectedGroup(profileId)).toBeNull()
    expect(destroy).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    expect(mocks.auth.logout).not.toHaveBeenCalled()
  })
  it('requires a new /me before reopening data after SDK authentication disappears and returns', async () => {
    const request = transport(); vi.stubGlobal('fetch', request)
    const session = configureKindeSession()
    const view = render(<FutebolRoot config={config} session={session} />)
    await screen.findByRole('button', { name: 'Criar grupo' })
    mocks.auth.isAuthenticated = false
    view.rerender(<FutebolRoot config={config} session={session} />)
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    mocks.auth.isAuthenticated = true
    view.rerender(<FutebolRoot config={config} session={session} />)
    await screen.findByRole('button', { name: 'Criar grupo' })
    expect(request.mock.calls.filter(([url]) => (url as URL).pathname === '/me')).toHaveLength(2)
  })
})
