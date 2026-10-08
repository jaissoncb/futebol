import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { validateSupabaseEnvironment } from './src/config/public-environment.ts'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, import.meta.dirname, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])
    validateSupabaseEnvironment({
      VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    }, { allowLocalHttp: mode === 'local-test' })
  }
  return {
    base: '/',
    plugins: [
      react(),
      VitePWA({
        base: '/',
        scope: '/',
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: ['icons/app-icon.svg', 'icons/app-icon-512.png'],
        manifest: {
          id: '/',
          name: 'Futebol - Times equilibrados',
          short_name: 'Futebol',
          description: 'Organize partidas entre amigos e sorteie times equilibrados.',
          lang: 'pt-BR',
          start_url: '/#/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#f4f8f6',
          theme_color: '#075b45',
          icons: [
            {
              src: '/icons/app-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
            {
              src: '/icons/app-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{css,html,ico,js,png,svg,webmanifest}'],
          navigateFallback: '/index.html',
          navigateFallbackAllowlist: [/^\/$/],
        },
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './vitest.setup.ts',
      css: true,
    },
  }
})
