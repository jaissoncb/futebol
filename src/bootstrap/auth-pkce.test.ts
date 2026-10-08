import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { bootstrapApplication, cleanAuthCallbackUrl, readAuthCallback } from './auth-pkce'

const session = { user: { email: 'jogador@example.com' } } as Session

function createClientMock(options: {
  callbackEvent?: AuthChangeEvent
  exchangeError?: boolean
  initialSession?: Session | null
  onExchange?: (code: string, options?: { flowId?: string }) => void
} = {}): FutebolSupabaseClient {
  let listener: ((event: AuthChangeEvent, session: Session | null) => void) | undefined

  return {
    auth: {
      exchangeCodeForSession: vi.fn((code: string, exchangeOptions?: { flowId?: string }) => {
        options.onExchange?.(code, exchangeOptions)
        if (options.callbackEvent) listener?.(options.callbackEvent, session)
        return Promise.resolve(options.exchangeError
          ? { data: { session: null, user: null }, error: { message: 'technical detail' } }
          : { data: { session, user: session.user }, error: null })
      }),
      getSession: vi.fn(() => Promise.resolve({
        data: { session: options.initialSession ?? null },
        error: null,
      })),
      onAuthStateChange: vi.fn((callback: (event: AuthChangeEvent, session: Session | null) => void) => {
        listener = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
    },
  } as unknown as FutebolSupabaseClient
}

describe('readAuthCallback', () => {
  it('lê o code PKCE da query antes da rota hash', () => {
    expect(readAuthCallback(new URL('https://futebol.sabara.org/?code=abc&sb_flow_id=flow-1#/')))
      .toEqual({ kind: 'pkce', code: 'abc', flowId: 'flow-1' })
  })

  it('normaliza callback de erro sem depender do hash', () => {
    expect(readAuthCallback(new URL('https://futebol.sabara.org/?error_code=otp_expired#/')))
      .toEqual({ kind: 'error', code: 'otp_expired', description: 'Não foi possível concluir a autenticação.' })
  })
})

describe('cleanAuthCallbackUrl', () => {
  it('remove somente parâmetros de autenticação e preserva a raiz', () => {
    const url = new URL('https://futebol.sabara.org/?utm_source=email&code=secret&sb_flow_id=flow#/login')
    expect(cleanAuthCallbackUrl(url, '#/')).toBe('/?utm_source=email#/')
  })
})

describe('bootstrapApplication', () => {
  it('mantém o aplicativo utilizável se a restauração da sessão lançar erro de rede', async () => {
    const client = createClientMock()
    client.auth.getSession = vi.fn().mockRejectedValue(new Error('private network error'))
    const context = await bootstrapApplication(new URL('https://futebol.sabara.org/'), { client })
    expect(context.session).toBeNull()
    expect(context.message).toMatch(/Confira a conexão/)
    expect(context.message).not.toContain('private')
  })
  it('troca o code antes de limpar a URL e disponibilizar a sessão', async () => {
    const order: string[] = []
    const exchanged: unknown[] = []
    const client = createClientMock({
      onExchange: (code, options) => {
        order.push('exchange')
        exchanged.push(code, options)
      },
    })

    const context = await bootstrapApplication(
      new URL('https://futebol.sabara.org/?code=one-time-code&sb_flow_id=flow#/login'),
      { client, replaceUrl: (url) => order.push(`replace:${url}`) },
    )

    expect(order).toEqual(['exchange', 'replace:/#/'])
    expect(exchanged).toEqual(['one-time-code', { flowId: 'flow' }])
    expect(context.session).toBe(session)
  })

  it('direciona a recuperação de senha para sua rota', async () => {
    const replaceUrl = vi.fn()
    await bootstrapApplication(new URL('https://futebol.sabara.org/?code=recovery'), {
      client: createClientMock({ callbackEvent: 'PASSWORD_RECOVERY' }),
      replaceUrl,
    })
    expect(replaceUrl).toHaveBeenCalledWith('/#/nova-senha')
  })

  it('limpa callbacks com erro e não expõe a descrição técnica', async () => {
    const replaceUrl = vi.fn()
    const context = await bootstrapApplication(
      new URL('https://futebol.sabara.org/?error=access_denied&error_description=internal#/'),
      { client: createClientMock(), replaceUrl },
    )
    expect(replaceUrl).toHaveBeenCalledWith('/#/login')
    expect(context.message).toBe('O acesso não foi autorizado.')
    expect(context.message).not.toContain('internal')
  })

  it('restaura a sessão persistida quando não há callback', async () => {
    const context = await bootstrapApplication(new URL('https://futebol.sabara.org/#/'), {
      client: createClientMock({ initialSession: session }),
    })
    expect(context.session).toBe(session)
  })

  it('explica quando o ambiente Supabase ainda não está configurado', async () => {
    const context = await bootstrapApplication(new URL('https://futebol.sabara.org/#/'), {
      client: null,
    })
    expect(context.session).toBeNull()
    expect(context.message).toMatch(/configure as variáveis públicas/i)
  })

  it('limpa o code mesmo quando a troca falha', async () => {
    const replaceUrl = vi.fn()
    const context = await bootstrapApplication(new URL('https://futebol.sabara.org/?code=used'), {
      client: createClientMock({ exchangeError: true }),
      replaceUrl,
    })
    expect(replaceUrl).toHaveBeenCalledWith('/#/login')
    expect(context.message).not.toContain('technical detail')
  })
})
