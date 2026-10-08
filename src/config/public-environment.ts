export interface SupabaseEnvironment {
  publishableKey: string
  url: string
}

export interface PublicEnvironment {
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
  VITE_SUPABASE_URL?: string
}

export interface EnvironmentValidationOptions {
  required?: boolean
  allowLocalHttp?: boolean
}

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseConfigurationError'
  }
}

/** Shared by the browser, Vite and artifact checks. Errors never contain values. */
export function validateSupabaseEnvironment(
  env: PublicEnvironment,
  { required = true, allowLocalHttp = false }: EnvironmentValidationOptions = {},
): SupabaseEnvironment | null {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) {
    if (!required) return null
    throw new SupabaseConfigurationError(
      `${!url ? 'VITE_SUPABASE_URL' : 'VITE_SUPABASE_PUBLISHABLE_KEY'} é obrigatória para o build.`,
    )
  }

  let parsedUrl: URL
  try { parsedUrl = new URL(url) } catch {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL não contém uma URL válida.')
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL não pode conter credenciais, query ou fragmento.')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if (parsedUrl.protocol !== 'https:' && !(allowLocalHttp && local && parsedUrl.protocol === 'http:')) {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL deve usar HTTPS; HTTP somente no modo local em loopback.')
  }
  if (/(^|[.-])(example|your-project|seu-projeto|placeholder|dummy)([.-]|$)/i.test(parsedUrl.hostname)
    || /\.(invalid|test|example)$/i.test(parsedUrl.hostname)) {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL deve substituir o valor de exemplo.')
  }

  const keyError = () => new SupabaseConfigurationError(
    'Use somente uma chave pública válida em VITE_SUPABASE_PUBLISHABLE_KEY, sem valores de exemplo.',
  )
  if (/sb_secret_|service_role/i.test(publishableKey)) throw keyError()
  if (publishableKey.split('.').length === 3) {
    // Deliberate compatibility with the existing LOCAL E2E and legacy anon keys.
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(publishableKey)) throw keyError()
      const payload: unknown = JSON.parse(atob(publishableKey.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
      if (typeof payload !== 'object' || payload === null || !('role' in payload) || payload.role !== 'anon') throw keyError()
    } catch { throw keyError() }
  } else if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)
    || /^(.)\1+$/.test(publishableKey.slice('sb_publishable_'.length))
    || /(?:^|_)(your|placeholder|dummy|synthetic|example|change[-_]?me)(?:_|-|$)/i.test(publishableKey)) {
    // A shape check, not a signature or project-ownership guarantee.
    throw keyError()
  }
  return { publishableKey, url: parsedUrl.href.replace(/\/$/, '') }
}
