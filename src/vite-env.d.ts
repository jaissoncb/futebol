/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __FUTEBOL_FRONTEND_CONFIG__: import('./config/futebol-environment').FutebolFrontendConfiguration

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
