import type { FutebolSupabaseClient } from './supabase/client'
import type { FutebolApiServices } from './api/services'

// Transitional type boundary: DEV can reuse the reviewed domain UI without a
// fake Supabase session/client or any Supabase runtime initialization.
export type FutebolDataClient = FutebolSupabaseClient | FutebolApiServices
export function isApiServices(client: FutebolDataClient): client is FutebolApiServices {
  return 'kind' in client && client.kind === 'futebol-api'
}
