import { validateSupabaseEnvironment } from './public-environment'

const key = 'sb_publishable_AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const valid = { VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key }
const legacy = (role?: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(role ? { role } : {}))}.synthetic-signature`

describe('release public environment contract', () => {
  it.each([
    ['URL absent', { ...valid, VITE_SUPABASE_URL: undefined }],
    ['key absent', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: undefined }],
    ['URL empty', { ...valid, VITE_SUPABASE_URL: '   ' }],
    ['key empty', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: '   ' }],
    ['URL placeholder', { ...valid, VITE_SUPABASE_URL: 'https://your-project.supabase.co' }],
    ['example URL', { ...valid, VITE_SUPABASE_URL: 'https://example.supabase.co' }],
    ['key placeholder', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'your-publishable-key' }],
    ['prefixed placeholder', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_placeholder-not-a-real-key' }],
    ['invalid URL', { ...valid, VITE_SUPABASE_URL: 'invalid-url' }],
    ['nonlocal HTTP', { ...valid, VITE_SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' }],
    ['local HTTP release', { ...valid, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }],
    ['URL credentials', { ...valid, VITE_SUPABASE_URL: 'https://synthetic-user:synthetic-password@abcdefghijklmnopqrst.supabase.co' }],
    ['URL query', { ...valid, VITE_SUPABASE_URL: `${valid.VITE_SUPABASE_URL}?token=synthetic` }],
    ['invalid key', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'arbitrary-invalid-string' }],
    ['repeated placeholder key', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'x'.repeat(32)}` }],
    ['private key', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic-not-real' }],
    ['service role literal', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'service_role' }],
    ['service JWT', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('service_role') }],
    ['session JWT', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('authenticated') }],
    ['admin JWT', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('admin') }],
    ['missing JWT role', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: legacy() }],
    ['malformed JWT', { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJmalformed.bad-json.signature' }],
  ])('rejects %s without revealing values', (_name, env) => {
    try {
      validateSupabaseEnvironment(env)
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toHaveProperty('name', 'SupabaseConfigurationError')
      const message = (error as Error).message
      expect(message).toMatch(/VITE_SUPABASE/)
      for (const value of Object.values(env)) if (value?.trim()) expect(message).not.toContain(value)
    }
  })
  it('accepts a publishable shape and normalizes whitespace/trailing slash', () => {
    expect(validateSupabaseEnvironment({ VITE_SUPABASE_URL: ` ${valid.VITE_SUPABASE_URL}/ `, VITE_SUPABASE_PUBLISHABLE_KEY: ` ${key} ` }))
      .toEqual({ url: valid.VITE_SUPABASE_URL, publishableKey: key })
  })
  it.each(['localhost', '127.0.0.1', '[::1]'])('permits HTTP loopback %s only with explicit local options', (host) => {
    expect(validateSupabaseEnvironment({ ...valid, VITE_SUPABASE_URL: `http://${host}:54321` }, { allowLocalHttp: true })).not.toBeNull()
  })
  it('never permits nonlocal HTTP even with local options', () => {
    expect(() => validateSupabaseEnvironment({ ...valid, VITE_SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' }, { allowLocalHttp: true })).toThrow(/HTTPS/)
  })
  it('deliberately accepts the existing legacy anon compatibility', () => {
    expect(validateSupabaseEnvironment({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('anon') })).not.toBeNull()
  })
})
