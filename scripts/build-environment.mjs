import { loadEnv } from 'vite'
import { resolve } from 'node:path'
import { validateSupabaseEnvironment } from '../src/config/public-environment.ts'

export function getBuildEnvironment(mode = 'production') {
  const env = loadEnv(mode, resolve(import.meta.dirname, '..'), ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])
  return validateSupabaseEnvironment({
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  }, { allowLocalHttp: mode === 'local-test' })
}
