import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { validateFutebolEnvironment } from './src/config/futebol-environment.ts'

export default defineConfig(({ mode }) => {
  const publicEntry = mode !== 'kinde-dev' && mode !== 'test'
  let frontendConfig
  if (publicEntry) {
    const environment = mode === 'futebol-dev' ? 'dev' : mode === 'production' ? 'prd' : null
    if (!environment) throw new Error('Use um modo explícito: futebol-dev ou production.')
    frontendConfig = validateFutebolEnvironment(JSON.parse(readFileSync(
      new URL(`./deployment/frontend-${environment}.json`, import.meta.url), 'utf8')), environment)
  }
  return {
    base: '/',
    envDir: false,
    envPrefix: [],
    define: frontendConfig ? { __FUTEBOL_FRONTEND_CONFIG__: JSON.stringify(frontendConfig) } : {},
    server: { watch: { ignored: ['**/dist-dev/**'] } },
    plugins: [
      ...(publicEntry ? [{
        name: 'futebol-public-runtime-graph',
        generateBundle(_options: unknown, bundle: Record<string, { type: string; modules?: Record<string, unknown> }>) {
          for (const chunk of Object.values(bundle)) {
            for (const raw of Object.keys(chunk.modules ?? {})) {
              const id = raw.replaceAll('\\', '/')
              if (id.startsWith(`${import.meta.dirname.replaceAll('\\', '/')}/api/`)
                || /\/src\/(dev\/|App\.tsx|auth\/AuthProvider\.tsx|bootstrap\/auth-pkce\.ts|lib\/supabase\/client\.ts)|\/node_modules\/(?:\.pnpm\/@supabase\+|@supabase\/)|\.test\.[cm]?[jt]sx?$/.test(id)) {
                throw new Error('Módulo privado, legado ou de diagnóstico no grafo publicável.')
              }
            }
          }
        },
      }] : []),
      ...(mode === 'kinde-dev' ? [{
        name: 'futebol-kinde-dev-entry',
        transformIndexHtml: {
          order: 'pre' as const,
          handler(html: string) {
            if (!html.includes('/src/main.tsx')) throw new Error('Entrada DEV inesperada.')
            return html.replace('/src/main.tsx', '/src/dev/start-kinde.tsx')
          },
        },
      }] : []),
      react(),
      VitePWA({
        base: '/',
        scope: '/',
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: ['icons/app-icon.svg', 'icons/apple-touch-icon.png'],
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
              purpose: 'any',
            },
            {
              src: '/icons/app-icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/app-icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icons/app-icon-512-any.png',
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
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: './vitest.setup.ts',
      css: true,
    },
  }
})
