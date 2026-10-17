import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureKindeSession, KINDE_SCOPE } from '../auth/kinde-session'
import { KindeDevRoot } from './KindeDevRoot'
import { kindeTestConfig } from './kinde-test-config'

const mocks = vi.hoisted(() => ({
  provider: vi.fn<(props: Record<string, unknown>) => void>(),
  auth: { isAuthenticated: true, getAccessToken: vi.fn<() => Promise<string | undefined>>(), logout: vi.fn<() => Promise<void>>() },
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
    mocks.auth.logout.mockResolvedValue(undefined)
  })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
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
})
