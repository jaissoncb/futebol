import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnvironment } from '../../config/environment'
import type { Database } from './database.types'

export type FutebolSupabaseClient = SupabaseClient<Database>

let browserClient: FutebolSupabaseClient | null | undefined

export function getSupabaseClient(): FutebolSupabaseClient | null {
  if (browserClient !== undefined) {
    return browserClient
  }

  const environment = getSupabaseEnvironment()

  if (!environment) {
    browserClient = null
    return browserClient
  }

  browserClient = createClient<Database>(environment.url, environment.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      persistSession: true,
    },
  })

  return browserClient
}

export function resetSupabaseClientForTests(): void {
  browserClient = undefined
}
