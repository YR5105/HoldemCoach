/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app from a repo subpath; the deploy workflow sets
  // GITHUB_PAGES=true so asset URLs resolve. Dev and root-domain hosts stay at '/'.
  base: process.env.GITHUB_PAGES === 'true' ? '/HoldemCoach/' : '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    // Scope unit tests to src so Vitest never tries to run the Playwright
    // e2e specs (which use @playwright/test, not Vitest).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/evaluator/**'],
    },
  },
})
