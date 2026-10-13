import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE || '/reconocimiento-ejercicio/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'KINETIC · Reconocimiento de ejercicio',
        short_name: 'KINETIC',
        description: 'Cuenta repeticiones, series y analiza tu técnica con visión artificial.',
        theme_color: '#070a14',
        background_color: '#070a14',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|storage\.googleapis\.com)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'mediapipe', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 60 } }
          }
        ]
      }
    })
  ]
})
