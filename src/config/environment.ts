import { validateSupabaseEnvironment, type EnvironmentValidationOptions, type PublicEnvironment } from './public-environment'

export { SupabaseConfigurationError } from './public-environment'
export type { SupabaseEnvironment } from './public-environment'

export function getSupabaseEnvironment(
  env: PublicEnvironment = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  },
  options: EnvironmentValidationOptions = {
    required: false,
    allowLocalHttp: import.meta.env.DEV || import.meta.env.MODE === 'local-test',
  },
) {
  return validateSupabaseEnvironment(env, options)
}
