import { getSupabaseEnvironment, SupabaseConfigurationError } from './environment'

describe('getSupabaseEnvironment', () => {
  it('nao inicializa integracao parcial', () => {
    expect(getSupabaseEnvironment({ VITE_SUPABASE_URL: 'https://example.supabase.co' })).toBeNull()
  })

  it('aceita apenas as duas variaveis publicas previstas', () => {
    expect(
      getSupabaseEnvironment({
        VITE_SUPABASE_URL: ' https://abcdefghijklmnopqrst.supabase.co ',
        VITE_SUPABASE_PUBLISHABLE_KEY: ' sb_publishable_AbCdEfGhIjKlMnOpQrStUvWxYz012345 ',
      }),
    ).toEqual({
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      publishableKey: 'sb_publishable_AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    })
  })

  it('rejeita URL insegura fora do ambiente local', () => {
    expect(() => getSupabaseEnvironment({
      VITE_SUPABASE_URL: 'http://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    })).toThrow(SupabaseConfigurationError)
  })

  it('rejeita uma chave secreta no bundle do navegador', () => {
    expect(() => getSupabaseEnvironment({
      VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do-not-use',
    })).toThrow(/chave pública/i)
  })
  it('rejeita service_role codificado como JWT e aceita somente role anon legado', () => {
    const legacy = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.synthetic-signature`
    const env = { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: legacy('service_role') }
    expect(() => getSupabaseEnvironment(env)).toThrow(/chave pública/i)
    expect(() => getSupabaseEnvironment({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('authenticated') })).toThrow(/chave pública/i)
    expect(getSupabaseEnvironment({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('anon') })?.url).toBe('http://127.0.0.1:54321')
  })
})
