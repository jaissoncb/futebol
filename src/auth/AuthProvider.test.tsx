import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './auth-context'

function SessionState() {
  const { session } = useAuth()
  return <span>{session?.user.email ?? 'anônimo'}</span>
}

function LoginAction() {
  const { signIn } = useAuth()
  const [result, setResult] = useState<string | null>(null)
  return <><button onClick={() => { void signIn('fixture@example.test', 'synthetic-password').then((r) => setResult(r.error)) }}>Entrar</button><p>{result}</p></>
}

describe('AuthProvider', () => {
  it('converte exceção de rede em mensagem simples sem expor o erro privado', async () => {
    const client = { auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), signInWithPassword: vi.fn().mockRejectedValue(new Error('private exception')) } } as unknown as FutebolSupabaseClient
    render(<AuthProvider client={client} initialSession={null}><LoginAction /></AuthProvider>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText(/Confira a conexão/)).toBeInTheDocument()
    expect(screen.queryByText(/private exception/)).not.toBeInTheDocument()
  })
  it('acompanha mudanças entre estado autenticado e não autenticado sem rede', () => {
    let notify: ((event: AuthChangeEvent, session: Session | null) => void) | undefined
    const client = {
      auth: {
        onAuthStateChange: vi.fn((callback: typeof notify) => {
          notify = callback
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
      },
    } as unknown as FutebolSupabaseClient

    render(<AuthProvider client={client} initialSession={null}><SessionState /></AuthProvider>)
    expect(screen.getByText('anônimo')).toBeInTheDocument()

    act(() => notify?.('SIGNED_IN', { user: { email: 'jogador@example.com' } } as Session))
    expect(screen.getByText('jogador@example.com')).toBeInTheDocument()

    act(() => notify?.('SIGNED_OUT', null))
    expect(screen.getByText('anônimo')).toBeInTheDocument()
  })
})
