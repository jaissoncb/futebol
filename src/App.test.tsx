import { render, screen } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { AppRoutes } from './App'
import type { BootstrapContext } from './bootstrap/auth-pkce'
import type { FutebolSupabaseClient } from './lib/supabase/client'

function emptyQuery() {
  const response = Promise.resolve({ data: [], error: null })
  const query = {
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    then: response.then.bind(response),
  }
  return query
}

const client = {
  auth: {
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  },
  from: vi.fn(() => emptyQuery()),
} as unknown as FutebolSupabaseClient

function renderRoute(path: string, session: Session | null = null) {
  const bootstrap: BootstrapContext = {
    authCallback: { kind: 'none' },
    client,
    message: null,
    session,
  }

  return render(
    <AuthProvider client={client} initialSession={session}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes bootstrap={bootstrap} />
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('AppRoutes', () => {
  it('oferece login para uma sessão anônima', () => {
    renderRoute('/')
    expect(screen.getByRole('link', { name: /entrar para começar/i })).toBeInTheDocument()
  })

  it('abre o espaço de grupos para uma sessão autenticada', async () => {
    renderRoute('/', { user: { id: 'user-a', email: 'jogador@example.com' } } as Session)
    expect(screen.getByRole('link', { name: /conta/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /monte a sua pelada/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar grupo/i })).toBeEnabled()
  })

  it('expõe as telas mínimas de autenticação', () => {
    renderRoute('/login')
    expect(screen.getByRole('heading', { name: /entre na sua conta/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /esqueci minha senha/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /criar uma conta/i })).toBeInTheDocument()
  })

  it('possui fallback interno sem depender do 404 da raiz', () => {
    renderRoute('/rota-inexistente')
    expect(screen.getByRole('heading', { name: /esta tela ainda não existe/i })).toBeInTheDocument()
  })
})
