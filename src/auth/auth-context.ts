import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export interface AuthActionResult {
  error: string | null
}

export interface SignUpCredentials {
  displayName: string
  email: string
  password: string
}

export interface AuthContextValue {
  configured: boolean
  session: Session | null
  signIn: (email: string, password: string) => Promise<AuthActionResult>
  signOut: () => Promise<AuthActionResult>
  signUp: (credentials: SignUpCredentials) => Promise<AuthActionResult>
  sendPasswordRecovery: (email: string) => Promise<AuthActionResult>
  updatePassword: (password: string) => Promise<AuthActionResult>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider.')
  }

  return context
}
