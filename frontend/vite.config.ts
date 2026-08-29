/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The twin of tsconfig.app.json's `paths`. See the comment there.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    // Vite treats every file under the root as a candidate; without this, a `dist/` left over
    // from a previous build gets collected and the suite fails on minified output.
    exclude: ['node_modules/**', 'dist/**'],
  },
})
