import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { KindeDevRoot } from './KindeDevRoot'
import { kindeTestConfig } from './kinde-test-config'

const mocks = vi.hoisted(() => ({
  provider: vi.fn<(props: Record<string, unknown>) => void>(),
  auth: { isAuthenticated: true, getAccessToken: vi.fn<() => Promise<string | undefined>>(),
    getIdToken: vi.fn<() => Promise<string | undefined>>(), logout: vi.fn<() => Promise<void>>() },
}))
vi.mock('@kinde-oss/kinde-auth-react', () => ({
  KindeProvider: ({ children, ...props }: { children: ReactNode }) => { mocks.provider(props); return children },
  useKindeAuth: () => mocks.auth,
}))

describe('Futebol Kinde DEV boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); window.location.hash = '#/'
    mocks.auth.isAuthenticated = true
    mocks.auth.getAccessToken.mockResolvedValue('synthetic-memory-access')
    mocks.auth.getIdToken.mockResolvedValue('synthetic-memory-id')
    mocks.auth.logout.mockResolvedValue(undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })
  it('uses only Futebol public metadata, safe SDK options and the explicit Account portal', () => {
    const session = configureKindeSession()
    render(<KindeDevRoot session={session} />)
    const props = mocks.provider.mock.calls[0]![0]
    expect(props).toMatchObject({ ...kindeTestConfig, scope: KINDE_SCOPE, useInsecureForRefreshToken: false, refreshOnFocus: true })
    expect(props.forceChildrenRender).not.toBe(true)
    expect(props.store).toBe(session.memory)
    expect(screen.getByRole('link', { name: 'Gerenciar minha conta Sabará' })).toHaveAttribute('href', 'https://account.sabara.org/')
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
  })
  it('normal logout cancels a pending private response, clears memory and never asks allSessions', async () => {
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending)
    vi.stubGlobal('fetch', transport)
    const session = configureKindeSession()
    const destroy = vi.spyOn(session.transaction, 'destroySession')
    render(<KindeDevRoot session={session} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    await waitFor(() => expect(transport).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Sair' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(mocks.auth.logout).toHaveBeenCalledWith()
    expect(destroy).toHaveBeenCalled()
    expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    await act(async () => { release(new Response(JSON.stringify({ id: 'old-fixture-user' }))); await pending })
    expect(screen.queryByText('Acesso ao Futebol confirmado.')).not.toBeInTheDocument()
  })
  it('diagnoses only successful SDK refresh events, stops token requests on logout and keeps data separate', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', transport)
    render(<KindeDevRoot session={configureKindeSession()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar diagnóstico G3' }))
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(3))
    const callbacks = mocks.provider.mock.lastCall![0].callbacks as {
      onEvent: (event: string, result: { success: boolean }, context: typeof mocks.auth) => void
    }
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success: false }, mocks.auth); await Promise.resolve() })
    expect(transport).toHaveBeenCalledTimes(3)
    mocks.auth.getAccessToken.mockResolvedValue('synthetic-new-access')
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success: true }, mocks.auth); await Promise.resolve() })
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(4))
    expect(transport.mock.lastCall![1]?.headers).toEqual({ Authorization: 'Bearer synthetic-new-access' })
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success: true }, mocks.auth); await Promise.resolve() })
    expect(transport).toHaveBeenCalledTimes(4)
    expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    for (const [url] of transport.mock.calls) expect(url).toEqual(expect.stringContaining('/__dev/g3'))
  })
  it('mounts the existing domain UI only after two stable UUID /me responses; logout removes private data', async () => {
    const profileId = 'd0000000-0000-0000-0000-000000000001'
    const transport = vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(Response.json(
      (url as URL).pathname === '/workspace' ? { groups: [], players: [] } : { id: profileId, display_name: null })))
    vi.stubGlobal('fetch', transport)
    render(<KindeDevRoot session={configureKindeSession()} />)
    const user = userEvent.setup()
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    expect(await screen.findByRole('button', { name: 'Criar grupo' })).toBeVisible()
    expect(transport.mock.calls.filter(([url]) => (url as URL).pathname === '/me')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entrar com Sabará ID' })).toBeVisible()
  })
  it('does not mount domain UI for inconsistent identities returned by /me', async () => {
    let calls = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json({
      id: `d0000000-0000-0000-0000-00000000000${++calls}`, display_name: null,
    })))
    vi.stubGlobal('fetch', transport)
    render(<KindeDevRoot session={configureKindeSession()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
  })
  it('checks /me with renewed memory access only after a successful SDK event and stops on logout', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(Response.json(
      (url as URL).pathname === '/workspace' ? { groups: [], players: [] }
        : { id: 'd0000000-0000-0000-0000-000000000001', display_name: null })))
    vi.stubGlobal('fetch', transport)
    render(<KindeDevRoot session={configureKindeSession()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    await screen.findByRole('button', { name: 'Criar grupo' })
    const callbacks = mocks.provider.mock.lastCall![0].callbacks as {
      onEvent: (event: string, result: { success: boolean }, context: typeof mocks.auth) => void
    }
    const meCalls = () => transport.mock.calls.filter(([url]) => (url as URL).pathname === '/me')
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success: false }, mocks.auth); await Promise.resolve() })
    expect(meCalls()).toHaveLength(2)
    mocks.auth.getAccessToken.mockResolvedValue('synthetic-renewed-access')
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success: true }, mocks.auth); await Promise.resolve() })
    await waitFor(() => expect(meCalls()).toHaveLength(3))
    expect(meCalls()[2]![1]?.headers).toMatchObject({ Authorization: 'Bearer synthetic-renewed-access' })
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success: true }, mocks.auth); await Promise.resolve() })
    expect(meCalls()).toHaveLength(3)
  })
  it('removes private UI when a renewed /me changes identity', async () => {
    let meCalls = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(Response.json(
      (url as URL).pathname === '/workspace' ? { groups: [], players: [] }
        : { id: `d0000000-0000-0000-0000-00000000000${++meCalls > 2 ? 2 : 1}`, display_name: null })))
    vi.stubGlobal('fetch', transport)
    render(<KindeDevRoot session={configureKindeSession()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    await screen.findByRole('button', { name: 'Criar grupo' })
    const callbacks = mocks.provider.mock.lastCall![0].callbacks as {
      onEvent: (event: string, result: { success: boolean }, context: typeof mocks.auth) => void
    }
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success: true }, mocks.auth); await Promise.resolve() })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument())
    expect(screen.getByText('Não foi possível confirmar o acesso. Entre novamente.')).toBeVisible()
  })
  it('does not reuse a closed private client after SDK authentication disappears and returns', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(Response.json(
      (url as URL).pathname === '/workspace' ? { groups: [], players: [] }
        : { id: 'd0000000-0000-0000-0000-000000000001', display_name: null })))
    vi.stubGlobal('fetch', transport)
    const session = configureKindeSession()
    const view = render(<KindeDevRoot session={session} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    await screen.findByRole('button', { name: 'Criar grupo' })
    mocks.auth.isAuthenticated = false
    view.rerender(<KindeDevRoot session={session} />)
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    mocks.auth.isAuthenticated = true
    view.rerender(<KindeDevRoot session={session} />)
    expect(screen.queryByRole('button', { name: 'Criar grupo' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    expect(await screen.findByRole('button', { name: 'Criar grupo' })).toBeVisible()
  })
  it('backs off once for a renewed /me 503 without retrying writes or changing identity', async () => {
    let calls = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(
      (url as URL).pathname === '/workspace' ? Response.json({ groups: [], players: [] })
        : ++calls === 3 ? Response.json({error:'identity_unavailable'},{status:503})
          : Response.json({id:'d0000000-0000-0000-0000-000000000001',display_name:null})))
    vi.stubGlobal('fetch', transport)
    render(<KindeDevRoot session={configureKindeSession()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Verificar acesso ao Futebol' }))
    await screen.findByRole('button', { name: 'Criar grupo' })
    const callbacks = mocks.provider.mock.lastCall![0].callbacks as {
      onEvent: (event: string, result: { success: boolean }, context: typeof mocks.auth) => void
    }
    vi.useFakeTimers()
    await act(async () => { callbacks.onEvent('tokenRefreshed', { success:true },mocks.auth); await Promise.resolve() })
    expect(calls).toBe(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
    expect(calls).toBe(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(calls).toBe(4)
    expect(screen.getByRole('button', {name:'Criar grupo'})).toBeVisible()
    expect(transport.mock.calls.every(([,options]) => !options?.method || options.method === 'GET')).toBe(true)
  })
})
