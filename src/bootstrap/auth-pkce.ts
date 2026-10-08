import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { SupabaseConfigurationError } from '../config/environment'
import { getSupabaseClient, type FutebolSupabaseClient } from '../lib/supabase/client'

const AUTH_QUERY_PARAMETERS = [
  'code',
  'sb_flow_id',
  'error',
  'error_code',
  'error_description',
] as const

export type AuthCallback =
  | { kind: 'none' }
  | { kind: 'pkce'; code: string; flowId?: string }
  | { kind: 'error'; code?: string; description: string }

export interface BootstrapContext {
  authCallback: AuthCallback
  client: FutebolSupabaseClient | null
  message: string | null
  session: Session | null
}

interface BootstrapDependencies {
  client?: FutebolSupabaseClient | null
  replaceUrl?: (url: string) => void
}

export function readAuthCallback(url: URL): AuthCallback {
  const error = url.searchParams.get('error')
  const errorCode = url.searchParams.get('error_code')
  const errorDescription = url.searchParams.get('error_description')

  if (error || errorCode || errorDescription) {
    return {
      kind: 'error',
      code: errorCode ?? error ?? undefined,
      description: errorDescription ?? 'Não foi possível concluir a autenticação.',
    }
  }

  const code = url.searchParams.get('code')

  if (!code) {
    return { kind: 'none' }
  }

  const flowId = url.searchParams.get('sb_flow_id')
  return { kind: 'pkce', code, flowId: flowId ?? undefined }
}

export function cleanAuthCallbackUrl(url: URL, hash: string = url.hash): string {
  const cleanUrl = new URL(url)
  AUTH_QUERY_PARAMETERS.forEach((parameter) => cleanUrl.searchParams.delete(parameter))
  cleanUrl.hash = hash
  return `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`
}

export async function bootstrapApplication(
  url: URL,
  dependencies: BootstrapDependencies = {},
): Promise<BootstrapContext> {
  const authCallback = readAuthCallback(url)
  const replaceUrl = dependencies.replaceUrl
    ?? ((nextUrl: string) => window.history.replaceState({}, '', nextUrl))
  let client: FutebolSupabaseClient | null

  try {
    client = dependencies.client === undefined ? getSupabaseClient() : dependencies.client
  } catch (error) {
    const message = error instanceof SupabaseConfigurationError
      ? error.message
      : 'Não foi possível configurar a autenticação.'

    if (authCallback.kind !== 'none') {
      replaceUrl(cleanAuthCallbackUrl(url, '#/login'))
    }

    return { authCallback, client: null, message, session: null }
  }

  if (authCallback.kind === 'error') {
    replaceUrl(cleanAuthCallbackUrl(url, '#/login'))
    return {
      authCallback,
      client,
      message: friendlyCallbackError(authCallback.code),
      session: null,
    }
  }

  if (authCallback.kind === 'pkce') {
    if (!client) {
      replaceUrl(cleanAuthCallbackUrl(url, '#/login'))
      return {
        authCallback,
        client,
        message: 'A autenticação ainda não está configurada neste ambiente.',
        session: null,
      }
    }

    let recoveryEvent = false
    const { data: listener } = client.auth.onAuthStateChange((event: AuthChangeEvent) => {
      recoveryEvent ||= event === 'PASSWORD_RECOVERY'
    })

    try {
      const { data, error } = await client.auth.exchangeCodeForSession(
        authCallback.code,
        authCallback.flowId ? { flowId: authCallback.flowId } : undefined,
      )

      if (error) {
        replaceUrl(cleanAuthCallbackUrl(url, '#/login'))
        return {
          authCallback,
          client,
          message: 'Este link não pôde ser usado. Solicite um novo e tente novamente.',
          session: null,
        }
      }

      replaceUrl(cleanAuthCallbackUrl(url, recoveryEvent ? '#/nova-senha' : '#/'))
      return {
        authCallback,
        client,
        message: recoveryEvent ? 'Defina uma nova senha para concluir a recuperação.' : 'Acesso confirmado.',
        session: data.session,
      }
    } catch {
      replaceUrl(cleanAuthCallbackUrl(url, '#/login'))
      return {
        authCallback,
        client,
        message: 'Este link não pôde ser usado. Solicite um novo e tente novamente.',
        session: null,
      }
    } finally {
      listener.subscription.unsubscribe()
    }
  }

  if (!client) {
    return {
      authCallback,
      client,
      message: 'Configure as variáveis públicas do Supabase para habilitar o acesso.',
      session: null,
    }
  }

  try {
    const { data, error } = await client.auth.getSession()
    return { authCallback, client, message: error ? 'Não foi possível restaurar sua sessão. Entre novamente.' : null, session: error ? null : data.session }
  } catch {
    return { authCallback, client, message: 'Não foi possível restaurar sua sessão. Confira a conexão e entre novamente.', session: null }
  }
}

function friendlyCallbackError(code?: string): string {
  if (code === 'otp_expired') {
    return 'Este link expirou. Solicite um novo e tente novamente.'
  }

  if (code === 'access_denied') {
    return 'O acesso não foi autorizado.'
  }

  return 'Não foi possível concluir a autenticação. Tente novamente.'
}
