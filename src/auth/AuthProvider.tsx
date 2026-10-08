import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { AuthContext, type AuthActionResult, type SignUpCredentials } from './auth-context'
import { authRedirectUrl } from './redirect-url'

interface AuthProviderProps extends PropsWithChildren {
  client: FutebolSupabaseClient | null
  initialSession: Session | null
}

const NOT_CONFIGURED = 'A autenticação não está configurada neste ambiente.'

export function AuthProvider({ children, client, initialSession }: AuthProviderProps) {
  const [session, setSession] = useState(initialSession)

  useEffect(() => {
    if (!client) {
      return undefined
    }

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => data.subscription.unsubscribe()
  }, [client])

  const value = useMemo(() => ({
    configured: client !== null,
    session: client ? session : null,
    async signUp({ displayName, email, password }: SignUpCredentials): Promise<AuthActionResult> {
      if (!client) return { error: NOT_CONFIGURED }
      return safeAction(async () => { const { error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: authRedirectUrl(window.location.origin),
        },
      })
      return { error: error ? friendlyAuthError(error.code, 'cadastro') : null } })
    },
    async signIn(email: string, password: string): Promise<AuthActionResult> {
      if (!client) return { error: NOT_CONFIGURED }
      return safeAction(async () => { const { error } = await client.auth.signInWithPassword({ email, password })
      return { error: error ? friendlyAuthError(error.code, 'login') : null } })
    },
    async signOut(): Promise<AuthActionResult> {
      if (!client) return { error: NOT_CONFIGURED }
      return safeAction(async () => { const { error } = await client.auth.signOut({ scope: 'local' })
      return { error: error ? 'Não foi possível sair agora. Tente novamente.' : null } })
    },
    async sendPasswordRecovery(email: string): Promise<AuthActionResult> {
      if (!client) return { error: NOT_CONFIGURED }
      return safeAction(async () => { const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl(window.location.origin),
      })
      return { error: error ? friendlyAuthError(error.code, 'recuperacao') : null } })
    },
    async updatePassword(password: string): Promise<AuthActionResult> {
      if (!client) return { error: NOT_CONFIGURED }
      return safeAction(async () => { const { error } = await client.auth.updateUser({ password })
      return { error: error ? friendlyAuthError(error.code, 'senha') : null } })
    },
  }), [client, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

async function safeAction(action: () => Promise<AuthActionResult>): Promise<AuthActionResult> {
  try { return await action() }
  catch { return { error: 'Não foi possível concluir. Confira a conexão e tente novamente.' } }
}

function friendlyAuthError(code: string | undefined, operation: string): string {
  if (code === 'invalid_credentials') return 'E-mail ou senha incorretos.'
  if (code === 'user_already_exists' || code === 'email_exists') return 'Já existe uma conta com este e-mail.'
  if (code === 'weak_password') return 'Escolha uma senha mais forte, com pelo menos 8 caracteres.'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Muitas tentativas em pouco tempo. Aguarde e tente novamente.'
  }
  if (operation === 'recuperacao') return 'Não foi possível enviar o e-mail de recuperação.'
  if (operation === 'senha') return 'Não foi possível atualizar a senha.'
  if (operation === 'cadastro') return 'Não foi possível criar a conta.'
  return 'Não foi possível entrar. Tente novamente.'
}
